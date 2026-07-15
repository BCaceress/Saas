import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSaldos } from "./_data";
import { SaldosView, type Filtro } from "./saldos/_client";
import { EstoqueEmpty } from "./_empty";

const FILTROS: readonly string[] = ["todos", "sem", "baixoMinimo", "repor", "pendencias"];

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireActiveTenant();
  // Opções do form de reposição são carregadas sob demanda no client
  // (fetchEntradaFormDataAction) — a página só precisa dos saldos.
  const [siteId, saldos] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return [sid, await loadSaldos(sid)] as const;
  });

  if (saldos.length === 0) return <EstoqueEmpty />;

  // Estado da lista vive na URL (compartilhável, sobrevive a refresh/troca de site).
  const sp = await searchParams;
  const filtro =
    typeof sp.filtro === "string" && FILTROS.includes(sp.filtro) ? (sp.filtro as Filtro) : "todos";
  const q = typeof sp.q === "string" ? sp.q : "";
  const pagina = Math.max(1, Math.floor(Number(typeof sp.pagina === "string" ? sp.pagina : "")) || 1);

  return (
    <SaldosView saldos={saldos} siteId={siteId} initialQ={q} initialFiltro={filtro} initialPage={pagina} />
  );
}
