import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { getSubdomainFromHost } from "./lib/subdomain";

const { auth } = NextAuth(authConfig);

const ROOT = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000";

/**
 * Resolve domínio raiz vs. subdomínio do tenant. NÃO reescreve o path (rewrite
 * que troca o caminho quebra a hidratação do App Router). As rotas do app vivem
 * em grupos de rota `(app)` no mesmo path da URL; o tenant é resolvido pelo Host
 * no servidor (lib/current-tenant). Aqui só fazemos auth-gate e o redirect raiz.
 */
export default auth((req) => {
  const host = req.headers.get("host") ?? "";
  const sub = getSubdomainFromHost(host);
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // Domínio raiz: landing + auth. Sem gate.
  if (!sub) return NextResponse.next();

  // Subdomínio = app do tenant. Páginas de auth não existem aqui → manda à raiz.
  if (pathname === "/login" || pathname === "/cadastro") {
    return NextResponse.redirect(new URL(`${req.nextUrl.protocol}//${ROOT}${pathname}`));
  }

  // Exige sessão para o app.
  if (!isLoggedIn) {
    const proto = req.nextUrl.protocol;
    const loginUrl = new URL(`${proto}//${ROOT}/login`);
    loginUrl.searchParams.set("callbackUrl", `${proto}//${host}${pathname}`);
    return NextResponse.redirect(loginUrl);
  }

  // Raiz do subdomínio → home do app (dashboard).
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/inicio", req.url));
  }

  return NextResponse.next();
});

export const config = {
  // Tudo, menos assets/HMR do Next e o endpoint do Auth.js.
  matcher: ["/((?!_next|favicon.ico|api/auth).*)"],
};
