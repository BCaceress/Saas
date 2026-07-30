import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadHistorico } from "../_catalogo/data";
import { HistoricoPrecos } from "./_client";

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const dias = [7, 30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : 30;

  const { linhas, resumo } = await withTenant(ctx, () => loadHistorico(dias));

  return <HistoricoPrecos linhas={linhas} resumo={resumo} dias={dias} />;
}
