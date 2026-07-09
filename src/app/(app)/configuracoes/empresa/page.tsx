import { Building2 } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmpresaClient } from "./_client";

export const metadata = { title: "Empresa — NoHub Market" };

export default async function EmpresaPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Empresa"
        icon={Building2}
        description="Dados do seu mercado: identificação, contato e endereço."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <EmpresaClient
        subdomain={tenant.subdomain}
        initial={{
          nome: tenant.nome,
          razaoSocial: tenant.razaoSocial ?? "",
          cnpj: tenant.cnpj ?? "",
          telefone: tenant.telefone ?? "",
          emailContato: tenant.emailContato ?? "",
          cep: tenant.cep ?? "",
          rua: tenant.rua ?? "",
          numero: tenant.numero ?? "",
          cidade: tenant.cidade ?? "",
          estado: tenant.estado ?? "",
        }}
      />
    </div>
  );
}
