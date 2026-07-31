import { db } from "@/lib/prisma";
import type { SupplierIntegrationKind, SupplierIntegrationStatus } from "@/generated/prisma";

const PEDIDOS_ATIVOS = ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] as const;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Linha da lista de fornecedores. Depois que o fornecedor virou o centro de
 * tudo que é dele, a lista precisa mostrar também o estado da integração e do
 * catálogo — senão a pessoa abre um por um só para descobrir quem está parado.
 */
export type FornecedorListaRow = {
  id: string;
  cnpj: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  logoUrl: string | null;
  email: string | null;
  telefone: string | null;
  municipio: string | null;
  uf: string | null;
  ativo: boolean;
  createdAt: string;
  /** Produtos do meu catálogo apontando para ele. */
  totalProdutos: number;
  /** Itens da tabela de preço que ele mandou. */
  totalCatalogo: number;
  emPromocao: number;
  pendentes: number;
  tipoIntegracao: SupplierIntegrationKind | null;
  situacaoIntegracao: SupplierIntegrationStatus;
  ultimaSincronizacao: string | null;
  proximaEntrega: string | null;
  ultimaSolicitacao: { numero: string; status: string; data: string } | null;
  totalComprado30d: number;
};

/** Fornecedores com os sinais que a lista mostra. Roda dentro de `runWithTenant`. */
export async function loadFornecedores(): Promise<FornecedorListaRow[]> {
  const trintaDiasAtras = new Date(Date.now() - 30 * DIA_MS);

  const [suppliers, produtoCounts, catalogo, pedidos] = await Promise.all([
    db.supplier.findMany({
      orderBy: { razaoSocial: "asc" },
      select: {
        id: true,
        cnpj: true,
        razaoSocial: true,
        nomeFantasia: true,
        logoUrl: true,
        email: true,
        telefone: true,
        municipio: true,
        uf: true,
        ativo: true,
        createdAt: true,
        tipoIntegracao: true,
        situacaoIntegracao: true,
        ultimaSincronizacao: true,
      },
    }),
    db.productSupplier.groupBy({
      by: ["supplierId"],
      where: { product: { ativo: true } },
      _count: { _all: true },
    }),
    db.supplierCatalogItem.findMany({
      where: { ativo: true },
      select: { supplierId: true, emPromocao: true, matchStatus: true },
    }),
    db.purchaseOrder.findMany({
      where: { status: { not: "CANCELADO" } },
      orderBy: { createdAt: "desc" },
      select: {
        supplierId: true,
        numero: true,
        status: true,
        createdAt: true,
        previsaoEntrega: true,
        valorTotal: true,
      },
    }),
  ]);

  const produtoPorFornecedor = new Map(produtoCounts.map((c) => [c.supplierId, c._count._all]));

  const catalogoPorFornecedor = new Map<string, { total: number; promo: number; pendentes: number }>();
  for (const item of catalogo) {
    const acc = catalogoPorFornecedor.get(item.supplierId) ?? { total: 0, promo: 0, pendentes: 0 };
    acc.total++;
    if (item.emPromocao) acc.promo++;
    if (item.matchStatus === "PENDENTE") acc.pendentes++;
    catalogoPorFornecedor.set(item.supplierId, acc);
  }

  const ultimaPorFornecedor = new Map<string, { numero: string; status: string; data: string }>();
  const proximaPorFornecedor = new Map<string, string>();
  const compradoPorFornecedor = new Map<string, number>();

  for (const p of pedidos) {
    if (!ultimaPorFornecedor.has(p.supplierId)) {
      ultimaPorFornecedor.set(p.supplierId, {
        numero: p.numero,
        status: p.status,
        data: p.createdAt.toISOString(),
      });
    }
    if (p.createdAt >= trintaDiasAtras) {
      compradoPorFornecedor.set(
        p.supplierId,
        (compradoPorFornecedor.get(p.supplierId) ?? 0) + Number(p.valorTotal),
      );
    }
    if (p.previsaoEntrega && (PEDIDOS_ATIVOS as readonly string[]).includes(p.status)) {
      const atual = proximaPorFornecedor.get(p.supplierId);
      const iso = p.previsaoEntrega.toISOString();
      if (!atual || iso < atual) proximaPorFornecedor.set(p.supplierId, iso);
    }
  }

  return suppliers.map((s) => {
    const cat = catalogoPorFornecedor.get(s.id);
    return {
      id: s.id,
      cnpj: s.cnpj,
      razaoSocial: s.razaoSocial,
      nomeFantasia: s.nomeFantasia,
      logoUrl: s.logoUrl,
      email: s.email,
      telefone: s.telefone,
      municipio: s.municipio,
      uf: s.uf,
      ativo: s.ativo,
      createdAt: s.createdAt.toISOString(),
      totalProdutos: produtoPorFornecedor.get(s.id) ?? 0,
      totalCatalogo: cat?.total ?? 0,
      emPromocao: cat?.promo ?? 0,
      pendentes: cat?.pendentes ?? 0,
      tipoIntegracao: s.tipoIntegracao,
      situacaoIntegracao: s.situacaoIntegracao,
      ultimaSincronizacao: s.ultimaSincronizacao?.toISOString() ?? null,
      proximaEntrega: proximaPorFornecedor.get(s.id) ?? null,
      ultimaSolicitacao: ultimaPorFornecedor.get(s.id) ?? null,
      totalComprado30d: Math.round((compradoPorFornecedor.get(s.id) ?? 0) * 100) / 100,
    };
  });
}
