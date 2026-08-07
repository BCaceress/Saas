/**
 * Qual superfície o usuário usa neste aparelho: o app completo (`/inicio`) ou a
 * versão mobile (`/m`).
 *
 * Duas fontes, nesta ordem:
 *
 * 1. **Escolha explícita** no cookie `nohub-superficie` (`m` | `app`). Quem
 *    tocou em "ver versão completa" no celular mandou; nada abaixo desfaz isso.
 * 2. **Palpite pelo aparelho** (`ehAparelhoMobile`) quando não há escolha: quem
 *    entra pelo celular cai direto no PWA, sem precisar descobrir o `/m`.
 *
 * O cookie mora no domínio raiz (`.nohub.market`) porque quem escreve é a tela
 * do tenant e quem lê pode ser o login, que roda no domínio raiz.
 *
 * O palpite só decide **redirect de entrada** — login, pós-login OAuth e raiz do
 * subdomínio. Nunca layout: mudar o que a pessoa vê por header variável em rota
 * cacheável é a receita clássica de "meu computador abriu no celular".
 *
 * Módulo sem `server-only` de propósito: o middleware roda fora do runtime de
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

/**
 * O aparelho é um celular?
 *
 * `Sec-CH-UA-Mobile` manda quando existe (Chrome/Edge): é declaração do próprio
 * browser, não adivinhação de string. Safari e Firefox não mandam — aí sobra o
 * user-agent.
 *
 * Tablet conta como desktop de propósito: o app completo cabe em 10", e o iPad
 * moderno se anuncia como Macintosh de qualquer jeito.
 */
export function ehAparelhoMobile(
  userAgent: string | null | undefined,
  chUaMobile?: string | null,
): boolean {
  if (chUaMobile === "?1") return true;
  if (chUaMobile === "?0") return false;

  const ua = userAgent ?? "";
  if (!ua) return false;
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return false;
  return /Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile Safari/i.test(ua);
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
