/**
 * Qual superfície o usuário escolheu para este aparelho: o app completo
 * (`/inicio`) ou a versão mobile (`/m`).
 *
 * Mora num cookie porque quem lê primeiro é o middleware, na raiz do
 * subdomínio — antes de qualquer React rodar. É lido em UM lugar só
 * (`middleware.ts`, no `pathname === "/"`), nunca para decidir layout: a
 * escolha muda para onde a pessoa cai ao abrir o app, não o que ela vê depois.
 *
 * A decisão NÃO é automática por user-agent. Safari e Firefox não mandam
 * `Sec-CH-UA-Mobile`, iPad se declara desktop, e redirect que depende de header
 * variável em rota cacheável é fonte clássica de "meu computador abriu no
 * celular". Quem escolhe é a pessoa; o PWA instalado já entra pelo `/m` por
 * causa do `start_url` do manifest.
 *
 * Módulo sem `server-only` de propósito: o middleware roda fora do runtime de
 * servidor do Next.
 */

export const SUPERFICIE_COOKIE = "nohub-superficie";

/** Valor que indica preferência pela superfície mobile. */
export const SUPERFICIE_MOBILE = "m";
