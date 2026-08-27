import "server-only";
import { db } from "@/lib/prisma";
import { sugerirPedidos, type SugestaoPedido } from "@/lib/compras/conciliacao";
import { listarEventosDoRecebimento, type EventoPedido } from "@/lib/compras/eventos";
import { sugestoesDaNota, type SugestaoDePara } from "@/lib/compras/sugestao-de-para";
import type { ItemDePara } from "@/components/recebimento/tabela-de-para";
import type {
  FiscalInboundStatus,
  GoodsReceiptOrigem,
  GoodsReceiptStatus,
  PurchaseOrderStatus,
  ReconciliationResolucao,
  ReconciliationStatus,
} from "@/generated/prisma";

// ============================================================
// Leitura da tela de UM recebimento.
//
// A tela mostra três colunas por item — pedido, nota, recebido — e nada mais.
// Cada uma pode faltar: recebimento de pedido sem XML não tem coluna "nota", e
// o avulso não tem "pedido". O que nunca falta é a terceira, "recebido", que é
// o assunto da doca.
//
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
  /** Linha que ninguém esperava (item fora do pedido/nota, ou o avulso). */
  avulsa: boolean;
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

/** O recebimento em si: identidade, ciclo próprio e de onde ele nasceu. */
export type CabecalhoRecebimento = {
  id: string;
  numero: string;
  status: GoodsReceiptStatus;
  origem: GoodsReceiptOrigem;
  siteId: string;
  siteNome: string;
  supplierId: string | null;
  supplierNome: string | null;
  /** Número da nota no papel, quando o XML ainda não veio. */
  numeroNota: string | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  divergenciaMotivo: string | null;
  canceladoMotivo: string | null;
  observacao: string | null;
};

export type ResumoRecebimento = {
  itens: number;
  /** Total esperado: a nota, quando há; o que o pedido diz, quando não há. */
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
  /** Sempre existe. É a entidade da tela — o resto é contexto dele. */
  recebimento: CabecalhoRecebimento;
  /**
   * A NF-e, quando há. Nulo é caso normal, não erro: o recebimento de um
   * pedido sem XML e o avulso vivem sem documento até ele chegar (ou para
   * sempre).
   */
  nota: NotaRecebimento | null;
  pedido: PedidoRecebimento | null;
  /**
   * A nota chegou e ainda não se decidiu o que fazer com ela: vincular a um
   * pedido, gerar um pedido ou conferir sem pedido. Só acontece na origem XML —
   * quem começou pelo pedido já entra conferindo.
   */
  escolherPorta: boolean;
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
  /** Só preenchido enquanto a nota não entrou em conferência. */
  itensNota: ItemNotaView[];
  linhas: LinhaRecebimento[];
  resumo: ResumoRecebimento;
  timeline: EventoPedido[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Carrega a tela de UM recebimento.
 *
 * A chave é o RECEBIMENTO, não a nota: é ele que existe nas três origens
 * (pedido, XML, avulso) e o único que existe quando o XML ainda não chegou.
 * Antes a tela era endereçada pelo `inboundId`, o que fazia "receber sem nota"
 * não ter URL — e por isso a contagem sem XML acabava no localStorage.
 */
export async function carregarRecebimento(
  tenantId: string,
  receiptId: string,
): Promise<RecebimentoView | null> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: receiptId },
    select: {
      id: true,
      numero: true,
      status: true,
      origem: true,
      siteId: true,
      supplierId: true,
      fornecedorLivre: true,
      numeroNota: true,
      observacao: true,
      divergenciaMotivo: true,
      canceladoMotivo: true,
      iniciadoEm: true,
      finalizadoEm: true,
      purchaseOrderId: true,
      inboundId: true,
      site: { select: { nome: true } },
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
    },
  });
  if (!receipt) return null;

  const inboundId = receipt.inboundId;

  const inbound = inboundId
    ? await db.fiscalInbound.findFirst({
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
      })
    : null;

  const pedido = receipt.purchaseOrderId
    ? await db.purchaseOrder.findFirst({
        where: { id: receipt.purchaseOrderId },
        select: {
          id: true,
          numero: true,
          status: true,
          valorTotal: true,
          previsaoEntrega: true,
        },
      })
    : null;

  const linhasCru = await db.purchaseReconciliationItem.findMany({
    where: { receiptId: receipt.id },
    // Ordem alfabética e estável: a lista é para conferir na sequência da
    // paleteira, e o que está errado já subiu para o painel de divergências.
    orderBy: { descricao: "asc" },
  });

  // Só a nota tem porta a escolher. Quem veio do pedido (ou do avulso) já
  // nasce com as linhas montadas — perguntar "de qual pedido é isto?" a quem
  // clicou "Iniciar recebimento" NESTE pedido seria pedir o que já se sabe.
  const escolherPorta =
    receipt.origem === "XML" && !pedido && linhasCru.length === 0 && receipt.status !== "FINALIZADO";
  const semPedido = !pedido && linhasCru.length > 0;

  // A linha da conferência já vem convertida em unidades. Para dizer de ONDE
  // aquele número saiu — "0,6 MI × 1.000" — a tela precisa do item cru da nota.
  const itensDaNota =
    inboundId && linhasCru.length > 0
      ? await db.fiscalInboundItem.findMany({
          where: { inboundId },
          select: { id: true, unidade: true, quantidade: true, fatorConversao: true },
        })
      : [];
  const xmlPorItem = new Map(itensDaNota.map((i) => [i.id, i]));

  // Antes de escolher a porta, o assunto da tela são os itens crus da nota: é
  // neles que o operador relaciona o catálogo para poder escolher.
  const itensCru =
    inboundId && escolherPorta
      ? await db.fiscalInboundItem.findMany({
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
        })
      : [];

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
      /** Linha que ninguém esperava — só ela pode ser removida da conferência. */
      avulsa: !l.purchaseOrderItemId && !l.inboundItemId,
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
    // Sem nota, o "total esperado" é o que o pedido combinou — é contra ele
    // que a soma do que chegou faz sentido.
    valorNota: inbound
      ? Number(inbound.valorTotal)
      : linhas.reduce((s, l) => s + l.qtdFaturada * l.custoFaturado, 0),
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
    recebimento: {
      id: receipt.id,
      numero: receipt.numero,
      status: receipt.status,
      origem: receipt.origem,
      siteId: receipt.siteId,
      siteNome: receipt.site.nome,
      supplierId: receipt.supplierId,
      supplierNome:
        receipt.supplier?.nomeFantasia ||
        receipt.supplier?.razaoSocial ||
        receipt.fornecedorLivre ||
        inbound?.emitRazaoSocial ||
        null,
      numeroNota: receipt.numeroNota,
      iniciadoEm: receipt.iniciadoEm.toISOString(),
      finalizadoEm: iso(receipt.finalizadoEm),
      divergenciaMotivo: receipt.divergenciaMotivo,
      canceladoMotivo: receipt.canceladoMotivo,
      observacao: receipt.observacao,
    },
    nota: inbound
      ? {
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
        }
      : null,
    pedido: pedido
      ? {
          id: pedido.id,
          numero: pedido.numero,
          status: pedido.status,
          valorTotal: Number(pedido.valorTotal),
          previsaoEntrega: iso(pedido.previsaoEntrega),
        }
      : null,
    escolherPorta,
    semPedido,
    // Enquanto a porta não foi escolhida a tela vira "de qual pedido é isto?" —
    // as sugestões são o conteúdo principal, então valem a consulta.
    sugestoes: escolherPorta && inboundId ? await sugerirPedidos(inboundId) : [],
    // Só antes da porta: depois dela o de-para pendente aparece na conferência,
    // e são N buscas ranqueadas que ninguém pediu.
    sugestoesDePara:
      escolherPorta && inboundId && itensNota.some((i) => !i.productId)
        ? await sugestoesDaNota(inboundId)
        : [],
    itensNota,
    linhas,
    resumo,
    // A história é DESTE recebimento. A do pedido inteiro (que pode ter três
    // entregas) fica na tela do pedido.
    timeline: await listarEventosDoRecebimento(tenantId, receipt.id),
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
