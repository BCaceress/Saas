const ROOT = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000";

function proto(): string {
  return process.env.NODE_ENV === "production" ? "https" : "http";
}

/** URL absoluta no subdomínio do tenant (ex.: http://acme.lvh.me:3000/onboarding). */
export function tenantUrl(subdomain: string, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${proto()}://${subdomain}.${ROOT}${p}`;
}

/** URL absoluta no domínio raiz (marketing/auth). */
export function rootUrl(path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${proto()}://${ROOT}${p}`;
}
