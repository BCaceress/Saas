import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { loadSaldos, loadLocaisArmazenagem } from "./_data";
import { filtroValido } from "./_filtros";
import { SaldosView } from "./saldos/_client";
import { EstoqueEmpty } from "./_empty";

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireActiveTenant();
  const policy = policyDoTenant(ctx.tenant);
  // Opções do form de reposição são carregadas sob demanda no client
  // (fetchEntradaFormDataAction) — a página só precisa dos saldos.
  const [siteId, saldos, locais] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const [s, l] = await Promise.all([loadSaldos(sid, policy), loadLocaisArmazenagem(sid)]);
    return [sid, s, l] as const;
  });

  if (saldos.length === 0) return <EstoqueEmpty />;

  // Estado da lista vive na URL (compartilhável, sobrevive a refresh/troca de site).
  const sp = await searchParams;
  // Saneado pela estratégia: link com filtro de outra régua cai em "todos" em
  // vez de devolver lista vazia sem explicação.
  const filtro = filtroValido(sp.filtro, policy);
  const q = typeof sp.q === "string" ? sp.q : "";
  const pagina = Math.max(1, Math.floor(Number(typeof sp.pagina === "string" ? sp.pagina : "")) || 1);

  return (
    <SaldosView
      saldos={saldos}
      policy={policy}
      siteId={siteId}
      locais={locais}
      initialQ={q}
      initialFiltro={filtro}
      initialPage={pagina}
    />
  );
}
