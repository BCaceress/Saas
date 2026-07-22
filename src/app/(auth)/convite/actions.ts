"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { basePrisma } from "@/lib/prisma";
import { criarMembershipDoConvite } from "@/lib/convites";
import { tenantUrl } from "@/lib/urls";

export type ConviteState = { error?: string } | undefined;

/**
 * Aceita o convite do usuário JÁ logado. O e-mail da sessão precisa bater com o
 * do convite — senão o link viraria porta de entrada para qualquer conta.
 */
export async function aceitarConviteAction(
  _prev: ConviteState,
  formData: FormData,
): Promise<ConviteState> {
  const token = String(formData.get("token") ?? "");
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email?.toLowerCase().trim();
  if (!userId || !email) return { error: "Entre na sua conta para aceitar o convite." };

  const inv = await basePrisma.invite.findUnique({
    where: { token },
    include: { tenant: { select: { subdomain: true, onboardingDone: true } } },
  });
  if (!inv) return { error: "Convite inválido ou já usado." };
  if (inv.expiresAt.getTime() < Date.now()) {
    return { error: "Convite vencido. Peça um link novo a quem administra a conta." };
  }
  if (inv.email.toLowerCase() !== email) {
    return { error: `Este convite é para ${inv.email}. Entre com essa conta para aceitar.` };
  }

  const jaMembro = await basePrisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId: inv.tenantId } },
    select: { id: true },
  });

  await basePrisma.$transaction(async (tx) => {
    // Já fazia parte: só consome o convite, sem duplicar acessos.
    if (!jaMembro) await criarMembershipDoConvite(tx, userId, inv);
    await tx.invite.deleteMany({ where: { id: inv.id } });
  });

  redirect(tenantUrl(inv.tenant.subdomain, inv.tenant.onboardingDone ? "/inicio" : "/onboarding"));
}

/** Sair para poder aceitar com a conta certa. Volta para o mesmo convite. */
export async function trocarDeContaAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await signOut({ redirectTo: `/convite/${token}` });
}
