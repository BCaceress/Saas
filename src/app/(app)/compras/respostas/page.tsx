import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadRespostas } from "./_data";
import { CentralRespostas } from "./_client";

export const metadata = { title: "Respostas — Compras" };

export default async function RespostasPage() {
  const ctx = await requireActiveTenant();
  const { linhas, resumo } = await withTenant(ctx, () => loadRespostas());

  return <CentralRespostas linhas={linhas} resumo={resumo} />;
}
