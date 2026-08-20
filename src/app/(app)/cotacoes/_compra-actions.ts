"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSite, guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { emitirLinkCotacao, linkVigente } from "@/lib/compras/cotacao-link";
import { registrarPrecosDaCotacao } from "@/lib/compras/cotacao-precos";
import { ofertasPorProduto } from "@/lib/compras/comparador";
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
 * Deriva do MAIOR número existente, não da contagem: rascunho vazio é
 * descartado (ver `descartarSeVazia`), e contar linhas faria o contador andar
 * para trás e bater de frente com o unique `[tenantId, numero]`.
 */
async function proximoNumero(): Promise<string> {
  const ultima = await db.quotation.findFirst({
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const anterior = Number(ultima?.numero?.replace(/\D/g, "") ?? 0);
  return `COT-${String(anterior + 1).padStart(5, "0")}`;
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

/** Cotação em RASCUNHO ou ABERTA ainda aceita edição de itens/convidados. */
async function exigirEditavel(id: string) {
  const c = await db.quotation.findFirst({ where: { id }, select: { status: true, siteId: true } });
  if (!c) throw new Error("Cotação não encontrada.");
  if (c.status === "CANCELADA" || c.status === "DECIDIDA") {
    throw new Error("Esta cotação já foi fechada e não aceita mais mudanças.");
  }
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
    const numero = await proximoNumero();
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

const editarSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().trim().min(3),
  siteId: z.string().optional().nullable(),
  prazoResposta: z.string().optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
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
        prazoResposta: d.prazoResposta ? new Date(`${d.prazoResposta}T23:59:59`) : null,
        observacao: d.observacao ?? null,
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
};

async function montarProdutos(
  produtos: {
    id: string;
    nome: string;
    sku: string;
    imagemUrl: string | null;
    stocks: { estoqueFechado: unknown; estoqueAberto: unknown; estoqueMinimo: unknown }[];
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
    await exigirEditavel(d.quotationId);
    const ultimo = await db.quotationItem.findFirst({
      where: { quotationId: d.quotationId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });
    await db.quotationItem.create({
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
    });
    ok();
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
    await exigirEditavel(item.quotationId);
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
    await exigirEditavel(item.quotationId);
    await db.quotationItem.deleteMany({ where: { id } });
    ok();
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
    await exigirEditavel(d.quotationId);
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
    await exigirEditavel(d.quotationId);
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
    await exigirEditavel(convite.quotationId);
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
  itens: { descricao: string; quantidade: number }[],
  linkResposta: string | null,
): string {
  const linhas = itens.map((i) => `• ${i.descricao} — ${i.quantidade.toLocaleString("pt-BR")}`);
  const prazoTexto = prazo
    ? `\nPreciso da resposta até ${prazo.toLocaleDateString("pt-BR")}.`
    : "";
  const fecho = linkResposta
    ? `\nÉ só preencher os preços aqui (não precisa cadastro):\n${linkResposta}`
    : "\nPode me passar preço, prazo de entrega e condição de pagamento?";
  return [
    `Olá! Aqui é da ${empresa}.`,
    `Pedido de cotação ${numero} — ${titulo}:`,
    "",
    ...linhas,
    prazoTexto,
    fecho,
  ].join("\n");
}

const enviarSchema = z.object({
  quotationId: z.string().min(1),
  /** Vazio = manda para todos os convidados que ainda não receberam. */
  conviteIds: z.array(z.string().min(1)).optional(),
  /**
   * Por onde o link vai. O LINK é o mesmo nos dois canais — só muda o
   * carteiro. E-mail sai do servidor; WhatsApp continua sendo a mensagem
   * pronta que o operador dispara (sem gateway oficial, ver [[cotacoes-rfq]]).
   */
  canais: z.array(z.enum(["whatsapp", "email"])).min(1).default(["whatsapp"]),
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

export async function enviarCotacaoAction(input: z.input<typeof enviarSchema>) {
  const d = enviarSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        numero: true,
        titulo: true,
        status: true,
        prazoResposta: true,
        observacao: true,
        items: { select: { descricao: true, quantidade: true }, orderBy: { ordem: "asc" } },
        suppliers: {
          select: {
            id: true,
            status: true,
            supplier: {
              select: { razaoSocial: true, nomeFantasia: true, telefone: true, email: true },
            },
          },
        },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    if (cotacao.items.length === 0)
      throw new Error("Adicione ao menos um item antes de enviar.");
    if (cotacao.suppliers.length === 0) throw new Error("Convide ao menos um fornecedor.");

    const aceita = d.reenviar
      ? (st: string) => st === "PENDENTE" || st === "ENVIADA"
      : (st: string) => st === "PENDENTE";
    const alvos = cotacao.suppliers.filter(
      (s) => (d.conviteIds?.length ? d.conviteIds.includes(s.id) : true) && aceita(s.status),
    );
    if (alvos.length === 0) {
      throw new Error(
        d.reenviar
          ? "Ninguém para reenviar: os escolhidos já responderam ou recusaram."
          : "Todos os fornecedores escolhidos já receberam.",
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

    return Promise.all(
      alvos.map(async (a) => {
        const link = links.get(a.id) ?? null;
        const fornecedor = a.supplier.nomeFantasia || a.supplier.razaoSocial;
        const mensagem = montarMensagem(
          ctx.tenant.nome,
          cotacao.numero,
          cotacao.titulo,
          prazo,
          cotacao.items.map((i) => ({
            descricao: i.descricao,
            quantidade: Number(i.quantidade),
          })),
          link,
        );
        const tel = a.supplier.telefone?.replace(/\D/g, "") ?? "";
        const numeroWa = tel.length && tel.length <= 11 ? `55${tel}` : tel;

        // E-mail nunca derruba o envio: o convite já está gravado e o link
        // continua copiável na tela. Falha vira aviso, não exceção.
        let email: EmailEnvio = { estado: "nao-pedido", endereco: a.supplier.email ?? null };
        if (d.canais.includes("email") && link) {
          if (!a.supplier.email) {
            email = { estado: "sem-endereco", endereco: null };
          } else {
            const r = await enviarEmail(
              emailCotacao({
                para: a.supplier.email,
                fornecedor,
                mercado: ctx.tenant.nome,
                numero: cotacao.numero,
                titulo: cotacao.titulo,
                url: link,
                prazo: prazoTexto,
                itens: cotacao.items.map((i) => ({
                  descricao: i.descricao,
                  quantidade: Number(i.quantidade).toLocaleString("pt-BR", {
                    maximumFractionDigits: 3,
                  }),
                })),
                observacao: cotacao.observacao,
              }),
            );
            email = r.ok
              ? { estado: "enviado", endereco: a.supplier.email }
              : { estado: "falhou", endereco: a.supplier.email, erro: r.erro };
          }
        }

        return {
          conviteId: a.id,
          fornecedor,
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

/**
 * Texto pronto do convite (com o link dentro), sem reenviar nada.
 *
 * Existe porque copiar SÓ o link obriga o operador a escrever a explicação de
 * novo em cada conversa. Com o texto na mão ele manda pelo canal que quiser —
 * outro WhatsApp, Telegram, e-mail pessoal do vendedor — sem passar por aqui.
 */
export async function mensagemDoConviteAction(conviteId: string): Promise<{
  fornecedor: string;
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
        supplier: { select: { razaoSocial: true, nomeFantasia: true, telefone: true } },
        quotation: {
          select: {
            numero: true,
            titulo: true,
            status: true,
            prazoResposta: true,
            items: {
              select: { descricao: true, quantidade: true },
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

    const mensagem = montarMensagem(
      ctx.tenant.nome,
      convite.quotation.numero,
      convite.quotation.titulo,
      convite.quotation.prazoResposta,
      convite.quotation.items.map((i) => ({
        descricao: i.descricao,
        quantidade: Number(i.quantidade),
      })),
      link,
    );
    const tel = convite.supplier.telefone?.replace(/\D/g, "") ?? "";
    const numeroWa = tel.length && tel.length <= 11 ? `55${tel}` : tel;

    return {
      fornecedor: convite.supplier.nomeFantasia || convite.supplier.razaoSocial,
      mensagem,
      link,
      waLink: numeroWa ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(mensagem)}` : null,
    };
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
      }),
    )
    .min(1, "Registre ao menos um item."),
});

export async function registrarRespostaAction(input: z.input<typeof respostaSchema>) {
  const d = respostaSchema.parse(input);
  return txp("compras.pedir", null, async (tid) => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: d.conviteId },
      select: { quotationId: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);

    // Regravar por cima: corrigir um preço digitado errado é rotina, e a
    // resposta é sempre a última que o fornecedor mandou.
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

// ── Cotar pelo catálogo ──────────────────────────────────────
// Ponte entre o Comparador/Cesta (aposentados como tela própria) e a compra:
// em vez do operador esperar resposta de RFQ, ele escolhe direto na tabela
// de preço já importada do fornecedor. O destino do dado é o MESMO de uma
// resposta manual — QuotationSupplier + QuotationResponse — só que o preço
// vem do catálogo (`SupplierCatalogItem`) em vez de ser digitado.

export async function carregarOfertasCotacaoAction(
  quotationId: string,
): Promise<Record<string, { supplierId: string; supplierNome: string; precoEfetivo: number }[]>> {
  return tx(async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: quotationId },
      select: { items: { select: { id: true, productId: true } } },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");

    const productIds = [...new Set(cotacao.items.flatMap((i) => (i.productId ? [i.productId] : [])))];
    const ofertas = await ofertasPorProduto(productIds);

    const porItem: Record<string, { supplierId: string; supplierNome: string; precoEfetivo: number }[]> = {};
    for (const item of cotacao.items) {
      if (!item.productId) continue;
      const lista = ofertas.get(item.productId) ?? [];
      porItem[item.id] = lista.map((o) => ({
        supplierId: o.supplierId,
        supplierNome: o.supplierNome,
        precoEfetivo: o.precoEfetivo,
      }));
    }
    return porItem;
  });
}

const cotarCatalogoSchema = z.object({
  quotationId: z.string().min(1),
  escolhas: z
    .array(
      z.object({
        quotationItemId: z.string().min(1),
        supplierId: z.string().min(1),
        precoUnitario: z.number().min(0),
      }),
    )
    .min(1, "Escolha ao menos um fornecedor."),
});

export async function cotarComCatalogoAction(input: z.input<typeof cotarCatalogoSchema>) {
  const d = cotarCatalogoSchema.parse(input);
  return txp("compras.pedir", null, async (tid) => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        id: true,
        items: { select: { id: true } },
        suppliers: { select: { id: true, supplierId: true } },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    await exigirEditavel(cotacao.id);

    const porFornecedor = new Map<string, Map<string, number>>();
    for (const e of d.escolhas) {
      const mapa = porFornecedor.get(e.supplierId) ?? new Map<string, number>();
      mapa.set(e.quotationItemId, e.precoUnitario);
      porFornecedor.set(e.supplierId, mapa);
    }

    for (const [supplierId, precoPorItem] of porFornecedor) {
      let convite = cotacao.suppliers.find((s) => s.supplierId === supplierId) ?? null;
      if (!convite) {
        convite = await db.quotationSupplier.create({
          data: { tenantId: tid, quotationId: cotacao.id, supplierId },
          select: { id: true, supplierId: true },
        });
      }
      // Mesma convenção de `registrarRespostaAction`: regrava a resposta
      // inteira do convite. Item fora de `precoPorItem` fica "indisponível"
      // para este fornecedor — correto quando o catálogo dele não tem o item;
      // simplificação aceita quando o operador escolheu outro fornecedor mais
      // barato para aquele item específico.
      await db.quotationResponse.deleteMany({ where: { quotationSupplierId: convite.id } });
      await db.quotationResponse.createMany({
        data: cotacao.items.map((item) => ({
          tenantId: tid,
          quotationSupplierId: convite!.id,
          quotationItemId: item.id,
          disponivel: precoPorItem.has(item.id),
          precoUnitario: precoPorItem.get(item.id) ?? 0,
        })),
      });
      await db.quotationSupplier.updateMany({
        where: { id: convite.id },
        data: { status: "RESPONDIDA", respondidaEm: new Date(), respondidaVia: "OPERADOR" },
      });
    }

    ok();
  });
}

// ── Decisão: compra vira pedido ─────────────────────────────

const decidirSchema = z.object({
  quotationId: z.string().min(1),
  /** Item → convite escolhido. Item de fora fica sem pedido, de propósito. */
  escolhas: z
    .array(z.object({ quotationItemId: z.string().min(1), conviteId: z.string().min(1) }))
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
              select: { quotationItemId: true, disponivel: true, precoUnitario: true },
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

      const lista = porConvite.get(convite.id) ?? [];
      lista.push({
        productId: item.productId,
        packagingId: item.packagingId,
        qtdPedida: Number(item.quantidade),
        custoUnitario: Number(resposta.precoUnitario),
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
    const numero = await proximoNumero();
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
