import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navDescricao } from "@/components/app/nav-config";
import { listarNotasPendentes } from "./_data";
import { FilaRecebimento } from "./_client";
import { RecebimentoAcoes } from "./_acoes";

export const metadata = { title: "Recebimento inteligente" };

export default async function RecebimentoPage() {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "compras.receber")) throw new SemPermissaoError();

  const notas = await withTenant(ctx, listarNotasPendentes);
  const descricao = navDescricao("/recebimento");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Recebimentos"
        icon={navIcon("/recebimento")}
        description={descricao}
        innerClassName="max-w-none"
        actions={<RecebimentoAcoes />}
      />
      <FilaRecebimento notas={notas} />
    </div>
  );
}
