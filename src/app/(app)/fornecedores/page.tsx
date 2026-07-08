import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { FornecedoresManager } from "./_client";

export default async function FornecedoresPage() {
  const ctx = await requireActiveTenant();

  const suppliers = await runWithTenant(ctx.tenant.id, async () => {
    return db.supplier.findMany({ orderBy: { razaoSocial: "asc" } });
  });

  return (
    <div className="flex flex-col gap-5">
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
