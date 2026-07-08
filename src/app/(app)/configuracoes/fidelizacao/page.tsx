import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { FidelizacaoClient } from "./_client";

export const metadata = { title: "Fidelização — NoHub Market" };

export default async function FidelizacaoPage() {
  const ctx = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/configuracoes"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={15} /> Configurações
        </Link>
        <h1 className="text-xl font-semibold text-ink">Fidelização</h1>
        <p className="text-sm text-muted">
          Defina como os cupons de retorno e aniversário são enviados aos clientes.
        </p>
      </div>
      <FidelizacaoClient
        cupomAutomatico={ctx.tenant.cupomAutomatico}
        cupomDiasRisco={ctx.tenant.cupomDiasRisco}
      />
    </div>
  );
}
