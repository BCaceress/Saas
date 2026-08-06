"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SUPERFICIE_COOKIE } from "@/lib/superficie";

/**
 * Sai da superfície mobile e volta ao app completo.
 *
 * Limpar o cookie é o que faz a raiz do subdomínio parar de cair no `/m` na
 * próxima vez — sem isso, "ver versão completa" duraria até o próximo toque no
 * ícone do app.
 */
export async function usarVersaoCompletaAction() {
  (await cookies()).delete(SUPERFICIE_COOKIE);
  redirect("/inicio");
}

/** Passa a abrir no `/m` ao entrar pela raiz do subdomínio. */
export async function usarVersaoMobileAction() {
  (await cookies()).set(SUPERFICIE_COOKIE, "m", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  redirect("/m");
}
