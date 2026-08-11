import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { getSubdomainFromHost } from "./lib/subdomain";
import { SUPERFICIE_COOKIE, homeDaSuperficie } from "./lib/superficie";

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

  // Back-office da equipe vive só no domínio raiz. No subdomínio, /admin é uma
  // rota do tenant que não existe — mandar para a raiz evita que a tela da
  // NoHub apareça pendurada no endereço de um cliente.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return NextResponse.redirect(new URL(`${req.nextUrl.protocol}//${ROOT}${pathname}`));
  }

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

  // Raiz do subdomínio → home do app. Qual home: a escolha do aparelho quando
  // existe, senão o palpite pelo user-agent (ver lib/superficie). É redirect,
  // não rewrite: o path final é real, então nada aqui esbarra na restrição de
  // hidratação explicada acima.
  if (pathname === "/") {
    const home = homeDaSuperficie({
      cookie: req.cookies.get(SUPERFICIE_COOKIE)?.value,
      userAgent: req.headers.get("user-agent"),
      chUaMobile: req.headers.get("sec-ch-ua-mobile"),
    });
    return NextResponse.redirect(new URL(home, req.url));
  }

  return NextResponse.next();
});

export const config = {
  // Tudo, menos assets/HMR do Next, o endpoint do Auth.js e os arquivos do PWA.
  //
  // Manifest, service worker, página offline e ícones PRECISAM ficar de fora: o
  // browser busca o manifest sem credenciais, então no subdomínio ele cairia no
  // gate de sessão acima, receberia o redirect para o /login do domínio raiz e o
  // app deixaria de ser instalável. Mesma história para o registro do SW num
  // aparelho com a sessão expirada.
  // `wasm/` é o leitor de código de barras (biblioteca aberta, zero dado de
  // tenant). Ficando dentro do gate, o binário viraria um redirect para o
  // login e o scanner do iOS não carregaria.
  // `totem/manifest.webmanifest` é o manifest do quiosque (app instalável
  // separado, em tela cheia) e segue a mesma regra do manifest principal.
  matcher: [
    "/((?!_next|favicon.ico|manifest.webmanifest|totem/manifest.webmanifest|sw.js|offline.html|icons/|wasm/|apple-touch-icon.png|api/auth).*)",
  ],
};
