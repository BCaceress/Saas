import { db } from "@/lib/prisma";
import { Decimal } from "@/generated/prisma/runtime/library";

const n = (v: Decimal | null | undefined) => (v == null ? 0 : Number(v));

// ── Sugestões de reposição ────────────────────────────────────
// Inverte a lógica do pedido manual: o sistema olha estoque × mínimo ×
// ideal × ritmo de venda e responde "o que precisa ser comprado", já
// agrupado por fornecedor e com quantidade/custo sugeridos.

export type SugestaoStatus = "ruptura" | "critico" | "abaixo" | "monitorar";

export type SugestaoRow = {
  productId: string;
  sku: string;
  nome: string;
  imagemUrl: string | null;
  categoria: string | null;
  marca: string | null;
  // Situação do estoque (unidades base)
  estoque: number;
  estoqueMinimo: number;
  estoqueIdeal: number;
  consumo7: number;
  consumo30: number;
  mediaDia: number; // vendas/dia (janela 30d, fallback 7d)
  coberturaDias: number | null; // estoque ÷ média — null sem vendas
  pendente: number; // já pedido e não recebido (un base)
  pedidosPendentes: { numero: string; previsaoEntrega: string | null }[]; // pedidos que geram o `pendente`
  status: SugestaoStatus;
  // Meta de reposição — sempre presente quando há sugestão, mesmo sem ideal configurado.
  alvoReposicao: number; // un base — ideal configurado, ou o suficiente p/ ALVO_DIAS, ou 2× mínimo
  necessidadeBase: number; // un base ainda faltando p/ alvo (alvo − estoque − pendente, antes de arredondar p/ embalagem)
  // Sugestão de compra
  packagingId: string | null;
  packagingNome: string | null;
  fatorConversao: number; // un base por unidade de compra
  qtdSugerida: number; // em unidades de compra (0 = já coberto por pedido a caminho)
  custoUnitCompra: number | null; // por unidade de compra
  // Referências de preço
  ultimoCustoUn: number | null; // por unidade de compra, na última entrada
  ultimaCompraEm: string | null; // ISO
  // Outros fornecedores vinculados ao produto — p/ permitir trocar sem poluir a tela.
  fornecedores: {
    supplierId: string;
    nome: string;
    telefone: string | null;
    email: string | null;
    custoUnitCompra: number | null; // já convertido p/ unidade de compra
    leadTimeDias: number | null;
  }[];
};

export type GrupoReposicao = {
  supplierId: string | null; // null = produtos sem fornecedor vinculado
  supplierNome: string;
  supplierTelefone: string | null; // p/ solicitar por WhatsApp
  supplierEmail: string | null; // p/ solicitar por e-mail
  leadTimeDias: number | null; // média enviado→recebido dos últimos pedidos
  itens: SugestaoRow[];
};

/** Dias de cobertura que a sugestão mira quando não há estoque ideal configurado. */
const ALVO_DIAS = 14;

export async function loadSugestoesReposicao(siteId: string | null): Promise<GrupoReposicao[]> {
  const whereSite = siteId ? { siteId } : {};
  const stocks = await db.stock.findMany({
    where: whereSite,
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          nome: true,
          tipo: true,
          ativo: true,
          imagemUrl: true,
          custo: true,
          custoMedio: true,
          brand: { select: { nome: true } },
          subcategory: { select: { nome: true } },
          packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
          suppliers: {
            orderBy: { isPrincipal: "desc" },
            select: {
              custoFornecedor: true,
              supplier: { select: { id: true, razaoSocial: true, nomeFantasia: true, telefone: true, email: true } },
            },
          },
        },
      },
    },
  });

  const estocaveis = stocks.filter(
    (s) => s.product.ativo && (s.product.tipo === "SIMPLES" || s.product.tipo === "INSUMO"),
  );
  const productIds = estocaveis.map((s) => s.productId);
  if (productIds.length === 0) return [];

  const d30 = new Date(Date.now() - 30 * 864e5);
  const d7 = new Date(Date.now() - 7 * 864e5);

  const [vendas, pendentes, entradas, pedidosLead] = await Promise.all([
    // Ritmo de venda: saídas dos últimos 30 dias.
    db.stockMovement.findMany({
      where: { productId: { in: productIds }, tipo: "SAIDA", createdAt: { gte: d30 }, ...whereSite },
      select: { productId: true, deltaFechado: true, deltaAberto: true, createdAt: true },
    }),
    // Já pedido e ainda não recebido — não sugerir de novo.
    db.purchaseOrderItem.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: { status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] }, ...whereSite },
      },
      select: {
        productId: true,
        packagingId: true,
        qtdPedida: true,
        qtdRecebida: true,
        purchaseOrder: { select: { numero: true, previsaoEntrega: true } },
      },
    }),
    // Última entrada por produto (preço de referência).
    db.stockMovement.findMany({
      where: { productId: { in: productIds }, tipo: "ENTRADA", ...whereSite },
      select: { productId: true, custoUnitario: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    // Lead time por fornecedor: média enviado→recebido dos últimos pedidos.
    db.purchaseOrder.findMany({
      where: { status: "RECEBIDO", enviadoEm: { not: null }, recebidoEm: { not: null } },
      select: { supplierId: true, enviadoEm: true, recebidoEm: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // Consumo por janela
  const consumoMap = new Map<string, { d7: number; d30: number }>();
  for (const v of vendas) {
    const q = Math.abs(n(v.deltaFechado)) || Math.abs(n(v.deltaAberto));
    if (q <= 0) continue;
    const c = consumoMap.get(v.productId) ?? { d7: 0, d30: 0 };
    c.d30 += q;
    if (v.createdAt >= d7) c.d7 += q;
    consumoMap.set(v.productId, c);
  }

  // Pendente em unidades BASE (converte a embalagem do item pedido)
  const pendPkgIds = [...new Set(pendentes.flatMap((p) => (p.packagingId ? [p.packagingId] : [])))];
  const pendPkgs = pendPkgIds.length
    ? await db.productPackaging.findMany({ where: { id: { in: pendPkgIds } }, select: { id: true, fatorConversao: true } })
    : [];
  const pendFator = new Map(pendPkgs.map((p) => [p.id, n(p.fatorConversao)]));
  const pendenteMap = new Map<string, number>();
  const pedidosPendentesMap = new Map<string, { numero: string; previsaoEntrega: string | null }[]>();
  for (const p of pendentes) {
    const rest = Math.max(0, n(p.qtdPedida) - n(p.qtdRecebida));
    if (rest <= 0) continue;
    const fator = p.packagingId ? (pendFator.get(p.packagingId) ?? 1) : 1;
    pendenteMap.set(p.productId, (pendenteMap.get(p.productId) ?? 0) + rest * fator);
    const lista = pedidosPendentesMap.get(p.productId) ?? [];
    if (!lista.some((x) => x.numero === p.purchaseOrder.numero)) {
      lista.push({ numero: p.purchaseOrder.numero, previsaoEntrega: p.purchaseOrder.previsaoEntrega?.toISOString() ?? null });
    }
    pedidosPendentesMap.set(p.productId, lista);
  }

  // Última entrada por produto (movimentos já vêm desc)
  const ultimaEntrada = new Map<string, { custo: number | null; em: Date }>();
  for (const e of entradas) {
    if (!ultimaEntrada.has(e.productId)) {
      ultimaEntrada.set(e.productId, { custo: e.custoUnitario ? n(e.custoUnitario) : null, em: e.createdAt });
    }
  }

  // Lead time médio por fornecedor
  const leadAgg = new Map<string, { total: number; count: number }>();
  for (const po of pedidosLead) {
    if (!po.enviadoEm || !po.recebidoEm) continue;
    const dias = (po.recebidoEm.getTime() - po.enviadoEm.getTime()) / 864e5;
    if (dias < 0 || dias > 60) continue;
    const a = leadAgg.get(po.supplierId) ?? { total: 0, count: 0 };
    a.total += dias;
    a.count += 1;
    leadAgg.set(po.supplierId, a);
  }
  const leadTime = new Map<string, number>();
  for (const [sid, a] of leadAgg) leadTime.set(sid, Math.max(1, Math.round(a.total / a.count)));

  // Monta as sugestões
  const rows: (SugestaoRow & {
    supplierId: string | null;
    supplierNome: string;
    supplierTelefone: string | null;
    supplierEmail: string | null;
  })[] = [];

  for (const s of estocaveis) {
    const estoque = n(s.estoqueFechado);
    const minimo = n(s.estoqueMinimo);
    const ideal = n(s.estoqueIdeal);
    const consumo = consumoMap.get(s.productId) ?? { d7: 0, d30: 0 };
    const mediaDia = consumo.d30 > 0 ? consumo.d30 / 30 : consumo.d7 > 0 ? consumo.d7 / 7 : 0;
    const cobertura = mediaDia > 0 ? estoque / mediaDia : null;
    const pendente = pendenteMap.get(s.productId) ?? 0;

    // Classificação — só entra na lista quem precisa de ação.
    const temParametro = minimo > 0 || ideal > 0 || mediaDia > 0;
    if (!temParametro) continue;

    let status: SugestaoStatus | null = null;
    if (estoque <= 0) status = "ruptura";
    else if ((minimo > 0 && estoque < minimo * 0.5) || (cobertura != null && cobertura <= 3)) status = "critico";
    else if ((minimo > 0 && estoque < minimo) || (cobertura != null && cobertura <= 7)) status = "abaixo";
    // Ainda acima do mínimo, mas abaixo do ideal ou com giro que projeta
    // queda pra baixo do alvo dentro da janela de reposição — no radar,
    // sem urgência de compra imediata.
    else if ((ideal > 0 && estoque < ideal) || (cobertura != null && cobertura <= ALVO_DIAS)) status = "monitorar";
    if (!status) continue;

    // Alvo: ideal configurado, senão o suficiente p/ ALVO_DIAS de venda, senão 2× mínimo.
    const alvo = Math.max(ideal, Math.ceil(mediaDia * ALVO_DIAS), minimo > 0 ? minimo * 2 : 0, minimo);
    const necessidadeBase = Math.max(0, alvo - estoque - pendente);

    const pkg = s.product.packagings.find((p) => p.isCompraDefault) ?? s.product.packagings[0] ?? null;
    const fator = pkg ? n(pkg.fatorConversao) || 1 : 1;
    const qtdSugerida = necessidadeBase > 0 ? Math.max(1, Math.ceil(necessidadeBase / fator)) : 0;

    const ult = ultimaEntrada.get(s.productId);
    const vinc = s.product.suppliers[0] ?? null;
    const custoGenerico =
      ult?.custo ??
      (s.product.custoMedio ? n(s.product.custoMedio) : null) ??
      (s.product.custo ? n(s.product.custo) : null);
    const custoBase = custoGenerico ?? (vinc?.custoFornecedor ? n(vinc.custoFornecedor) : null);

    const fornecedores = s.product.suppliers.map((f) => {
      const custo = f.custoFornecedor != null ? n(f.custoFornecedor) : custoGenerico;
      return {
        supplierId: f.supplier.id,
        nome: f.supplier.nomeFantasia ?? f.supplier.razaoSocial,
        telefone: f.supplier.telefone,
        email: f.supplier.email,
        custoUnitCompra: custo != null ? Number((custo * fator).toFixed(2)) : null,
        leadTimeDias: leadTime.get(f.supplier.id) ?? null,
      };
    });

    rows.push({
      productId: s.productId,
      sku: s.product.sku,
      nome: s.product.nome,
      imagemUrl: s.product.imagemUrl,
      categoria: s.product.subcategory?.nome ?? null,
      marca: s.product.brand?.nome ?? null,
      estoque,
      estoqueMinimo: minimo,
      estoqueIdeal: ideal,
      consumo7: consumo.d7,
      consumo30: consumo.d30,
      mediaDia,
      coberturaDias: cobertura != null ? Math.floor(cobertura) : null,
      pendente,
      pedidosPendentes: pedidosPendentesMap.get(s.productId) ?? [],
      status,
      alvoReposicao: alvo,
      necessidadeBase,
      packagingId: pkg?.id ?? null,
      packagingNome: pkg?.nome ?? null,
      fatorConversao: fator,
      qtdSugerida,
      custoUnitCompra: custoBase != null ? Number((custoBase * fator).toFixed(2)) : null,
      ultimoCustoUn: ult?.custo != null ? Number((ult.custo * fator).toFixed(2)) : null,
      ultimaCompraEm: ult?.em.toISOString() ?? null,
      fornecedores,
      supplierId: vinc?.supplier.id ?? null,
      supplierNome: vinc ? (vinc.supplier.nomeFantasia ?? vinc.supplier.razaoSocial) : "Sem fornecedor",
      supplierTelefone: vinc?.supplier.telefone ?? null,
      supplierEmail: vinc?.supplier.email ?? null,
    });
  }

  // Agrupa por fornecedor — mais urgente primeiro dentro do grupo,
  // grupos ordenados por gravidade (nº de rupturas) e valor.
  const peso: Record<SugestaoStatus, number> = { ruptura: 0, critico: 1, abaixo: 2, monitorar: 3 };
  const grupos = new Map<string, GrupoReposicao>();
  for (const r of rows) {
    const key = r.supplierId ?? "__sem__";
    const g = grupos.get(key) ?? {
      supplierId: r.supplierId,
      supplierNome: r.supplierNome,
      supplierTelefone: r.supplierTelefone,
      supplierEmail: r.supplierEmail,
      leadTimeDias: r.supplierId ? (leadTime.get(r.supplierId) ?? null) : null,
      itens: [],
    };
    g.itens.push(r);
    grupos.set(key, g);
  }

  const lista = [...grupos.values()];
  for (const g of lista) g.itens.sort((a, b) => peso[a.status] - peso[b.status] || a.nome.localeCompare(b.nome));
  lista.sort((a, b) => {
    // "Sem fornecedor" sempre por último
    if (a.supplierId === null !== (b.supplierId === null)) return a.supplierId === null ? 1 : -1;
    const rupt = (g: GrupoReposicao) => g.itens.filter((i) => i.status === "ruptura").length;
    return rupt(b) - rupt(a) || b.itens.length - a.itens.length;
  });
  return lista;
}

// ── Histórico de compras de um produto (drawer) ───────────────

export type HistoricoCompraProduto = {
  compras: {
    data: string; // ISO
    supplierNome: string | null;
    numeroPedido: string | null;
    quantidade: number;
    packagingNome: string | null;
    custoUn: number; // por unidade comprada
  }[];
  precoMedio: number | null;
  menorPreco: number | null;
  maiorPreco: number | null;
  qtdHabitual: number | null;
  fornecedores: {
    supplierId: string;
    nome: string;
    isPrincipal: boolean;
    custoFornecedor: number | null;
    leadTimeDias: number | null;
    ultimaCompraEm: string | null;
  }[];
};

export async function loadHistoricoCompraProduto(productId: string): Promise<HistoricoCompraProduto> {
  const [items, vinculos] = await Promise.all([
    db.purchaseItem.findMany({
      where: { productId },
      orderBy: { id: "desc" },
      take: 60,
      select: { quantidade: true, custoTotal: true, packagingId: true, purchaseId: true },
    }),
    db.productSupplier.findMany({
      where: { productId },
      orderBy: { isPrincipal: "desc" },
      select: {
        supplierId: true,
        isPrincipal: true,
        custoFornecedor: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
  ]);

  const purchaseIds = [...new Set(items.map((i) => i.purchaseId))];
  const pkgIds = [...new Set(items.flatMap((i) => (i.packagingId ? [i.packagingId] : [])))];
  const supplierIds = vinculos.map((v) => v.supplierId);

  const [purchases, pkgs, pedidosFornecedor] = await Promise.all([
    purchaseIds.length
      ? db.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: {
            id: true,
            data: true,
            supplierId: true,
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
            purchaseOrder: { select: { numero: true } },
          },
        })
      : Promise.resolve([]),
    pkgIds.length
      ? db.productPackaging.findMany({ where: { id: { in: pkgIds } }, select: { id: true, nome: true } })
      : Promise.resolve([]),
    supplierIds.length
      ? db.purchaseOrder.findMany({
          where: { supplierId: { in: supplierIds }, status: "RECEBIDO", enviadoEm: { not: null }, recebidoEm: { not: null } },
          select: { supplierId: true, enviadoEm: true, recebidoEm: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  const purchaseMap = new Map(purchases.map((p) => [p.id, p]));
  const pkgMap = new Map(pkgs.map((p) => [p.id, p.nome]));

  const compras = items
    .map((i) => {
      const pu = purchaseMap.get(i.purchaseId);
      const qtd = n(i.quantidade);
      return {
        data: pu?.data.toISOString() ?? "",
        supplierId: pu?.supplierId ?? null,
        supplierNome: pu?.supplier ? (pu.supplier.nomeFantasia ?? pu.supplier.razaoSocial) : null,
        numeroPedido: pu?.purchaseOrder?.numero ?? null,
        quantidade: qtd,
        packagingNome: i.packagingId ? (pkgMap.get(i.packagingId) ?? null) : null,
        custoUn: qtd > 0 ? Number((n(i.custoTotal) / qtd).toFixed(2)) : 0,
      };
    })
    .filter((c) => c.data)
    .sort((a, b) => b.data.localeCompare(a.data));

  const precos = compras.map((c) => c.custoUn).filter((v) => v > 0);
  const qtds = compras.map((c) => c.quantidade).filter((v) => v > 0);

  const leadAgg = new Map<string, { total: number; count: number }>();
  for (const po of pedidosFornecedor) {
    if (!po.enviadoEm || !po.recebidoEm) continue;
    const dias = (po.recebidoEm.getTime() - po.enviadoEm.getTime()) / 864e5;
    if (dias < 0 || dias > 60) continue;
    const a = leadAgg.get(po.supplierId) ?? { total: 0, count: 0 };
    a.total += dias;
    a.count += 1;
    leadAgg.set(po.supplierId, a);
  }

  const ultimaPorFornecedor = new Map<string, string>();
  for (const c of compras) {
    if (c.supplierId && !ultimaPorFornecedor.has(c.supplierId)) ultimaPorFornecedor.set(c.supplierId, c.data);
  }

  return {
    compras: compras.slice(0, 10).map((c) => ({
      data: c.data,
      supplierNome: c.supplierNome,
      numeroPedido: c.numeroPedido,
      quantidade: c.quantidade,
      packagingNome: c.packagingNome,
      custoUn: c.custoUn,
    })),
    precoMedio: precos.length ? Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2)) : null,
    menorPreco: precos.length ? Math.min(...precos) : null,
    maiorPreco: precos.length ? Math.max(...precos) : null,
    qtdHabitual: qtds.length
      ? Number(([...qtds].sort((a, b) => a - b)[Math.floor(qtds.length / 2)]).toFixed(0))
      : null,
    fornecedores: vinculos.map((v) => {
      const lead = leadAgg.get(v.supplierId);
      return {
        supplierId: v.supplierId,
        nome: v.supplier.nomeFantasia ?? v.supplier.razaoSocial,
        isPrincipal: v.isPrincipal,
        custoFornecedor: v.custoFornecedor ? n(v.custoFornecedor) : null,
        leadTimeDias: lead ? Math.max(1, Math.round(lead.total / lead.count)) : null,
        ultimaCompraEm: ultimaPorFornecedor.get(v.supplierId) ?? null,
      };
    }),
  };
}
