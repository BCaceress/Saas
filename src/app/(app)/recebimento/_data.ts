import "server-only";
import { db } from "@/lib/prisma";
import { sugerirPedidos, type SugestaoPedido } from "@/lib/compras/conciliacao";
import { listarEventos, listarEventosDaNota, type EventoPedido } from "@/lib/compras/eventos";
import { sugestoesDaNota, type SugestaoDePara } from "@/lib/compras/sugestao-de-para";
import type { ItemDePara } from "@/components/recebimento/tabela-de-para";
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
  /**
   * O que o XML escreveu nesta linha, intacto.
   *
   * A conferência conta UNIDADE — 0,6 MI de cigarro viram 600 maços contados
   * na porta. Guardar a quantidade e a unidade originais ao lado é o que
   * mantém a rastreabilidade fiscal: o número convertido é outro campo, nunca
   * a substituição silenciosa do que o fornecedor faturou.
   */
  xml: { quantidade: number; unidade: string; fatorConversao: number } | null;
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
  uf: string | null;
  supplierId: string | null;
  siteId: string;
  siteNome: string;
  /** Motivo do descarte, quando houve. */
  observacao: string | null;
  /** Por que este documento não virou estoque — serviço, frete ou já lançado. */
  semEstoqueMotivo: string | null;
  /** A entrada que esta nota gerou (ou que ela documenta). */
  purchaseId: string | null;
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

/**
 * Item cru da nota — o que a etapa de de-para mostra antes de haver pedido.
 * É o mesmo formato que a fila fiscal usa: a tabela é a mesma nas duas telas.
 */
export type ItemNotaView = ItemDePara;

export type RecebimentoView = {
  nota: NotaRecebimento;
  pedido: PedidoRecebimento | null;
  /**
   * Conferência sem pedido: há linhas para conferir e não há (nem haverá) um
   * pedido por trás. A tela esconde a coluna "Pedido" — comparar a nota com
   * ela mesma não é conciliação, é ruído.
   */
  semPedido: boolean;
  sugestoes: SugestaoPedido[];
  /**
   * Palpites de de-para já prontos. Vêm do servidor porque buscá-los no
   * cliente fazia a tabela pintar três estados até chegar onde já dava para
   * nascer: "sem produto" → "procurando…" → o palpite.
   */
  sugestoesDePara: SugestaoDePara[];
  /** Só preenchido enquanto a nota não entrou em conferência (com ou sem pedido). */
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
      emitUf: true,
      supplierId: true,
      observacao: true,
      semEstoqueMotivo: true,
      purchaseId: true,
      purchaseOrderId: true,
      vinculoAutomatico: true,
      conciliadoEm: true,
      siteId: true,
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

  // A conferência existe com pedido (conciliação) ou sem ele (a nota é a
  // referência). O que decide é haver linha montada, não haver pedido.
  const emConferencia = Boolean(pedido) || Boolean(inbound.conciliadoEm);

  const linhasCru = emConferencia
    ? await db.purchaseReconciliationItem.findMany({
        where: { inboundId },
        // Ordem alfabética e estável: a lista é para conferir na sequência da
        // paleteira, e o que está errado já subiu para o painel de divergências.
        orderBy: { descricao: "asc" },
      })
    : [];

  const semPedido = !pedido && linhasCru.length > 0;

  // A linha da conferência já vem convertida em unidades. Para dizer de ONDE
  // aquele número saiu — "0,6 MI × 1.000" — a tela precisa do item cru da nota.
  const itensDaNota = emConferencia
    ? await db.fiscalInboundItem.findMany({
        where: { inboundId },
        select: { id: true, unidade: true, quantidade: true, fatorConversao: true },
      })
    : [];
  const xmlPorItem = new Map(itensDaNota.map((i) => [i.id, i]));

  // Antes de escolher a porta, o assunto da tela são os itens crus da nota: é
  // neles que o operador relaciona o catálogo para poder escolher.
  const itensCru = pedido || semPedido
    ? []
    : await db.fiscalInboundItem.findMany({
        where: { inboundId },
        select: {
          id: true,
          ordem: true,
          descricao: true,
          codigoFornecedor: true,
          gtin: true,
          ncm: true,
          cest: true,
          cfop: true,
          unidade: true,
          quantidade: true,
          unidadeTributavel: true,
          quantidadeTributavel: true,
          fatorConversao: true,
          valorUnitario: true,
          valorTotal: true,
          // O custo real da linha (e o alerta de custo fora da curva) precisa
          // de tudo que soma ou desconta, não só do valor da mercadoria.
          valorDesconto: true,
          valorIcmsSt: true,
          valorFcpSt: true,
          valorIpi: true,
          valorFrete: true,
          bonificacao: true,
          productId: true,
          packagingId: true,
        },
        // Alfabética, igual à lista pós-vínculo — a ordem da nota (`ordem`)
        // não ajuda a achar o item na hora de relacionar ao catálogo.
        orderBy: { descricao: "asc" },
      });

  const produtos = await produtosDe([
    ...linhasCru.map((l) => l.productId),
    ...itensCru.map((i) => i.productId),
  ]);
  const donos = await donosDosCodigos(itensCru.map((i) => i.gtin));

  const itensNota: ItemNotaView[] = itensCru.map((i) => {
    const p = i.productId ? produtos.get(i.productId) : null;
    return {
      id: i.id,
      ordem: i.ordem,
      descricao: i.descricao,
      codigoFornecedor: i.codigoFornecedor,
      gtin: i.gtin,
      ncm: i.ncm,
      cest: i.cest,
      cfop: i.cfop,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      unidadeTributavel: i.unidadeTributavel,
      quantidadeTributavel:
        i.quantidadeTributavel == null ? null : Number(i.quantidadeTributavel),
      fatorConversao: Number(i.fatorConversao),
      valorUnitario: Number(i.valorUnitario),
      valorTotal: Number(i.valorTotal),
      valorDesconto: Number(i.valorDesconto),
      valorIcmsSt: Number(i.valorIcmsSt),
      valorFcpSt: Number(i.valorFcpSt),
      valorIpi: Number(i.valorIpi),
      valorFrete: Number(i.valorFrete),
      bonificacao: i.bonificacao,
      productId: i.productId,
      productNome: p?.nome ?? null,
      productSku: p?.sku ?? null,
      productUnidade: p?.unidadeBase ?? null,
      productConteudo: p?.conteudoPorUnidade ?? null,
      productImagemUrl: p?.imagemUrl ?? null,
      productCustoMedio: p?.custoMedio ?? null,
      productEan: p?.ean ?? null,
      productNcm: p?.ncm ?? null,
      productEmbalagens: (p?.embalagens ?? []).map((e) => ({
        id: e.id,
        nome: e.nome,
        ean: e.ean,
        fator: e.fator,
      })),
      // Quem já usa este código de barras no catálogo — a prova de que a linha
      // está prestes a apontar o mesmo GTIN para dois produtos.
      donoDoGtin: i.gtin ? (donos.get(i.gtin) ?? null) : null,
      packagingId: i.packagingId,
    };
  });

  const linhas: LinhaRecebimento[] = linhasCru.map((l) => {
    const p = l.productId ? produtos.get(l.productId) : null;
    const doXml = l.inboundItemId ? xmlPorItem.get(l.inboundItemId) : null;
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
      xml: doXml
        ? {
            quantidade: Number(doXml.quantidade),
            unidade: doXml.unidade,
            fatorConversao: Number(doXml.fatorConversao),
          }
        : null,
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
      uf: inbound.emitUf,
      supplierId: inbound.supplierId,
      siteId: inbound.siteId,
      siteNome: inbound.site.nome,
      observacao: inbound.observacao,
      semEstoqueMotivo: inbound.semEstoqueMotivo,
      purchaseId: inbound.purchaseId,
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
    semPedido,
    // Enquanto a porta não foi escolhida a tela vira "de qual pedido é isto?" —
    // as sugestões são o conteúdo principal, então valem a consulta.
    sugestoes: pedido || semPedido ? [] : await sugerirPedidos(inboundId),
    // Só antes da porta: depois dela o de-para pendente aparece na conferência,
    // e são N buscas ranqueadas que ninguém pediu.
    sugestoesDePara:
      pedido || semPedido || itensNota.every((i) => i.productId)
        ? []
        : await sugestoesDaNota(inboundId),
    itensNota,
    linhas,
    resumo,
    // Sem pedido a história mora na nota — é a única chave que sobra.
    timeline: pedido
      ? await listarEventos(tenantId, pedido.id)
      : semPedido
        ? await listarEventosDaNota(tenantId, inboundId)
        : [],
  };
}

type ProdutoView = {
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  /** Unidade de MEDIDA (UN, ML, G) — não é o que entra numa compra. */
  unidadeBase: string;
  /** Conteúdo de uma unidade fechada, na unidadeBase. */
  conteudoPorUnidade: number | null;
  /** Base do alerta de custo fora da curva na tabela de de-para. */
  custoMedio: number;
  /** NCM que vale hoje: o do perfil do produto ou o herdado da subcategoria. */
  ncm: string | null;
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
      unidadeBase: true,
      conteudoPorUnidade: true,
      custoMedio: true,
      fiscalProfile: { select: { ncm: true } },
      subcategory: { select: { defaultFiscalProfile: { select: { ncm: true } } } },
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
        unidadeBase: p.unidadeBase,
        conteudoPorUnidade:
          p.conteudoPorUnidade == null ? null : Number(p.conteudoPorUnidade),
        custoMedio: Number(p.custoMedio),
        // O perfil do produto manda; sem ele vale o padrão da subcategoria, que
        // é o que a emissão usa. Comparar com a nota só faz sentido contra o
        // NCM que valeria hoje.
        ncm: p.fiscalProfile?.ncm ?? p.subcategory?.defaultFiscalProfile?.ncm ?? null,
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

export type DonoDeCodigo = {
  productId: string;
  nome: string;
  sku: string;
  /** "o produto", 'a embalagem "Caixa"'… — a frase entra no aviso. */
  onde: string;
};

/**
 * Quem já usa cada código de barras da nota.
 *
 * Uma consulta por tabela para a nota inteira, não uma por linha: nota de 40
 * itens abriria 80 idas ao banco só para descobrir o que dois `IN` resolvem.
 * O primeiro dono encontrado vence, na mesma ordem de `donoDoCodigo` — produto
 * e depois embalagem — para que a tela e a busca digam a mesma coisa.
 */
async function donosDosCodigos(gtins: (string | null)[]): Promise<Map<string, DonoDeCodigo>> {
  const codigos = [...new Set(gtins.filter((g): g is string => Boolean(g)))];
  const mapa = new Map<string, DonoDeCodigo>();
  if (codigos.length === 0) return mapa;

  const [produtos, embalagens] = await Promise.all([
    db.product.findMany({
      where: { ean: { in: codigos }, ativo: true },
      select: { id: true, nome: true, sku: true, ean: true },
    }),
    db.productPackaging.findMany({
      where: { ean: { in: codigos } },
      select: {
        nome: true,
        ean: true,
        product: { select: { id: true, nome: true, sku: true, ativo: true } },
      },
    }),
  ]);

  for (const e of embalagens) {
    if (!e.ean || !e.product.ativo) continue;
    mapa.set(e.ean, {
      productId: e.product.id,
      nome: e.product.nome,
      sku: e.product.sku,
      onde: `a embalagem “${e.nome}”`,
    });
  }
  for (const p of produtos) {
    if (!p.ean) continue;
    mapa.set(p.ean, { productId: p.id, nome: p.nome, sku: p.sku, onde: "o produto" });
  }
  return mapa;
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
