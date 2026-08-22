import "server-only";
import { db } from "@/lib/prisma";

// Leitura da tela de devoluções ao fornecedor. Só o que a lista mostra —
// o detalhe de cada devolução abre pelo documento.

export type DevolucaoRow = {
  id: string;
  numero: string;
  status: "RASCUNHO" | "CONFIRMADA" | "CANCELADA";
  motivo: string;
  observacao: string;
  supplierNome: string;
  supplierId: string;
  siteNome: string;
  numeroNota: string | null;
  pedidoNumero: string | null;
  valorTotal: number;
  itens: number;
  createdAt: Date;
  confirmadaEm: Date | null;
};

export async function loadDevolucoes(siteId: string | null): Promise<DevolucaoRow[]> {
  const rows = await db.supplierReturn.findMany({
    where: siteId ? { siteId } : {},
    select: {
      id: true,
      numero: true,
      status: true,
      motivo: true,
      observacao: true,
      supplierId: true,
      numeroNota: true,
      valorTotal: true,
      createdAt: true,
      confirmadaEm: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      site: { select: { nome: true } },
      purchaseOrder: { select: { numero: true } },
      items: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    status: r.status,
    motivo: r.motivo,
    observacao: r.observacao,
    supplierId: r.supplierId,
    supplierNome: r.supplier.nomeFantasia || r.supplier.razaoSocial,
    siteNome: r.site.nome,
    numeroNota: r.numeroNota,
    pedidoNumero: r.purchaseOrder?.numero ?? null,
    valorTotal: Number(r.valorTotal),
    itens: r.items.length,
    createdAt: r.createdAt,
    confirmadaEm: r.confirmadaEm,
  }));
}

export async function loadDevolucaoFormOptions() {
  const [sites, suppliers] = await Promise.all([
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    // Só fornecedores de quem já se comprou: devolver para quem nunca entregou
    // nada é erro de digitação, não caso de uso.
    db.supplier.findMany({
      where: { ativo: true },
      orderBy: { razaoSocial: "asc" },
      select: { id: true, razaoSocial: true, nomeFantasia: true, comprasNotas: true },
    }),
  ]);

  return {
    sites,
    suppliers: suppliers.map((s) => ({
      id: s.id,
      nome: s.nomeFantasia || s.razaoSocial,
      comprou: s.comprasNotas > 0,
    })),
  };
}
