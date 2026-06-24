import Link from "next/link";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadEntradas } from "../_data";
import { Plus, PackagePlus } from "lucide-react";
import { EntradasList } from "./_client";

export default async function EntradasPage() {
  const ctx = await requireActiveTenant();
  const [, entradas] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const e = await loadEntradas(sid);
    return [sid, e] as const;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Registro de entradas no estoque.</p>
        <Link
          href="/estoque/entradas/nova"
          className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <Plus size={16} /> Registrar entrada
        </Link>
      </div>

      {entradas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <PackagePlus size={36} className="text-faint" />
          <p className="text-sm font-medium text-muted">Nenhuma entrada registrada.</p>
          <Link
            href="/estoque/entradas/nova"
            className="mt-1 flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={14} /> Registrar primeira entrada
          </Link>
        </div>
      ) : (
        <EntradasList entradas={entradas} />
      )}
    </div>
  );
}
