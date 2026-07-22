import { db } from "@/lib/prisma";
import type { SupplierRow } from "../produtos/_types";

const PEDIDOS_ATIVOS = ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] as const;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Fornecedores com sinais agregados de compras — usado no sidepanel de /fornecedores. Roda dentro de `runWithTenant`. */
export async function loadFornecedores(): Promise<SupplierRow[]> {
  const trintaDiasAtras = new Date(Date.now() - 30 * DIA_MS);
  const [suppliers, produtoCounts, pedidos] = await Promise.all([
    db.supplier.findMany({ orderBy: { razaoSocial: "asc" } }),
    db.productSupplier.groupBy({
      by: ["supplierId"],
      where: { product: { ativo: true } },
      _count: { _all: true },
    }),
    db.purchaseOrder.findMany({
      where: { status: { not: "CANCELADO" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
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
  const ultimaPorFornecedor = new Map<string, { numero: string; status: string; data: string }>();
  const proximaPorFornecedor = new Map<string, string>();
  const ultimosPorFornecedor = new Map<
    string,
    Array<{ id: string; numero: string; status: string; data: string; valorTotal: number }>
  >();
  const totalComprado30dPorFornecedor = new Map<string, number>();

  for (const p of pedidos) {
    if (!ultimaPorFornecedor.has(p.supplierId)) {
      ultimaPorFornecedor.set(p.supplierId, { numero: p.numero, status: p.status, data: p.createdAt.toISOString() });
    }
    const ultimos = ultimosPorFornecedor.get(p.supplierId) ?? [];
    if (ultimos.length < 3) {
      ultimos.push({
        id: p.id,
        numero: p.numero,
        status: p.status,
        data: p.createdAt.toISOString(),
        valorTotal: p.valorTotal.toNumber(),
      });
      ultimosPorFornecedor.set(p.supplierId, ultimos);
    }
    if (p.createdAt >= trintaDiasAtras) {
      totalComprado30dPorFornecedor.set(
        p.supplierId,
        (totalComprado30dPorFornecedor.get(p.supplierId) ?? 0) + p.valorTotal.toNumber(),
      );
    }
    if (p.previsaoEntrega && (PEDIDOS_ATIVOS as readonly string[]).includes(p.status)) {
      const atual = proximaPorFornecedor.get(p.supplierId);
      const iso = p.previsaoEntrega.toISOString();
      if (!atual || iso < atual) proximaPorFornecedor.set(p.supplierId, iso);
    }
  }

  return suppliers.map((s) => ({
    id: s.id,
    cnpj: s.cnpj,
    razaoSocial: s.razaoSocial,
    nomeFantasia: s.nomeFantasia,
    logoUrl: s.logoUrl,
    email: s.email,
    telefone: s.telefone,
    nomeContatoPrincipal: s.nomeContatoPrincipal,
    website: s.website,
    pedidoMinimo: s.pedidoMinimo != null ? Number(s.pedidoMinimo) : null,
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
    createdAt: s.createdAt.toISOString(),
    totalProdutos: produtoPorFornecedor.get(s.id) ?? 0,
    proximaEntrega: proximaPorFornecedor.get(s.id) ?? null,
    ultimaSolicitacao: ultimaPorFornecedor.get(s.id) ?? null,
    ultimosPedidos: ultimosPorFornecedor.get(s.id) ?? [],
    totalComprado30d: totalComprado30dPorFornecedor.get(s.id) ?? 0,
  }));
}
