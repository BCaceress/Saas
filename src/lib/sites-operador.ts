import "server-only";
import { listSites, type SiteRow } from "@/lib/sites";
import type { Acesso } from "@/lib/permissoes";

/**
 * As lojas em que ESTA pessoa trabalha.
 *
 * `listSites()` devolve todos os locais ativos do tenant — é o que a tela de
 * mesa usa, onde quem administra vê tudo. Aqui o filtro é o acesso: um repositor
 * lotado no depósito não deve nem enxergar a outra unidade no seletor de loja,
 * muito menos passar a operar nela por engano.
 *
 * `siteId: null` num acesso significa "todas as lojas" (é como o administrador
 * é modelado) — nesse caso a lista inteira passa.
 */
export async function sitesDoOperador(acessos: Acesso[]): Promise<SiteRow[]> {
  const sites = await listSites();
  if (acessos.some((a) => a.siteId === null)) return sites;

  const permitidos = new Set(acessos.map((a) => a.siteId).filter((id): id is string => !!id));
  return sites.filter((s) => permitidos.has(s.id));
}
