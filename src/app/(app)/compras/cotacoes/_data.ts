import { db } from "@/lib/prisma";
import type {
  ConviteCotacao,
  CotacaoDetalhe,
  CotacaoRow,
  ItemCotacao,
  OpcoesCotacao,
  ResumoCotacoes,
} from "./_types";

// ============================================================
// Leituras das Cotações (RFQ). Tudo roda dentro de `runWithTenant` — RSC
// chama o `db` estendido direto (ver CLAUDE.md).
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;

const n = (v: unknown) => Number(v ?? 0);

/** Preço vezes quantidade pedida, item a item, mais o frete. */
function totalDoConvite(
  respostas: { quotationItemId: string; disponivel: boolean; precoUnitario: number }[],
  quantidades: Map<string, number>,
  frete: number | null,
): number {
  const itens = respostas.reduce(
    (acc, r) =>
      r.disponivel ? acc + r.precoUnitario * (quantidades.get(r.quotationItemId) ?? 0) : acc,
    0,
  );
  return itens + (frete ?? 0);
}

// ── Lista ───────────────────────────────────────────────────

export async function loadCotacoes(): Promise<{
  linhas: CotacaoRow[];
  resumo: ResumoCotacoes;
}> {
  const cotacoes = await db.quotation.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      numero: true,
      titulo: true,
      status: true,
      prazoResposta: true,
      createdAt: true,
      site: { select: { nome: true } },
      items: { select: { id: true, quantidade: true } },
      suppliers: {
        select: {
          status: true,
          frete: true,
          responses: {
            select: { quotationItemId: true, disponivel: true, precoUnitario: true },
          },
        },
      },
    },
  });

  const agora = Date.now();
  let aguardandoResposta = 0;
  let economiaPotencial = 0;

  const linhas: CotacaoRow[] = cotacoes.map((c) => {
    const quantidades = new Map(c.items.map((i) => [i.id, n(i.quantidade)]));

    const totais: number[] = [];
    for (const s of c.suppliers) {
      if (s.status === "ENVIADA") aguardandoResposta++;
      if (s.status !== "RESPONDIDA") continue;

      const respostas = s.responses.map((r) => ({
        quotationItemId: r.quotationItemId,
        disponivel: r.disponivel,
        precoUnitario: n(r.precoUnitario),
      }));
      // Só entra na disputa quem cotou a lista inteira — comparar cesta cheia
      // com cesta pela metade daria uma economia que não existe.
      const cobreTudo = c.items.every((i) =>
        respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
      );
      if (cobreTudo) totais.push(totalDoConvite(respostas, quantidades, n(s.frete)));
    }

    if (totais.length > 1) {
      economiaPotencial += Math.max(...totais) - Math.min(...totais);
    }

    return {
      id: c.id,
      numero: c.numero,
      titulo: c.titulo,
      status: c.status,
      siteNome: c.site.nome,
      prazoResposta: c.prazoResposta?.toISOString() ?? null,
      criadaEm: c.createdAt.toISOString(),
      totalItens: c.items.length,
      totalConvidados: c.suppliers.length,
      totalRespondidos: c.suppliers.filter((s) => s.status === "RESPONDIDA").length,
      melhorTotal: totais.length ? Math.min(...totais) : null,
    };
  });

  const abertas = linhas.filter((l) => l.status === "ABERTA");

  return {
    linhas,
    resumo: {
      abertas: abertas.length,
      aguardandoResposta,
      prazoVencendo: abertas.filter(
        (l) => l.prazoResposta && new Date(l.prazoResposta).getTime() - agora <= 2 * DIA_MS,
      ).length,
      economiaPotencial,
    },
  };
}

// ── Detalhe ─────────────────────────────────────────────────

export async function loadCotacao(id: string): Promise<CotacaoDetalhe | null> {
  const c = await db.quotation.findFirst({
    where: { id },
    select: {
      id: true,
      numero: true,
      titulo: true,
      status: true,
      siteId: true,
      prazoResposta: true,
      observacao: true,
      createdAt: true,
      enviadaEm: true,
      site: { select: { nome: true } },
      items: {
        orderBy: [{ ordem: "asc" }, { descricao: "asc" }],
        select: {
          id: true,
          productId: true,
          packagingId: true,
          descricao: true,
          quantidade: true,
          observacao: true,
          ordem: true,
        },
      },
      suppliers: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          supplierId: true,
          status: true,
          enviadaEm: true,
          respondidaEm: true,
          prazoEntregaDias: true,
          condicaoPagamento: true,
          frete: true,
          observacao: true,
          purchaseOrderId: true,
          supplier: {
            select: { razaoSocial: true, nomeFantasia: true, telefone: true, email: true },
          },
          responses: {
            select: {
              quotationItemId: true,
              disponivel: true,
              precoUnitario: true,
              quantidadeOfertada: true,
              marca: true,
              observacao: true,
            },
          },
        },
      },
    },
  });
  if (!c) return null;

  // Produto e embalagem enriquecem o item; texto livre segue sem eles.
  const productIds = [...new Set(c.items.flatMap((i) => (i.productId ? [i.productId] : [])))];
  const packagingIds = [...new Set(c.items.flatMap((i) => (i.packagingId ? [i.packagingId] : [])))];

  const [produtos, embalagens] = await Promise.all([
    productIds.length
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, imagemUrl: true },
        })
      : Promise.resolve([]),
    packagingIds.length
      ? db.productPackaging.findMany({
          where: { id: { in: packagingIds } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
  ]);
  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const porEmbalagem = new Map(embalagens.map((p) => [p.id, p.nome]));

  const itens: ItemCotacao[] = c.items.map((i) => {
    const p = i.productId ? porProduto.get(i.productId) : undefined;
    return {
      id: i.id,
      productId: i.productId,
      packagingId: i.packagingId,
      descricao: i.descricao,
      quantidade: n(i.quantidade),
      observacao: i.observacao,
      ordem: i.ordem,
      sku: p?.sku ?? null,
      imagemUrl: p?.imagemUrl ?? null,
      embalagemNome: i.packagingId ? (porEmbalagem.get(i.packagingId) ?? null) : null,
    };
  });

  const quantidades = new Map(itens.map((i) => [i.id, i.quantidade]));

  const convites: ConviteCotacao[] = c.suppliers.map((s) => {
    const respostas = s.responses.map((r) => ({
      quotationItemId: r.quotationItemId,
      disponivel: r.disponivel,
      precoUnitario: n(r.precoUnitario),
      quantidadeOfertada: r.quantidadeOfertada === null ? null : n(r.quantidadeOfertada),
      marca: r.marca,
      observacao: r.observacao,
    }));
    return {
      id: s.id,
      supplierId: s.supplierId,
      supplierNome: s.supplier.nomeFantasia || s.supplier.razaoSocial,
      telefone: s.supplier.telefone,
      email: s.supplier.email,
      status: s.status,
      enviadaEm: s.enviadaEm?.toISOString() ?? null,
      respondidaEm: s.respondidaEm?.toISOString() ?? null,
      prazoEntregaDias: s.prazoEntregaDias,
      condicaoPagamento: s.condicaoPagamento,
      frete: s.frete === null ? null : n(s.frete),
      observacao: s.observacao,
      purchaseOrderId: s.purchaseOrderId,
      respostas,
      total: totalDoConvite(respostas, quantidades, s.frete === null ? null : n(s.frete)),
      itensAtendidos: respostas.filter((r) => r.disponivel).length,
    };
  });

  return {
    id: c.id,
    numero: c.numero,
    titulo: c.titulo,
    status: c.status,
    siteId: c.siteId,
    siteNome: c.site.nome,
    prazoResposta: c.prazoResposta?.toISOString() ?? null,
    observacao: c.observacao,
    criadaEm: c.createdAt.toISOString(),
    enviadaEm: c.enviadaEm?.toISOString() ?? null,
    itens,
    convites,
  };
}

// ── Referências de preço (para o resumo) ────────────────────

/**
 * Preço que cada fornecedor praticava em cada produto ANTES desta cotação,
 * chaveado por `${supplierId}:${productId}`.
 *
 * É o que transforma "R$ 138" em "R$ 138, 8% acima da última vez" — a única
 * informação do painel que não está na tela do comparativo. Sai do
 * `SupplierPriceHistory`, alimentado tanto por tabela importada quanto pelas
 * respostas de cotação (ver lib/compras/cotacao-precos).
 *
 * O corte por data é obrigatório: sem ele, a resposta desta cotação — que já
 * gravou seu próprio ponto no histórico — viraria referência de si mesma e
 * toda variação daria zero.
 */
export async function loadReferenciasPreco(
  cotacao: CotacaoDetalhe,
): Promise<Record<string, number>> {
  const productIds = [...new Set(cotacao.itens.flatMap((i) => (i.productId ? [i.productId] : []))) ];
  const supplierIds = [...new Set(cotacao.convites.map((c) => c.supplierId))];
  if (productIds.length === 0 || supplierIds.length === 0) return {};

  // Antes do primeiro envio da cotação: qualquer preço posterior já pode ser
  // resposta dela.
  const corte = cotacao.enviadaEm ? new Date(cotacao.enviadaEm) : new Date(cotacao.criadaEm);

  const pontos = await db.supplierPriceHistory.findMany({
    where: {
      productId: { in: productIds },
      supplierId: { in: supplierIds },
      data: { lt: corte },
    },
    orderBy: { data: "desc" },
    select: { supplierId: true, productId: true, preco: true, precoPromocional: true },
    take: 2000,
  });

  const referencias: Record<string, number> = {};
  for (const p of pontos) {
    if (!p.productId) continue;
    const chave = `${p.supplierId}:${p.productId}`;
    // `orderBy` desc + primeiro a chegar vence = o ponto mais recente antes do corte.
    if (referencias[chave] !== undefined) continue;
    const promo = p.precoPromocional === null ? null : n(p.precoPromocional);
    referencias[chave] = promo && promo > 0 && promo < n(p.preco) ? promo : n(p.preco);
  }
  return referencias;
}

// ── Opções dos formulários ──────────────────────────────────

export async function loadOpcoes(): Promise<OpcoesCotacao> {
  const [produtos, fornecedores, sites] = await Promise.all([
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        sku: true,
        imagemUrl: true,
        packagings: { select: { id: true, nome: true, isCompraDefault: true } },
      },
    }),
    db.supplier.findMany({
      where: { ativo: true },
      orderBy: { razaoSocial: "asc" },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        telefone: true,
        email: true,
      },
    }),
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
  ]);

  return {
    produtos,
    fornecedores: fornecedores.map((f) => ({
      id: f.id,
      nome: f.nomeFantasia || f.razaoSocial,
      telefone: f.telefone,
      email: f.email,
    })),
    sites,
  };
}
