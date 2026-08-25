import { db } from "@/lib/prisma";
import { sinaisDosLinks } from "@/lib/compras/cotacao-link";
import { coberturaDeFornecedores } from "@/lib/fornecedores/historico";
import { consumoPorProduto } from "@/lib/estoque-giro";
import type { LimitesEscala } from "@/lib/compras/escalas";
import type { Tenant } from "@/generated/prisma";
import type {
  ConviteCotacao,
  CotacaoAnterior,
  CotacaoDetalhe,
  CotacaoRow,
  ItemCotacao,
  OpcoesCotacao,
  ResumoCompras,
} from "./_compra-types";
import { rotuloEmbalagemPedida } from "./_catalogo/format";

// ============================================================
// Leituras das Compras (evolução do Quotation/RFQ). Tudo roda dentro de
// `runWithTenant` — RSC chama o `db` estendido direto (ver CLAUDE.md).
// ============================================================

const n = (v: unknown) => Number(v ?? 0);

/** "Porto Alegre — RS", "Porto Alegre" ou "RS", conforme o cadastro tiver. */
function praca(municipio: string | null, uf: string | null): string | null {
  const cidade = municipio?.trim();
  const estado = uf?.trim().toUpperCase();
  if (cidade && estado) return `${cidade} — ${estado}`;
  return cidade || estado || null;
}

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

/**
 * Mediana dos dias de prateleira observados nos lotes de cada produto —
 * (validade − entrada). É a única fonte honesta de "quanto tempo isso dura"
 * que o sistema tem: não existe campo de validade no cadastro, mas existe o
 * histórico do que já entrou pela porta.
 *
 * Mediana e não média porque um único lote de ponta de estoque, comprado
 * vencendo, puxaria a média para baixo e barraria promoção boa.
 */
async function validadeTipicaPorProduto(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const lotes = await db.stockLot.findMany({
    where: { productId: { in: productIds }, validade: { not: null } },
    select: { productId: true, validade: true, createdAt: true },
  });

  const dias = new Map<string, number[]>();
  for (const l of lotes) {
    if (!l.validade) continue;
    const d = Math.round((l.validade.getTime() - l.createdAt.getTime()) / 864e5);
    // Lote que entrou já vencido é erro de digitação, não prazo de prateleira.
    if (d <= 0) continue;
    const lista = dias.get(l.productId) ?? [];
    lista.push(d);
    dias.set(l.productId, lista);
  }

  const mediana = new Map<string, number>();
  for (const [productId, lista] of dias) {
    lista.sort((a, b) => a - b);
    const meio = Math.floor(lista.length / 2);
    mediana.set(
      productId,
      lista.length % 2 ? lista[meio] : Math.round((lista[meio - 1] + lista[meio]) / 2),
    );
  }
  return mediana;
}

/**
 * @param tenant cadastro do tenant — de onde saem a janela da média de venda e
 *   as travas da compra por escala. Vem por parâmetro, e não de uma consulta
 *   aqui dentro, porque a página já resolveu o tenant para autorizar.
 */
export async function loadCotacao(id: string, tenant: Tenant): Promise<CotacaoDetalhe | null> {
  const c = await db.quotation.findFirst({
    where: { id },
    select: {
      id: true,
      numero: true,
      titulo: true,
      status: true,
      siteId: true,
      dataCotacao: true,
      prazoResposta: true,
      observacao: true,
      createdAt: true,
      enviadaEm: true,
      pedeEscala: true,
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
              municipio: true,
              uf: true,
              pedidoMinimo: true,
              prazoPagamentoDias: true,
              prazoMedioDias: true,
              contacts: SELECT_CONTATOS,
            },
          },
          envios: {
            orderBy: { enviadoEm: "desc" },
            select: {
              id: true,
              canal: true,
              contactId: true,
              contatoNome: true,
              destino: true,
              copias: true,
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
              faixas: {
                orderBy: { quantidadeMinima: "asc" },
                select: { quantidadeMinima: true, precoUnitario: true },
              },
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

  // Giro e validade só interessam quando a cotação pede escala — são duas
  // varreduras de tabela grande, e cobrá-las de toda cotação encareceria a
  // tela para quem nunca vai abrir a segunda lente.
  const [produtos, embalagens, estoques, consumo, validades] = await Promise.all([
    productIds.length
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, sku: true, imagemUrl: true, custoMedio: true, custo: true },
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
    c.pedeEscala && productIds.length
      ? consumoPorProduto(tenant.periodoMediaDias, { productIds, siteId: c.siteId })
      : Promise.resolve(new Map<string, number>()),
    c.pedeEscala ? validadeTipicaPorProduto(productIds) : Promise.resolve(new Map<string, number>()),
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
    return rotuloEmbalagemPedida(emb.nome, Number(emb.fatorConversao));
  }

  const janela = Math.max(1, tenant.periodoMediaDias);

  const itens: ItemCotacao[] = c.items.map((i) => {
    const p = i.productId ? porProduto.get(i.productId) : undefined;
    const estoque = i.productId ? porEstoque.get(i.productId) : undefined;
    const vendido = i.productId ? consumo.get(i.productId) : undefined;
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
      // Item sem embalagem escolhida é pedido na unidade: fator 1.
      fatorEmbalagem: i.packagingId ? (porEmbalagem.get(i.packagingId)?.fatorConversao ?? 1) : 1,
      // Médio primeiro: é o que a operação pagou de fato. O custo de cadastro
      // entra quando ainda não houve entrada para formar média.
      custoUnitario: p?.custoMedio ? n(p.custoMedio) : p?.custo ? n(p.custo) : null,
      // Zero venda na janela é informação ("não gira"), e não ausência de
      // histórico — vira 0/dia, que reprova qualquer sobra pela cobertura.
      consumoDiarioUnidades: vendido === undefined ? null : vendido / janela,
      validadeTipicaDias: (i.productId ? validades.get(i.productId) : undefined) ?? null,
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
      faixas: r.faixas.map((f) => ({
        quantidadeMinima: n(f.quantidadeMinima),
        precoUnitario: n(f.precoUnitario),
      })),
    }));
    return {
      id: s.id,
      supplierId: s.supplierId,
      supplierNome: s.supplier.nomeFantasia || s.supplier.razaoSocial,
      supplierLogoUrl: s.supplier.logoUrl,
      // Praça do fornecedor: é o que separa dois distribuidores de nome
      // parecido e explica frete e prazo antes de qualquer um chegar.
      supplierPraca: praca(s.supplier.municipio, s.supplier.uf),
      supplierPedidoMinimo:
        s.supplier.pedidoMinimo === null ? null : n(s.supplier.pedidoMinimo),
      // Negociado primeiro (é a promessa), praticado depois (é o que acontece).
      supplierPrazoPagamentoDias: s.supplier.prazoPagamentoDias ?? s.supplier.prazoMedioDias,
      telefone: s.supplier.telefone,
      email: s.supplier.email,
      contatoId: s.contactId,
      contatos: s.supplier.contacts,
      envios: s.envios.map((e) => ({
        id: e.id,
        canal: e.canal,
        contactId: e.contactId,
        contatoNome: e.contatoNome,
        destino: e.destino,
        copias: e.copias,
        reenvio: e.reenvio,
        sucesso: e.sucesso,
        erro: e.erro,
        enviadoEm: e.enviadoEm.toISOString(),
      })),
      abertoEm: sinais.get(s.id)?.abertoEm?.toISOString() ?? null,
      // Só existe origem quando existe proposta. Link respondido = o próprio
      // fornecedor preencheu; sem isso, alguém digitou por ele aqui dentro.
      origemResposta:
        s.status !== "RESPONDIDA"
          ? null
          : sinais.get(s.id)?.respondidoEm
            ? "link"
            : "manual",
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
    // Nunca declarada: a data do documento é a da criação — sem isso a tela
    // abriria com o campo vazio numa cotação que existe desde a semana passada.
    dataCotacao: (c.dataCotacao ?? c.createdAt).toISOString(),
    prazoResposta: c.prazoResposta?.toISOString() ?? null,
    observacao: c.observacao,
    criadaEm: c.createdAt.toISOString(),
    enviadaEm: c.enviadaEm?.toISOString() ?? null,
    pedeEscala: c.pedeEscala,
    limitesEscala: limitesDoTenant(tenant),
    itens,
    convites,
  };
}

/**
 * A última cotação com lista montada, tirando a que está aberta na tela.
 *
 * Serve ao estado vazio: quem acabou de criar a cotação de reposição da semana
 * quer a lista da semana passada, não uma tela em branco e trinta buscas de
 * produto. Null quando ainda não existe histórico — e aí o estado vazio não
 * promete um atalho que não tem para onde ir.
 */
export async function loadUltimaCotacaoComItens(
  excetoId: string,
): Promise<CotacaoAnterior | null> {
  const c = await db.quotation.findFirst({
    where: {
      id: { not: excetoId },
      status: { not: "CANCELADA" },
      items: { some: {} },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      numero: true,
      titulo: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });
  if (!c) return null;
  return {
    id: c.id,
    numero: c.numero,
    titulo: c.titulo,
    totalItens: c._count.items,
    criadaEm: c.createdAt.toISOString(),
  };
}

/** Travas da compra por escala como a tela precisa delas. */
export function limitesDoTenant(tenant: Tenant): LimitesEscala {
  return {
    coberturaMaxDias: tenant.escalaCoberturaMaxDias,
    economiaMinPct: n(tenant.escalaEconomiaMinPct),
    capitalExtraMax:
      tenant.escalaCapitalExtraMax === null ? null : n(tenant.escalaCapitalExtraMax),
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
