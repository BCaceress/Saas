import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { consultarProdutos, listarVisoes } from "./_query";
import { lerConsulta } from "./_url";
import { ProdutosClient } from "./_client";

export const metadata = { title: "Produtos — NoHub Market" };

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const consulta = lerConsulta(sp, sp.fornecedorId);

  // Só a listagem em si: as opções dos filtros vêm do layout, que não
  // re-renderiza quando muda apenas a query string.
  const [pagina, visoes] = await runWithTenant(ctx.tenant.id, async () => {
    return Promise.all([consultarProdutos(consulta), listarVisoes(ctx.user.id)]);
  });

  return (
    <ProdutosClient
      pagina={pagina}
      visoesIniciais={visoes}
      consultaInicial={consulta}
      initialFornecedorNome={sp.fornecedorNome}
      policy={policyDoTenant(ctx.tenant)}
    />
  );
}
