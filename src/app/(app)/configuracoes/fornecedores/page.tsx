import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { FornecedoresManager } from "./_client";

export default async function FornecedoresPage() {
  const ctx = await requireActiveTenant();

  const suppliers = await runWithTenant(ctx.tenant.id, async () => {
    return db.supplier.findMany({ orderBy: { razaoSocial: "asc" } });
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Configurações"
        title="Fornecedores"
        description="Cadastre e gerencie os fornecedores da sua operação."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <FornecedoresManager
        suppliers={suppliers.map((s) => ({
          id: s.id,
          cnpj: s.cnpj,
          razaoSocial: s.razaoSocial,
          nomeFantasia: s.nomeFantasia,
          email: s.email,
          telefone: s.telefone,
          nomeContatoPrincipal: s.nomeContatoPrincipal,
          website: s.website,
          cep: s.cep,
          logradouro: s.logradouro,
          numero: s.numero,
          complemento: s.complemento,
          bairro: s.bairro,
          municipio: s.municipio,
          uf: s.uf,
          ativo: s.ativo,
        }))}
      />
    </div>
  );
}
