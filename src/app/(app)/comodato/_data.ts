import "server-only";

import { db } from "@/lib/prisma";
import type {
  AssetRow,
  ContainerTypeRow,
  ContainerBalanceRow,
  CustomerOption,
} from "./_types";

// Loaders do comodato — assumem contexto de tenant ativo (runWithTenant).

export async function loadAssetRows(): Promise<AssetRow[]> {
  const assets = await db.comodatoAsset.findMany({
    orderBy: { nome: "asc" },
    include: {
      loans: {
        where: { devolvidoEm: null },
        include: { customer: { select: { id: true, nome: true } } },
        take: 1,
      },
    },
  });

  return assets.map((a) => {
    const loan = a.loans[0] ?? null;
    return {
      id: a.id,
      nome: a.nome,
      identificacao: a.identificacao,
      status: a.status,
      valorEstimado: a.valorEstimado != null ? Number(a.valorEstimado) : null,
      observacao: a.observacao,
      createdAt: a.createdAt.toISOString(),
      loanAtual: loan
        ? {
            loanId: loan.id,
            customerId: loan.customer.id,
            customerNome: loan.customer.nome,
            emprestadoEm: loan.emprestadoEm.toISOString(),
            previsaoDevolucao: loan.previsaoDevolucao?.toISOString() ?? null,
          }
        : null,
    };
  });
}

export async function loadContainerTypes(): Promise<ContainerTypeRow[]> {
  const [types, sums] = await Promise.all([
    db.containerType.findMany({ orderBy: { nome: "asc" } }),
    db.containerMovement.groupBy({
      by: ["containerTypeId"],
      _sum: { quantidade: true },
    }),
  ]);
  const emCampo = new Map(sums.map((s) => [s.containerTypeId, s._sum.quantidade ?? 0]));

  return types.map((t) => ({
    id: t.id,
    nome: t.nome,
    valorUnitario: t.valorUnitario != null ? Number(t.valorUnitario) : null,
    ativo: t.ativo,
    totalEmCampo: emCampo.get(t.id) ?? 0,
  }));
}

export async function loadContainerBalances(): Promise<ContainerBalanceRow[]> {
  const grouped = await db.containerMovement.groupBy({
    by: ["customerId", "containerTypeId"],
    _sum: { quantidade: true },
    _max: { createdAt: true },
  });
  const comSaldo = grouped.filter((g) => (g._sum.quantidade ?? 0) !== 0);
  if (comSaldo.length === 0) return [];

  const [customers, types] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: [...new Set(comSaldo.map((g) => g.customerId))] } },
      select: { id: true, nome: true },
    }),
    db.containerType.findMany({
      where: { id: { in: [...new Set(comSaldo.map((g) => g.containerTypeId))] } },
      select: { id: true, nome: true },
    }),
  ]);
  const nomeCliente = new Map(customers.map((c) => [c.id, c.nome]));
  const nomeTipo = new Map(types.map((t) => [t.id, t.nome]));

  return comSaldo
    .map((g) => ({
      customerId: g.customerId,
      customerNome: nomeCliente.get(g.customerId) ?? "—",
      containerTypeId: g.containerTypeId,
      containerTypeNome: nomeTipo.get(g.containerTypeId) ?? "—",
      saldo: g._sum.quantidade ?? 0,
      ultimaMovimentacao: (g._max.createdAt ?? new Date()).toISOString(),
    }))
    .sort(
      (a, b) =>
        a.customerNome.localeCompare(b.customerNome) ||
        a.containerTypeNome.localeCompare(b.containerTypeNome),
    );
}

export async function loadCustomerOptions(): Promise<CustomerOption[]> {
  return db.customer.findMany({
    where: { ativo: true },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });
}
