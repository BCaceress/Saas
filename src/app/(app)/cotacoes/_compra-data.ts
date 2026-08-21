import { db } from "@/lib/prisma";
import { sinaisDosLinks } from "@/lib/compras/cotacao-link";
import { coberturaDeFornecedores } from "@/lib/fornecedores/historico";
import type {
  ConviteCotacao,
  CotacaoDetalhe,
  CotacaoRow,
  ItemCotacao,
  OpcoesCotacao,
  ResumoCompras,
} from "./_compra-types";

// ============================================================
// Leituras das Compras (evolução do Quotation/RFQ). Tudo roda dentro de
// `runWithTenant` — RSC chama o `db` estendido direto (ver CLAUDE.md).
// ============================================================

const n = (v: unknown) => Number(v ?? 0);
const fmtUn = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

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
  resumo: ResumoCompras;
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

  let planejamento = 0;
  let cotando = 0;
  let valorPrevisto = 0;

  const linhas: CotacaoRow[] = cotacoes.map((c) => {
    const quantidades = new Map(c.items.map((i) => [i.id, n(i.quantidade)]));

    if (c.status === "RASCUNHO") planejamento++;
    if (c.status === "ABERTA") cotando++;

    // Valor previsto: o que a cotação custaria hoje, item a item, pelo melhor
    // preço já conhecido entre os fornecedores que responderam — mesmo sem
    // decisão fechada. Cotação decidida/cancelada não é mais "previsão".
    if (c.status !== "DECIDIDA" && c.status !== "CANCELADA") {
      const melhorPrecoPorItem = new Map<string, number>();
      for (const s of c.suppliers) {
        for (const r of s.responses) {
          if (!r.disponivel) continue;
          const preco = n(r.precoUnitario);
          const atual = melhorPrecoPorItem.get(r.quotationItemId);
          if (atual === undefined || preco < atual) melhorPrecoPorItem.set(r.quotationItemId, preco);
        }
      }
      for (const [itemId, preco] of melhorPrecoPorItem) {
        valorPrevisto += preco * (quantidades.get(itemId) ?? 0);
      }
    }

    const totais: number[] = [];
    for (const s of c.suppliers) {
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
      totalRecusados: c.suppliers.filter((s) => s.status === "RECUSADA").length,
      melhorTotal: totais.length ? Math.min(...totais) : null,
    };
  });

  return {
    linhas,
    resumo: {
      planejamento,
      cotando,
      valorPrevisto,
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
          contactId: true,
          supplier: {
            select: {
              razaoSocial: true,
              nomeFantasia: true,
              logoUrl: true,
              telefone: true,
              email: true,
              contacts: SELECT_CONTATOS,
            },
          },
          envios: {
            orderBy: { enviadoEm: "desc" },
            select: {
              id: true,
              canal: true,
              contatoNome: true,
              destino: true,
              reenvio: true,
              sucesso: true,
              erro: true,
              enviadoEm: true,
            },
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

  const [produtos, embalagens, estoques] = await Promise.all([
    productIds.length
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, imagemUrl: true },
        })
      : Promise.resolve([]),
    packagingIds.length
      ? db.productPackaging.findMany({
          where: { id: { in: packagingIds } },
          select: { id: true, nome: true, fatorConversao: true },
        })
      : Promise.resolve([]),
    // Estoque na loja de destino da compra — mesma leitura que
    // `loadSugestoesReposicao` já faz (estoqueFechado/estoqueMinimo).
    productIds.length
      ? db.stock.findMany({
          where: { siteId: c.siteId, productId: { in: productIds } },
          select: { productId: true, estoqueFechado: true, estoqueMinimo: true },
        })
      : Promise.resolve([]),
  ]);
  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const porEmbalagem = new Map(embalagens.map((p) => [p.id, { nome: p.nome, fatorConversao: n(p.fatorConversao) }]));
  const porEstoque = new Map(estoques.map((e) => [e.productId, e]));

  // Embalagem sempre traz quanto vem: "Caixa (60 un.)". A base (sem embalagem
  // escolhida) é a única exceção — é sempre 1 un., então o rótulo dispensa o
  // número. Item fora do catálogo não tem embalagem para informar.
  function embalagemLabel(i: NonNullable<typeof c>["items"][number]): string | null {
    if (!i.productId) return null;
    if (!i.packagingId) return "Unidade";
    const emb = porEmbalagem.get(i.packagingId);
    if (!emb) return null;
    return `${emb.nome} (${fmtUn(emb.fatorConversao)} un.)`;
  }

  const itens: ItemCotacao[] = c.items.map((i) => {
    const p = i.productId ? porProduto.get(i.productId) : undefined;
    const estoque = i.productId ? porEstoque.get(i.productId) : undefined;
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
      embalagemNome: embalagemLabel(i),
      estoqueAtual: estoque ? n(estoque.estoqueFechado) : null,
      estoqueMinimo: estoque ? n(estoque.estoqueMinimo) : null,
    };
  });

  const quantidades = new Map(itens.map((i) => [i.id, i.quantidade]));

  // Quem abriu o link já é informação: o comprador para de cobrar quem está
  // preenchendo e cobra quem nem olhou.
  const sinais = await sinaisDosLinks(c.suppliers.map((s) => s.id));

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
      supplierLogoUrl: s.supplier.logoUrl,
      telefone: s.supplier.telefone,
      email: s.supplier.email,
      contatoId: s.contactId,
      contatos: s.supplier.contacts,
      envios: s.envios.map((e) => ({
        id: e.id,
        canal: e.canal,
        contatoNome: e.contatoNome,
        destino: e.destino,
        reenvio: e.reenvio,
        sucesso: e.sucesso,
        erro: e.erro,
        enviadoEm: e.enviadoEm.toISOString(),
      })),
      abertoEm: sinais.get(s.id)?.abertoEm?.toISOString() ?? null,
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
 * Preço que cada fornecedor praticava em cada produto ANTES desta compra,
 * chaveado por `${supplierId}:${productId}`.
 *
 * É o que transforma "R$ 138" em "R$ 138, 8% acima da última vez" — a única
 * informação do painel que não está na tela do comparativo. Sai do
 * `SupplierPriceHistory`, alimentado tanto por tabela importada quanto pelas
 * respostas de cotação (ver lib/compras/cotacao-precos).
 *
 * O corte por data é obrigatório: sem ele, a resposta desta compra — que já
 * gravou seu próprio ponto no histórico — viraria referência de si mesma e
 * toda variação daria zero.
 */
export async function loadReferenciasPreco(
  cotacao: CotacaoDetalhe,
): Promise<Record<string, number>> {
  const productIds = [...new Set(cotacao.itens.flatMap((i) => (i.productId ? [i.productId] : []))) ];
  const supplierIds = [...new Set(cotacao.convites.map((c) => c.supplierId))];
  if (productIds.length === 0 || supplierIds.length === 0) return {};

  // Antes do primeiro envio da compra: qualquer preço posterior já pode ser
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

/** Contatos que podem receber cotação — o principal encabeça a lista. */
const SELECT_CONTATOS = {
  where: { ativo: true },
  orderBy: [{ principal: "desc" as const }, { createdAt: "asc" as const }],
  select: {
    id: true,
    nome: true,
    cargo: true,
    telefone: true,
    email: true,
    principal: true,
  },
};

/**
 * Fornecedores ativos em forma de opção. Existe separado de  porque
 * o mobile não carrega o catálogo inteiro para convidar alguém — lá o produto
 * entra por busca ou bipe, não por lista.
 */
export async function loadFornecedoresOpcao(
  /** Produtos da cotação: quem já entregou algum deles aparece marcado. */
  productIds: string[] = [],
): Promise<OpcoesCotacao["fornecedores"]> {
  const [fornecedores, cobertura] = await Promise.all([
    db.supplier.findMany({
      where: { ativo: true },
      orderBy: { razaoSocial: "asc" },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        logoUrl: true,
        telefone: true,
        email: true,
        contacts: SELECT_CONTATOS,
      },
    }),
    coberturaDeFornecedores(productIds),
  ]);
  return fornecedores.map((f) => ({
    id: f.id,
    nome: f.nomeFantasia || f.razaoSocial,
    logoUrl: f.logoUrl,
    telefone: f.telefone,
    email: f.email,
    contatos: f.contacts,
    jaForneceu: cobertura.get(f.id)?.itens ?? 0,
    ultimaCompraEm: cobertura.get(f.id)?.ultimaCompraEm ?? null,
  }));
}

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
        logoUrl: true,
        telefone: true,
        email: true,
        contacts: SELECT_CONTATOS,
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
      jaForneceu: 0,
      ultimaCompraEm: null,
      id: f.id,
      nome: f.nomeFantasia || f.razaoSocial,
      logoUrl: f.logoUrl,
      telefone: f.telefone,
      email: f.email,
      contatos: f.contacts,
    })),
    sites,
  };
}
