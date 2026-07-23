import { redirect } from "next/navigation";
import { requirePermissao } from "@/lib/guard";
import { featureAtiva, temFeature } from "@/lib/planos";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { FiscalHeader } from "./_header";

/**
 * Módulo Fiscal. Três portas: a permissão (`fiscal.ver`), o add-on contratado e
 * o toggle do tenant — quem não emite nota não precisa da tela ocupando o menu.
 * Sem o add-on manda para planos (é venda); com ele e sem toggle, para módulos.
 */
export default async function FiscalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("fiscal.ver");
  if (!featureAtiva(ctx.tenant, "fiscal")) {
    redirect(
      temFeature(ctx.tenant, "fiscal") ? "/configuracoes/modulos" : "/configuracoes/plano",
    );
  }

  const cfg = await runWithTenant(ctx.tenant.id, () =>
    db.fiscalConfig.findFirst({ select: { ambiente: true, ativo: true } }),
  );

  return (
    <div className="flex flex-col gap-5">
      <FiscalHeader ambiente={cfg?.ativo ? cfg.ambiente : null} />
      {children}
    </div>
  );
}
