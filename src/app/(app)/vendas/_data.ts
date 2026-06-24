import "server-only";
import { db } from "@/lib/prisma";
import { resolvePreco } from "@/lib/vendas";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export type VariantVenda = {
  id: string;
  nome: string;
  preco: number;
  fatorEscala: number;
  volumeMl: number | null;
};

export type ComponentGroupVenda = {
  id: string;
  nome: string;
  obrigatoria: boolean;
  tipoSelecao: "UNICA" | "MULTIPLA";
  maxSelecoes: number | null;
  items: {
    componentProductId: string;
    nome: string;
    preco: number;
    isDefault: boolean;
    acrescimoPreco: number | null;
  }[];
};

export type ProdutoVenda = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  tipo: string;
  preco: number;
  restricaoIdade: boolean;
  unidadeBase: string;
  estoqueFechado: number | null; // null = derivado (combo/personalizado)
  imagemUrl: string | null;
  categoria: string | null;
  variants: VariantVenda[];
  groups?: ComponentGroupVenda[];
};

/** Produtos vendáveis no site (SIMPLES/COMBO/PERSONALIZADO ativos; INSUMO fora). */
export async function loadProdutosVenda(siteId: string | null): Promise<ProdutoVenda[]> {
  const products = await db.product.findMany({
    where: { ativo: true, tipo: { in: ["SIMPLES", "COMBO", "PERSONALIZADO"] } },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      tipo: true,
      precoVenda: true,
      restricaoIdade: true,
      unidadeBase: true,
      imagemUrl: true,
      subcategory: { select: { category: { select: { nome: true } } } },
      variants: {
        where: { ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, precoVenda: true, fatorEscala: true, volumeMl: true },
      },
      componentGroups: {
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          nome: true,
          obrigatoria: true,
          tipoSelecao: true,
          maxSelecoes: true,
          components: {
            select: {
              componentProductId: true,
              isDefault: true,
              acrescimoPreco: true,
              component: { select: { nome: true, precoVenda: true } },
            },
          },
        },
      },
      stocks: siteId
        ? { where: { siteId }, select: { estoqueFechado: true } }
        : { select: { estoqueFechado: true } },
    },
    orderBy: { nome: "asc" },
  });

  return products.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    tipo: p.tipo,
    preco: num(p.precoVenda),
    restricaoIdade: p.restricaoIdade,
    unidadeBase: p.unidadeBase,
    imagemUrl: p.imagemUrl,
    categoria: p.subcategory?.category?.nome ?? null,
    estoqueFechado: p.tipo === "SIMPLES" ? num(p.stocks[0]?.estoqueFechado) : null,
    variants: p.variants.map((v) => ({
      id: v.id,
      nome: v.nome,
      preco: resolvePreco(p, v),
      fatorEscala: num(v.fatorEscala),
      volumeMl: v.volumeMl != null ? num(v.volumeMl) : null,
    })),
    groups:
      p.tipo === "PERSONALIZADO"
        ? p.componentGroups.map((g) => ({
            id: g.id,
            nome: g.nome,
            obrigatoria: g.obrigatoria,
            tipoSelecao: g.tipoSelecao as "UNICA" | "MULTIPLA",
            maxSelecoes: g.maxSelecoes,
            items: g.components.map((c) => ({
              componentProductId: c.componentProductId,
              nome: c.component.nome,
              preco: num(c.component.precoVenda),
              isDefault: c.isDefault,
              acrescimoPreco: c.acrescimoPreco != null ? num(c.acrescimoPreco) : null,
            })),
          }))
        : undefined,
  }));
}

export type VendaRow = {
  id: string;
  origem: string;
  status: string;
  total: number;
  numItens: number;
  metodos: string[];
  createdAt: Date;
  paidAt: Date | null;
};

export async function loadVendasRecentes(siteId: string | null, limit = 30): Promise<VendaRow[]> {
  const sales = await db.sale.findMany({
    where: { ...(siteId ? { siteId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      origem: true,
      status: true,
      total: true,
      createdAt: true,
      paidAt: true,
      _count: { select: { items: true } },
      payments: { select: { metodo: true, status: true } },
    },
  });

  return sales.map((s) => ({
    id: s.id,
    origem: s.origem,
    status: s.status,
    total: num(s.total),
    numItens: s._count.items,
    metodos: [...new Set(s.payments.filter((p) => p.status !== "ESTORNADO").map((p) => p.metodo))],
    createdAt: s.createdAt,
    paidAt: s.paidAt,
  }));
}
