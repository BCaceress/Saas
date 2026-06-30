import "server-only";
import { db } from "./prisma";
import { runWithTenant, getTenantId } from "./tenant-context";
import { basePrisma } from "./prisma";

/**
 * Job de StockSnapshot (PRD Fase 7 §2/§11). Foto diária do saldo e do valor de
 * estoque por (produto × site). Idempotente por dia: regrava o snapshot de `data`
 * (default hoje) — reprocessável sem duplicar (unique [siteId, productId, data]).
 *
 * Valor de estoque = (fechado + aberto convertido em unidades) × custoMedio.
 * O aberto (ml/g) vira fração de unidade via conteudoPorUnidade.
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v));

function diaUTC(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Captura o snapshot de um tenant (já dentro de runWithTenant). */
export async function snapshotEstoqueTenant(data = new Date()): Promise<number> {
  const dia = diaUTC(data);

  const stocks = await db.stock.findMany({
    select: {
      productId: true,
      siteId: true,
      estoqueFechado: true,
      estoqueAberto: true,
      product: { select: { custoMedio: true, conteudoPorUnidade: true } },
    },
  });

  // Idempotência: limpa o dia e regrava.
  await db.stockSnapshot.deleteMany({ where: { data: dia } });
  const comSite = stocks.filter((s): s is typeof s & { siteId: string } => s.siteId != null);
  if (comSite.length === 0) return 0;

  const tenantId = getTenantId();
  if (!tenantId) throw new Error("snapshotEstoqueTenant: fora do contexto de tenant.");

  const rows = comSite.map((s) => {
    const fechado = num(s.estoqueFechado);
    const aberto = num(s.estoqueAberto);
    const cpu = s.product.conteudoPorUnidade ? num(s.product.conteudoPorUnidade) : null;
    const custoMedio = s.product.custoMedio != null ? num(s.product.custoMedio) : null;
    const unidadesAbertas = cpu && cpu > 0 ? aberto / cpu : 0;
    const valorEstoque =
      custoMedio != null ? Math.round((fechado + unidadesAbertas) * custoMedio * 100) / 100 : null;
    return {
      tenantId,
      siteId: s.siteId,
      productId: s.productId,
      data: dia,
      saldoFechado: fechado,
      saldoAberto: aberto,
      custoMedio,
      valorEstoque,
    };
  });

  await db.stockSnapshot.createMany({ data: rows });
  return rows.length;
}

/** Roda o snapshot para TODOS os tenants ativos. Usado pelo job agendado. */
export async function snapshotEstoqueTodos(data = new Date()): Promise<{ tenants: number; linhas: number }> {
  const tenants = await basePrisma.tenant.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE"] } },
    select: { id: true },
  });

  let linhas = 0;
  for (const t of tenants) {
    linhas += await runWithTenant(t.id, () => snapshotEstoqueTenant(data));
  }
  return { tenants: tenants.length, linhas };
}
