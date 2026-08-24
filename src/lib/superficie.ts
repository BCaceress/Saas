/**
 * Qual superfície o usuário usa neste aparelho: o app completo (`/inicio`) ou a
 * versão mobile (`/m`).
 *
 * Duas fontes, nesta ordem:
 *
 * 1. **Escolha explícita** no cookie `nohub-superficie` (`m` | `app`). Quem
 *    tocou em "ver versão completa" no celular mandou; nada abaixo desfaz isso.
 * 2. **Palpite pelo aparelho** (`ehAparelhoMobile`) quando não há escolha: quem
 *    entra pelo celular ou tablet cai direto no PWA, sem precisar descobrir o
 *    `/m`.
 *
 * O cookie mora no domínio raiz (`.nohub.market`) porque quem escreve é a tela
 * do tenant e quem lê pode ser o login, que roda no domínio raiz.
 *
 * O palpite só decide **redirect de entrada** — login, pós-login OAuth e raiz do
 * subdomínio. Nunca layout: mudar o que a pessoa vê por header variável em rota
 * cacheável é a receita clássica de "meu computador abriu no celular".
 *
 * Módulo sem `server-only` de propósito: o proxy roda fora do runtime de
 * servidor do Next.
 */

export const SUPERFICIE_COOKIE = "nohub-superficie";

/** Valor que indica preferência pela superfície mobile. */
export const SUPERFICIE_MOBILE = "m";
/** Preferência explícita pelo app completo — diferente de "nunca escolheu". */
export const SUPERFICIE_APP = "app";

/** Home de cada superfície. */
export const HOME_MOBILE = "/m";
export const HOME_APP = "/inicio";

/**
 * Domínio do cookie: `.raiz` para a escolha valer no login (domínio raiz) e em
 * todos os subdomínios de tenant. Em `localhost` (sem ponto) fica host-only —
 * navegador nenhum aceita cookie de domínio para host sem ponto.
 */
export function superficieCookieDomain(): string | undefined {
  const root = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000").split(":")[0];
  return root.includes(".") ? `.${root}` : undefined;
}

/** Tablets que se declaram como tal no user-agent. */
const TABLET = /iPad|Tablet|PlayBook|Silk|Kindle|Nexus (?:7|9|10)|Android(?!.*Mobile)/i;

/** Celulares. */
const CELULAR = /Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile Safari/i;

/**
 * O aparelho é de mão (celular OU tablet)?
 *
 * Tablet entra junto com o celular: quem opera de pé na loja usa a mesma tela
 * de polegar, e o app completo num 10" em pé fica apertado. O teste do tablet
 * vem ANTES do `Sec-CH-UA-Mobile` porque o Chrome de tablet Android manda `?0`
 * — a dica só distingue celular de "não celular", não de "não é de mão".
 *
 * Fica de fora o que o servidor não tem como saber: iPad com Safari em modo
 * desktop se anuncia como Macintosh, sem nenhuma pista no cabeçalho. Para esse
 * caso o convite aparece no cliente, onde dá para ler toque e tamanho de tela
 * (ver `components/mobile/oferecer-mobile.tsx`).
 */
export function ehAparelhoMobile(
  userAgent: string | null | undefined,
  chUaMobile?: string | null,
): boolean {
  const ua = userAgent ?? "";
  if (TABLET.test(ua)) return true;

  if (chUaMobile === "?1") return true;
  if (chUaMobile === "?0") return false;

  if (!ua) return false;
  return CELULAR.test(ua);
}

/**
 * Home do aparelho: escolha explícita quando existe, palpite pelo user-agent
 * quando não. Usada nos três pontos de entrada (login por senha, pós-login do
 * Google e raiz do subdomínio).
 */
export function homeDaSuperficie({
  cookie,
  userAgent,
  chUaMobile,
}: {
  cookie?: string | null;
  userAgent?: string | null;
  chUaMobile?: string | null;
}): typeof HOME_MOBILE | typeof HOME_APP {
  if (cookie === SUPERFICIE_MOBILE) return HOME_MOBILE;
  if (cookie === SUPERFICIE_APP) return HOME_APP;
  return ehAparelhoMobile(userAgent, chUaMobile) ? HOME_MOBILE : HOME_APP;
}
