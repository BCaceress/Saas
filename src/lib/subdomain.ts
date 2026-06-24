/**
 * Extração do subdomínio a partir do Host. Compartilhado entre middleware
 * (edge) e código de servidor — função pura, sem dependências de runtime.
 * null = domínio raiz (marketing/auth).
 */
const ROOT = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000";
const ROOT_HOST = ROOT.split(":")[0];

export function getSubdomainFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0];
  if (hostname === ROOT_HOST || hostname === `www.${ROOT_HOST}`) return null;
  if (!hostname.endsWith(`.${ROOT_HOST}`)) return null;
  const sub = hostname.slice(0, -(ROOT_HOST.length + 1));
  if (!sub || sub === "www") return null;
  return sub;
}
