import { requireActiveTenant } from "@/lib/current-tenant";
import { EmpresaClient } from "./_client";

/** Miolo do cadastro da empresa — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoEmpresa() {
  const { tenant } = await requireActiveTenant();
  return (
    <EmpresaClient
      subdomain={tenant.subdomain}
      initial={{
        nome: tenant.nome,
        logoUrl: tenant.logoUrl ?? "",
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
  );
}
