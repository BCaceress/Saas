"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { sitesDoOperador } from "@/lib/sites-operador";
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

// A ação inversa ("usar a versão completa") saiu junto com o botão do `/m/menu`:
// no aparelho de mão o app é o `/m`. Quem precisa da tela de mesa abre pelo
// computador — ou entra por um link direto, que continua funcionando.

/** Passa a abrir no `/m` ao entrar pela raiz do subdomínio. */
export async function usarVersaoMobileAction() {
  await gravar(SUPERFICIE_MOBILE);
  redirect("/m");
}

// ── Loja ativa ──────────────────────────────────────────────

const siteSchema = z.object({ siteId: z.string().min(1) });

/**
 * Troca a loja em que o celular está operando.
 *
 * Existia só na tela de mesa (`setSiteAction`), e o `/m` inteiro lê
 * `getActiveSiteId()`: quem opera em duas unidades ficava preso na loja que o
 * computador escolheu — ou na mais antiga, se ninguém nunca escolheu. Contar
 * prateleira da loja B com o saldo da loja A na tela é erro de estoque, não
 * incômodo de navegação.
 *
 * Valida do lado do servidor que a loja existe, está ativa e é uma das que a
 * PESSOA acessa: o cookie é editável pelo navegador, e sem esta checagem ele
 * viraria uma porta para operar numa unidade sem permissão.
 */
export async function trocarSiteAction(entrada: { siteId: string }) {
  const { siteId } = siteSchema.parse(entrada);
  const ctx = await requireActiveTenant();

  const permitida = await withTenant(ctx, async () => {
    const sites = await sitesDoOperador(ctx.acessos);
    return sites.some((s) => s.id === siteId);
  });
  if (!permitida) throw new Error("Você não tem acesso a esta loja.");

  const jar = await cookies();
  jar.set("nohub-site", siteId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  // A superfície inteira lê o site ativo no servidor — saldo, contagem, vendas,
  // pedidos. Revalidar só a tela do menu deixaria as outras com o dado velho.
  revalidatePath("/m", "layout");
}
