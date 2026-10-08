import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { camposDoTenant } from "@/lib/cadastro-campos";
import { consultarProdutos } from "./_query";
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
  const campos = camposDoTenant(ctx.tenant);
  const consulta = lerConsulta(sp, sp.fornecedorId);

  // Campo desligado não filtra: link antigo (ou favorito do navegador) com
  // `?marca=` esconderia produtos por um critério que a tela não mostra mais.
  if (!campos.marca) consulta.marca = "";

  // Só a listagem em si: as opções dos filtros vêm do layout, que não
  // re-renderiza quando muda apenas a query string.
  const pagina = await runWithTenant(ctx.tenant.id, () => consultarProdutos(consulta));

  return (
    <ProdutosClient
      pagina={pagina}
      consultaInicial={consulta}
      initialFornecedorNome={sp.fornecedorNome}
      policy={policyDoTenant(ctx.tenant)}
      campos={campos}
    />
  );
}
