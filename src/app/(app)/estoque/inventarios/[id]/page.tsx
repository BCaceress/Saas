import { notFound, redirect } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { listSites } from "@/lib/sites";
import { loadInventario } from "../../_data";
import { ContagemView } from "../_contagem";

export const metadata = { title: "Contagem de inventário — NoHub Market" };

export default async function ContagemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const { inventario, multiSite } = await withTenant(ctx, async () => {
    const [inv, sites] = await Promise.all([loadInventario(id), listSites()]);
    return { inventario: inv, multiSite: sites.length > 1 };
  });

  if (!inventario) notFound();
  // Só a contagem em andamento tem tela própria; o resto vive na lista.
  if (inventario.status !== "ABERTO") redirect("/estoque/inventarios");

  return (
    <ContagemView
      inventario={{
        ...inventario,
        dataProgramada: inventario.dataProgramada.toISOString(),
        createdAt: inventario.createdAt.toISOString(),
        iniciadoEm: inventario.iniciadoEm?.toISOString() ?? null,
        fechadoEm: inventario.fechadoEm?.toISOString() ?? null,
      }}
      multiSite={multiSite}
    />
  );
}
