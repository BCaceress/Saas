import { redirect } from "next/navigation";
import { requirePermissao } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { FiscalHeader } from "./_header";

/**
 * Módulo Fiscal. Duas portas: a permissão (`fiscal.ver`) e o toggle do tenant —
 * quem não emite nota não precisa da tela ocupando o menu.
 */
export default async function FiscalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("fiscal.ver");
  if (!ctx.tenant.moduloFiscal) redirect("/configuracoes/modulos");

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
