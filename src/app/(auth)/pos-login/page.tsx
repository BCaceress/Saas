import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { basePrisma } from "@/lib/prisma";
import { tenantUrl, rootUrl } from "@/lib/urls";

/**
 * Roteador pós-login OAuth: descobre o tenant do usuário (provisionado no
 * evento createUser) e manda para o subdomínio — onboarding ou produtos.
 */
export default async function PosLoginPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const membership = await basePrisma.membership.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { tenant: { select: { subdomain: true, onboardingDone: true } } },
  });

  if (!membership) {
    // Provisionamento ainda não concluiu (raro). Volta ao login para tentar de novo.
    redirect(rootUrl("/login"));
  }

  const { subdomain, onboardingDone } = membership.tenant;
  redirect(tenantUrl(subdomain, onboardingDone ? "/inicio" : "/onboarding"));
}
