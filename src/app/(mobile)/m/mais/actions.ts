"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SUPERFICIE_COOKIE,
  SUPERFICIE_APP,
  SUPERFICIE_MOBILE,
  superficieCookieDomain,
} from "@/lib/superficie";

/**
 * Grava a escolha do aparelho.
 *
 * No domínio raiz (`.nohub.market`) porque quem lê pode ser o login, que roda
 * fora do subdomínio do tenant — sem isso, entrar de novo pelo celular
 * devolveria a pessoa para o `/m` que ela acabou de recusar.
 */
async function gravar(valor: typeof SUPERFICIE_APP | typeof SUPERFICIE_MOBILE) {
  const jar = await cookies();
  // Versões antigas gravaram o cookie host-only no subdomínio. Ele tem
  // precedência na leitura e mascararia a escolha nova — some primeiro.
  jar.delete(SUPERFICIE_COOKIE);
  jar.set(SUPERFICIE_COOKIE, valor, {
    path: "/",
    domain: superficieCookieDomain(),
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

// A ação inversa ("usar a versão completa") saiu junto com o botão do `/m/mais`:
// no aparelho de mão o app é o `/m`. Quem precisa da tela de mesa abre pelo
// computador — ou entra por um link direto, que continua funcionando.

/** Passa a abrir no `/m` ao entrar pela raiz do subdomínio. */
export async function usarVersaoMobileAction() {
  await gravar(SUPERFICIE_MOBILE);
  redirect("/m");
}
