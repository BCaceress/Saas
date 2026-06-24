import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { requireActiveTenant } from "@/lib/current-tenant";
import { OnboardingWizard } from "./_wizard";

export const metadata = { title: "Setup — NoHub Market" };

export default async function OnboardingPage() {
  const ctx = await requireActiveTenant();
  if (ctx.tenant.onboardingDone) redirect("/produtos");

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line px-5 py-4">
        <Logo />
      </header>
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <OnboardingWizard nomeAtual={ctx.tenant.nome} />
      </div>
    </div>
  );
}
