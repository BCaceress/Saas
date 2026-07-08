import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { Scale } from "lucide-react";
import { db } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { FiscalManager } from "./_client";

export default async function ClassificacaoFiscalPage() {
  const ctx = await requireActiveTenant();

  const [fiscalProfiles, categories] = await runWithTenant(ctx.tenant.id, async () => {
    return Promise.all([
      db.fiscalProfile.findMany({ orderBy: { nome: "asc" } }),
      db.category.findMany({
        orderBy: { nome: "asc" },
        include: { subcategories: { orderBy: { nome: "asc" } } },
      }),
    ]);
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Classificação fiscal"
        icon={Scale}
        description="Perfis fiscais (NCM/CEST) e o vínculo padrão de cada subcategoria."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <FiscalManager
        fiscalProfiles={fiscalProfiles.map((f) => ({
          id: f.id,
          nome: f.nome,
          ncm: f.ncm,
          cest: f.cest,
          origem: f.origem,
          csosn: f.csosn,
          cst: f.cst,
          cstPis: f.cstPis,
          cstCofins: f.cstCofins,
          aliquotaIcms: f.aliquotaIcms ? f.aliquotaIcms.toNumber() : null,
          temSt: f.temSt,
          precisaRevisao: f.precisaRevisao,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          nome: c.nome,
          subcategorias: c.subcategories.map((s) => ({
            id: s.id,
            nome: s.nome,
            ativo: s.ativo,
            defaultFiscalProfileId: s.defaultFiscalProfileId,
          })),
        }))}
      />
    </div>
  );
}
