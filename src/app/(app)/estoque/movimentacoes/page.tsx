import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadMovimentacoes } from "../_data";
import { MovimentacoesView } from "./_client";

export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;

  const dias = sp.periodo === "tudo" ? null : Number.parseInt(sp.periodo ?? "7", 10);

  const data = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return loadMovimentacoes(sid, {
      q: sp.q,
      chip: sp.tipo,
      dias: Number.isNaN(dias as number) ? 7 : dias,
      origem: sp.origem,
      responsavel: sp.resp,
      pagina: Number.parseInt(sp.pagina ?? "1", 10) || 1,
      porPagina: Number.parseInt(sp.pp ?? "100", 10) || 100,
    });
  });

  return (
    <MovimentacoesView
      rows={data.rows}
      total={data.total}
      pagina={data.pagina}
      porPagina={data.porPagina}
      responsaveis={data.responsaveis}
      filtros={{
        q: sp.q ?? "",
        tipo: sp.tipo ?? "todos",
        periodo: sp.periodo ?? "7",
        origem: sp.origem ?? "",
        resp: sp.resp ?? "",
      }}
    />
  );
}
