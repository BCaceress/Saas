import "server-only";
import { db } from "@/lib/prisma";
import type { Customer } from "@/generated/prisma";
import type { CustomerRow, CustomerInsights, CouponCandidate } from "./_types";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const DIA = 86_400_000;

/** Só vendas efetivadas contam para fidelização. */
const PAGA = { status: "PAGA" as const };

/**
 * Lista de clientes com total gasto e última compra agregados das vendas.
 * Assume contexto de tenant ativo (runWithTenant no chamador).
 */
export async function loadCustomerRows(): Promise<CustomerRow[]> {
  const [customers, agg] = await Promise.all([
    db.customer.findMany({ orderBy: { nome: "asc" } }),
    db.sale.groupBy({
      by: ["customerId"],
      where: { ...PAGA, customerId: { not: null } },
      _sum: { total: true },
      _max: { paidAt: true },
    }),
  ]);

  const map = new Map(
    agg.map((a) => [
      a.customerId as string,
      { total: num(a._sum.total), ultima: a._max.paidAt },
    ]),
  );

  return customers.map((c) => toCustomerRow(c, map.get(c.id)));
}

function toCustomerRow(
  c: Customer,
  stats?: { total: number; ultima: Date | null },
): CustomerRow {
  return {
    id: c.id,
    nome: c.nome,
    cpf: c.cpf,
    dataNascimento: c.dataNascimento ? c.dataNascimento.toISOString() : null,
    sexo: c.sexo,
    whatsapp: c.whatsapp,
    pontos: c.pontos,
    ativo: c.ativo,
    createdAt: c.createdAt.toISOString(),
    totalGasto: stats?.total ?? 0,
    ultimaCompra: stats?.ultima ? stats.ultima.toISOString() : null,
  };
}

/** Métricas ao vivo de um cliente. Assume contexto de tenant ativo. */
export async function computeInsights(customerId: string): Promise<CustomerInsights> {
  const [sales, favAgg] = await Promise.all([
    db.sale.findMany({
      where: { ...PAGA, customerId },
      select: { total: true, paidAt: true },
      orderBy: { paidAt: "desc" },
    }),
    db.saleItem.groupBy({
      by: ["productId"],
      where: { sale: { ...PAGA, customerId } },
      _sum: { quantidade: true },
      orderBy: { _sum: { quantidade: "desc" } },
      take: 4,
    }),
  ]);

  const totalGasto = sales.reduce((s, v) => s + num(v.total), 0);
  const visitas = sales.length;
  const ticketMedio = visitas > 0 ? totalGasto / visitas : 0;
  const ultimaCompra = sales[0]?.paidAt ?? null;

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const visitasMes = sales.filter((s) => s.paidAt && s.paidAt >= inicioMes).length;

  const diasSemComprar = ultimaCompra
    ? Math.floor((Date.now() - ultimaCompra.getTime()) / DIA)
    : null;

  const prodIds = favAgg.map((f) => f.productId);
  const prods = prodIds.length
    ? await db.product.findMany({
        where: { id: { in: prodIds } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeById = new Map(prods.map((p) => [p.id, p.nome]));
  const produtosFavoritos = favAgg.map((f) => ({
    nome: nomeById.get(f.productId) ?? "Produto",
    vezes: Math.round(num(f._sum.quantidade)),
  }));

  return {
    totalGasto,
    ticketMedio,
    visitas,
    visitasMes,
    ultimaCompra: ultimaCompra ? ultimaCompra.toISOString() : null,
    diasSemComprar,
    produtosFavoritos,
  };
}

/**
 * Detecta clientes que merecem cupom: em risco (ativos que pararam de comprar)
 * e aniversariantes (hoje/amanhã). Marca quem já recebeu cupom do tipo nos
 * últimos 7 dias para evitar reenvio. Assume contexto de tenant ativo.
 */
export async function loadCouponCandidates(diasRisco: number): Promise<CouponCandidate[]> {
  const [customers, vendasAgg, cuponsRecentes] = await Promise.all([
    db.customer.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, whatsapp: true, dataNascimento: true },
    }),
    db.sale.groupBy({
      by: ["customerId"],
      where: { ...PAGA, customerId: { not: null } },
      _max: { paidAt: true },
      _count: { _all: true },
    }),
    db.couponSend.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * DIA) } },
      select: { customerId: true, motivo: true },
    }),
  ]);

  const ultimaById = new Map(
    vendasAgg.map((a) => [
      a.customerId as string,
      { ultima: a._max.paidAt, compras: a._count._all },
    ]),
  );
  const enviadoRisco = new Set(
    cuponsRecentes.filter((c) => c.motivo === "RISCO").map((c) => c.customerId),
  );
  const enviadoAniv = new Set(
    cuponsRecentes.filter((c) => c.motivo === "ANIVERSARIO").map((c) => c.customerId),
  );

  const hoje = new Date();
  const candidates: CouponCandidate[] = [];

  for (const c of customers) {
    // Aniversário: hoje ou amanhã (compara dia/mês).
    if (c.dataNascimento) {
      const nasc = c.dataNascimento;
      for (const offset of [0, 1]) {
        const alvo = new Date(hoje);
        alvo.setDate(hoje.getDate() + offset);
        if (nasc.getUTCDate() === alvo.getDate() && nasc.getUTCMonth() === alvo.getMonth()) {
          candidates.push({
            customerId: c.id,
            nome: c.nome,
            whatsapp: c.whatsapp,
            tipo: "ANIVERSARIO",
            aniversario: `${String(nasc.getUTCDate()).padStart(2, "0")}/${String(nasc.getUTCMonth() + 1).padStart(2, "0")}`,
            jaEnviado: enviadoAniv.has(c.id),
          });
          break;
        }
      }
    }

    // Risco: já comprou alguma vez e a última compra passou do limite.
    const stats = ultimaById.get(c.id);
    if (stats?.ultima && stats.compras > 0) {
      const dias = Math.floor((Date.now() - stats.ultima.getTime()) / DIA);
      if (dias >= diasRisco) {
        candidates.push({
          customerId: c.id,
          nome: c.nome,
          whatsapp: c.whatsapp,
          tipo: "RISCO",
          dias,
          jaEnviado: enviadoRisco.has(c.id),
        });
      }
    }
  }

  // Aniversário primeiro, depois risco por dias desc.
  return candidates.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === "ANIVERSARIO" ? -1 : 1;
    return (b.dias ?? 0) - (a.dias ?? 0);
  });
}
