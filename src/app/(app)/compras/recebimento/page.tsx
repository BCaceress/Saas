import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { listarNotasPendentes } from "./_data";
import { FilaRecebimento } from "./_client";

export const metadata = { title: "Recebimento inteligente" };

export default async function RecebimentoPage() {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "compras.receber")) throw new SemPermissaoError();

  const notas = await withTenant(ctx, listarNotasPendentes);

  return <FilaRecebimento notas={notas} />;
}
