import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedoresSelect, loadImportacoes } from "../_catalogo/data";
import { Importacoes } from "./_client";

export default async function ImportacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;

  const dados = await withTenant(ctx, async () => {
    const [importacoes, fornecedores] = await Promise.all([
      loadImportacoes(),
      loadFornecedoresSelect(),
    ]);
    return { importacoes, fornecedores };
  });

  return (
    <Importacoes
      importacoes={dados.importacoes}
      fornecedores={dados.fornecedores}
      fornecedorInicial={sp.fornecedor ?? ""}
      podeImportar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
