"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSite, guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { proximoNumeroDocumento } from "@/lib/numeracao";
import { emitirLinkCotacao, linkVigente } from "@/lib/compras/cotacao-link";
import { registrarPrecosDaCotacao } from "@/lib/compras/cotacao-precos";
import { regrasDaCotacao } from "@/lib/compras/cotacao-regras";
import { normalizarFaixas, precoNaQuantidade } from "@/lib/compras/escalas";
import { quantidadeComUnidade, unidadesDosItens } from "@/lib/compras/cotacao-unidades";
import { db } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { emailCotacao } from "@/lib/email/templates";
import { getActiveSiteId, listSites } from "@/lib/sites";

// ============================================================
// Compras (evolução do Quotation/RFQ) — pedir preço, registrar resposta,
// decidir.
//
// Nada aqui mexe em estoque: a compra é planejamento e conversa. Só o passo
// final ("gerar pedidos") cria PurchaseOrder, e aí o fluxo volta a ser o de
// sempre — /pedidos manda no resto da vida do pedido.
// ============================================================

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

async function txp<T>(
  permissao: Permissao,
  siteId: string | null,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => {
  revalidatePath("/cotacoes", "layout");
  revalidatePath("/pedidos", "layout");
  // A mesma cotação vive nas duas superfícies: sem isto, quem monta a lista no
  // celular vê o cache do desktop (e vice-versa).
  revalidatePath("/m/cotacoes", "layout");
};

/**
 * Próximo número sequencial COT-00001 por tenant.
 *
 * Contador atômico no banco (ver `lib/numeracao`), e não contagem nem "maior
 * existente": as duas formas leem antes de escrever, e duas cotações criadas no
 * mesmo segundo recebiam o mesmo número — batendo no unique `[tenantId, numero]`.
 */
async function proximoNumero(tenantId: string): Promise<string> {
  return proximoNumeroDocumento(tenantId, "COT");
}

/**
 * Rascunho sem item E sem fornecedor não é cotação — é um toque em "Nova" que
 * não virou nada. Some sozinho para a lista não encher de casca vazia.
 */
async function descartarSeVazia(id: string): Promise<boolean> {
  const c = await db.quotation.findFirst({
    where: { id, status: "RASCUNHO" },
    select: { _count: { select: { items: true, suppliers: true } } },
  });
  if (!c || c._count.items > 0 || c._count.suppliers > 0) return false;
  await db.quotation.deleteMany({ where: { id, status: "RASCUNHO" } });
  return true;
}

/** Cotação viva: ainda aceita as mudanças de estado (enviar, encerrar, responder). */
async function exigirEditavel(id: string) {
  const c = await db.quotation.findFirst({ where: { id }, select: { status: true, siteId: true } });
  if (!c) throw new Error("Cotação não encontrada.");
  if (c.status === "CANCELADA" || c.status === "DECIDIDA") {
    throw new Error("Esta cotação já foi fechada e não aceita mais mudanças.");
  }
  return c;
}

/**
 * Trava fina de itens e convidados — `regrasDaCotacao` é a fonte única, a
 * mesma que a tela lê para acender ou apagar os botões.
 *
 * Existe separada de `exigirEditavel` porque as duas perguntas são diferentes:
 * "a cotação está viva?" (encerrar, responder, cancelar) e "esta mudança
 * específica ainda é honesta com quem já respondeu?".
 */
async function exigirLicenca(id: string, acao: "itens" | "convidar" | "desconvidar") {
  const c = await db.quotation.findFirst({
    where: { id },
    select: { status: true, siteId: true, suppliers: { select: { status: true } } },
  });
  if (!c) throw new Error("Cotação não encontrada.");
  const licenca = regrasDaCotacao(c.status, c.suppliers)[acao];
  if (!licenca.pode) throw new Error(licenca.motivo ?? "Esta mudança não é mais possível.");
  return c;
}

// ── Cotação ─────────────────────────────────────────────────

/**
 * Loja de destino quando ninguém escolheu: a ativa da sessão, ou a primeira
 * cadastrada. Mercado de uma loja só nunca deveria ver essa pergunta.
 */
async function resolverSite(): Promise<string> {
  const ativa = await getActiveSiteId();
  if (ativa) return ativa;
  const [primeira] = await listSites();
  if (!primeira) throw new Error("Cadastre uma loja antes de abrir uma cotação.");
  return primeira.id;
}

const criarSchema = z.object({
  /** Vazio = o sistema dá um nome pela data; o operador renomeia na revisão. */
  titulo: z.string().trim().max(120).optional().nullable(),
  /** Vazio = loja ativa da sessão. */
  siteId: z.string().optional().nullable(),
  prazoResposta: z.string().optional().nullable(), // yyyy-mm-dd
  observacao: z.string().trim().max(1000).optional().nullable(),
});

/** Nome de fábrica: "Cotação de 19/08". Reconhecível sem exigir digitação. */
function tituloAutomatico(): string {
  return `Cotação de ${new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })}`;
}

/**
 * Cria a cotação já em RASCUNHO, sem perguntar nada: o nome sai da data e a
 * loja é a ativa. O primeiro passo do operador é a lista de produtos — pedir
 * título antes disso é cobrar decisão que ele ainda não tem.
 */
export async function criarCotacaoAction(input: z.input<typeof criarSchema> = {}) {
  const d = criarSchema.parse(input);
  // A loja só é descoberta DENTRO do contexto do tenant (o cookie de loja
  // ativa é validado contra o banco), então a permissão é checada em duas
  // etapas: em alguma loja para entrar, naquela loja para gravar.
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = d.siteId || (await resolverSite());
    assertSite(ctx, "compras.pedir", siteId);
    const tid = ctx.tenant.id;
    const userId = ctx.user.id ?? "";

    // Quem tocou em "Nova" e fechou a aba deixou uma casca para trás. Limpa as
    // dele antes de abrir mais uma — a lista é do operador, não do histórico
    // de cliques dele.
    const vazias = await db.quotation.findMany({
      where: {
        status: "RASCUNHO",
        createdBy: userId || undefined,
        items: { none: {} },
        suppliers: { none: {} },
      },
      select: { id: true },
    });
    if (vazias.length > 0) {
      await db.quotation.deleteMany({ where: { id: { in: vazias.map((v) => v.id) } } });
    }
    const numero = await proximoNumero(tid);
    const cotacao = await db.quotation.create({
      data: {
        tenantId: tid,
        siteId,
        numero,
        titulo: d.titulo?.trim() || tituloAutomatico(),
        prazoResposta: d.prazoResposta ? new Date(`${d.prazoResposta}T23:59:59`) : null,
        observacao: d.observacao ?? null,
        createdBy: userId,
      },
      select: { id: true, numero: true },
    });
    ok();
    return cotacao;
  });
}

const editarSchema = z
  .object({
    id: z.string().min(1),
    titulo: z.string().trim().min(3, "Informe o nome da cotação."),
    siteId: z.string().optional().nullable(),
    /** Data do documento (yyyy-mm-dd). Ausente = não mexe no que está gravado. */
    dataCotacao: z.string().optional().nullable(),
    prazoResposta: z.string().optional().nullable(),
    observacao: z.string().trim().max(1000).optional().nullable(),
    /** Pedir promoção por volume ao fornecedor. Ausente = não mexe na chave. */
    pedeEscala: z.boolean().optional(),
  })
  // Prazo antes da data da cotação seria uma pergunta que vence antes de ser
  // feita. A tela já barra; aqui é a mesma régua para quem chega pela ação.
  .refine((d) => !d.dataCotacao || !d.prazoResposta || d.prazoResposta >= d.dataCotacao, {
    path: ["prazoResposta"],
    message: "O prazo de resposta não pode ser anterior à data da cotação.",
  });

export async function editarCotacaoAction(input: z.input<typeof editarSchema>) {
  const d = editarSchema.parse(input);
  // Trocar a loja de destino é decisão de compra, não de leitura: exige a
  // permissão de pedir NA LOJA nova, senão daria para desviar a entrega para
  // uma loja onde a pessoa não pode comprar.
  const ctx = await guardAction(d.siteId ? "compras.pedir" : "compras.ver", d.siteId ?? null);
  return runWithTenant(ctx.tenant.id, async () => {
    await exigirEditavel(d.id);
    await db.quotation.updateMany({
      where: { id: d.id },
      data: {
        titulo: d.titulo,
        siteId: d.siteId || undefined,
        // Meio-dia UTC: a data do documento é um DIA, e gravar na virada faria
        // o fuso do navegador mostrar o dia anterior de volta.
        dataCotacao: d.dataCotacao ? new Date(`${d.dataCotacao}T12:00:00.000Z`) : undefined,
        prazoResposta: d.prazoResposta ? new Date(`${d.prazoResposta}T23:59:59`) : null,
        observacao: d.observacao ?? null,
        pedeEscala: d.pedeEscala,
      },
    });
    ok();
  });
}

export async function encerrarCotacaoAction(id: string) {
  return tx(async () => {
    await exigirEditavel(id);
    await db.quotation.updateMany({
      where: { id },
      data: { status: "ENCERRADA", encerradaEm: new Date() },
    });
    ok();
  });
}

export async function reabrirCotacaoAction(id: string) {
  return tx(async () => {
    const c = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (c?.status !== "ENCERRADA") throw new Error("Só uma cotação encerrada pode ser reaberta.");
    await db.quotation.updateMany({
      where: { id },
      data: { status: "ABERTA", encerradaEm: null },
    });
    ok();
  });
}

/**
 * Nova cotação com os mesmos produtos e os mesmos fornecedores.
 *
 * Compra de mercado é repetitiva: a lista de cerveja da semana passada é quase
 * a desta semana. Duplicar copia a PERGUNTA (itens, quantidades, convidados) e
 * nunca a RESPOSTA — preço de terça não vale quinta, e trazer junto o que o
 * fornecedor cotou daria ao comprador a sensação de já ter proposta quando
 * ninguém foi consultado ainda.
 *
 * Nasce em RASCUNHO, com prazo em branco: a data velha já passou.
 */
export async function duplicarCotacaoAction(id: string) {
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const origem = await db.quotation.findFirst({
      where: { id },
      select: {
        titulo: true,
        siteId: true,
        observacao: true,
        items: {
          orderBy: { ordem: "asc" },
          select: {
            productId: true,
            packagingId: true,
            descricao: true,
            quantidade: true,
            observacao: true,
            ordem: true,
          },
        },
        suppliers: { select: { supplierId: true } },
      },
    });
    if (!origem) throw new Error("Cotação não encontrada.");
    assertSite(ctx, "compras.pedir", origem.siteId);

    const tid = ctx.tenant.id;
    const numero = await proximoNumero(tid);
    const nova = await db.quotation.create({
      data: {
        tenantId: tid,
        siteId: origem.siteId,
        numero,
        // "Cópia de Cópia de…" não ajuda ninguém a achar nada.
        titulo: origem.titulo.startsWith("Cópia de ")
          ? origem.titulo
          : `Cópia de ${origem.titulo}`,
        observacao: origem.observacao,
        createdBy: ctx.user.id ?? null,
      },
      select: { id: true, numero: true },
    });

    if (origem.items.length > 0) {
      await db.quotationItem.createMany({
        data: origem.items.map((i) => ({
          tenantId: tid,
          quotationId: nova.id,
          productId: i.productId,
          packagingId: i.packagingId,
          descricao: i.descricao,
          quantidade: i.quantidade,
          observacao: i.observacao,
          ordem: i.ordem,
        })),
      });
    }
    if (origem.suppliers.length > 0) {
      await db.quotationSupplier.createMany({
        data: origem.suppliers.map((sup) => ({
          tenantId: tid,
          quotationId: nova.id,
          supplierId: sup.supplierId,
        })),
      });
    }

    ok();
    return nova;
  });
}

/**
 * Apaga a cotação de vez. Só RASCUNHO: depois de enviada existe promessa feita
 * a fornecedor, e apagar isso apagaria também a resposta que ele deu — para
 * esse caso existe cancelar, que deixa rastro.
 */
export async function excluirCotacaoAction(id: string) {
  return txp("compras.pedir", null, async () => {
    const c = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (!c) throw new Error("Cotação não encontrada.");
    if (c.status !== "RASCUNHO") {
      throw new Error("Só dá para excluir cotação em rascunho. Use cancelar.");
    }
    await db.quotation.deleteMany({ where: { id, status: "RASCUNHO" } });
    ok();
  });
}

/** Chamado ao sair da tela: descarta o rascunho que ninguém preencheu. */
export async function descartarSeVaziaAction(id: string): Promise<{ descartada: boolean }> {
  return txp("compras.pedir", null, async () => {
    const descartada = await descartarSeVazia(id);
    if (descartada) ok();
    return { descartada };
  });
}

export async function cancelarCotacaoAction(id: string) {
  return tx(async () => {
    const c = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (!c) throw new Error("Cotação não encontrada.");
    if (c.status === "DECIDIDA") throw new Error("Cotação já virou pedido — não dá para cancelar.");
    await db.quotation.updateMany({
      where: { id },
      data: { status: "CANCELADA", canceladaEm: new Date() },
    });
    ok();
  });
}

// ── Busca de produto para a cotação ─────────────────────────
// Existe em vez de reusar a busca do scanner (`/m/scan/actions`) porque aquela
// pede `produto.ver`: comprador com perfil só de compras ficava sem resultado
// nenhum, sem erro na tela. Quem monta cotação precisa de `compras.ver`, e é
// essa a permissão exigida aqui.

export type ProdutoCotacao = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  /** Saldo na loja de destino, quando a cotação já tem loja. */
  estoque: number | null;
  /** Quanto falta para o mínimo — vira a quantidade sugerida do item. */
  sugerido: number;
  /**
   * Embalagens de compra (fardo, caixa) — o item é cotado numa delas. O
   * `fator` vem junto porque é ele que transforma "2" em "2 caixas de 12":
   * sem o número na tela, quem digita a quantidade está adivinhando.
   */
  embalagens: { id: string; nome: string; isCompraDefault: boolean; fator: number }[];
};

async function montarProdutos(
  produtos: {
    id: string;
    nome: string;
    sku: string;
    imagemUrl: string | null;
    stocks: { estoqueFechado: unknown; estoqueAberto: unknown; estoqueMinimo: unknown }[];
    packagings: { id: string; nome: string; isCompraDefault: boolean; fatorConversao: unknown }[];
  }[],
): Promise<ProdutoCotacao[]> {
  const num = (v: unknown) => Number(v ?? 0);
  return produtos.map((p) => {
    const st = p.stocks[0];
    const saldo = st ? num(st.estoqueFechado) + num(st.estoqueAberto) : null;
    const minimo = st ? num(st.estoqueMinimo) : 0;
    return {
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      imagemUrl: p.imagemUrl,
      estoque: saldo,
      sugerido: saldo === null ? 0 : Math.max(0, Math.ceil(minimo - saldo)),
      embalagens: p.packagings.map((e) => ({
        id: e.id,
        nome: e.nome,
        isCompraDefault: e.isCompraDefault,
        // Decimal do Prisma não atravessa a fronteira do client: vira número aqui.
        fator: Number(e.fatorConversao ?? 1) || 1,
      })),
    };
  });
}

const buscaSchema = z.object({
  termo: z.string().trim().max(120),
  /** Loja da cotação: sem ela o saldo mostrado seria de outra prateleira. */
  siteId: z.string().optional().nullable(),
});

export async function buscarProdutosCotacaoAction(
  input: z.input<typeof buscaSchema>,
): Promise<ProdutoCotacao[]> {
  const d = buscaSchema.parse(input);
  if (d.termo.length < 2) return [];
  const ctx = await guardAction("compras.ver", null, { mesmoSuspenso: true });
  return runWithTenant(ctx.tenant.id, async () => {
    const produtos = await db.product.findMany({
      where: {
        ativo: true,
        tipo: { in: ["SIMPLES", "INSUMO"] },
        OR: [
          { nome: { contains: d.termo, mode: "insensitive" } },
          { sku: { contains: d.termo, mode: "insensitive" } },
          { ean: { contains: d.termo } },
        ],
      },
      orderBy: { nome: "asc" },
      take: 20,
      select: {
        id: true,
        nome: true,
        sku: true,
        imagemUrl: true,
        stocks: {
          where: d.siteId ? { siteId: d.siteId } : undefined,
          take: 1,
          select: { estoqueFechado: true, estoqueAberto: true, estoqueMinimo: true },
        },
        packagings: { select: { id: true, nome: true, isCompraDefault: true, fatorConversao: true } },
      },
    });
    return montarProdutos(produtos);
  });
}

/** Mesma busca, pelo código de barras — o caminho do bipe. */
export async function buscarProdutoPorCodigoCotacaoAction(
  codigo: string,
  siteId?: string | null,
): Promise<ProdutoCotacao | null> {
  const limpo = codigo.trim();
  if (!limpo) return null;
  const ctx = await guardAction("compras.ver", null, { mesmoSuspenso: true });
  return runWithTenant(ctx.tenant.id, async () => {
    const select = {
      id: true,
      nome: true,
      sku: true,
      imagemUrl: true,
      stocks: {
        where: siteId ? { siteId } : undefined,
        take: 1,
        select: { estoqueFechado: true, estoqueAberto: true, estoqueMinimo: true },
      },
      packagings: { select: { id: true, nome: true, isCompraDefault: true, fatorConversao: true } },
    };
    // Unidade, SKU e, por último, o EAN da caixa/fardo — quem bipa no depósito
    // costuma ter a embalagem na mão, não a unidade.
    const direto = await db.product.findFirst({
      where: { ativo: true, OR: [{ ean: limpo }, { sku: limpo }] },
      select,
    });
    if (direto) return (await montarProdutos([direto]))[0] ?? null;

    const emb = await db.productPackaging.findFirst({
      where: { ean: limpo },
      select: { product: { select: select } },
    });
    if (!emb?.product) return null;
    return (await montarProdutos([emb.product]))[0] ?? null;
  });
}

// ── Itens ───────────────────────────────────────────────────

const itemSchema = z.object({
  quotationId: z.string().min(1),
  productId: z.string().optional().nullable(),
  packagingId: z.string().optional().nullable(),
  descricao: z.string().trim().min(2, "Descreva o item para o fornecedor entender."),
  quantidade: z.number().positive("A quantidade precisa ser maior que zero."),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function adicionarItemAction(input: z.input<typeof itemSchema>) {
  const d = itemSchema.parse(input);
  return tx(async (tid) => {
    await exigirLicenca(d.quotationId, "itens");
    const ultimo = await db.quotationItem.findFirst({
      where: { quotationId: d.quotationId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });
    // Devolve o id: a lista do celular pinta o item antes da gravação e
    // precisa trocar o id provisório pelo de verdade para o + seguinte gravar
    // no lugar certo.
    const item = await db.quotationItem.create({
      data: {
        tenantId: tid,
        quotationId: d.quotationId,
        productId: d.productId || null,
        packagingId: d.packagingId || null,
        descricao: d.descricao,
        quantidade: d.quantidade,
        observacao: d.observacao ?? null,
        ordem: (ultimo?.ordem ?? -1) + 1,
      },
      select: { id: true },
    });
    ok();
    return item;
  });
}

const editarItemSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().trim().min(2),
  quantidade: z.number().positive(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function editarItemAction(input: z.input<typeof editarItemSchema>) {
  const d = editarItemSchema.parse(input);
  return tx(async () => {
    const item = await db.quotationItem.findFirst({
      where: { id: d.id },
      select: { quotationId: true },
    });
    if (!item) throw new Error("Item não encontrado.");
    await exigirLicenca(item.quotationId, "itens");
    await db.quotationItem.updateMany({
      where: { id: d.id },
      data: {
        descricao: d.descricao,
        quantidade: d.quantidade,
        observacao: d.observacao ?? null,
      },
    });
    ok();
  });
}

export async function removerItemAction(id: string) {
  return tx(async () => {
    const item = await db.quotationItem.findFirst({
      where: { id },
      select: { quotationId: true },
    });
    if (!item) throw new Error("Item não encontrado.");
    await exigirLicenca(item.quotationId, "itens");
    await db.quotationItem.deleteMany({ where: { id } });
    ok();
  });
}

const reordenarSchema = z.object({
  quotationId: z.string().min(1),
  /** Ids na ordem final. Itens fora da lista mantêm o que tinham. */
  ids: z.array(z.string().min(1)).min(2),
});

/**
 * Muda a ordem da lista.
 *
 * A ordem importa porque a lista É o documento que o fornecedor lê: agrupar
 * por marca ou por corredor faz ele conferir depressa e errar menos. Guardar
 * a ordem já existia (`ordem`); faltava deixar mudá-la.
 */
export async function reordenarItensAction(input: z.input<typeof reordenarSchema>) {
  const d = reordenarSchema.parse(input);
  return tx(async () => {
    await exigirLicenca(d.quotationId, "itens");
    // Um update por item: são dezenas de linhas, não milhares, e a alternativa
    // (CASE gigante em SQL cru) perderia a injeção de tenant do extension.
    await Promise.all(
      d.ids.map((id, ordem) =>
        db.quotationItem.updateMany({
          where: { id, quotationId: d.quotationId },
          data: { ordem },
        }),
      ),
    );
    ok();
  });
}

const copiarItensSchema = z.object({
  quotationId: z.string().min(1),
  origemId: z.string().min(1),
});

/**
 * Traz a lista de uma cotação anterior para esta.
 *
 * Diferente de duplicar: aqui a cotação de destino JÁ existe (o operador está
 * dentro dela) e o que se copia é só a pergunta — itens, embalagem e
 * quantidade. Fornecedores não vêm junto: quem vende cerveja em agosto pode
 * não ser quem vendia em julho, e essa escolha tem coluna própria na tela.
 *
 * O que já está na lista não duplica: repetir o clique não faz "Coca 2L"
 * aparecer duas vezes com quantidades diferentes.
 */
export async function copiarItensDeAction(input: z.input<typeof copiarItensSchema>) {
  const d = copiarItensSchema.parse(input);
  return tx(async (tid) => {
    await exigirLicenca(d.quotationId, "itens");

    const [origem, atuais, ultimo] = await Promise.all([
      db.quotationItem.findMany({
        where: { quotationId: d.origemId },
        orderBy: { ordem: "asc" },
        select: {
          productId: true,
          packagingId: true,
          descricao: true,
          quantidade: true,
          observacao: true,
        },
      }),
      db.quotationItem.findMany({
        where: { quotationId: d.quotationId },
        select: { productId: true, descricao: true },
      }),
      db.quotationItem.findFirst({
        where: { quotationId: d.quotationId },
        orderBy: { ordem: "desc" },
        select: { ordem: true },
      }),
    ]);
    if (origem.length === 0) throw new Error("A cotação escolhida não tem itens para copiar.");

    // Produto vinculado é a identidade quando existe; item de texto livre se
    // reconhece pela descrição, que é tudo que ele tem.
    const jaTem = new Set(
      atuais.map((i) => i.productId ?? `livre:${i.descricao.trim().toLowerCase()}`),
    );
    const novos = origem.filter(
      (i) => !jaTem.has(i.productId ?? `livre:${i.descricao.trim().toLowerCase()}`),
    );
    if (novos.length === 0) return { copiados: 0 };

    let ordem = (ultimo?.ordem ?? -1) + 1;
    await db.quotationItem.createMany({
      data: novos.map((i) => ({
        tenantId: tid,
        quotationId: d.quotationId,
        productId: i.productId,
        packagingId: i.packagingId,
        descricao: i.descricao,
        quantidade: i.quantidade,
        observacao: i.observacao,
        ordem: ordem++,
      })),
    });
    ok();
    return { copiados: novos.length };
  });
}

// ── Convidados ──────────────────────────────────────────────

const convidarSchema = z.object({
  quotationId: z.string().min(1),
  supplierIds: z.array(z.string().min(1)).min(1, "Escolha ao menos um fornecedor."),
});

export async function convidarFornecedoresAction(input: z.input<typeof convidarSchema>) {
  const d = convidarSchema.parse(input);
  return tx(async (tid) => {
    await exigirLicenca(d.quotationId, "convidar");
    // createMany + skipDuplicates: reconvidar quem já está na lista não é erro,
    // é clique repetido.
    await db.quotationSupplier.createMany({
      data: d.supplierIds.map((supplierId) => ({
        tenantId: tid,
        quotationId: d.quotationId,
        supplierId,
      })),
      skipDuplicates: true,
    });
    ok();
  });
}

const definirConviteSchema = z.object({
  quotationId: z.string().min(1),
  supplierId: z.string().min(1),
  convidado: z.boolean(),
});

/**
 * Liga/desliga um fornecedor da cotação pelo ESTADO desejado, não pelo id do
 * convite.
 *
 * A diferença importa no celular: com marcação otimista, o operador toca duas
 * vezes antes da primeira chamada voltar, e a segunda ainda não conhece o id
 * que a primeira criou. Mandando "quero convidado / não quero", quem resolve é
 * o servidor, que sabe o estado atual — e chamada repetida vira no-op em vez
 * de erro.
 */
export async function definirConviteAction(input: z.input<typeof definirConviteSchema>) {
  const d = definirConviteSchema.parse(input);
  return tx(async (tid) => {
    // Ligar e desligar são duas licenças diferentes: convidar mais gente vale
    // enquanto a cotação está viva, tirar alguém só antes de ela sair.
    await exigirLicenca(d.quotationId, d.convidado ? "convidar" : "desconvidar");
    const atual = await db.quotationSupplier.findFirst({
      where: { quotationId: d.quotationId, supplierId: d.supplierId },
      select: { id: true, status: true },
    });

    if (d.convidado) {
      if (atual) return;
      await db.quotationSupplier.create({
        data: { tenantId: tid, quotationId: d.quotationId, supplierId: d.supplierId },
      });
      ok();
      return;
    }

    if (!atual) return;
    if (atual.status === "RESPONDIDA") {
      throw new Error("Este fornecedor já respondeu — a proposta dele sairia junto.");
    }
    await db.quotationSupplier.deleteMany({ where: { id: atual.id } });
    ok();
  });
}

export async function removerConviteAction(id: string) {
  return tx(async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id },
      select: { quotationId: true, status: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirLicenca(convite.quotationId, "desconvidar");
    if (convite.status === "RESPONDIDA") {
      throw new Error("Este fornecedor já respondeu — encerre a compra em vez de apagar a resposta.");
    }
    await db.quotationSupplier.deleteMany({ where: { id } });
    ok();
  });
}

// ── Envio ───────────────────────────────────────────────────

/** Texto que o operador manda ao fornecedor — mesma ideia do cupom: sem
 *  gateway de mensageria, devolvemos a mensagem pronta e o link wa.me.
 *
 *  O link de resposta vai junto e é o ponto da mensagem: preenchido por ele,
 *  a proposta entra no comparador sozinha. Quem preferir responder por áudio
 *  continua podendo — a lista fica na mensagem de propósito. */
function montarMensagem(
  empresa: string,
  numero: string,
  titulo: string,
  prazo: Date | null,
  itens: { descricao: string; quantidade: string }[],
  linkResposta: string | null,
  /** Primeiro nome de quem recebe. Sem contato cadastrado, volta ao "Olá!". */
  contato: string | null = null,
): string {
  // A quantidade chega pronta com a unidade ("2 × Caixa (12 un.)"): número solto
  // faz o fornecedor precificar outra coisa. Ver lib/compras/cotacao-unidades.
  const linhas = itens.map((i) => `• ${i.descricao} — ${i.quantidade}`);
  const prazoTexto = prazo
    ? `\nPreciso da resposta até ${prazo.toLocaleDateString("pt-BR")}.`
    : "";
  const fecho = linkResposta
    ? `\nÉ só preencher os preços aqui (não precisa cadastro):\n${linkResposta}`
    : "\nPode me passar preço, prazo de entrega e condição de pagamento?";
  const saudacao = contato ? `Olá, ${contato.trim().split(/\s+/)[0]}!` : "Olá!";
  return [
    `${saudacao} Aqui é da ${empresa}.`,
    `Pedido de cotação ${numero} — ${titulo}:`,
    "",
    ...linhas,
    prazoTexto,
    fecho,
  ].join("\n");
}

const canalSchema = z.enum(["whatsapp", "email"]);

/**
 * Destino fora do cadastro: o vendedor que só existe na agenda do celular do
 * comprador. Vale para ESTE disparo — quem manda é o que foi digitado agora, e
 * a trilha grava o número usado (com contactId nulo), então nunca fica a
 * dúvida de para onde foi. Virar contato é decisão de outra tela.
 */
const avulsoSchema = z
  .object({
    nome: z.string().trim().max(80).optional(),
    telefone: z.string().trim().max(20).optional(),
    email: z.string().trim().email("E-mail inválido.").max(120).optional(),
  })
  .refine((a) => Boolean(a.telefone?.trim() || a.email?.trim()), {
    message: "Informe um WhatsApp ou um e-mail para o destino avulso.",
    path: ["telefone"],
  });

/** Uma linha do modal de envio: para quem, dentro daquele fornecedor, e por onde. */
const destinoSchema = z.object({
  conviteId: z.string().min(1),
  /** Contato escolhido na tela. Vazio = o principal (ou a empresa, na falta dele). */
  contactId: z.string().min(1).nullable().optional(),
  canais: z.array(canalSchema).min(1),
  /**
   * Destino fora do cadastro: o vendedor que só existe na agenda do celular
   * do comprador. Vale para ESTE disparo — quem manda é o que foi digitado
   * agora, e a trilha grava o número usado (com contactId nulo), então nunca
   * fica a dúvida de para onde foi. Virar contato é decisão de outra tela.
   */
  avulso: avulsoSchema.optional(),
});

const enviarSchema = z.object({
  quotationId: z.string().min(1),
  /** Vazio = manda para todos os convidados que ainda não receberam. */
  conviteIds: z.array(z.string().min(1)).optional(),
  /**
   * Por onde o link vai. O LINK é o mesmo nos dois canais — só muda o
   * carteiro. E-mail sai do servidor; WhatsApp continua sendo a mensagem
   * pronta que o operador dispara (sem gateway oficial, ver [[cotacoes-rfq]]).
   *
   * Vale como padrão: quem não aparece em `destinos` sai por aqui.
   */
  canais: z.array(canalSchema).min(1).default(["whatsapp"]),
  /**
   * Escolha por fornecedor feita no modal de envio (contato + canal). Quando
   * vem preenchido, MANDA: define o conjunto de alvos e o destinatário de
   * cada um. É o que permite um botão só de "Enviar cotação" com João no
   * WhatsApp e Maria no e-mail no mesmo disparo.
   */
  destinos: z.array(destinoSchema).optional(),
  /**
   * Reenvio: alcança também quem JÁ recebeu e ainda não respondeu. Cada
   * reenvio emite um token novo — o link antigo morre na hora, então quem
   * tinha a página aberta precisa do endereço novo.
   */
  reenviar: z.boolean().default(false),
  /** Estica o prazo de resposta antes de mandar de novo (yyyy-mm-dd). */
  prazoResposta: z.string().optional().nullable(),
});

export type EmailEnvio =
  | { estado: "nao-pedido"; endereco: string | null }
  | { estado: "sem-endereco"; endereco: null }
  | { estado: "enviado"; endereco: string }
  | { estado: "falhou"; endereco: string; erro: string };

/** Contato que de fato vai receber — já resolvido, com os fallbacks aplicados. */
type Destinatario = {
  contactId: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
};

type ContatoDoFornecedor = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

/**
 * Quem recebe a cotação neste fornecedor, em ordem de precedência:
 * escolha da tela → contato já gravado no convite → principal → primeiro
 * contato alcançável.
 *
 * NÃO existe queda para o telefone/e-mail da empresa. Aquele dado é do setor
 * fiscal ou do 0800 — cotação mandada para lá some. A cotação vai para uma
 * PESSOA; sem contato alcançável, não há destino, e quem chama trata isso.
 */
function resolverDestinatario(
  contatos: ContatoDoFornecedor[],
  contactIdGravado: string | null,
  escolhido: string | null | undefined,
): Destinatario {
  const alcancavel = (c: ContatoDoFornecedor) => Boolean(c.telefone?.trim() || c.email?.trim());
  const contato =
    (escolhido ? contatos.find((c) => c.id === escolhido) : undefined) ??
    (contactIdGravado ? contatos.find((c) => c.id === contactIdGravado) : undefined) ??
    contatos.find((c) => c.principal && alcancavel(c)) ??
    contatos.find(alcancavel);

  // Com contato escolhido, o dado DELE manda: cair no telefone da empresa
  // faria a mensagem chegar em quem o comprador não escolheu.
  if (contato) {
    return {
      contactId: contato.id,
      nome: contato.nome,
      telefone: contato.telefone,
      email: contato.email,
    };
  }
  return { contactId: null, nome: null, telefone: null, email: null };
}

/** 11 dígitos ou menos = número nacional; o wa.me exige o 55 na frente. */
function numeroWhatsApp(telefone: string | null): string | null {
  const tel = telefone?.replace(/\D/g, "") ?? "";
  if (!tel) return null;
  return tel.length <= 11 ? `55${tel}` : tel;
}

export type Envio = {
  conviteId: string;
  supplierId: string;
  fornecedor: string;
  /** Quem recebeu — null quando o fornecedor ainda não tem contato cadastrado. */
  contato: { id: string; nome: string } | null;
  /** Destino digitado na hora, fora do cadastro. Abre o convite de salvá-lo. */
  avulso: { nome: string | null; telefone: string | null; email: string | null } | null;
  mensagem: string;
  link: string | null;
  waLink: string | null;
  email: EmailEnvio;
};

export async function enviarCotacaoAction(input: z.input<typeof enviarSchema>): Promise<Envio[]> {
  const d = enviarSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  const userId = ctx.user.id ?? null;
  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        numero: true,
        titulo: true,
        status: true,
        prazoResposta: true,
        observacao: true,
        items: {
          select: {
            id: true,
            descricao: true,
            quantidade: true,
            packagingId: true,
            productId: true,
          },
          orderBy: { ordem: "asc" },
        },
        suppliers: {
          select: {
            id: true,
            status: true,
            contactId: true,
            supplierId: true,
            supplier: {
              select: {
                razaoSocial: true,
                nomeFantasia: true,
                telefone: true,
                email: true,
                contacts: {
                  where: { ativo: true },
                  orderBy: [{ principal: "desc" }, { createdAt: "asc" }],
                  select: {
                    id: true,
                    nome: true,
                    telefone: true,
                    email: true,
                    principal: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    if (cotacao.items.length === 0)
      throw new Error("Adicione ao menos um item antes de enviar.");
    if (cotacao.suppliers.length === 0) throw new Error("Convide ao menos um fornecedor.");

    const escolhas = new Map(d.destinos?.map((x) => [x.conviteId, x]) ?? []);
    const aceita = d.reenviar
      ? (st: string) => st === "PENDENTE" || st === "ENVIADA"
      : (st: string) => st === "PENDENTE";
    // Com o modal de envio aberto, a lista de destinos É a seleção; sem ele
    // (mobile, reenvio direto) vale o conviteIds de sempre.
    const conviteIds = d.conviteIds;
    const selecionados = escolhas.size
      ? (id: string) => escolhas.has(id)
      : conviteIds?.length
        ? (id: string) => conviteIds.includes(id)
        : () => true;
    const alvos = cotacao.suppliers.filter((s) => selecionados(s.id) && aceita(s.status));
    if (alvos.length === 0) {
      throw new Error(
        d.reenviar
          ? "Ninguém para reenviar: os escolhidos já responderam ou recusaram."
          : "Todos os fornecedores escolhidos já receberam.",
      );
    }

    // Cotação vai para uma PESSOA. Sem contato alcançável não há para onde
    // mandar — e marcar o convite como enviado seria mentira que só aparece
    // três dias depois, quando ninguém respondeu. Barra ANTES de qualquer
    // escrita: meio envio gravado é pior que envio nenhum.
    const destinatarios = new Map<string, Destinatario>();
    const semContato: string[] = [];
    for (const a of alvos) {
      const escolha = escolhas.get(a.id);
      const av = escolha?.avulso ?? null;
      const destinatario: Destinatario = av
        ? {
            contactId: null,
            nome: av.nome?.trim() || null,
            telefone: av.telefone?.trim() || null,
            email: av.email?.trim() || null,
          }
        : resolverDestinatario(a.supplier.contacts, a.contactId, escolha?.contactId ?? null);
      if (!destinatario.telefone?.trim() && !destinatario.email?.trim()) {
        semContato.push(a.supplier.nomeFantasia || a.supplier.razaoSocial);
      }
      destinatarios.set(a.id, destinatario);
    }
    if (semContato.length > 0) {
      throw new Error(
        `Sem contato para enviar: ${semContato.join(", ")}. Cadastre alguém com WhatsApp ou e-mail no fornecedor — a cotação vai para uma pessoa, não para a empresa.`,
      );
    }

    const agora = new Date();

    // Prazo novo vale para a cotação inteira — é a data que sai na mensagem e
    // a que manda na validade do link.
    let prazo = cotacao.prazoResposta;
    if (d.prazoResposta) {
      prazo = new Date(`${d.prazoResposta}T23:59:59`);
      await db.quotation.updateMany({
        where: { id: d.quotationId },
        data: { prazoResposta: prazo },
      });
    }
    await db.quotationSupplier.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { status: "ENVIADA", enviadaEm: agora },
    });
    await db.quotation.updateMany({
      where: { id: d.quotationId },
      data: {
        status: "ABERTA",
        enviadaEm: cotacao.status === "RASCUNHO" ? agora : undefined,
      },
    });

    // Um link por convite: o token identifica QUEM está respondendo, então
    // dois fornecedores nunca compartilham endereço (e ninguém vê a proposta
    // do outro). Reenviar troca o token — o link antigo morre na hora.
    const links = new Map<string, string>();
    for (const alvo of alvos) {
      const { url } = await emitirLinkCotacao(ctx.tenant.id, alvo.id, prazo);
      links.set(alvo.id, url);
    }

    ok();

    const prazoTexto = prazo ? prazo.toLocaleDateString("pt-BR") : null;
    const unidades = await unidadesDosItens(cotacao.items);
    const itensDoTexto = cotacao.items.map((i) => ({
      descricao: i.descricao,
      quantidade: quantidadeComUnidade(Number(i.quantidade), unidades.get(i.id)),
    }));

    return Promise.all(
      alvos.map(async (a) => {
        const link = links.get(a.id) ?? null;
        const fornecedor = a.supplier.nomeFantasia || a.supplier.razaoSocial;
        const escolha = escolhas.get(a.id);
        const canais = escolha?.canais ?? d.canais;
        // Já resolvido (e validado) antes das escritas — aqui só se usa.
        const avulso = escolha?.avulso ?? null;
        const destinatario = destinatarios.get(a.id)!;

        // O contato usado fica gravado no convite: o próximo reenvio já abre
        // com a mesma pessoa, sem o comprador reescolher.
        if (destinatario.contactId && destinatario.contactId !== a.contactId) {
          await db.quotationSupplier.updateMany({
            where: { id: a.id },
            data: { contactId: destinatario.contactId },
          });
        }

        // "Olá, João" abre melhor que "Olá!" — e é o sinal de que o comprador
        // sabe com quem está falando.
        const mensagem = montarMensagem(
          ctx.tenant.nome,
          cotacao.numero,
          cotacao.titulo,
          prazo,
          itensDoTexto,
          link,
          destinatario.nome,
        );
        const numeroWa = numeroWhatsApp(destinatario.telefone);

        // E-mail nunca derruba o envio: o convite já está gravado e o link
        // continua copiável na tela. Falha vira aviso, não exceção.
        let email: EmailEnvio = { estado: "nao-pedido", endereco: destinatario.email };
        if (canais.includes("email") && link) {
          if (!destinatario.email) {
            email = { estado: "sem-endereco", endereco: null };
          } else {
            const r = await enviarEmail(
              emailCotacao({
                para: destinatario.email,
                fornecedor: destinatario.nome ?? fornecedor,
                mercado: ctx.tenant.nome,
                numero: cotacao.numero,
                titulo: cotacao.titulo,
                url: link,
                prazo: prazoTexto,
                itens: itensDoTexto,
                observacao: cotacao.observacao,
              }),
            );
            email = r.ok
              ? { estado: "enviado", endereco: destinatario.email }
              : { estado: "falhou", endereco: destinatario.email, erro: r.erro };
          }
        }

        // Trilha: uma linha por canal, com o nome do contato COPIADO. É o que
        // responde "mandei pro João ou pra Maria?" três dias depois — e
        // continua respondendo depois de o vendedor sair da empresa.
        const trilha: {
          canal: "WHATSAPP" | "EMAIL";
          destino: string | null;
          sucesso: boolean;
          erro: string | null;
        }[] = [];
        if (canais.includes("whatsapp")) {
          trilha.push({
            canal: "WHATSAPP",
            destino: destinatario.telefone,
            sucesso: true,
            erro: null,
          });
        }
        if (email.estado !== "nao-pedido") {
          trilha.push({
            canal: "EMAIL",
            destino: email.estado === "sem-endereco" ? null : email.endereco,
            sucesso: email.estado === "enviado",
            erro:
              email.estado === "falhou"
                ? email.erro
                : email.estado === "sem-endereco"
                  ? "Contato sem e-mail cadastrado."
                  : null,
          });
        }
        if (trilha.length > 0) {
          await db.quotationSend.createMany({
            // O tipo do createMany exige tenantId em cada linha; o extension reescreve
            // com o mesmo valor, então declarar aqui não abre brecha de tenant.
            data: trilha.map((t) => ({
              tenantId: ctx.tenant.id,
              quotationSupplierId: a.id,
              contactId: destinatario.contactId,
              contatoNome: destinatario.nome,
              canal: t.canal,
              destino: t.destino,
              reenvio: d.reenviar,
              sucesso: t.sucesso,
              erro: t.erro,
              enviadoEm: agora,
              enviadoPor: userId,
            })),
          });
        }

        return {
          conviteId: a.id,
          supplierId: a.supplierId,
          fornecedor,
          contato: destinatario.contactId
            ? { id: destinatario.contactId, nome: destinatario.nome ?? fornecedor }
            : null,
          avulso: avulso
            ? {
                nome: destinatario.nome,
                telefone: destinatario.telefone,
                email: destinatario.email,
              }
            : null,
          mensagem,
          link,
          waLink: numeroWa
            ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(mensagem)}`
            : null,
          email,
        };
      }),
    );
  });
}

// ── Envio manual, um fornecedor por vez ─────────────────────
// O NoHub não manda a mensagem: ele PREPARA o disparo (link + texto) e abre o
// WhatsApp ou o cliente de e-mail do operador, que aperta o enviar dele. Por
// isso o ato se parte em dois:
//
//   preparar  → gera o que vai ser mandado. Não muda status nem grava trilha:
//               abrir o WhatsApp não é ter enviado, e marcar aqui produziria
//               "enviada" para uma mensagem que o operador desistiu de mandar.
//   confirmar → o operador diz que mandou. AQUI o convite vira ENVIADA, a
//               trilha é gravada e a cotação sai de rascunho.
//
// A separação é o ponto todo do fluxo: só quem esteve no WhatsApp sabe se a
// mensagem saiu, e o sistema não finge saber.

const prepararEnvioSchema = z.object({
  conviteId: z.string().min(1),
  canal: canalSchema,
  /** Contato que vai receber. Obrigatório: a cotação não vai para uma empresa. */
  contactId: z.string().min(1),
  /** Só e-mail: quem entra em cópia. Contatos do MESMO fornecedor. */
  copiaIds: z.array(z.string().min(1)).default([]),
});

export type ContatoDoEnvio = { id: string; nome: string; email: string | null };

export type EnvioPreparado = {
  conviteId: string;
  fornecedor: string;
  contactId: string;
  contatoNome: string;
  /** Telefone (WhatsApp) ou e-mail (e-mail) que de fato vai ser usado. */
  destino: string | null;
  /** Contatos em cópia, resolvidos — vira a trilha depois da confirmação. */
  copias: ContatoDoEnvio[];
  mensagem: string;
  link: string | null;
  /** Endereço pronto do canal: `https://wa.me/...` ou `mailto:...`. */
  url: string | null;
  /** Por que não dá para abrir, quando `url` é null. */
  impedimento: string | null;
};

/**
 * Monta o disparo de UM contato. Não muda status nem grava trilha: abrir o
 * WhatsApp não é ter enviado.
 *
 * O destino sai do CONTATO — `contact.telefone` / `contact.email`. Nunca do
 * cadastro do fornecedor: aquele telefone é do fiscal ou de um 0800, e cotação
 * mandada para lá some sem ninguém perceber. Sem o dado no contato, a ação
 * recusa e a tela pede outro contato.
 */
export async function prepararEnvioAction(
  input: z.input<typeof prepararEnvioSchema>,
): Promise<EnvioPreparado> {
  const d = prepararEnvioSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: d.conviteId },
      select: {
        id: true,
        quotation: {
          select: {
            id: true,
            numero: true,
            titulo: true,
            prazoResposta: true,
            items: {
              orderBy: { ordem: "asc" },
              select: {
                id: true,
                descricao: true,
                quantidade: true,
                packagingId: true,
                productId: true,
              },
            },
          },
        },
        supplier: {
          select: {
            razaoSocial: true,
            nomeFantasia: true,
            contacts: {
              where: { ativo: true },
              select: { id: true, nome: true, telefone: true, email: true },
            },
          },
        },
      },
    });
    if (!convite) throw new Error("Fornecedor não encontrado nesta cotação.");
    const cotacao = convite.quotation;
    if (cotacao.items.length === 0) throw new Error("Adicione ao menos um item antes de enviar.");

    const fornecedor = convite.supplier.nomeFantasia || convite.supplier.razaoSocial;
    // O contato precisa ser DESTE fornecedor. Sem essa checagem, um id de fora
    // mandaria a cotação para a pessoa errada.
    const contato = convite.supplier.contacts.find((c) => c.id === d.contactId);
    if (!contato) throw new Error("Contato não encontrado neste fornecedor.");

    const link =
      (await linkVigente(convite.id))?.url ??
      (await emitirLinkCotacao(ctx.tenant.id, convite.id, cotacao.prazoResposta)).url;

    const unidades = await unidadesDosItens(cotacao.items);
    const mensagem = montarMensagem(
      ctx.tenant.nome,
      cotacao.numero,
      cotacao.titulo,
      cotacao.prazoResposta,
      cotacao.items.map((i) => ({
        descricao: i.descricao,
        quantidade: quantidadeComUnidade(Number(i.quantidade), unidades.get(i.id)),
      })),
      link,
      contato.nome,
    );

    const base = {
      conviteId: convite.id,
      fornecedor,
      contactId: contato.id,
      contatoNome: contato.nome,
      mensagem,
      link,
    };

    if (d.canal === "whatsapp") {
      const numero = numeroWhatsApp(contato.telefone);
      return {
        ...base,
        destino: contato.telefone,
        copias: [],
        url: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : null,
        impedimento: numero
          ? null
          : `${contato.nome} não tem WhatsApp cadastrado. Escolha outro contato ou cadastre o número.`,
      };
    }

    // Cópia só entra com e-mail e só de quem é deste fornecedor — mesma
    // checagem do destinatário principal, pelo mesmo motivo.
    const copias = convite.supplier.contacts
      .filter((c) => d.copiaIds.includes(c.id) && c.id !== contato.id && c.email?.trim())
      .map((c) => ({ id: c.id, nome: c.nome, email: c.email }));

    if (!contato.email?.trim()) {
      return {
        ...base,
        destino: null,
        copias,
        url: null,
        impedimento: `${contato.nome} não tem e-mail cadastrado. Escolha outro contato ou cadastre o endereço.`,
      };
    }

    const assunto = `Cotação ${cotacao.numero} — ${cotacao.titulo}`;
    const cc = copias.map((c) => c.email!).join(",");
    const url =
      `mailto:${encodeURIComponent(contato.email)}` +
      `?subject=${encodeURIComponent(assunto)}` +
      (cc ? `&cc=${encodeURIComponent(cc)}` : "") +
      `&body=${encodeURIComponent(mensagem)}`;

    return { ...base, destino: contato.email, copias, url, impedimento: null };
  });
}

const confirmarEnvioSchema = z.object({
  conviteId: z.string().min(1),
  canal: canalSchema,
  contactId: z.string().min(1),
  /** Nome de quem recebeu, COPIADO — sobrevive ao vendedor sair da empresa. */
  contatoNome: z.string().trim().max(160),
  /** Telefone ou e-mail que o operador usou de fato. */
  destino: z.string().trim().max(200).nullable().optional(),
  /** "Maria <maria@x>; Carlos <carlos@x>" — só e-mail tem cópia. */
  copias: z.string().trim().max(1000).nullable().optional(),
  reenvio: z.boolean().default(false),
});

/**
 * O operador diz que mandou para ESTE contato. Só aqui a trilha é gravada.
 *
 * O convite vira ENVIADA no primeiro contato confirmado — o fornecedor foi
 * procurado, mesmo que outras pessoas dele ainda estejam na fila; o painel
 * mostra "2 de 3 contatos" a partir da trilha. A cotação sai de RASCUNHO no
 * mesmo momento e fica em ABERTA: "aguardando respostas" continua verdade com
 * todo mundo já avisado. Enviado não é respondido.
 */
export async function confirmarEnvioAction(
  input: z.input<typeof confirmarEnvioSchema>,
): Promise<{ enviadoEm: string }> {
  const d = confirmarEnvioSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  const userId = ctx.user.id ?? null;
  return runWithTenant(ctx.tenant.id, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: d.conviteId },
      select: {
        id: true,
        status: true,
        quotationId: true,
        quotation: { select: { status: true } },
        supplier: { select: { contacts: { where: { ativo: true }, select: { id: true } } } },
      },
    });
    if (!convite) throw new Error("Fornecedor não encontrado nesta cotação.");
    if (convite.status === "RESPONDIDA" || convite.status === "RECUSADA") {
      throw new Error("Este fornecedor já respondeu — não dá para marcar como enviado de novo.");
    }
    if (!convite.supplier.contacts.some((c) => c.id === d.contactId)) {
      throw new Error("Contato não encontrado neste fornecedor.");
    }

    const agora = new Date();
    await db.quotationSupplier.updateMany({
      where: { id: convite.id },
      data: {
        status: "ENVIADA",
        enviadaEm: agora,
        // O contato usado fica gravado: o próximo reenvio abre com a mesma
        // pessoa, sem o comprador reescolher.
        contactId: d.contactId,
      },
    });
    if (convite.quotation.status === "RASCUNHO") {
      await db.quotation.updateMany({
        where: { id: convite.quotationId },
        data: { status: "ABERTA", enviadaEm: agora },
      });
    }
    await db.quotationSend.create({
      data: {
        tenantId: ctx.tenant.id,
        quotationSupplierId: convite.id,
        contactId: d.contactId,
        contatoNome: d.contatoNome,
        canal: d.canal === "whatsapp" ? "WHATSAPP" : "EMAIL",
        destino: d.destino ?? null,
        copias: d.copias || null,
        reenvio: d.reenvio,
        // Envio MANUAL: o sucesso é a palavra do operador, que esteve no
        // aplicativo. Não há retorno de gateway para contradizê-lo.
        sucesso: true,
        erro: null,
        enviadoEm: agora,
        enviadoPor: userId,
      },
    });
    ok();
    return { enviadoEm: agora.toISOString() };
  });
}

/**
 * Texto pronto do convite (com o link dentro), sem reenviar nada.
 *
 * Existe porque copiar SÓ o link obriga o operador a escrever a explicação de
 * novo em cada conversa. Com o texto na mão ele manda pelo canal que quiser —
 * outro WhatsApp, Telegram, e-mail pessoal do vendedor — sem passar por aqui.
 */
export async function mensagemDoConviteAction(
  conviteId: string,
  /**
   * Para QUEM montar o texto. Vazio mantém a precedência de sempre (contato
   * gravado no convite → principal → empresa). Vindo preenchido, a saudação e
   * o WhatsApp saem no nome de quem o operador escolheu na hora — sem isso o
   * celular só sabia falar com o principal.
   */
  contactId?: string | null,
): Promise<{
  fornecedor: string;
  /** Nome do contato a quem o texto está endereçado — null = sem contato. */
  contato: string | null;
  /** Para onde este texto vai, já resolvido: alimenta o wa.me e o mailto. */
  telefone: string | null;
  email: string | null;
  mensagem: string;
  link: string;
  waLink: string | null;
}> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: conviteId },
      select: {
        id: true,
        contactId: true,
        supplier: {
          select: {
            razaoSocial: true,
            nomeFantasia: true,
            telefone: true,
            email: true,
            contacts: {
              where: { ativo: true },
              orderBy: [{ principal: "desc" }, { createdAt: "asc" }],
              select: { id: true, nome: true, telefone: true, email: true, principal: true },
            },
          },
        },
        quotation: {
          select: {
            numero: true,
            titulo: true,
            status: true,
            prazoResposta: true,
            items: {
              select: {
                id: true,
                descricao: true,
                quantidade: true,
                packagingId: true,
                productId: true,
              },
              orderBy: { ordem: "asc" },
            },
          },
        },
      },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    if (convite.quotation.status !== "ABERTA") {
      throw new Error("O link só funciona enquanto a cotação está aberta.");
    }

    const vigente = await linkVigente(conviteId);
    const link =
      vigente?.url ??
      (await emitirLinkCotacao(ctx.tenant.id, conviteId, convite.quotation.prazoResposta)).url;

    const destinatario = resolverDestinatario(
      convite.supplier.contacts,
      convite.contactId,
      contactId ?? null,
    );

    const unidades = await unidadesDosItens(convite.quotation.items);
    const mensagem = montarMensagem(
      ctx.tenant.nome,
      convite.quotation.numero,
      convite.quotation.titulo,
      convite.quotation.prazoResposta,
      convite.quotation.items.map((i) => ({
        descricao: i.descricao,
        quantidade: quantidadeComUnidade(Number(i.quantidade), unidades.get(i.id)),
      })),
      link,
      destinatario.nome,
    );
    const numeroWa = numeroWhatsApp(destinatario.telefone);

    return {
      fornecedor: convite.supplier.nomeFantasia || convite.supplier.razaoSocial,
      contato: destinatario.nome,
      telefone: destinatario.telefone,
      email: destinatario.email,
      mensagem,
      link,
      waLink: numeroWa ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(mensagem)}` : null,
    };
  });
}

/** Uma mensagem já montada, pronta para virar wa.me ou mailto sem ida ao servidor. */
export type MensagemPronta = {
  conviteId: string;
  /** Contato para quem este texto foi escrito — a chave do cache na tela. */
  contactId: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  mensagem: string;
  link: string;
  waLink: string | null;
};

/**
 * As mensagens de TODOS os convites já enviados, de uma vez.
 *
 * Existe por causa do celular: lá o botão do WhatsApp navega para o wa.me, e
 * navegar depois de um round-trip é meio segundo de tela parada com o dedo já
 * fora do botão — o operador toca de novo achando que não pegou. Buscando o
 * lote quando a lista abre, o toque vira navegação imediata.
 *
 * Só LÊ link vigente: abrir uma tela não pode emitir token novo, senão o
 * endereço que o fornecedor tem aberto no celular morre sozinho.
 */
export async function mensagensDaCotacaoAction(quotationId: string): Promise<MensagemPronta[]> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: quotationId },
      select: {
        numero: true,
        titulo: true,
        status: true,
        prazoResposta: true,
        items: {
          select: {
            id: true,
            descricao: true,
            quantidade: true,
            packagingId: true,
            productId: true,
          },
          orderBy: { ordem: "asc" },
        },
        suppliers: {
          select: {
            id: true,
            status: true,
            contactId: true,
            supplier: {
              select: {
                razaoSocial: true,
                nomeFantasia: true,
                contacts: {
                  where: { ativo: true },
                  orderBy: [{ principal: "desc" }, { createdAt: "asc" }],
                  select: {
                    id: true,
                    nome: true,
                    telefone: true,
                    email: true,
                    principal: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cotacao || cotacao.status !== "ABERTA") return [];

    const unidades = await unidadesDosItens(cotacao.items);
    const itensDoTexto = cotacao.items.map((i) => ({
      descricao: i.descricao,
      quantidade: quantidadeComUnidade(Number(i.quantidade), unidades.get(i.id)),
    }));

    const prontas = await Promise.all(
      cotacao.suppliers
        .filter((s) => s.status === "ENVIADA")
        .map(async (s): Promise<MensagemPronta | null> => {
          const vigente = await linkVigente(s.id);
          if (!vigente) return null;
          const destinatario = resolverDestinatario(s.supplier.contacts, s.contactId, null);
          const mensagem = montarMensagem(
            ctx.tenant.nome,
            cotacao.numero,
            cotacao.titulo,
            cotacao.prazoResposta,
            itensDoTexto,
            vigente.url,
            destinatario.nome,
          );
          const numeroWa = numeroWhatsApp(destinatario.telefone);
          return {
            conviteId: s.id,
            contactId: destinatario.contactId,
            contato: destinatario.nome,
            telefone: destinatario.telefone,
            email: destinatario.email,
            mensagem,
            link: vigente.url,
            waLink: numeroWa
              ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(mensagem)}`
              : null,
          };
        }),
    );
    return prontas.filter((p): p is MensagemPronta => p !== null);
  });
}

/**
 * Devolve o link de resposta de um convite já enviado — para mandar de novo
 * por outro canal. Só gera token novo quando não existe ou já venceu: renovar
 * à toa mataria o endereço que o fornecedor já tem aberto no celular.
 */
export async function linkDoConviteAction(conviteId: string): Promise<{ url: string }> {
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: conviteId },
      select: { id: true, quotation: { select: { prazoResposta: true, status: true } } },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    if (convite.quotation.status !== "ABERTA") {
      throw new Error("O link só funciona enquanto a compra está aberta.");
    }

    const vigente = await linkVigente(conviteId);
    if (vigente) return { url: vigente.url };

    const novo = await emitirLinkCotacao(
      ctx.tenant.id,
      conviteId,
      convite.quotation.prazoResposta,
    );
    return { url: novo.url };
  });
}

// ── Resposta do fornecedor ──────────────────────────────────

const respostaSchema = z.object({
  conviteId: z.string().min(1),
  prazoEntregaDias: z.number().int().min(0).max(365).optional().nullable(),
  condicaoPagamento: z.string().trim().max(120).optional().nullable(),
  frete: z.number().min(0).optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
  itens: z
    .array(
      z.object({
        quotationItemId: z.string().min(1),
        disponivel: z.boolean().default(true),
        precoUnitario: z.number().min(0).default(0),
        quantidadeOfertada: z.number().min(0).optional().nullable(),
        marca: z.string().trim().max(120).optional().nullable(),
        observacao: z.string().trim().max(500).optional().nullable(),
        /** Promoção por volume ditada no telefone — mesma forma da do link. */
        faixas: z
          .array(
            z.object({
              quantidadeMinima: z.number().positive().max(9_999_999),
              precoUnitario: z.number().positive().max(9_999_999),
            }),
          )
          .max(5)
          .optional()
          .default([]),
      }),
    )
    .min(1, "Registre ao menos um item."),
});

export async function registrarRespostaAction(input: z.input<typeof respostaSchema>) {
  const d = respostaSchema.parse(input);
  return txp("compras.pedir", null, async (tid) => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: d.conviteId },
      select: {
        quotationId: true,
        quotation: {
          select: { pedeEscala: true, items: { select: { id: true, quantidade: true } } },
        },
      },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);

    // Mesma peneira da resposta que vem pelo link: a faixa só vale se a cotação
    // pede escala, e `normalizarFaixas` derruba faixa abaixo do pedido e preço
    // que sobe com o volume. Quem digita aqui é o operador transcrevendo um
    // telefonema — errar a ordem das faixas é o erro esperado, não o exótico.
    const pedida = new Map(convite.quotation.items.map((i) => [i.id, Number(i.quantidade)]));
    const faixasPorItem = new Map<string, { quantidadeMinima: number; precoUnitario: number }[]>();
    if (convite.quotation.pedeEscala) {
      for (const i of d.itens) {
        if (!i.disponivel || i.faixas.length === 0) continue;
        const limpas = normalizarFaixas(
          pedida.get(i.quotationItemId) ?? 0,
          i.precoUnitario,
          i.faixas,
        );
        if (limpas.length > 0) faixasPorItem.set(i.quotationItemId, limpas);
      }
    }

    // Regravar por cima: corrigir um preço digitado errado é rotina, e a
    // resposta é sempre a última que o fornecedor mandou. As faixas caem junto
    // pelo cascade.
    await db.quotationResponse.deleteMany({ where: { quotationSupplierId: d.conviteId } });
    await db.quotationResponse.createMany({
      data: d.itens.map((i) => ({
        tenantId: tid,
        quotationSupplierId: d.conviteId,
        quotationItemId: i.quotationItemId,
        disponivel: i.disponivel,
        precoUnitario: i.disponivel ? i.precoUnitario : 0,
        quantidadeOfertada: i.quantidadeOfertada ?? null,
        marca: i.marca ?? null,
        observacao: i.observacao ?? null,
      })),
    });

    // Depois do createMany porque ele não devolve id — igual ao caminho do link.
    if (faixasPorItem.size > 0) {
      const gravadas = await db.quotationResponse.findMany({
        where: {
          quotationSupplierId: d.conviteId,
          quotationItemId: { in: [...faixasPorItem.keys()] },
        },
        select: { id: true, quotationItemId: true },
      });
      await db.quotationResponseTier.createMany({
        data: gravadas.flatMap((r) =>
          (faixasPorItem.get(r.quotationItemId) ?? []).map((f, ordem) => ({
            tenantId: tid,
            quotationResponseId: r.id,
            quantidadeMinima: f.quantidadeMinima,
            precoUnitario: f.precoUnitario,
            ordem,
          })),
        ),
      });
    }
    await db.quotationSupplier.updateMany({
      where: { id: d.conviteId },
      data: {
        status: "RESPONDIDA",
        respondidaEm: new Date(),
        // Registrada pela loja: a Central de Respostas marca essa como
        // transcrição (áudio, foto, telefone), que merece um segundo olhar.
        respondidaVia: "OPERADOR",
        prazoEntregaDias: d.prazoEntregaDias ?? null,
        condicaoPagamento: d.condicaoPagamento ?? null,
        frete: d.frete ?? null,
        observacao: d.observacao ?? null,
      },
    });
    // Mesmo destino da resposta que vem pelo link: preço cotado é preço, e o
    // comparador/histórico não deveriam saber por qual porta ele entrou.
    await registrarPrecosDaCotacao(d.conviteId);
    ok();
  });
}

export async function recusarConviteAction(conviteId: string, motivo?: string) {
  return txp("compras.pedir", null, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: conviteId },
      select: { quotationId: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);
    await db.quotationSupplier.updateMany({
      where: { id: conviteId },
      data: {
        status: "RECUSADA",
        respondidaEm: new Date(),
        observacao: motivo?.trim() || null,
      },
    });
    ok();
  });
}

// ── Decisão: compra vira pedido ─────────────────────────────

const decidirSchema = z.object({
  quotationId: z.string().min(1),
  /** Item → convite escolhido. Item de fora fica sem pedido, de propósito. */
  escolhas: z
    .array(
      z.object({
        quotationItemId: z.string().min(1),
        conviteId: z.string().min(1),
        /**
         * Quantidade a pedir, quando a lente "Melhor oportunidade" mandou
         * levar uma faixa de promoção. Ausente = a quantidade cotada.
         */
        quantidade: z.number().positive().max(9_999_999).optional().nullable(),
      }),
    )
    .min(1, "Escolha ao menos um item."),
  enviar: z.boolean().default(true),
});

export async function gerarPedidosAction(input: z.input<typeof decidirSchema>) {
  const d = decidirSchema.parse(input);
  const ctx = await guardAction("compras.pedir");

  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        id: true,
        numero: true,
        siteId: true,
        status: true,
        items: {
          select: { id: true, productId: true, packagingId: true, quantidade: true, descricao: true },
        },
        suppliers: {
          select: {
            id: true,
            supplierId: true,
            prazoEntregaDias: true,
            responses: {
              select: {
                quotationItemId: true,
                disponivel: true,
                precoUnitario: true,
                faixas: { select: { quantidadeMinima: true, precoUnitario: true } },
              },
            },
          },
        },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    if (cotacao.status === "DECIDIDA") throw new Error("Esta compra já virou pedido.");
    if (cotacao.status === "CANCELADA") throw new Error("Compra cancelada.");

    const itemPorId = new Map(cotacao.items.map((i) => [i.id, i]));
    const convitePorId = new Map(cotacao.suppliers.map((s) => [s.id, s]));

    // Agrupa por fornecedor: cada um vira um pedido de compra independente.
    const porConvite = new Map<string, { productId: string; packagingId: string | null; qtdPedida: number; custoUnitario: number }[]>();
    const semProduto: string[] = [];

    for (const escolha of d.escolhas) {
      const item = itemPorId.get(escolha.quotationItemId);
      const convite = convitePorId.get(escolha.conviteId);
      if (!item || !convite) continue;

      // Item de texto livre não tem para onde ir no estoque — avisa em vez de
      // criar pedido pela metade em silêncio.
      if (!item.productId) {
        semProduto.push(item.descricao);
        continue;
      }

      const resposta = convite.responses.find((r) => r.quotationItemId === item.id);
      if (!resposta?.disponivel) continue;

      // Comprar MENOS do que foi cotado mudaria a disputa depois de decidida —
      // o vencedor pode ter ganho no volume. Só para cima, e o preço vem da
      // faixa que a quantidade alcança, recalculada AQUI: preço que chega do
      // cliente é sugestão, nunca fato.
      const cotada = Number(item.quantidade);
      const pedida = Math.max(cotada, escolha.quantidade ?? cotada);
      const { preco } = precoNaQuantidade(
        { quantidadePedida: cotada, precoBase: Number(resposta.precoUnitario) },
        resposta.faixas.map((f) => ({
          quantidadeMinima: Number(f.quantidadeMinima),
          precoUnitario: Number(f.precoUnitario),
        })),
        pedida,
      );

      const lista = porConvite.get(convite.id) ?? [];
      lista.push({
        productId: item.productId,
        packagingId: item.packagingId,
        qtdPedida: pedida,
        custoUnitario: preco,
      });
      porConvite.set(convite.id, lista);
    }

    if (porConvite.size === 0) {
      throw new Error(
        semProduto.length
          ? "Os itens escolhidos não estão vinculados a um produto do catálogo. Vincule antes de gerar o pedido."
          : "Nenhum item escolhido tem preço disponível.",
      );
    }

    // Sequencial de propósito: o número do pedido (PC-000NN) é gerado por
    // tenant e criações paralelas colidiriam no unique.
    const criados: { id: string; conviteId: string }[] = [];
    for (const [conviteId, items] of porConvite) {
      const convite = convitePorId.get(conviteId)!;
      const previsao = convite.prazoEntregaDias
        ? new Date(Date.now() + convite.prazoEntregaDias * 24 * 60 * 60 * 1000)
        : null;

      const id = await criarPedidoCompra(
        ctx.tenant.id,
        {
          siteId: cotacao.siteId,
          supplierId: convite.supplierId,
          previsaoEntrega: previsao,
          observacao: `Gerado da compra ${cotacao.numero}`,
          origem: "COTACAO",
          quotationId: cotacao.id,
          items,
        },
        { enviar: d.enviar, createdBy: ctx.user.id ?? undefined },
      );
      criados.push({ id, conviteId });
      await db.quotationSupplier.updateMany({
        where: { id: conviteId },
        data: { purchaseOrderId: id },
      });
    }

    await db.quotation.updateMany({
      where: { id: cotacao.id },
      data: { status: "DECIDIDA", decididaEm: new Date() },
    });

    revalidatePath("/cotacoes", "layout");
    revalidatePath("/pedidos", "layout");
    revalidatePath("/estoque", "layout");
    return { pedidos: criados.length, semProduto };
  });
}

// ── Ponte: Reposição Inteligente → Compra ───────────────────

const compraDaReposicaoItemSchema = z.object({
  productId: z.string().min(1),
  packagingId: z.string().optional().nullable(),
  descricao: z.string().trim().min(1),
  quantidade: z.number().positive(),
});

const compraDaReposicaoSchema = z.object({
  siteId: z.string().min(1, "Selecione a loja de destino."),
  titulo: z.string().trim().min(3).optional(),
  itens: z.array(compraDaReposicaoItemSchema).min(1, "Nenhum item selecionado."),
});

/**
 * Aprovar uma revisão de reposição SEMPRE cai numa Compra em Planejamento —
 * nunca pula direto pro pedido (funil único). Escolha de arquitetura: UMA
 * Quotation com todos os itens aprovados, sem fornecedor ainda — separar por
 * fornecedor já é o trabalho de "Cotar"/convidar na tela da Compra, não
 * precisa ser antecipado aqui (evita decidir fornecedor duas vezes).
 */
export async function criarCompraDaReposicaoAction(
  input: z.input<typeof compraDaReposicaoSchema>,
): Promise<{ id: string }> {
  const d = compraDaReposicaoSchema.parse(input);
  return txp("compras.pedir", d.siteId, async (tid, userId) => {
    const numero = await proximoNumero(tid);
    const cotacao = await db.quotation.create({
      data: {
        tenantId: tid,
        siteId: d.siteId,
        numero,
        titulo: d.titulo?.trim() || `Reposição sugerida — ${new Date().toLocaleDateString("pt-BR")}`,
        createdBy: userId,
        items: {
          create: d.itens.map((item, i) => ({
            tenantId: tid,
            productId: item.productId,
            packagingId: item.packagingId || null,
            descricao: item.descricao,
            quantidade: item.quantidade,
            ordem: i,
          })),
        },
      },
      select: { id: true },
    });
    ok();
    return { id: cotacao.id };
  });
}

// ── Travas da compra por escala ─────────────────────────────

const limitesEscalaSchema = z.object({
  coberturaMaxDias: z.number().int().min(0).max(3650),
  economiaMinPct: z.number().min(0).max(100),
  capitalExtraMax: z.number().min(0).max(99_999_999).nullable(),
});

/**
 * Guarda as travas que a lente "Melhor oportunidade" usa. São do TENANT e não
 * da cotação: o teto de caixa e a paciência com estoque parado são do negócio,
 * não desta compra. O comparativo deixa afrouxar na hora sem gravar — só este
 * botão vira padrão.
 */
export async function salvarLimitesEscalaAction(
  input: z.input<typeof limitesEscalaSchema>,
) {
  const d = limitesEscalaSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    await db.tenant.update({
      where: { id: ctx.tenant.id },
      data: {
        escalaCoberturaMaxDias: d.coberturaMaxDias,
        escalaEconomiaMinPct: d.economiaMinPct,
        escalaCapitalExtraMax: d.capitalExtraMax,
      },
    });
    ok();
    return { ok: true as const };
  });
}
