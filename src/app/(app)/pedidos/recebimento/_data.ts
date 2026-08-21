import "server-only";
import { db } from "@/lib/prisma";
import { sugerirPedidos, type SugestaoPedido } from "@/lib/compras/conciliacao";
import { listarEventos, type EventoPedido } from "@/lib/compras/eventos";
import type {
  FiscalInboundStatus,
  PurchaseOrderStatus,
  ReconciliationResolucao,
  ReconciliationStatus,
} from "@/generated/prisma";

// ============================================================
// Leitura da tela de recebimento inteligente.
//
// A tela mostra três colunas por item — pedido, nota, recebido — e nada mais.
// Tudo aqui já vem em UNIDADE BASE, com as embalagens do produto por perto
// para o bipe somar 12 quando o que passou no leitor foi a caixa.
// ============================================================

export type EmbalagemView = {
  id: string;
  nome: string;
  ean: string | null;
  fator: number;
};

export type LinhaRecebimento = {
  id: string;
  productId: string | null;
  inboundItemId: string | null;
  descricao: string;
  sku: string | null;
  imagemUrl: string | null;
  ean: string | null;
  codigoFornecedor: string | null;
  qtdPedida: number;
  qtdFaturada: number;
  qtdRecebida: number | null;
  custoPedido: number;
  custoFaturado: number;
  bonificacao: boolean;
  status: ReconciliationStatus;
  resolucao: ReconciliationResolucao | null;
  motivoDivergencia: string | null;
  lote: string | null;
  validade: string | null;
  embalagens: EmbalagemView[];
};

export type NotaRecebimento = {
  id: string;
  status: FiscalInboundStatus;
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: string;
  valorTotal: number;
  fornecedor: string;
  cnpj: string;
  siteNome: string;
  vinculoAutomatico: boolean;
  conciliadoEm: string | null;
  temXml: boolean;
  /** cobr/dup do XML: o parcelamento que o fornecedor cobrou. */
  duplicatas: { numero: string; vencimento: string; valor: number }[];
};

export type PedidoRecebimento = {
  id: string;
  numero: string;
  status: PurchaseOrderStatus;
  valorTotal: number;
  previsaoEntrega: string | null;
};

export type ResumoRecebimento = {
  itens: number;
  valorNota: number;
  divergencias: number;
  custosAlterados: number;
  conferidos: number;
  /** Sem produto relacionado ainda — a entrada trava até isto chegar a zero. */
  produtosNovos: number;
  /** Diferença de custo total (nota − pedido) nos itens que casaram. */
  impactoCusto: number;
};

/** Item cru da nota — o que a tela mostra antes de haver pedido vinculado. */
export type ItemNotaView = {
  id: string;
  ordem: number;
  descricao: string;
  codigoFornecedor: string;
  gtin: string | null;
  unidade: string;
  quantidade: number;
  fatorConversao: number;
  valorTotal: number;
  bonificacao: boolean;
  productId: string | null;
  produtoNome: string | null;
};

export type RecebimentoView = {
  nota: NotaRecebimento;
  pedido: PedidoRecebimento | null;
  sugestoes: SugestaoPedido[];
  /** Só preenchido enquanto não há pedido: é a lista para relacionar/gerar pedido. */
  itensNota: ItemNotaView[];
  linhas: LinhaRecebimento[];
  resumo: ResumoRecebimento;
  timeline: EventoPedido[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function carregarRecebimento(
  tenantId: string,
  inboundId: string,
): Promise<RecebimentoView | null> {
  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      status: true,
      chave: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      valorTotal: true,
      emitRazaoSocial: true,
      emitCnpj: true,
      purchaseOrderId: true,
      vinculoAutomatico: true,
      conciliadoEm: true,
      site: { select: { nome: true } },
      xmlArquivo: { select: { id: true } },
      duplicatas: {
        orderBy: { vencimento: "asc" },
        select: { numero: true, vencimento: true, valor: true },
      },
    },
  });
  if (!inbound) return null;

  const pedido = inbound.purchaseOrderId
    ? await db.purchaseOrder.findFirst({
        where: { id: inbound.purchaseOrderId },
        select: {
          id: true,
          numero: true,
          status: true,
          valorTotal: true,
          previsaoEntrega: true,
        },
      })
    : null;

  const linhasCru = pedido
    ? await db.purchaseReconciliationItem.findMany({
        where: { inboundId },
        // Ordem alfabética e estável: a lista é para conferir na sequência da
        // paleteira, e o que está errado já subiu para o painel de divergências.
        orderBy: { descricao: "asc" },
      })
    : [];

  // Sem pedido, o assunto da tela são os itens crus da nota: é neles que o
  // operador relaciona o catálogo antes de escolher (ou gerar) o pedido.
  const itensCru = pedido
    ? []
    : await db.fiscalInboundItem.findMany({
        where: { inboundId },
        select: {
          id: true,
          ordem: true,
          descricao: true,
          codigoFornecedor: true,
          gtin: true,
          unidade: true,
          quantidade: true,
          fatorConversao: true,
          valorTotal: true,
          bonificacao: true,
          productId: true,
        },
        // Alfabética, igual à lista pós-vínculo — a ordem da nota (`ordem`)
        // não ajuda a achar o item na hora de relacionar ao catálogo.
        orderBy: { descricao: "asc" },
      });

  const produtos = await produtosDe([
    ...linhasCru.map((l) => l.productId),
    ...itensCru.map((i) => i.productId),
  ]);

  const itensNota: ItemNotaView[] = itensCru.map((i) => ({
    id: i.id,
    ordem: i.ordem,
    descricao: i.descricao,
    codigoFornecedor: i.codigoFornecedor,
    gtin: i.gtin,
    unidade: i.unidade,
    quantidade: Number(i.quantidade),
    fatorConversao: Number(i.fatorConversao),
    valorTotal: Number(i.valorTotal),
    bonificacao: i.bonificacao,
    productId: i.productId,
    produtoNome: i.productId ? (produtos.get(i.productId)?.nome ?? null) : null,
  }));

  const linhas: LinhaRecebimento[] = linhasCru.map((l) => {
    const p = l.productId ? produtos.get(l.productId) : null;
    return {
      id: l.id,
      productId: l.productId,
      inboundItemId: l.inboundItemId,
      descricao: l.descricao,
      sku: p?.sku ?? null,
      imagemUrl: p?.imagemUrl ?? null,
      ean: l.ean ?? p?.ean ?? null,
      codigoFornecedor: l.codigoFornecedor,
      qtdPedida: Number(l.qtdPedida),
      qtdFaturada: Number(l.qtdFaturada),
      qtdRecebida: l.qtdRecebida == null ? null : Number(l.qtdRecebida),
      custoPedido: Number(l.custoPedido),
      custoFaturado: Number(l.custoFaturado),
      bonificacao: l.bonificacao,
      status: l.status,
      resolucao: l.resolucao,
      motivoDivergencia: l.motivoDivergencia,
      lote: l.lote,
      validade: l.validade ? l.validade.toISOString().slice(0, 10) : null,
      embalagens: p?.embalagens ?? [],
    };
  });

  const resumo: ResumoRecebimento = {
    itens: linhas.length,
    valorNota: Number(inbound.valorTotal),
    divergencias: linhas.filter((l) => l.status !== "OK" && !l.resolucao).length,
    custosAlterados: linhas.filter((l) => l.status === "PRECO_ALTERADO").length,
    conferidos: linhas.filter((l) => l.qtdRecebida != null).length,
    produtosNovos: linhas.filter((l) => !l.productId).length,
    impactoCusto: linhas.reduce(
      (s, l) =>
        l.qtdPedida > 0 && l.custoPedido > 0
          ? s + (l.custoFaturado - l.custoPedido) * Math.min(l.qtdFaturada, l.qtdPedida)
          : s,
      0,
    ),
  };

  return {
    nota: {
      id: inbound.id,
      status: inbound.status,
      chave: inbound.chave,
      numero: inbound.numero,
      serie: inbound.serie,
      dataEmissao: inbound.dataEmissao.toISOString(),
      valorTotal: Number(inbound.valorTotal),
      fornecedor: inbound.emitRazaoSocial,
      cnpj: inbound.emitCnpj,
      siteNome: inbound.site.nome,
      vinculoAutomatico: inbound.vinculoAutomatico,
      conciliadoEm: iso(inbound.conciliadoEm),
      temXml: Boolean(inbound.xmlArquivo),
      duplicatas: inbound.duplicatas.map((d) => ({
        numero: d.numero,
        vencimento: d.vencimento.toISOString(),
        valor: Number(d.valor),
      })),
    },
    pedido: pedido
      ? {
          id: pedido.id,
          numero: pedido.numero,
          status: pedido.status,
          valorTotal: Number(pedido.valorTotal),
          previsaoEntrega: iso(pedido.previsaoEntrega),
        }
      : null,
    // Sem pedido vinculado a tela vira "qual pedido é este?" — as sugestões
    // são o conteúdo principal, então valem a consulta.
    sugestoes: pedido ? [] : await sugerirPedidos(inboundId),
    itensNota,
    linhas,
    resumo,
    timeline: pedido ? await listarEventos(tenantId, pedido.id) : [],
  };
}

type ProdutoView = {
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  embalagens: EmbalagemView[];
};

async function produtosDe(ids: (string | null)[]): Promise<Map<string, ProdutoView>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map();
  const produtos = await db.product.findMany({
    where: { id: { in: unicos } },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      packagings: { select: { id: true, nome: true, ean: true, fatorConversao: true } },
    },
  });
  return new Map(
    produtos.map((p) => [
      p.id,
      {
        nome: p.nome,
        sku: p.sku,
        ean: p.ean,
        imagemUrl: p.imagemUrl,
        embalagens: p.packagings.map((e) => ({
          id: e.id,
          nome: e.nome,
          ean: e.ean,
          fator: Number(e.fatorConversao),
        })),
      },
    ]),
  );
}

export type SubcategoriaCadastro = { id: string; nome: string; categoriaNome: string };

/**
 * Só o suficiente pra um select — o cadastro rápido do recebimento não
 * precisa da árvore inteira que `/produtos` usa pra gerenciar categorias.
 */
export async function listarSubcategoriasParaCadastro(): Promise<SubcategoriaCadastro[]> {
  const subcategorias = await db.subcategory.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, category: { select: { nome: true } } },
    orderBy: [{ category: { nome: "asc" } }, { nome: "asc" }],
  });
  return subcategorias.map((s) => ({ id: s.id, nome: s.nome, categoriaNome: s.category.nome }));
}
