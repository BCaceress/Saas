import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { MapPin } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SitesManager } from "./_client";
import { DistribuicaoConfig } from "./_distribuicao-config";

export default async function SitesPage() {
  const ctx = await requireActiveTenant();
  const [sites, rawLocations] = await runWithTenant(ctx.tenant.id, async () => {
    return Promise.all([
      db.site.findMany({ orderBy: { createdAt: "asc" } }),
      db.storageLocation.findMany({
        orderBy: { nome: "asc" },
        include: { _count: { select: { stocks: true } } },
      }),
    ]);
  });

  const storageLocations = rawLocations.map((l) => ({
    id: l.id,
    nome: l.nome,
    tipo: l.tipo as "AMBIENTE" | "REFRIGERADO" | "CONGELADO",
    siteId: l.siteId,
    ativo: l.ativo,
    stockCount: l._count.stocks,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Lojas e pontos"
        icon={MapPin}
        description="Lojas, pontos autônomos e centros de distribuição do tenant."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <DistribuicaoConfig
        topologiaInicial={ctx.tenant.topologia ?? "LOCAL"}
        recebimentoInicial={ctx.tenant.recebimentoExigeContagem}
      />
      <SitesManager
        sites={sites.map((s) => ({
          id: s.id,
          nome: s.nome,
          tipo: s.tipo,
          ativo: s.ativo,
          cep: s.cep,
          rua: s.rua,
          numero: s.numero,
          cidade: s.cidade,
          estado: s.estado,
          estoquePropio: s.estoquePropio,
          cdAbastecedorId: s.cdAbastecedorId,
          controleIdade: s.controleIdade,
        }))}
        allSites={sites.map((s) => ({
          id: s.id,
          nome: s.nome,
          tipo: s.tipo,
          ativo: s.ativo,
        }))}
        locations={storageLocations}
      />
    </div>
  );
}
