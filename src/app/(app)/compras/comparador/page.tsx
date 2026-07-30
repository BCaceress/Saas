import { requireActiveTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { Comparador } from "./_client";

export default async function ComparadorPage() {
  const ctx = await requireActiveTenant();
  return <Comparador podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")} />;
}
