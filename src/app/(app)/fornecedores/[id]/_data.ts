import { db } from "@/lib/prisma";
import type { IndicadorIE } from "@/generated/prisma";

// ============================================================
// Leituras do Centro de Gestão do Fornecedor. Uma função por aba — a página
// carrega só o que a aba mostra. Tudo roda dentro de `runWithTenant`.
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;
const PEDIDOS_ATIVOS = ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "CONFERENCIA", "RECEBIDO_PARCIAL"] as const;

// ── Cabeçalho (layout, vale para todas as abas) ─────────────

export type FornecedorHeader = {
  id: string;
  nome: string;
  razaoSocial: string;
  cnpj: string | null;
  logoUrl: string | null;
  ativo: boolean;
  telefone: string | null;
  email: string | null;
  pedidoMinimo: number | null;
  createdAt: string;
  totalCatalogo: number;
  pendentes: number;
  totalPedidos: number;
};

export async function loadFornecedorHeader(id: string): Promise<FornecedorHeader | null> {
  const s = await db.supplier.findFirst({
    where: { id },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      cnpj: true,
      logoUrl: true,
      ativo: true,
      telefone: true,
      email: true,
      pedidoMinimo: true,
      createdAt: true,
    },
  });
  if (!s) return null;

  const [totalCatalogo, pendentes, totalPedidos] = await Promise.all([
    db.supplierCatalogItem.count({ where: { supplierId: id, ativo: true } }),
    db.supplierCatalogItem.count({ where: { supplierId: id, ativo: true, matchStatus: "PENDENTE" } }),
    db.purchaseOrder.count({ where: { supplierId: id, status: { not: "CANCELADO" } } }),
  ]);

  return {
    id: s.id,
    nome: s.nomeFantasia ?? s.razaoSocial,
    razaoSocial: s.razaoSocial,
    cnpj: s.cnpj,
    logoUrl: s.logoUrl,
    ativo: s.ativo,
    telefone: s.telefone,
    email: s.email,
    pedidoMinimo: s.pedidoMinimo == null ? null : Number(s.pedidoMinimo),
    createdAt: s.createdAt.toISOString(),
    totalCatalogo,
    pendentes,
    totalPedidos,
  };
}

// ── Aba Resumo ──────────────────────────────────────────────

/** Pessoa que recebe cotação neste fornecedor. */
export type ContatoFornecedor = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  observacao: string | null;
  principal: boolean;
  ativo: boolean;
  /** Quantas cotações já saíram para ele (WhatsApp ou e-mail). */
  envios: number;
  /**
   * Contato que nunca recebeu nada pode sumir; quem já recebeu só pode ser
   * inativado — apagar levaria junto o "para quem foi" do histórico.
   */
  podeExcluir: boolean;
};

export type FornecedorCadastro = {
  id: string;
  cnpj: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  logoUrl: string | null;
  email: string | null;
  telefone: string | null;
  nomeContatoPrincipal: string | null;
  website: string | null;
  pedidoMinimo: number | null;
  prazoPagamentoDias: number | null;
  observacoes: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipio: string | null;
  uf: string | null;
  ie: string | null;
  indicadorIE: IndicadorIE | null;
  ativo: boolean;
  /** Produtos do meu catálogo que apontam para este fornecedor. */
  produtosVinculados: number;
  /** Quem recebe cotação — o principal primeiro. */
  contatos: ContatoFornecedor[];
};

export async function loadFornecedorCadastro(id: string): Promise<FornecedorCadastro | null> {
  const s = await db.supplier.findFirst({ where: { id } });
  if (!s) return null;

  const [produtosVinculados, contatos] = await Promise.all([
    db.productSupplier.count({ where: { supplierId: id, product: { ativo: true } } }),
    // Inativos entram na lista: sumir com o vendedor que saiu da empresa
    // apagaria o rastro de quem falava com quem.
    db.supplierContact.findMany({
      where: { supplierId: id },
      orderBy: [{ ativo: "desc" }, { principal: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        nome: true,
        cargo: true,
        telefone: true,
        email: true,
        observacao: true,
        principal: true,
        ativo: true,
        _count: { select: { envios: true } },
      },
    }),
  ]);

  return {
    id: s.id,
    cnpj: s.cnpj,
    razaoSocial: s.razaoSocial,
    nomeFantasia: s.nomeFantasia,
    logoUrl: s.logoUrl,
    email: s.email,
    telefone: s.telefone,
    nomeContatoPrincipal: s.nomeContatoPrincipal,
    website: s.website,
    pedidoMinimo: s.pedidoMinimo == null ? null : Number(s.pedidoMinimo),
    prazoPagamentoDias: s.prazoPagamentoDias,
    observacoes: s.observacoes,
    cep: s.cep,
    logradouro: s.logradouro,
    numero: s.numero,
    complemento: s.complemento,
    bairro: s.bairro,
    municipio: s.municipio,
    codigoMunicipio: s.codigoMunicipio,
    uf: s.uf,
    ie: s.ie,
    indicadorIE: s.indicadorIE,
    ativo: s.ativo,
    produtosVinculados,
    contatos: contatos.map((c) => ({
      id: c.id,
      nome: c.nome,
      cargo: c.cargo,
      telefone: c.telefone,
      email: c.email,
      observacao: c.observacao,
      principal: c.principal,
      ativo: c.ativo,
      envios: c._count.envios,
      podeExcluir: c._count.envios === 0,
    })),
  };
}

// ── Aba Histórico de preços ─────────────────────────────────

export type ItemComHistorico = {
  id: string;
  descricao: string;
  ean: string | null;
  precoAtual: number;
  pontos: number;
};

/** Itens deste fornecedor que já têm série de preço — só eles rendem gráfico. */
export async function loadItensComHistorico(id: string): Promise<ItemComHistorico[]> {
  const [itens, pontos] = await Promise.all([
    db.supplierCatalogItem.findMany({
      where: { supplierId: id, ativo: true },
      orderBy: { descricao: "asc" },
      take: 500,
      select: { id: true, descricao: true, ean: true, preco: true, precoPromocional: true },
    }),
    db.supplierPriceHistory.groupBy({
      by: ["catalogItemId"],
      where: { supplierId: id },
      _count: { _all: true },
    }),
  ]);

  const contagem = new Map(pontos.map((p) => [p.catalogItemId, p._count._all]));

  return itens
    .map((i) => ({
      id: i.id,
      descricao: i.descricao,
      ean: i.ean,
      precoAtual: i.precoPromocional == null ? Number(i.preco) : Number(i.precoPromocional),
      pontos: contagem.get(i.id) ?? 0,
    }))
    .sort((a, b) => b.pontos - a.pontos || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

export type MovimentoPreco = {
  itemId: string;
  descricao: string;
  precoAtual: number;
  precoAnterior: number;
  variacao: number;
  data: string;
};

/** As mudanças de preço mais fortes do período — a leitura rápida da aba. */
export async function loadMovimentosPreco(id: string, dias: number): Promise<MovimentoPreco[]> {
  const desde = new Date(Date.now() - dias * DIA_MS);
  const pontos = await db.supplierPriceHistory.findMany({
    where: { supplierId: id, data: { gte: desde } },
    orderBy: { data: "desc" },
    take: 1200,
    select: {
      catalogItemId: true,
      preco: true,
      precoPromocional: true,
      data: true,
      catalogItem: { select: { descricao: true } },
    },
  });

  const efetivo = (p: (typeof pontos)[number]) =>
    p.precoPromocional == null ? Number(p.preco) : Number(p.precoPromocional);

  const vistos = new Map<string, { atual: (typeof pontos)[number]; anterior?: (typeof pontos)[number] }>();
  for (const p of pontos) {
    const registro = vistos.get(p.catalogItemId);
    if (!registro) vistos.set(p.catalogItemId, { atual: p });
    else if (!registro.anterior) registro.anterior = p;
  }

  return [...vistos.values()]
    .filter((v) => v.anterior)
    .map(({ atual, anterior }) => {
      const agora = efetivo(atual);
      const antes = efetivo(anterior!);
      return {
        itemId: atual.catalogItemId,
        descricao: atual.catalogItem?.descricao ?? "Item",
        precoAtual: agora,
        precoAnterior: antes,
        variacao: antes > 0 ? Math.round(((agora - antes) / antes) * 1000) / 10 : 0,
        data: atual.data.toISOString(),
      };
    })
    .sort((a, b) => Math.abs(b.variacao) - Math.abs(a.variacao))
    .slice(0, 40);
}

// ── Aba Pedidos ─────────────────────────────────────────────

export type PedidoFornecedor = {
  id: string;
  numero: string;
  status: string;
  createdAt: string;
  previsaoEntrega: string | null;
  recebidoEm: string | null;
  valorTotal: number;
  itens: number;
  siteNome: string;
};

export async function loadPedidosFornecedor(id: string): Promise<PedidoFornecedor[]> {
  const pedidos = await db.purchaseOrder.findMany({
    where: { supplierId: id },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: {
      id: true,
      numero: true,
      status: true,
      createdAt: true,
      previsaoEntrega: true,
      recebidoEm: true,
      valorTotal: true,
      site: { select: { nome: true } },
      _count: { select: { items: true } },
    },
  });

  return pedidos.map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
    recebidoEm: p.recebidoEm?.toISOString() ?? null,
    valorTotal: Number(p.valorTotal),
    itens: p._count.items,
    siteNome: p.site.nome,
  }));
}

// ── Aba Financeiro ──────────────────────────────────────────

export type FinanceiroFornecedor = {
  compradoMes: number;
  compradoAno: number;
  pedidosMes: number;
  pedidosAno: number;
  pedidosTotal: number;
  ticketMedio: number;
  prazoPagamentoDias: number | null;
  /** Média enviado → recebido, em dias. null = nenhum pedido fechou o ciclo. */
  prazoEntregaDias: number | null;
  /** Pontualidade: entregas dentro da previsão ÷ entregas com previsão. */
  entregasNoPrazo: number;
  entregasComPrevisao: number;
  /** Quanto este fornecedor economiza (ou custa) contra o melhor preço de mercado. */
  economia: number;
  itensComparados: number;
  itensMaisBaratos: number;
  emAberto: number;
  valorEmAberto: number;
  serieMensal: Array<{ mes: string; valor: number }>;
};

export async function loadFinanceiroFornecedor(id: string): Promise<FinanceiroFornecedor> {
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioAno = new Date(agora.getFullYear(), 0, 1);
  const dozeMesesAtras = new Date(agora.getFullYear(), agora.getMonth() - 11, 1);

  const [supplier, pedidos, ofertas] = await Promise.all([
    db.supplier.findFirst({ where: { id }, select: { prazoPagamentoDias: true } }),
    db.purchaseOrder.findMany({
      where: { supplierId: id, status: { not: "CANCELADO" } },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        valorTotal: true,
        createdAt: true,
        enviadoEm: true,
        recebidoEm: true,
        previsaoEntrega: true,
      },
    }),
    db.supplierCatalogItem.findMany({
      where: { supplierId: id, ativo: true, matchStatus: "VINCULADO" },
      select: { productId: true, preco: true, precoPromocional: true, validadeOferta: true },
    }),
  ]);

  const efetivo = (o: { preco: unknown; precoPromocional: unknown; validadeOferta: Date | null }) => {
    const tabela = Number(o.preco);
    const promo = o.precoPromocional == null ? null : Number(o.precoPromocional);
    const vencida = o.validadeOferta != null && o.validadeOferta.getTime() < Date.now();
    return promo != null && !vencida && promo < tabela ? promo : tabela;
  };

  let compradoMes = 0;
  let compradoAno = 0;
  let pedidosMes = 0;
  let pedidosAno = 0;
  let total = 0;
  let emAberto = 0;
  let valorEmAberto = 0;
  let somaLead = 0;
  let contaLead = 0;
  let entregasNoPrazo = 0;
  let entregasComPrevisao = 0;
  const porMes = new Map<string, number>();

  for (const p of pedidos) {
    const valor = Number(p.valorTotal);
    total += valor;
    if (p.createdAt >= inicioMes) {
      compradoMes += valor;
      pedidosMes++;
    }
    if (p.createdAt >= inicioAno) {
      compradoAno += valor;
      pedidosAno++;
    }
    if (p.createdAt >= dozeMesesAtras) {
      const chave = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`;
      porMes.set(chave, (porMes.get(chave) ?? 0) + valor);
    }
    if ((PEDIDOS_ATIVOS as readonly string[]).includes(p.status)) {
      emAberto++;
      valorEmAberto += valor;
    }
    if (p.enviadoEm && p.recebidoEm) {
      somaLead += (p.recebidoEm.getTime() - p.enviadoEm.getTime()) / DIA_MS;
      contaLead++;
    }
    if (p.recebidoEm && p.previsaoEntrega) {
      entregasComPrevisao++;
      if (p.recebidoEm <= p.previsaoEntrega) entregasNoPrazo++;
    }
  }

  // Economia: para cada produto que este fornecedor oferta, compara com o
  // melhor preço do mercado. Negativo = ele está mais caro.
  const productIds = [...new Set(ofertas.map((o) => o.productId).filter((p): p is string => !!p))];
  const concorrentes =
    productIds.length > 0
      ? await db.supplierCatalogItem.findMany({
          where: {
            ativo: true,
            matchStatus: "VINCULADO",
            productId: { in: productIds },
            supplierId: { not: id },
          },
          select: { productId: true, preco: true, precoPromocional: true, validadeOferta: true },
        })
      : [];

  const melhorConcorrente = new Map<string, number>();
  for (const c of concorrentes) {
    if (!c.productId) continue;
    const v = efetivo(c);
    const atual = melhorConcorrente.get(c.productId);
    if (atual == null || v < atual) melhorConcorrente.set(c.productId, v);
  }

  let economia = 0;
  let itensComparados = 0;
  let itensMaisBaratos = 0;
  for (const o of ofertas) {
    if (!o.productId) continue;
    const rival = melhorConcorrente.get(o.productId);
    if (rival == null) continue;
    itensComparados++;
    const meu = efetivo(o);
    economia += rival - meu;
    if (meu <= rival) itensMaisBaratos++;
  }

  const meses: Array<{ mes: string; valor: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    meses.push({
      mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      valor: Math.round((porMes.get(chave) ?? 0) * 100) / 100,
    });
  }

  return {
    compradoMes: Math.round(compradoMes * 100) / 100,
    compradoAno: Math.round(compradoAno * 100) / 100,
    pedidosMes,
    pedidosAno,
    pedidosTotal: pedidos.length,
    ticketMedio: pedidos.length > 0 ? Math.round((total / pedidos.length) * 100) / 100 : 0,
    prazoPagamentoDias: supplier?.prazoPagamentoDias ?? null,
    prazoEntregaDias: contaLead > 0 ? Math.round((somaLead / contaLead) * 10) / 10 : null,
    entregasNoPrazo,
    entregasComPrevisao,
    economia: Math.round(economia * 100) / 100,
    itensComparados,
    itensMaisBaratos,
    emAberto,
    valorEmAberto: Math.round(valorEmAberto * 100) / 100,
    serieMensal: meses,
  };
}
