import { db } from "@/lib/prisma";
import { precoEfetivo } from "@/lib/compras/comparador";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import { loadSugestoesReposicao } from "../_data";
import { loadImportacoes } from "../_catalogo/data";
import type { ImportacaoRow } from "../_catalogo/types";

// ============================================================
// Painel de Compras — a Central Inteligente.
//
// A tela responde três perguntas, nesta ordem: o que comprar, de quem comprar
// e quanto dá para economizar. Nada aqui configura fornecedor: configuração é
// assunto do Centro de Gestão do Fornecedor (/fornecedores/[id]).
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;
/** Tabela parada há mais que isso já não serve para decidir compra. */
const DIAS_PRECO_VELHO = 30;

export type ResumoPainel = {
  produtosParaComprar: number;
  produtosCriticos: number;
  economiaPossivel: number;
  produtosComparaveis: number;
  promocoes: number;
  produtosSemFornecedor: number;
  produtosSemPrecoAtualizado: number;
  pedidosPendentes: number;
  valorPedidosPendentes: number;
  pedidosAtrasados: number;
  itensARevisar: number;
  fornecedoresSemTabela: number;
  ultimaSincronizacao: string | null;
};

export type SugestaoCompra = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  status: "ruptura" | "critico" | "abaixo" | "monitorar";
  /** Quanto comprar, em unidades de compra. */
  quantidade: number;
  unidade: string | null;
  /** Fornecedor recomendado — o mais barato entre os que ofertam hoje. */
  supplierId: string | null;
  supplierNome: string;
  supplierLogoUrl: string | null;
  precoUnitario: number | null;
  /** Melhor oferta do catálogo — o item que vai para a cesta. */
  catalogItemId: string | null;
  /** Quanto se deixa de gastar comprando aqui em vez da alternativa mais cara. */
  economia: number;
  /** Contra quem a economia foi medida. */
  comparadoCom: string | null;
  ofertas: number;
};

export type Alerta = {
  tom: "danger" | "warn" | "info";
  titulo: string;
  detalhe: string;
  href: string;
  acao: string;
};

export type PainelCompras = {
  resumo: ResumoPainel;
  sugestoes: SugestaoCompra[];
  importacoes: ImportacaoRow[];
  alertas: Alerta[];
  aprendendo: boolean;
};

export async function loadPainelCompras(
  siteId: string | null,
  policy: EstoquePolicy,
): Promise<PainelCompras> {
  const [reposicao, importacoes, ofertas, semFornecedor, pedidos, catalogos, fornecedores] =
    await Promise.all([
      loadSugestoesReposicao(siteId, policy),
      loadImportacoes(6),
      db.supplierCatalogItem.findMany({
        where: { ativo: true },
        select: {
          id: true,
          supplierId: true,
          productId: true,
          preco: true,
          precoPromocional: true,
          validadeOferta: true,
          emPromocao: true,
          matchStatus: true,
          ultimaAtualizacao: true,
          unidade: true,
          supplier: { select: { razaoSocial: true, nomeFantasia: true, logoUrl: true, ativo: true } },
        },
      }),
      db.product.count({ where: { ativo: true, suppliers: { none: {} } } }),
      db.purchaseOrder.findMany({
        where: {
          status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "CONFERENCIA", "RECEBIDO_PARCIAL"] },
          ...(siteId ? { siteId } : {}),
        },
        select: { valorTotal: true, previsaoEntrega: true },
      }),
      db.supplierCatalog.findMany({ select: { supplierId: true, totalItens: true } }),
      db.supplier.findMany({
        where: { ativo: true },
        select: { id: true, ultimaSincronizacao: true },
      }),
    ]);

  // ── Ofertas por produto: base de "de quem comprar" e "quanto economizar" ──
  const limitePreco = new Date(Date.now() - DIAS_PRECO_VELHO * DIA_MS);
  const porProduto = new Map<
    string,
    Array<{
      catalogItemId: string;
      supplierId: string;
      nome: string;
      logoUrl: string | null;
      preco: number;
      unidade: string | null;
    }>
  >();
  let promocoes = 0;
  let itensARevisar = 0;
  let itensDesatualizados = 0;

  for (const o of ofertas) {
    if (o.emPromocao) promocoes++;
    if (o.matchStatus === "PENDENTE") itensARevisar++;
    if (o.ultimaAtualizacao < limitePreco) itensDesatualizados++;

    // Fornecedor inativo não entra na recomendação — comprar dele não é opção.
    if (!o.productId || o.matchStatus !== "VINCULADO" || !o.supplier.ativo) continue;
    const lista = porProduto.get(o.productId) ?? [];
    lista.push({
      catalogItemId: o.id,
      supplierId: o.supplierId,
      nome: o.supplier.nomeFantasia ?? o.supplier.razaoSocial,
      logoUrl: o.supplier.logoUrl,
      preco: precoEfetivo(o),
      unidade: o.unidade,
    });
    porProduto.set(o.productId, lista);
  }

  // "Economia possível" da loja inteira: uma unidade de cada produto comprada
  // no mais barato em vez do mais caro. É indicador de oportunidade.
  let economiaPossivel = 0;
  let produtosComparaveis = 0;
  for (const lista of porProduto.values()) {
    if (lista.length < 2) continue;
    produtosComparaveis++;
    const precos = lista.map((l) => l.preco);
    economiaPossivel += Math.max(...precos) - Math.min(...precos);
  }

  // ── Sugestão inteligente: o que comprar, de quem, quanto economiza ──
  const linhas = reposicao.grupos.flatMap((g) => g.itens);
  const vistos = new Set<string>();
  const sugestoes: SugestaoCompra[] = [];

  for (const l of linhas) {
    if (vistos.has(l.productId) || l.qtdSugerida <= 0) continue;
    vistos.add(l.productId);

    const lista = (porProduto.get(l.productId) ?? []).sort((a, b) => a.preco - b.preco);
    const melhor = lista[0] ?? null;
    const pior = lista.length > 1 ? lista[lista.length - 1] : null;

    // A economia sai da disputa entre fornecedores; sem disputa, do que a loja
    // pagou na última entrada. Sem nenhum dos dois, não há número para mostrar.
    let economia = 0;
    let comparadoCom: string | null = null;
    if (melhor && pior) {
      economia = (pior.preco - melhor.preco) * l.qtdSugerida;
      comparadoCom = pior.nome;
    } else if (melhor && l.ultimoCustoUn != null && l.ultimoCustoUn > melhor.preco) {
      economia = (l.ultimoCustoUn - melhor.preco) * l.qtdSugerida;
      comparadoCom = "último custo";
    }

    // Sem oferta no catálogo, cai no fornecedor cadastrado do produto.
    const fallback = l.fornecedores[0] ?? null;

    sugestoes.push({
      productId: l.productId,
      nome: l.nome,
      sku: l.sku,
      imagemUrl: l.imagemUrl,
      status: l.status,
      quantidade: l.qtdSugerida,
      unidade: melhor?.unidade ?? l.packagingNome,
      supplierId: melhor?.supplierId ?? fallback?.supplierId ?? null,
      supplierNome: melhor?.nome ?? fallback?.nome ?? "Sem fornecedor",
      supplierLogoUrl: melhor?.logoUrl ?? fallback?.logoUrl ?? null,
      precoUnitario: melhor?.preco ?? l.custoUnitCompra ?? null,
      catalogItemId: melhor?.catalogItemId ?? null,
      economia: Math.round(economia * 100) / 100,
      comparadoCom,
      ofertas: lista.length,
    });
  }

  // Economia primeiro; empate resolve pela urgência do estoque.
  const PESO = { ruptura: 0, critico: 1, abaixo: 2, monitorar: 3 } as const;
  sugestoes.sort((a, b) => b.economia - a.economia || PESO[a.status] - PESO[b.status]);

  // ── Pedidos e alertas ──
  const agora = Date.now();
  let valorPendentes = 0;
  let atrasados = 0;
  for (const p of pedidos) {
    valorPendentes += Number(p.valorTotal);
    if (p.previsaoEntrega && p.previsaoEntrega.getTime() < agora) atrasados++;
  }

  const comTabela = new Set(catalogos.filter((c) => c.totalItens > 0).map((c) => c.supplierId));
  const fornecedoresSemTabela = fornecedores.filter((f) => !comTabela.has(f.id)).length;
  const ultimaSincronizacao = fornecedores
    .map((f) => f.ultimaSincronizacao)
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const criticos = sugestoes.filter((s) => s.status === "ruptura" || s.status === "critico").length;

  const alertas: Alerta[] = [];
  if (criticos > 0) {
    alertas.push({
      tom: "danger",
      titulo: `${criticos} produto${criticos === 1 ? "" : "s"} em ruptura ou perto dela`,
      detalhe: "Sem reposição agora, a prateleira fica vazia.",
      href: "/compras/reposicao-inteligente",
      acao: "Revisar sugestões",
    });
  }
  if (atrasados > 0) {
    alertas.push({
      tom: "warn",
      titulo: `${atrasados} pedido${atrasados === 1 ? "" : "s"} com entrega atrasada`,
      detalhe: "A previsão já passou e a mercadoria não chegou.",
      href: "/compras/pedidos",
      acao: "Ver pedidos",
    });
  }
  if (itensARevisar > 0) {
    alertas.push({
      tom: "warn",
      titulo: `${itensARevisar} itens de tabela sem vínculo`,
      detalhe: "Sem vínculo com um produto seu, eles ficam fora da comparação de preço.",
      href: "/compras/importacoes",
      acao: "Abrir importações",
    });
  }
  if (semFornecedor > 0) {
    alertas.push({
      tom: "info",
      titulo: `${semFornecedor} produto${semFornecedor === 1 ? "" : "s"} sem fornecedor`,
      detalhe: "Produto sem fornecedor não entra em sugestão de compra.",
      href: "/produtos",
      acao: "Abrir produtos",
    });
  }
  if (fornecedoresSemTabela > 0) {
    alertas.push({
      tom: "info",
      titulo: `${fornecedoresSemTabela} fornecedor${fornecedoresSemTabela === 1 ? "" : "es"} sem tabela de preço`,
      detalhe: "Configure a integração deles para receber preços automaticamente.",
      href: "/fornecedores",
      acao: "Abrir fornecedores",
    });
  }

  return {
    resumo: {
      produtosParaComprar: sugestoes.length,
      produtosCriticos: criticos,
      economiaPossivel: Math.round(economiaPossivel * 100) / 100,
      produtosComparaveis,
      promocoes,
      produtosSemFornecedor: semFornecedor,
      produtosSemPrecoAtualizado: itensDesatualizados,
      pedidosPendentes: pedidos.length,
      valorPedidosPendentes: Math.round(valorPendentes * 100) / 100,
      pedidosAtrasados: atrasados,
      itensARevisar,
      fornecedoresSemTabela,
      ultimaSincronizacao: ultimaSincronizacao?.toISOString() ?? null,
    },
    sugestoes: sugestoes.slice(0, 12),
    importacoes,
    alertas,
    aprendendo: reposicao.aprendendo,
  };
}
