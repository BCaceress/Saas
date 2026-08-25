"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant, type ActiveTenant } from "@/lib/current-tenant";
import { assertPodeEscrever } from "@/lib/assinatura";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import {
  relacionarItemInbound,
  desrelacionarItemInbound,
  irmaosPendentesDoItem,
} from "@/lib/fiscal/entrada";
import { remontarConferencia } from "@/lib/compras/conciliacao";
import {
  buscarProdutosParaRelacionar,
  donoDoCodigo,
  produtosJaFornecidos,
} from "@/lib/compras/busca-produto";
import { sugestoesDaNota, type SugestaoDePara } from "@/lib/compras/sugestao-de-para";
import { createProduct } from "@/app/(app)/produtos/actions";

// ============================================================
// Ações do de-para item da nota ↔ produto do catálogo.
//
// Um dono só. A mesma pergunta ("esse aí virou qual produto meu?") é feita na
// fila fiscal e na conferência de recebimento — duas cópias da ação viravam
// dois fatores de conversão para o mesmo fardo, e aí o estoque mente.
// ============================================================

/**
 * Relacionar item ao catálogo é trabalho de PORTA e trabalho de ESCRITÓRIO: o
 * conferente faz na doca, o contador faz na fila da nota. Exigir uma
 * permissão só empurraria um dos dois para fora do próprio fluxo.
 */
async function tx<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  const pode =
    podeEmAlguma(ctx.acessos, "compras.receber") || podeEmAlguma(ctx.acessos, "fiscal.importar");
  if (!pode) throw new SemPermissaoError();
  assertPodeEscrever(ctx.tenant);
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

/** Leitura pura — ver o catálogo para escolher não muda nada. */
async function ler<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  const pode = podeEmAlguma(ctx.acessos, "compras.ver") || podeEmAlguma(ctx.acessos, "fiscal.ver");
  if (!pode) throw new SemPermissaoError();
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

/** Todas as telas que mostram a nota — não sabemos de qual delas veio a ação. */
function revalidar(inboundId?: string) {
  revalidatePath("/fiscal/notas-recebidas");
  revalidatePath("/pedidos");
  if (inboundId) revalidatePath(`/recebimento/${inboundId}`);
}

// ── Buscar no catálogo ──────────────────────────────────────

/**
 * Produtos para o seletor de de-para, por nome, SKU ou código de barras.
 * A ordem é a relevância ao que foi digitado (ver `busca-produto.ts`) —
 * alfabético com LIMIT chegava a esconder o produto certo.
 */
export async function buscarProdutosRelacionarAction(
  termo: string,
  gtin?: string | null,
  contexto?: { supplierId?: string | null; siteId?: string | null },
) {
  return ler(() =>
    buscarProdutosParaRelacionar(termo, {
      gtin,
      limite: 20,
      supplierId: contexto?.supplierId ?? null,
      siteId: contexto?.siteId ?? null,
    }),
  );
}

/**
 * Ponto de partida da busca: o que este fornecedor já mandou antes. Lista
 * vazia com o cursor piscando faz o operador digitar no escuro — e a resposta
 * quase sempre está no caminhão anterior do mesmo fornecedor.
 */
export async function produtosDoFornecedorAction(
  supplierId: string,
  siteId?: string | null,
) {
  return ler(() => produtosJaFornecidos(supplierId, { limite: 12, siteId }));
}

/**
 * De quem já é este código de barras. O painel pergunta ANTES de deixar
 * cadastrar: código repetido faz o PDV vender o produto errado, e o erro só
 * aparece no inventário que não fecha.
 */
export async function donoDoCodigoAction(gtin: string) {
  return ler(() => donoDoCodigo(gtin));
}
/**
 * Palpites recalculados depois de mexer no de-para: relacionar uma linha pode
 * ter criado embalagem/EAN que muda o palpite das outras. A carga inicial vem
 * pronta do servidor (ver `_data.ts`) — esta action é só para o depois.
 */
export async function sugestoesDaNotaAction(inboundId: string): Promise<SugestaoDePara[]> {
  return ler(() => sugestoesDaNota(inboundId));
}

// ── Relacionar ──────────────────────────────────────────────

const relacionarSchema = z.object({
  itemId: z.string().min(1),
  productId: z.string().min(1, "Escolha o produto."),
  /** Sabor/cor que a linha da nota representa — vai junto no de-para. */
  variantId: z.string().optional().nullable(),
  packagingId: z.string().optional().nullable(),
  fatorConversao: z.coerce.number().positive().default(1),
});

export async function relacionarItemAction(input: z.input<typeof relacionarSchema>) {
  return tx(async (ctx) => {
    const d = relacionarSchema.parse(input);
    const r = await relacionarItemInbound({ tenantId: ctx.tenant.id, ...d });

    // Mesmo código do fornecedor na mesma nota é o mesmo produto — só em lote
    // ou desconto diferente. Perguntar de novo por cada linha é imposto de
    // tempo, então elas seguem junto e o retorno diz quantas foram.
    const irmaos = await irmaosPendentesDoItem(d.itemId);
    for (const itemId of irmaos) {
      await relacionarItemInbound({ tenantId: ctx.tenant.id, ...d, itemId });
    }

    const inboundId = await remontarSeEmConferencia(ctx, d.itemId);
    revalidar(inboundId);
    // O cadastro do produto pode ter ganhado embalagem, EAN ou custo.
    revalidatePath("/produtos");
    return { ...r, irmaos: irmaos.length };
  });
}

/**
 * Grava várias sugestões de uma vez.
 *
 * Só faz sentido para as de código de barras: EAN batendo é prova, e numa nota
 * de 40 linhas em que 30 vieram por código o operador estava clicando 30 vezes
 * no mesmo botão para dizer "sim" trinta vezes. Palpite por NOME continua um a
 * um de propósito — ali a decisão é dele, não da máquina.
 */
export async function relacionarEmLoteAction(
  sugestoes: {
    itemId: string;
    productId: string;
    variantId?: string | null;
    packagingId?: string | null;
    fatorConversao: number;
  }[],
) {
  return tx(async (ctx) => {
    let relacionados = 0;
    let inboundId: string | undefined;
    const falhas: string[] = [];

    for (const s of sugestoes) {
      try {
        await relacionarItemInbound({ tenantId: ctx.tenant.id, ...s });
        relacionados++;
        // Irmãos entram junto aqui também — a nota repete o mesmo cProd em
        // lotes diferentes e cada repetição é a mesma decisão.
        for (const irmao of await irmaosPendentesDoItem(s.itemId)) {
          await relacionarItemInbound({ tenantId: ctx.tenant.id, ...s, itemId: irmao });
          relacionados++;
        }
      } catch (e) {
        // Uma linha problemática não pode derrubar as outras 29: a falha é
        // contada e a nota segue com o que deu certo.
        falhas.push(e instanceof Error ? e.message : "falha desconhecida");
      }
      inboundId ??= await inboundDoItem(s.itemId);
    }

    // Uma remontagem só no fim: refazer as linhas da conferência a cada item
    // do lote seria N vezes o mesmo trabalho, e só o último estado importa.
    const primeiro = sugestoes[0]?.itemId;
    if (primeiro) await remontarSeEmConferencia(ctx, primeiro);
    revalidar(inboundId);
    revalidatePath("/produtos");
    return { relacionados, falhas: falhas.length };
  });
}

/** Desfaz o de-para de uma linha — e o mapa do fornecedor que o gerou. */
export async function desrelacionarItemAction(itemId: string) {
  return tx(async (ctx) => {
    await desrelacionarItemInbound({ itemId });
    revalidar(await remontarSeEmConferencia(ctx, itemId));
  });
}

// ── Cadastro-relâmpago a partir do item da nota ──────────────

export type SubcategoriaCadastro = { id: string; nome: string; categoriaNome: string };

/** Subcategorias para o select do cadastro rápido. */
export async function subcategoriasAction(): Promise<SubcategoriaCadastro[]> {
  return ler(async () => {
    const subs = await db.subcategory.findMany({
      where: { ativo: true },
      orderBy: [{ category: { nome: "asc" } }, { nome: "asc" }],
      select: { id: true, nome: true, category: { select: { nome: true } } },
    });
    return subs.map((s) => ({ id: s.id, nome: s.nome, categoriaNome: s.category.nome }));
  });
}

const criarDoItemSchema = z.object({
  itemId: z.string().min(1),
  nome: z.string().trim().min(2, "Informe o nome do produto."),
  subcategoryId: z.string().min(1, "Escolha a subcategoria."),
  /** Unidades de prateleira por unidade de compra da nota. */
  fatorConversao: z.coerce.number().positive().default(1),
  embalagemNome: z.string().trim().optional(),
});

/**
 * Cria o produto que faltava usando o que o XML já sabe e relaciona a linha na
 * mesma ação. Sem isso o operador abandona a nota no meio, cadastra o produto
 * em outra tela e volta para procurar onde estava.
 */
export async function criarProdutoDoItemAction(input: z.input<typeof criarDoItemSchema>) {
  const d = criarDoItemSchema.parse(input);

  const item = await tx(async () => {
    const i = await db.fiscalInboundItem.findFirst({
      where: { id: d.itemId },
      select: {
        id: true,
        gtin: true,
        unidade: true,
        quantidade: true,
        valorTotal: true,
        valorDesconto: true,
        valorIcmsSt: true,
        valorFcpSt: true,
        valorIpi: true,
        valorFrete: true,
        bonificacao: true,
        inbound: { select: { supplierId: true } },
      },
    });
    if (!i) throw new Error("Item não encontrado.");
    return i;
  });

  const quantidade = Number(item.quantidade);
  const custoDaLinha = item.bonificacao
    ? 0
    : Math.max(
        0,
        Number(item.valorTotal) -
          Number(item.valorDesconto) +
          Number(item.valorIcmsSt) +
          Number(item.valorFcpSt) +
          Number(item.valorIpi) +
          Number(item.valorFrete),
      );
  // Custo por unidade de PRATELEIRA — é assim que o cadastro guarda, e é o
  // número que o alerta de custo fora da curva vai comparar depois.
  const unidades = quantidade * d.fatorConversao;
  const custo = unidades > 0 ? custoDaLinha / unidades : 0;

  // Com conversão, o código de barras da nota é do fardo, não da garrafa:
  // gravar como EAN do produto faria o PDV bipar a caixa e vender uma unidade.
  const daEmbalagem = d.fatorConversao > 1;

  const produto = await createProduct({
    nome: d.nome,
    subcategoryId: d.subcategoryId,
    ean: !daEmbalagem && item.gtin ? item.gtin : undefined,
    custo,
    fornecedorPrincipalId: item.inbound.supplierId ?? undefined,
    custoFornecedor: custo > 0 ? custo : undefined,
    packagings: daEmbalagem
      ? [
          {
            nome: d.embalagemNome?.trim() || item.unidade || "Caixa",
            ean: item.gtin,
            fatorConversao: d.fatorConversao,
          },
        ]
      : [],
  });

  const r = await relacionarItemAction({
    itemId: d.itemId,
    productId: produto.id,
    fatorConversao: d.fatorConversao,
  });
  return { productId: produto.id, sku: produto.sku, ...r };
}

// ── Auxiliares ──────────────────────────────────────────────

/**
 * A linha recém-relacionada precisa aparecer na conferência com o nome do
 * produto — e isso vale para as duas portas, com pedido ou sem ele. Nota que
 * ainda não escolheu porta não tem linha para remontar. Devolve o id da nota
 * para quem precisa revalidar a rota dela.
 */
async function inboundDoItem(itemId: string): Promise<string | undefined> {
  const i = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: { inboundId: true },
  });
  return i?.inboundId;
}

async function remontarSeEmConferencia(
  ctx: ActiveTenant,
  itemId: string,
): Promise<string | undefined> {
  const item = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: {
      inboundId: true,
      inbound: { select: { purchaseOrderId: true, conciliadoEm: true } },
    },
  });
  if (!item) return undefined;
  if (item.inbound.purchaseOrderId || item.inbound.conciliadoEm) {
    await remontarConferencia(ctx.tenant.id, item.inboundId, ctx.user.id);
  }
  return item.inboundId;
}
