"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { db } from "@/lib/prisma";
import { listarEventos } from "@/lib/compras/eventos";
import { loadHistoricoCompraProduto } from "../cotacoes/_data";
import { loadComprasFormOptions, loadPedidosAReceber } from "../estoque/_data";
import { getActiveSiteId } from "@/lib/sites";
import type { GoodsReceiptStatus } from "@/generated/prisma";

/** Baseline de leitura do módulo. Escrita usa `txp` com a loja de destino. */
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
  revalidatePath("/pedidos", "layout");
  revalidatePath("/estoque", "layout");
};

// ── Pedidos de reposição em lote ──────────────────────────────
// Recebe a revisão das sugestões (já agrupadas por fornecedor no client)
// e cria um pedido de compra por fornecedor, tudo de uma vez.

const reposicaoPedidoSchema = z.object({
  supplierId: z.string().min(1),
  previsaoEntrega: z.string().optional().nullable(), // yyyy-mm-dd
  observacao: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        packagingId: z.string().optional().nullable(),
        qtdPedida: z.number().positive(),
        custoUnitario: z.number().nonnegative().default(0),
        observacao: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1),
});

const reposicaoSchema = z.object({
  siteId: z.string().min(1, "Selecione a loja de destino."),
  enviar: z.boolean().default(true),
  pedidos: z.array(reposicaoPedidoSchema).min(1, "Nenhum item selecionado."),
});

export async function criarPedidosReposicaoAction(input: z.input<typeof reposicaoSchema>) {
  const d = reposicaoSchema.parse(input);
  return txp("compras.pedir", d.siteId, async (tid, userId) => {
    const ids: string[] = [];
    // Sequencial de propósito: o número do pedido (PC-000NN) é gerado por
    // tenant e criações paralelas colidiriam no unique.
    for (const pedido of d.pedidos) {
      const id = await criarPedidoCompra(
        tid,
        {
          siteId: d.siteId,
          supplierId: pedido.supplierId,
          previsaoEntrega: pedido.previsaoEntrega ? new Date(`${pedido.previsaoEntrega}T00:00:00`) : null,
          observacao: pedido.observacao ?? null,
          origem: "REPOSICAO",
          items: pedido.items,
        },
        { enviar: d.enviar, createdBy: userId },
      );
      ids.push(id);
    }
    // Número gerado (PC-000NN) volta ao client — entra na mensagem ao fornecedor.
    const criados = await db.purchaseOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, numero: true, supplierId: true },
    });
    ok();
    return criados;
  });
}

// ── Histórico de compras do produto (lazy, p/ drawer) ─────────

export async function fetchHistoricoCompraProdutoAction(productId: string) {
  return tx(() => loadHistoricoCompraProduto(productId));
}

// ── Linha do tempo do pedido (lazy, p/ drawer) ────────────────

export async function listarEventosPedidoAction(purchaseOrderId: string) {
  return tx((tid) => listarEventos(tid, purchaseOrderId));
}

// ── Recebimentos do pedido (lazy, p/ drawer) ──────────────────
// O pedido NÃO vira recebimento: ele continua existindo e pode ter vários.
// Esta é a resposta de "o que já chegou deste pedido?" — uma linha por
// recebimento, aberto ou finalizado, com o caminho para abrir cada um.

export type RecebimentoDoPedido = {
  id: string;
  numero: string;
  status: GoodsReceiptStatus;
  data: string;
  valor: number;
  /** Quantidade contada e quanto se esperava neste recebimento. */
  recebido: number;
  esperado: number;
  numeroNota: string | null;
  temNota: boolean;
  estornado: boolean;
  href: string;
};

export async function listarRecebimentosPedidoAction(
  purchaseOrderId: string,
): Promise<RecebimentoDoPedido[]> {
  return tx(async () => {
    const rows = await db.goodsReceipt.findMany({
      where: { purchaseOrderId },
      select: {
        id: true,
        numero: true,
        status: true,
        numeroNota: true,
        iniciadoEm: true,
        finalizadoEm: true,
        inbound: { select: { numero: true, serie: true } },
        itens: {
          select: {
            qtdPedida: true,
            qtdFaturada: true,
            qtdRecebida: true,
            custoFaturado: true,
            bonificacao: true,
          },
        },
        entradas: { select: { estornadaEm: true } },
      },
      orderBy: { iniciadoEm: "asc" },
    });

    return rows.map((r): RecebimentoDoPedido => {
      const finalizado = r.status === "FINALIZADO";
      const esperadoDe = (i: (typeof r.itens)[number]) =>
        Number(i.qtdFaturada) || Number(i.qtdPedida);
      const recebidoDe = (i: (typeof r.itens)[number]) =>
        i.qtdRecebida == null ? (finalizado ? esperadoDe(i) : 0) : Number(i.qtdRecebida);
      return {
        id: r.id,
        numero: r.numero,
        status: r.status,
        data: (r.finalizadoEm ?? r.iniciadoEm).toISOString(),
        valor: r.itens.reduce(
          (a, i) => a + (i.bonificacao ? 0 : recebidoDe(i) * Number(i.custoFaturado)),
          0,
        ),
        recebido: r.itens.reduce((a, i) => a + recebidoDe(i), 0),
        esperado: r.itens.reduce((a, i) => a + esperadoDe(i), 0),
        numeroNota: r.inbound ? `${r.inbound.numero}/${r.inbound.serie}` : r.numeroNota,
        temNota: !!r.inbound,
        estornado: r.entradas.length > 0 && r.entradas.every((e) => e.estornadaEm),
        href: `/recebimento/${r.id}`,
      };
    });
  });
}

// ── Códigos de barras do pedido (p/ bipe no recebimento sem XML) ──
// Um produto/embalagem por vez seria N idas ao banco; aqui é uma só,
// batendo productId+packagingId de cada linha contra o catálogo.

export async function buscarCodigosDeBarrasAction(
  itens: { itemId: string; productId: string; packagingId: string | null }[],
) {
  return tx(async () => {
    const productIds = [...new Set(itens.map((i) => i.productId))];
    if (productIds.length === 0) return {};

    const produtos = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, ean: true, packagings: { select: { id: true, ean: true } } },
    });
    const porProduto = new Map(produtos.map((p) => [p.id, p]));

    const mapa: Record<string, string[]> = {};
    for (const it of itens) {
      const p = porProduto.get(it.productId);
      if (!p) continue;
      const codigos: string[] = [];
      if (p.ean) codigos.push(p.ean);
      const pkg = it.packagingId ? p.packagings.find((pk) => pk.id === it.packagingId) : null;
      if (pkg?.ean) codigos.push(pkg.ean);
      if (codigos.length > 0) mapa[it.itemId] = codigos;
    }
    return mapa;
  });
}

// ── Catálogo do form de pedido (lazy) ─────────────────────────
// `loadComprasFormOptions` varre catálogo, embalagens, saldos, últimos
// preços e lead time — é o item mais caro da tela e só serve DEPOIS de
// abrir o sheet (novo/editar/duplicar) ou o painel de bonificação. Sai
// do carregamento inicial de /pedidos e vem sob demanda, uma vez só.

export async function carregarFormOptionsAction() {
  return tx(() => loadComprasFormOptions());
}

// ── Pedidos abertos para receber (p/ o painel "Receber mercadoria") ──
// Quem chega pela porta "escanear"/"manual" sem ter clicado num pedido
// precisa escolher um ali mesmo. Sem isto, as duas portas ficavam
// desabilitadas explicando o motivo num `title` que celular nenhum mostra.

export async function listarPedidosAReceberAction() {
  return tx(async () => {
    const siteId = await getActiveSiteId();
    const pedidos = await loadPedidosAReceber(siteId);
    return pedidos.map((p) => ({
      ...p,
      previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      enviadoEm: p.enviadoEm?.toISOString() ?? null,
      confirmadoEm: p.confirmadoEm?.toISOString() ?? null,
      emTransitoEm: p.emTransitoEm?.toISOString() ?? null,
      recebidoEm: p.recebidoEm?.toISOString() ?? null,
      canceladoEm: p.canceladoEm?.toISOString() ?? null,
    }));
  });
}

// ── Busca de produto na conferência (item fora do pedido) ─────
// Deliberadamente magra: o catálogo inteiro (`carregarFormOptionsAction`) é
// caro e existe para montar pedido. Na porta, o que se procura é UM item que
// veio a mais — por nome, SKU ou o código que acabou de ser bipado.

export type ProdutoRecebimento = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: number | null;
  packagings: { id: string; nome: string; fatorConversao: number; isCompraDefault: boolean }[];
};

const selectProdutoRecebimento = {
  id: true,
  nome: true,
  sku: true,
  ean: true,
  imagemUrl: true,
  custoMedio: true,
  packagings: {
    select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true },
    orderBy: { fatorConversao: "asc" },
  },
} as const;

type ProdutoCru = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: unknown;
  packagings: { id: string; nome: string; fatorConversao: unknown; isCompraDefault: boolean }[];
};

const serialProduto = (p: ProdutoCru): ProdutoRecebimento => ({
  id: p.id,
  nome: p.nome,
  sku: p.sku,
  ean: p.ean,
  imagemUrl: p.imagemUrl,
  custoMedio: p.custoMedio == null ? null : Number(p.custoMedio),
  packagings: p.packagings.map((pk) => ({
    id: pk.id,
    nome: pk.nome,
    fatorConversao: Number(pk.fatorConversao) || 1,
    isCompraDefault: pk.isCompraDefault,
  })),
});

export async function buscarProdutosRecebimentoAction(termo: string): Promise<ProdutoRecebimento[]> {
  const q = termo.trim();
  if (q.length < 2) return [];
  return tx(async () => {
    const produtos = await db.product.findMany({
      where: {
        ativo: true,
        tipo: { in: ["SIMPLES", "INSUMO"] },
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { ean: { contains: q } },
        ],
      },
      select: selectProdutoRecebimento,
      orderBy: { nome: "asc" },
      take: 20,
    });
    return produtos.map(serialProduto);
  });
}

/**
 * Código bipado que não estava no pedido. Antes disso o bipe só dizia "fora
 * deste pedido" e morria ali — mas fornecedor mandar item a mais é rotina, e
 * quem está na porta precisa registrar o que tem na mão, não brigar com a tela.
 */
export async function buscarProdutoPorCodigoAction(codigo: string): Promise<{
  produto: ProdutoRecebimento;
  packagingId: string | null;
} | null> {
  const c = codigo.trim();
  if (!c) return null;
  return tx(async () => {
    const porEan = await db.product.findFirst({
      where: { ativo: true, OR: [{ ean: c }, { sku: { equals: c, mode: "insensitive" } }] },
      select: selectProdutoRecebimento,
    });
    if (porEan) return { produto: serialProduto(porEan), packagingId: null };

    // O código pode ser da CAIXA, não da unidade — aí a embalagem já vem
    // escolhida, e a quantidade digitada é em caixas.
    const pkg = await db.productPackaging.findFirst({
      where: { ean: c },
      select: { id: true, productId: true },
    });
    if (!pkg) return null;
    const produto = await db.product.findFirst({
      where: { id: pkg.productId, ativo: true },
      select: selectProdutoRecebimento,
    });
    return produto ? { produto: serialProduto(produto), packagingId: pkg.id } : null;
  });
}
