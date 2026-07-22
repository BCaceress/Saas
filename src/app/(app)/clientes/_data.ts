import "server-only";
import { db } from "@/lib/prisma";
import type { Customer } from "@/generated/prisma";
import type { CustomerRow, CustomerInsights, CouponCandidate, ComprasPorDia } from "./_types";

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
    email: c.email,
    cnpj: c.cnpj,
    razaoSocial: c.razaoSocial,
    ie: c.ie,
    indicadorIE: c.indicadorIE,
    cep: c.cep,
    logradouro: c.logradouro,
    numero: c.numero,
    complemento: c.complemento,
    bairro: c.bairro,
    municipio: c.municipio,
    codigoMunicipio: c.codigoMunicipio,
    uf: c.uf,
    totalGasto: stats?.total ?? 0,
    ultimaCompra: stats?.ultima ? stats.ultima.toISOString() : null,
  };
}

/** Métricas ao vivo de um cliente. Assume contexto de tenant ativo. */
export async function computeInsights(customerId: string): Promise<CustomerInsights> {
  const [sales, recentSales] = await Promise.all([
    db.sale.findMany({
      where: { ...PAGA, customerId },
      select: { total: true, paidAt: true },
      orderBy: { paidAt: "desc" },
    }),
    db.sale.findMany({
      where: { ...PAGA, customerId },
      select: { paidAt: true, items: { select: { productId: true, quantidade: true } } },
      orderBy: { paidAt: "desc" },
      take: 8,
    }),
  ]);

  const totalGasto = sales.reduce((s, v) => s + num(v.total), 0);
  const visitas = sales.length;
  const ticketMedio = visitas > 0 ? totalGasto / visitas : 0;
  const ultimaCompra = sales[0]?.paidAt ?? null;
  const valorUltimaCompra = sales[0] ? num(sales[0].total) : null;

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const inicioMesAnterior = new Date(inicioMes);
  inicioMesAnterior.setMonth(inicioMesAnterior.getMonth() - 1);

  const vendasMes = sales.filter((s) => s.paidAt && s.paidAt >= inicioMes);
  const vendasMesAnterior = sales.filter(
    (s) => s.paidAt && s.paidAt >= inicioMesAnterior && s.paidAt < inicioMes,
  );
  const visitasMes = vendasMes.length;
  const visitasMesAnterior = vendasMesAnterior.length;
  const gastoMes = vendasMes.reduce((s, v) => s + num(v.total), 0);
  const gastoMesAnterior = vendasMesAnterior.length
    ? vendasMesAnterior.reduce((s, v) => s + num(v.total), 0)
    : null;

  const diasSemComprar = ultimaCompra
    ? Math.floor((Date.now() - ultimaCompra.getTime()) / DIA)
    : null;

  const datasOrdenadas = sales
    .map((s) => s.paidAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  const frequenciaMediaDias =
    datasOrdenadas.length >= 2
      ? Math.round(
          (datasOrdenadas[datasOrdenadas.length - 1].getTime() - datasOrdenadas[0].getTime()) /
            DIA /
            (datasOrdenadas.length - 1),
        )
      : null;

  const prodIds = [...new Set(recentSales.flatMap((s) => s.items.map((i) => i.productId)))];
  const prods = prodIds.length
    ? await db.product.findMany({
        where: { id: { in: prodIds } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeById = new Map(prods.map((p) => [p.id, p.nome]));

  const porDia = new Map<string, ComprasPorDia>();
  for (const s of recentSales) {
    if (!s.paidAt) continue;
    const chave = s.paidAt.toISOString().slice(0, 10);
    const grupo = porDia.get(chave) ?? { data: s.paidAt.toISOString(), itens: [] };
    for (const item of s.items) {
      const nome = nomeById.get(item.productId) ?? "Produto";
      const existente = grupo.itens.find((i) => i.nome === nome);
      if (existente) existente.vezes += Math.round(num(item.quantidade));
      else grupo.itens.push({ nome, vezes: Math.round(num(item.quantidade)) });
    }
    porDia.set(chave, grupo);
  }
  const comprasRecentes = [...porDia.values()].slice(0, 4);

  return {
    totalGasto,
    ticketMedio,
    visitas,
    visitasMes,
    visitasMesAnterior,
    ultimaCompra: ultimaCompra ? ultimaCompra.toISOString() : null,
    valorUltimaCompra,
    diasSemComprar,
    gastoMes,
    gastoMesAnterior,
    frequenciaMediaDias,
    comprasRecentes,
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
