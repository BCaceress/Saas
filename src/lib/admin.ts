import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

// ============================================================
// Back-office da NoHub (não do lojista).
//
// Quem entra aqui vê e mexe em TODOS os tenants — é o único lugar do sistema
// que atravessa a fronteira multi-tenant de propósito. Por isso o acesso não
// vem de perfil no banco (que um admin de loja poderia se conceder), e sim de
// uma allowlist em variável de ambiente: mudar quem é da equipe exige deploy,
// não um UPDATE.
// ============================================================

function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function ehSuperAdmin(): Promise<boolean> {
  const lista = allowlist();
  if (lista.length === 0) return false; // sem allowlist, ninguém entra

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return !!email && lista.includes(email);
}

/** Exige equipe NoHub. Manda para o login em vez de contar que a rota existe. */
export async function requireSuperAdmin(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();

  if (!email || !allowlist().includes(email)) {
    redirect("/login?callbackUrl=/admin");
  }
  return { email };
}

/** Versão para Server Action: lança em vez de navegar. */
export async function assertSuperAdmin(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !allowlist().includes(email)) {
    throw new Error("Ação restrita à equipe NoHub.");
  }
  return email;
}
