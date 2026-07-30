import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadCatalogo, type FiltroCatalogo } from "../../_catalogo/data";
import { CatalogoFornecedor } from "./_client";

export default async function CatalogoPage({
  params,
  searchParams,
}: {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const { supplierId } = await params;
  const sp = await searchParams;

  const filtro: FiltroCatalogo = {
    busca: sp.q,
    categoria: sp.categoria,
    apenasPromocao: sp.promocao === "1",
    apenasPendentes: sp.pendentes === "1",
    ordem: (sp.ordem as FiltroCatalogo["ordem"]) ?? "descricao",
  };

  const dados = await withTenant(ctx, () => loadCatalogo(supplierId, filtro));
  if (!dados.fornecedor) notFound();

  return (
    <CatalogoFornecedor
      fornecedor={dados.fornecedor}
      itens={dados.itens}
      categorias={dados.categorias}
      filtro={{
        busca: filtro.busca ?? "",
        categoria: filtro.categoria ?? "",
        apenasPromocao: !!filtro.apenasPromocao,
        apenasPendentes: !!filtro.apenasPendentes,
        ordem: filtro.ordem ?? "descricao",
      }}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
