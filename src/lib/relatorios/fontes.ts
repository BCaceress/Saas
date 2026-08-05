import "server-only";
import { db } from "@/lib/prisma";
import { listSites } from "@/lib/sites";
import { consumoPorProduto } from "@/lib/estoque-giro";
import {
  curvaABC,
  comprasPorFornecedor,
  comprasPorProduto,
  fechamentosCaixa,
  perdas,
  rankingProdutos,
  rentabilidadeDrinks,
  serieFinanceiraDiaria,
  type Range,
} from "@/app/(app)/relatorios/_data";
import type { FonteCtx, Linha, OpcaoFiltro, FonteOpcoes } from "./definicao";

/**
 * Carregadores — a única parte de um relatório que sabe ler o banco.
 *
 * Cada função devolve LINHAS CRUAS: um objeto por registro, com as chaves
 * casando com os `id` das colunas da definição. Nada de formatação, nada de
 * ordenação, nada de corte — quem faz isso é o motor (`executar.ts`), uma vez
 * só, para todos os relatórios.
 *
 * O que chega até aqui já vem resolvido: período (intervalo pronto), loja
 * (seletor do app) e a estratégia de estoque do tenant. O que o carregador
 * ainda decide é o que empurra para o banco — e é só isso.
 */

const n = (v: unknown): number => Number(v ?? 0);

function faixa(ctx: FonteCtx): Range {
  // Retrato ao vivo (posição de estoque) não tem período; quem chama estas
  // fontes sempre declara o filtro de período, então o fallback é defensivo.
  if (ctx.periodo) return { inicio: ctx.periodo.inicio, fim: ctx.periodo.fim };
  const fim = new Date();
  return { inicio: new Date(fim.getTime() - 30 * 864e5), fim };
}

// ── Estoque ─────────────────────────────────────────────────

/**
 * Posição de estoque completa — a linha mais rica do sistema.
 *
 * É o carregador de referência: traz identificação, classificação, saldo,
 * dinheiro, origem e datas, e deixa o operador escolher na tela o que quer
 * ver. Buscar tudo é barato aqui (uma leitura por produto/loja) e evita
 * multiplicar consultas conforme o operador marca colunas.
 */
export async function carregarInventario(ctx: FonteCtx): Promise<Linha[]> {
  const stocks = await db.stock.findMany({
    where: ctx.siteId ? { siteId: ctx.siteId } : {},
    select: {
      productId: true,
      estoqueFechado: true,
      estoqueAberto: true,
      estoqueMinimo: true,
      estoqueIdeal: true,
      site: { select: { nome: true } },
      location: { select: { nome: true } },
      product: {
        select: {
          nome: true,
          sku: true,
          ean: true,
          ativo: true,
          custoMedio: true,
          precoVenda: true,
          conteudoPorUnidade: true,
          brand: { select: { nome: true } },
          subcategory: { select: { nome: true, category: { select: { nome: true } } } },
          suppliers: {
            where: { isPrincipal: true },
            take: 1,
            select: { supplier: { select: { razaoSocial: true, nomeFantasia: true } } },
          },
        },
      },
    },
  });
  if (stocks.length === 0) return [];

  const ids = [...new Set(stocks.map((s) => s.productId))];
  const janela = ctx.policy.periodoMediaDias;

  const [consumo, ultimas] = await Promise.all([
    consumoPorProduto(janela, { productIds: ids, siteId: ctx.siteId }),
    ultimasMovimentacoes(ids, ctx.siteId),
  ]);

  return stocks.map((s) => {
    const p = s.product;
    const fechado = n(s.estoqueFechado);
    const aberto = n(s.estoqueAberto);
    const minimo = n(s.estoqueMinimo);
    const ideal = n(s.estoqueIdeal);
    const custoMedio = p.custoMedio == null ? null : n(p.custoMedio);
    const conteudo = n(p.conteudoPorUnidade) || 1;
    // Aberto está na unidade de consumo (ml, g); vira fração de unidade para
    // somar com o fechado sem inventar estoque.
    const equivalente = fechado + (conteudo > 0 ? aberto / conteudo : 0);
    const mediaDiaria = janela > 0 ? (consumo.get(s.productId) ?? 0) / janela : 0;
    const forn = p.suppliers[0]?.supplier;

    return {
      produto: p.nome,
      sku: p.sku,
      ean: p.ean,
      categoria: p.subcategory?.category?.nome ?? null,
      subcategoria: p.subcategory?.nome ?? null,
      marca: p.brand?.nome ?? null,
      fornecedor: forn ? (forn.nomeFantasia ?? forn.razaoSocial) : null,
      site: s.site?.nome ?? "—",
      localizacao: s.location?.nome ?? null,
      estoqueFechado: fechado,
      estoqueAberto: aberto,
      estoqueDisponivel: equivalente,
      estoqueMinimo: minimo,
      estoqueIdeal: ideal,
      custoMedio,
      precoVenda: p.precoVenda == null ? null : n(p.precoVenda),
      valorEstoque: custoMedio == null ? 0 : equivalente * custoMedio,
      mediaDiaria,
      diasCobertura: mediaDiaria > 0 ? equivalente / mediaDiaria : null,
      ultimaCompra: ultimas.entrada.get(s.productId) ?? null,
      ultimaVenda: ultimas.saida.get(s.productId) ?? null,
      abaixoMinimo: ctx.policy.usaMinimo && minimo > 0 && fechado < minimo,
      zerado: equivalente <= 0,
      ativo: p.ativo,
    } satisfies Linha;
  });
}

/** Última entrada e última saída por produto — para as colunas de data. */
async function ultimasMovimentacoes(
  productIds: string[],
  siteId: string | null,
): Promise<{ entrada: Map<string, Date>; saida: Map<string, Date> }> {
  const linhas = await db.stockMovement.groupBy({
    by: ["productId", "tipo"],
    where: {
      productId: { in: productIds },
      tipo: { in: ["ENTRADA", "SAIDA"] },
      ...(siteId ? { siteId } : {}),
    },
    _max: { createdAt: true },
  });

  const entrada = new Map<string, Date>();
  const saida = new Map<string, Date>();
  for (const l of linhas) {
    if (!l._max.createdAt) continue;
    (l.tipo === "ENTRADA" ? entrada : saida).set(l.productId, l._max.createdAt);
  }
  return { entrada, saida };
}

// ── Vendas ──────────────────────────────────────────────────

/** Produtos vendidos no período: quantidade, receita, CMV e margem. */
export async function carregarProdutosVendidos(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await rankingProdutos(faixa(ctx), ctx.siteId);
  return linhas.map((p) => ({
    produto: p.nome,
    sku: p.sku,
    categoria: p.categoria,
    quantidade: p.quantidade,
    receita: p.receita,
    custo: p.custo,
    margem: p.margem,
    margemPct: p.margemPct,
    precoMedio: p.quantidade > 0 ? p.receita / p.quantidade : 0,
  }));
}

/** Curva ABC — o mesmo ranking, classificado por participação acumulada. */
export async function carregarCurvaABC(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await curvaABC(faixa(ctx), ctx.siteId);
  return linhas.map((p) => ({
    classe: p.classe,
    produto: p.nome,
    sku: p.sku,
    categoria: p.categoria,
    quantidade: p.quantidade,
    receita: p.receita,
    margem: p.margem,
    margemPct: p.margemPct,
    acumuladoPct: p.acumuladoPct,
  }));
}

/** Rentabilidade de drinks/receitas produzidos e vendidos no período. */
export async function carregarProducao(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await rentabilidadeDrinks(faixa(ctx), ctx.siteId);
  return linhas.map((p) => ({
    produto: p.nome,
    sku: p.sku,
    quantidade: p.quantidade,
    receita: p.receita,
    custo: p.custo,
    margem: p.margem,
    margemPct: p.margemPct,
  }));
}

// ── Perdas ──────────────────────────────────────────────────

export async function carregarPerdas(ctx: FonteCtx): Promise<Linha[]> {
  const { itens } = await perdas(faixa(ctx), ctx.siteId);
  return itens.map((p) => ({
    produto: p.nome,
    sku: p.sku,
    quantidade: p.quantidade,
    custo: p.custo,
    custoUnitario: p.quantidade > 0 ? p.custo / p.quantidade : 0,
  }));
}

// ── Compras ─────────────────────────────────────────────────

export async function carregarComprasProduto(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await comprasPorProduto(faixa(ctx), ctx.siteId);
  return linhas.map((c) => ({
    produto: c.nome,
    sku: c.sku,
    quantidade: c.quantidade,
    custoMedioCompra: c.custoMedioCompra,
    total: c.total,
  }));
}

export async function carregarComprasFornecedor(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await comprasPorFornecedor(faixa(ctx), ctx.siteId);
  return linhas.map((c) => ({
    fornecedor: c.supplierNome,
    numNotas: c.numNotas,
    total: c.total,
    ticketNota: c.numNotas > 0 ? c.total / c.numNotas : 0,
  }));
}

// ── Caixa ───────────────────────────────────────────────────

export async function carregarCaixa(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await fechamentosCaixa(faixa(ctx), ctx.siteId);
  return linhas.map((f) => ({
    site: f.siteNome,
    abertaEm: f.abertaEm,
    fechadaEm: f.fechadaEm,
    valorAbertura: f.valorAbertura,
    vendasDinheiro: f.vendasDinheiro,
    esperado: f.esperado,
    contado: f.contado,
    quebra: f.quebra,
    conferido: f.contado != null,
  }));
}

// ── Movimentações ───────────────────────────────────────────

const ROTULO_MOVIMENTO: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  AJUSTE: "Ajuste",
  TRANSFERENCIA: "Transferência",
  ABERTURA: "Abertura",
  PRODUCAO: "Produção",
  PERDA: "Perda",
  DEVOLUCAO_CLIENTE: "Devolução do cliente",
  DEVOLUCAO_FORNECEDOR: "Devolução ao fornecedor",
};

/** Extrato de estoque (kardex): cada movimento com tipo, quantidade e custo. */
export async function carregarMovimentacoes(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const movs = await db.stockMovement.findMany({
    where: {
      createdAt: { gte: range.inicio, lt: range.fim },
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      productId: true,
      tipo: true,
      deltaFechado: true,
      deltaAberto: true,
      custoUnitario: true,
      observacao: true,
      createdAt: true,
      siteId: true,
    },
  });
  if (movs.length === 0) return [];

  const [produtos, sites] = await Promise.all([
    db.product.findMany({
      where: { id: { in: [...new Set(movs.map((m) => m.productId))] } },
      select: { id: true, nome: true, sku: true },
    }),
    listSites(),
  ]);
  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const porSite = new Map(sites.map((s) => [s.id, s.nome]));

  return movs.map((m) => {
    const p = porProduto.get(m.productId);
    const quantidade = n(m.deltaFechado) || n(m.deltaAberto);
    const custoUnitario = m.custoUnitario == null ? null : n(m.custoUnitario);
    return {
      data: m.createdAt,
      tipo: ROTULO_MOVIMENTO[m.tipo] ?? m.tipo,
      produto: p?.nome ?? "—",
      sku: p?.sku ?? "—",
      site: porSite.get(m.siteId) ?? "—",
      quantidade,
      custoUnitario,
      custoTotal: custoUnitario == null ? null : Math.abs(quantidade) * custoUnitario,
      observacao: m.observacao,
    } satisfies Linha;
  });
}

// ── Validade ────────────────────────────────────────────────

/**
 * Lotes com data de validade e saldo — quem vence primeiro na frente.
 *
 * Retrato ao vivo: validade não tem período, tem prazo. O `diasParaVencer`
 * negativo é lote vencido, e ele entra na lista de propósito — sumir com o
 * vencido é como fingir que a perda não aconteceu.
 */
export async function carregarValidade(ctx: FonteCtx): Promise<Linha[]> {
  const lotes = await db.stockLot.findMany({
    where: {
      validade: { not: null },
      quantidade: { gt: 0 },
      esgotadoEm: null,
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    orderBy: { validade: "asc" },
    take: 5000,
    select: {
      lote: true,
      validade: true,
      quantidade: true,
      custoUnitario: true,
      siteId: true,
      product: {
        select: {
          nome: true,
          sku: true,
          custoMedio: true,
          subcategory: { select: { nome: true, category: { select: { nome: true } } } },
        },
      },
    },
  });
  if (lotes.length === 0) return [];

  const sites = await listSites();
  const porSite = new Map(sites.map((s) => [s.id, s.nome]));
  const hoje = new Date();

  return lotes.map((l) => {
    const dias = Math.floor((l.validade!.getTime() - hoje.getTime()) / 864e5);
    const qtd = n(l.quantidade);
    const custo = l.custoUnitario == null ? n(l.product.custoMedio) : n(l.custoUnitario);
    return {
      produto: l.product.nome,
      sku: l.product.sku,
      categoria: l.product.subcategory?.category?.nome ?? null,
      site: porSite.get(l.siteId) ?? "—",
      lote: l.lote,
      validade: l.validade,
      diasParaVencer: dias,
      situacao: dias < 0 ? "Vencido" : dias === 0 ? "Vence hoje" : `Vence em ${dias} dias`,
      vencido: dias < 0,
      quantidade: qtd,
      custoUnitario: custo || null,
      valorEmRisco: qtd * custo,
    } satisfies Linha;
  });
}

// ── Compras ─────────────────────────────────────────────────

const ROTULO_PEDIDO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  AGUARDANDO: "Aguardando entrega",
  EM_TRANSITO: "Em trânsito",
  RECEBIDO_PARCIAL: "Recebido parcial",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
};

/** Pedidos de compra do período, com fornecedor, prazo e valor. */
export async function carregarPedidosCompra(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const pedidos = await db.purchaseOrder.findMany({
    where: {
      createdAt: { gte: range.inicio, lt: range.fim },
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 3000,
    select: {
      numero: true,
      status: true,
      valorTotal: true,
      createdAt: true,
      previsaoEntrega: true,
      recebidoEm: true,
      observacao: true,
      site: { select: { nome: true } },
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: { select: { qtdPedida: true, qtdRecebida: true } },
    },
  });

  const hoje = Date.now();

  return pedidos.map((p) => {
    const pedido = p.items.reduce((s, i) => s + n(i.qtdPedida), 0);
    const recebido = p.items.reduce((s, i) => s + n(i.qtdRecebida), 0);
    const aberto = p.recebidoEm == null && p.status !== "CANCELADO";
    return {
      numero: p.numero,
      status: ROTULO_PEDIDO[p.status] ?? p.status,
      fornecedor: p.supplier.nomeFantasia ?? p.supplier.razaoSocial,
      site: p.site.nome,
      criadoEm: p.createdAt,
      previsaoEntrega: p.previsaoEntrega,
      recebidoEm: p.recebidoEm,
      // Atraso só existe para pedido em aberto: pedido recebido não atrasa mais.
      diasAtraso:
        aberto && p.previsaoEntrega && p.previsaoEntrega.getTime() < hoje
          ? Math.floor((hoje - p.previsaoEntrega.getTime()) / 864e5)
          : null,
      itens: p.items.length,
      qtdPedida: pedido,
      qtdRecebida: recebido,
      valorTotal: n(p.valorTotal),
      emAberto: aberto,
      observacao: p.observacao,
    } satisfies Linha;
  });
}

/** Cada item comprado, compra a compra — é aqui que o preço mostra a variação. */
export async function carregarComprasHistorico(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const compras = await db.purchase.findMany({
    where: {
      data: { gte: range.inicio, lt: range.fim },
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    orderBy: { data: "desc" },
    take: 3000,
    select: {
      data: true,
      numeroNota: true,
      site: { select: { nome: true } },
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: {
        select: {
          quantidade: true,
          custoTotal: true,
          productId: true,
        },
      },
    },
  });
  if (compras.length === 0) return [];

  const ids = [...new Set(compras.flatMap((c) => c.items.map((i) => i.productId)))];
  const produtos = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true, sku: true },
  });
  const porProduto = new Map(produtos.map((p) => [p.id, p]));

  return compras.flatMap((c) =>
    c.items.map((i) => {
      const p = porProduto.get(i.productId);
      const qtd = n(i.quantidade);
      const total = n(i.custoTotal);
      return {
        data: c.data,
        nota: c.numeroNota,
        fornecedor: c.supplier
          ? (c.supplier.nomeFantasia ?? c.supplier.razaoSocial)
          : "Sem fornecedor",
        site: c.site.nome,
        produto: p?.nome ?? "—",
        sku: p?.sku ?? "—",
        quantidade: qtd,
        custoUnitario: qtd > 0 ? total / qtd : null,
        custoTotal: total,
      } satisfies Linha;
    }),
  );
}

/**
 * Economia possível por produto: o que foi pago contra o MELHOR preço praticado
 * no mesmo período.
 *
 * A referência é o próprio histórico (menor unitário efetivamente pago), não
 * uma tabela de fornecedor — preço de tabela costuma ser promessa, e comparar
 * com promessa infla a economia. `economiaPossivel` responde: se toda compra
 * tivesse saído pelo melhor preço já conseguido, quanto sobraria.
 */
export async function carregarEconomiaCompras(ctx: FonteCtx): Promise<Linha[]> {
  const linhas = await carregarComprasHistorico(ctx);

  type Agg = {
    produto: string;
    sku: string;
    quantidade: number;
    custoTotal: number;
    melhorUnitario: number;
    melhorFornecedor: string;
    compras: number;
  };
  const porProduto = new Map<string, Agg>();

  for (const l of linhas) {
    const chave = String(l.sku ?? l.produto);
    const unitario = typeof l.custoUnitario === "number" ? l.custoUnitario : null;
    const atual = porProduto.get(chave);
    const base: Agg = atual ?? {
      produto: String(l.produto ?? "—"),
      sku: String(l.sku ?? "—"),
      quantidade: 0,
      custoTotal: 0,
      melhorUnitario: Number.POSITIVE_INFINITY,
      melhorFornecedor: "—",
      compras: 0,
    };

    base.quantidade += Number(l.quantidade ?? 0);
    base.custoTotal += Number(l.custoTotal ?? 0);
    base.compras += 1;
    if (unitario !== null && unitario > 0 && unitario < base.melhorUnitario) {
      base.melhorUnitario = unitario;
      base.melhorFornecedor = String(l.fornecedor ?? "—");
    }
    porProduto.set(chave, base);
  }

  return [...porProduto.values()]
    .filter((a) => a.quantidade > 0 && Number.isFinite(a.melhorUnitario))
    .map((a) => {
      const medio = a.custoTotal / a.quantidade;
      const diferenca = medio - a.melhorUnitario;
      return {
        produto: a.produto,
        sku: a.sku,
        compras: a.compras,
        quantidade: a.quantidade,
        custoMedio: medio,
        melhorUnitario: a.melhorUnitario,
        melhorFornecedor: a.melhorFornecedor,
        diferencaUnitaria: diferenca,
        diferencaPct: medio > 0 ? (diferenca / medio) * 100 : 0,
        custoTotal: a.custoTotal,
        economiaPossivel: diferenca * a.quantidade,
      } satisfies Linha;
    });
}

/**
 * Preço por fornecedor para o mesmo item — a cesta comparada, em tabela.
 *
 * Sai das ofertas ativas dos catálogos importados (`SupplierOffer`): é o preço
 * que o fornecedor está anunciando hoje. Sem catálogo importado, a tabela vem
 * vazia — e vazia é a resposta honesta, não zero.
 */
export async function carregarOfertasFornecedor(): Promise<Linha[]> {
  const agora = new Date();
  const ofertas = await db.supplierOffer.findMany({
    where: {
      ativa: true,
      inicio: { lte: agora },
      OR: [{ fim: null }, { fim: { gte: agora } }],
    },
    take: 5000,
    select: {
      preco: true,
      precoPromocional: true,
      quantidadeMinima: true,
      inicio: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      catalogItem: {
        select: {
          descricao: true,
          codigoFornecedor: true,
          ean: true,
          product: { select: { nome: true, sku: true } },
        },
      },
    },
  });

  const linhas = ofertas.map((o) => {
    const preco = o.precoPromocional == null ? n(o.preco) : n(o.precoPromocional);
    return {
      produto: o.catalogItem.product?.nome ?? o.catalogItem.descricao,
      sku: o.catalogItem.product?.sku ?? null,
      ean: o.catalogItem.ean,
      codigoFornecedor: o.catalogItem.codigoFornecedor,
      fornecedor: o.supplier.nomeFantasia ?? o.supplier.razaoSocial,
      preco,
      precoTabela: n(o.preco),
      emPromocao: o.precoPromocional != null,
      quantidadeMinima: o.quantidadeMinima == null ? null : n(o.quantidadeMinima),
      atualizadoEm: o.inicio,
    } satisfies Linha;
  });

  // "Quem está mais barato" é a pergunta: marca o menor preço de cada produto.
  const melhor = new Map<string, number>();
  for (const l of linhas) {
    const chave = String(l.sku ?? l.ean ?? l.produto);
    const atual = melhor.get(chave);
    if (atual === undefined || Number(l.preco) < atual) melhor.set(chave, Number(l.preco));
  }
  return linhas.map((l) => ({
    ...l,
    melhorPreco: melhor.get(String(l.sku ?? l.ean ?? l.produto)) === l.preco,
  }));
}

// ── Clientes ────────────────────────────────────────────────

/**
 * Base de clientes com o resumo de compras de cada um.
 *
 * Uma fonte serve os quatro relatórios de cliente (ativos, inativos, novos,
 * aniversariantes): o que muda entre eles é o FILTRO, não o dado. As colunas de
 * comportamento (última compra, dias sem comprar, total gasto) saem de uma
 * agregação só sobre as vendas pagas — o resto é cadastro.
 */
export async function carregarClientes(ctx: FonteCtx): Promise<Linha[]> {
  const clientes = await db.customer.findMany({
    take: 5000,
    select: {
      id: true,
      nome: true,
      cpf: true,
      whatsapp: true,
      email: true,
      dataNascimento: true,
      pontos: true,
      ativo: true,
      createdAt: true,
    },
  });
  if (clientes.length === 0) return [];

  const vendas = await db.sale.groupBy({
    by: ["customerId"],
    where: {
      status: "PAGA",
      customerId: { in: clientes.map((c) => c.id) },
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    _count: { _all: true },
    _sum: { total: true },
    _max: { paidAt: true },
    _min: { paidAt: true },
  });
  const porCliente = new Map(vendas.map((v) => [v.customerId, v]));

  const hoje = new Date();
  const mesDia = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

  return clientes.map((c) => {
    const v = porCliente.get(c.id);
    const ultima = v?._max.paidAt ?? null;
    const compras = v?._count._all ?? 0;
    const gasto = v?._sum.total == null ? 0 : n(v._sum.total);
    const diasSemComprar =
      ultima == null ? null : Math.floor((hoje.getTime() - ultima.getTime()) / 864e5);

    return {
      cliente: c.nome,
      cpf: c.cpf,
      whatsapp: c.whatsapp,
      email: c.email,
      cadastradoEm: c.createdAt,
      aniversario: c.dataNascimento,
      // Dia do ano em número: é o que deixa "aniversariantes do mês" virar um
      // filtro de faixa em vez de uma consulta especial.
      aniversarioDia: c.dataNascimento ? mesDia(c.dataNascimento) : null,
      pontos: c.pontos,
      ativo: c.ativo,
      compras,
      totalGasto: gasto,
      ticketMedio: compras > 0 ? gasto / compras : null,
      primeiraCompra: v?._min.paidAt ?? null,
      ultimaCompra: ultima,
      diasSemComprar,
      nuncaComprou: compras === 0,
    } satisfies Linha;
  });
}

/** Cadastros criados dentro do período — o tamanho da base que entrou. */
export async function carregarClientesNovos(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const linhas = await carregarClientes(ctx);
  return linhas.filter((l) => {
    const d = l.cadastradoEm;
    return d instanceof Date && d >= range.inicio && d < range.fim;
  });
}

/**
 * Quem faz aniversário dentro do período.
 *
 * Compara dia e mês, ignorando o ano — e trata a virada (15/12 a 15/01) como
 * duas faixas, senão dezembro nunca casaria com janeiro. Período maior que um
 * ano traz todo mundo com data cadastrada, que é a resposta certa.
 */
export async function carregarClientesAniversariantes(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const linhas = await carregarClientes(ctx);
  const dias = (range.fim.getTime() - range.inicio.getTime()) / 864e5;
  if (dias >= 366) return linhas.filter((l) => l.aniversario instanceof Date);

  const chave = (d: Date) => (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const de = (range.inicio.getMonth() + 1) * 100 + range.inicio.getDate();
  const ate = (range.fim.getMonth() + 1) * 100 + range.fim.getDate();
  const dentro = (v: number) => (de <= ate ? v >= de && v <= ate : v >= de || v <= ate);

  return linhas.filter((l) => l.aniversario instanceof Date && dentro(chave(l.aniversario)));
}

// ── Indicadores ─────────────────────────────────────────────

/** Um dia por linha: receita, custo, margem, vendas e ticket. */
export async function carregarPainelDiario(ctx: FonteCtx): Promise<Linha[]> {
  const serie = await serieFinanceiraDiaria(faixa(ctx), ctx.siteId);
  return serie.map((d) => ({
    data: d.data,
    receita: d.receita,
    custo: d.cmv,
    margem: d.lucro,
    margemPct: d.receita > 0 ? (d.lucro / d.receita) * 100 : 0,
    numVendas: d.numVendas,
    ticketMedio: d.ticket,
  }));
}

const ROTULO_FISCAL: Record<string, string> = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Processando",
  AUTORIZADO: "Autorizada",
  REJEITADO: "Rejeitada",
  DENEGADO: "Denegada",
  CANCELADO: "Cancelada",
  CONTINGENCIA: "Contingência",
  INUTILIZADO: "Inutilizada",
};

/** Documentos fiscais emitidos e recebidos no período. */
export async function carregarFiscal(ctx: FonteCtx): Promise<Linha[]> {
  const range = faixa(ctx);
  const docs = await db.fiscalDocument.findMany({
    where: {
      dataEmissao: { gte: range.inicio, lt: range.fim },
      ...(ctx.siteId ? { siteId: ctx.siteId } : {}),
    },
    orderBy: { dataEmissao: "desc" },
    take: 5000,
    select: {
      modelo: true,
      direcao: true,
      status: true,
      serie: true,
      numero: true,
      chave: true,
      dataEmissao: true,
      dataAutorizacao: true,
      destNome: true,
      destDocumento: true,
      valorTotal: true,
      motivoRejeicao: true,
      site: { select: { nome: true } },
    },
  });

  return docs.map((d) => ({
    data: d.dataEmissao,
    modelo: d.modelo === "NFE" ? "NF-e" : d.modelo === "NFCE" ? "NFC-e" : d.modelo,
    direcao: d.direcao === "SAIDA" ? "Saída" : "Entrada",
    serie: d.serie,
    numero: d.numero,
    status: ROTULO_FISCAL[d.status] ?? d.status,
    site: d.site?.nome ?? "—",
    destinatario: d.destNome,
    documento: d.destDocumento,
    valorTotal: n(d.valorTotal),
    autorizadaEm: d.dataAutorizacao,
    chave: d.chave,
    motivoRejeicao: d.motivoRejeicao,
  }));
}

// ── Opções de filtro ────────────────────────────────────────

/**
 * Listas para os filtros de seleção. Vêm do banco na hora de montar a tela e
 * viajam prontas para o client — a configuração de relatório não consulta.
 */
export async function carregarOpcoes(fonte: FonteOpcoes): Promise<OpcaoFiltro[]> {
  switch (fonte) {
    case "categorias": {
      const linhas = await db.category.findMany({ select: { nome: true }, orderBy: { nome: "asc" } });
      return linhas.map((c) => ({ valor: c.nome, label: c.nome }));
    }
    case "marcas": {
      const linhas = await db.brand.findMany({
        select: { nome: true },
        orderBy: { nome: "asc" },
        take: 300,
      });
      return linhas.map((b) => ({ valor: b.nome, label: b.nome }));
    }
    case "fornecedores": {
      const linhas = await db.supplier.findMany({
        where: { ativo: true },
        select: { razaoSocial: true, nomeFantasia: true },
        orderBy: { razaoSocial: "asc" },
        take: 300,
      });
      return linhas.map((s) => {
        const nome = s.nomeFantasia ?? s.razaoSocial;
        return { valor: nome, label: nome };
      });
    }
    case "sites": {
      const linhas = await listSites();
      return linhas.map((s) => ({ valor: s.nome, label: s.nome }));
    }
    case "formasPagamento": {
      const linhas = await db.payment.groupBy({ by: ["metodo"], _count: { _all: true } });
      return linhas.map((p) => ({ valor: p.metodo, label: p.metodo }));
    }
    default:
      return [];
  }
}
