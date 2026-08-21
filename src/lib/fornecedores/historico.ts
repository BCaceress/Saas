import "server-only";
import { db } from "@/lib/prisma";
import { listarSugestoesPendentes, type AlteracaoSync } from "./sincronizacao-xml";

// ============================================================
// Leituras do relacionamento construído pelo XML: o que este fornecedor já
// entregou, quando e por quanto — e a trilha do que a sincronização mudou.
//
// A mesma base responde à pergunta inversa, que é a valiosa na hora de comprar:
// "quem já me vendeu ISTO, e a que preço?".
// ============================================================

export type ProdutoFornecido = {
  id: string;
  descricao: string;
  codigoFornecedor: string;
  gtin: string | null;
  ncm: string | null;
  unidade: string;
  vezes: number;
  ultimoPreco: number | null;
  ultimaNota: string | null;
  ultimaCompraEm: string;
  /** Produto do catálogo, quando o item já foi relacionado numa entrada. */
  produto: { id: string; nome: string; sku: string } | null;
};

export type EventoSync = {
  id: string;
  tipo: "AUTOMATICO" | "SUGESTAO" | "HISTORICO";
  status: "APLICADA" | "PENDENTE" | "IGNORADA";
  campo: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
  decisao: string | null;
  notaNumero: string | null;
  createdAt: string;
};

export type HistoricoFornecedor = {
  ultimaCompraEm: string | null;
  ultimaCompraNota: string | null;
  ultimaCompraValor: number | null;
  comprasNotas: number;
  /** Prazo praticado, calculado das duplicatas das notas. */
  prazoMedioDias: number | null;
  /** Prazo negociado, digitado no cadastro. */
  prazoPagamentoDias: number | null;
  produtos: ProdutoFornecido[];
  produtosTotal: number;
  eventos: EventoSync[];
  sugestoes: AlteracaoSync[];
};

const PRODUTOS_NA_TELA = 200;
const EVENTOS_NA_TELA = 60;

export async function loadHistoricoFornecedor(
  supplierId: string,
): Promise<HistoricoFornecedor | null> {
  const s = await db.supplier.findFirst({
    where: { id: supplierId },
    select: {
      ultimaCompraEm: true,
      ultimaCompraNota: true,
      ultimaCompraValor: true,
      comprasNotas: true,
      prazoMedioDias: true,
      prazoPagamentoDias: true,
    },
  });
  if (!s) return null;

  const [produtos, produtosTotal, eventos, sugestoes] = await Promise.all([
    db.supplierProductHistory.findMany({
      where: { supplierId },
      orderBy: [{ ultimaCompraEm: "desc" }, { vezes: "desc" }],
      take: PRODUTOS_NA_TELA,
      select: {
        id: true,
        descricao: true,
        codigoFornecedor: true,
        gtin: true,
        ncm: true,
        unidade: true,
        vezes: true,
        ultimoPreco: true,
        ultimaNota: true,
        ultimaCompraEm: true,
        productId: true,
      },
    }),
    db.supplierProductHistory.count({ where: { supplierId } }),
    db.supplierSyncChange.findMany({
      where: { supplierId },
      orderBy: { createdAt: "desc" },
      take: EVENTOS_NA_TELA,
      select: {
        id: true,
        tipo: true,
        status: true,
        campo: true,
        rotulo: true,
        valorAnterior: true,
        valorNovo: true,
        decisao: true,
        notaNumero: true,
        createdAt: true,
      },
    }),
    listarSugestoesPendentes(supplierId),
  ]);

  // O productId do histórico é preenchido pelo de-para; buscar o nome atual do
  // catálogo evita mostrar a descrição do fornecedor quando já existe a nossa.
  const ids = [...new Set(produtos.map((p) => p.productId).filter((i): i is string => !!i))];
  const catalogo =
    ids.length > 0
      ? await db.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, nome: true, sku: true },
        })
      : [];
  const porId = new Map(catalogo.map((p) => [p.id, p]));

  return {
    ultimaCompraEm: s.ultimaCompraEm?.toISOString() ?? null,
    ultimaCompraNota: s.ultimaCompraNota,
    ultimaCompraValor: s.ultimaCompraValor == null ? null : Number(s.ultimaCompraValor),
    comprasNotas: s.comprasNotas,
    prazoMedioDias: s.prazoMedioDias,
    prazoPagamentoDias: s.prazoPagamentoDias,
    produtosTotal,
    produtos: produtos.map((p) => ({
      id: p.id,
      descricao: p.descricao,
      codigoFornecedor: p.codigoFornecedor,
      gtin: p.gtin,
      ncm: p.ncm,
      unidade: p.unidade,
      vezes: p.vezes,
      ultimoPreco: p.ultimoPreco == null ? null : Number(p.ultimoPreco),
      ultimaNota: p.ultimaNota,
      ultimaCompraEm: p.ultimaCompraEm.toISOString(),
      produto: p.productId ? (porId.get(p.productId) ?? null) : null,
    })),
    eventos: eventos.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      status: e.status,
      campo: e.campo,
      rotulo: e.rotulo,
      antes: e.valorAnterior,
      depois: e.valorNovo,
      decisao: e.decisao,
      notaNumero: e.notaNumero,
      createdAt: e.createdAt.toISOString(),
    })),
    sugestoes,
  };
}

/** Quanto da lista de uma cotação este fornecedor já entregou antes. */
export type CoberturaFornecedor = {
  /** Quantos produtos da lista já vieram em nota dele. */
  itens: number;
  ultimaCompraEm: string | null;
};

/**
 * Para uma lista de produtos (os itens de uma cotação), diz quanto cada
 * fornecedor já entregou. É o que transforma "escolher fornecedor de memória"
 * em "convidar quem comprovadamente vende isto".
 */
export async function coberturaDeFornecedores(
  productIds: string[],
): Promise<Map<string, CoberturaFornecedor>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const cobertura = new Map<string, CoberturaFornecedor>();
  if (ids.length === 0) return cobertura;

  const linhas = await db.supplierProductHistory.findMany({
    where: { productId: { in: ids } },
    select: { supplierId: true, productId: true, ultimaCompraEm: true },
  });

  // Um fornecedor pode ter várias linhas para o mesmo produto (códigos
  // diferentes na nota); o que conta é quantos PRODUTOS distintos ele cobre.
  const produtosPorFornecedor = new Map<string, Set<string>>();
  for (const l of linhas) {
    if (!l.productId) continue;
    const set = produtosPorFornecedor.get(l.supplierId) ?? new Set<string>();
    set.add(l.productId);
    produtosPorFornecedor.set(l.supplierId, set);

    const atual = cobertura.get(l.supplierId);
    const iso = l.ultimaCompraEm.toISOString();
    cobertura.set(l.supplierId, {
      itens: set.size,
      ultimaCompraEm: !atual?.ultimaCompraEm || iso > atual.ultimaCompraEm ? iso : atual.ultimaCompraEm,
    });
  }

  return cobertura;
}

export type FornecedorDoProduto = {
  supplierId: string;
  nome: string;
  cnpj: string | null;
  ativo: boolean;
  descricaoNoFornecedor: string;
  codigoFornecedor: string;
  unidade: string;
  vezes: number;
  ultimoPreco: number | null;
  ultimaCompraEm: string;
  ultimaNota: string | null;
  prazoMedioDias: number | null;
};

/**
 * Quem já vendeu este produto, do mais recente para o mais antigo. É a resposta
 * que faltava antes de montar uma cotação: em vez de escolher fornecedor de
 * memória, o comprador vê quem entrega o item, quando entregou e por quanto.
 *
 * Casa por productId (item já relacionado ao catálogo) OU por GTIN — o segundo
 * pega o fornecedor que nunca teve item relacionado à mão.
 */
export async function fornecedoresQueJaForneceram(input: {
  productId?: string | null;
  gtin?: string | null;
  limite?: number;
}): Promise<FornecedorDoProduto[]> {
  const { productId, gtin, limite = 12 } = input;
  const alternativas = [
    ...(productId ? [{ productId }] : []),
    ...(gtin ? [{ gtin }] : []),
  ];
  if (alternativas.length === 0) return [];

  const linhas = await db.supplierProductHistory.findMany({
    where: { OR: alternativas },
    orderBy: { ultimaCompraEm: "desc" },
    take: limite * 3, // o mesmo fornecedor pode ter várias linhas (cProd distintos)
    select: {
      supplierId: true,
      descricao: true,
      codigoFornecedor: true,
      unidade: true,
      vezes: true,
      ultimoPreco: true,
      ultimaNota: true,
      ultimaCompraEm: true,
      supplier: {
        select: {
          razaoSocial: true,
          nomeFantasia: true,
          cnpj: true,
          ativo: true,
          prazoMedioDias: true,
        },
      },
    },
  });

  // Uma linha por fornecedor: a mais recente ganha.
  const porFornecedor = new Map<string, FornecedorDoProduto>();
  for (const l of linhas) {
    if (porFornecedor.has(l.supplierId)) continue;
    porFornecedor.set(l.supplierId, {
      supplierId: l.supplierId,
      nome: l.supplier.nomeFantasia ?? l.supplier.razaoSocial,
      cnpj: l.supplier.cnpj,
      ativo: l.supplier.ativo,
      descricaoNoFornecedor: l.descricao,
      codigoFornecedor: l.codigoFornecedor,
      unidade: l.unidade,
      vezes: l.vezes,
      ultimoPreco: l.ultimoPreco == null ? null : Number(l.ultimoPreco),
      ultimaCompraEm: l.ultimaCompraEm.toISOString(),
      ultimaNota: l.ultimaNota,
      prazoMedioDias: l.supplier.prazoMedioDias,
    });
  }

  return [...porFornecedor.values()].slice(0, limite);
}
