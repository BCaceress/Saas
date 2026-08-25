import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { carregarRecebimento, listarSubcategoriasParaCadastro } from "../_data";
import { RecebimentoClient } from "./_client";

export const metadata = { title: "Recebimento inteligente" };

export default async function RecebimentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();
  // A nota é assunto das duas pontas: quem confere na doca e quem trata o XML
  // no escritório. Exigir só `compras.receber` trancava o contador para fora
  // da própria etapa de de-para.
  const podeReceber = podeEmAlguma(ctx.acessos, "compras.receber");
  const podeTratarNota = podeEmAlguma(ctx.acessos, "fiscal.importar");
  if (!podeReceber && !podeTratarNota) throw new SemPermissaoError();

  // Cadastro rápido de produto (item da nota sem catálogo) exige permissão
  // própria — quem só confere na porta pode não poder criar produto.
  const podeCriarProduto = podeEmAlguma(ctx.acessos, "produto.editar");

  const [dados, subcategorias] = await withTenant(ctx, () =>
    Promise.all([
      carregarRecebimento(ctx.tenant.id, id),
      podeCriarProduto ? listarSubcategoriasParaCadastro() : Promise.resolve([]),
    ]),
  );
  if (!dados) notFound();

  return (
    <RecebimentoClient
      dados={dados}
      podeReceber={podeReceber}
      podeTratarNota={podeTratarNota}
      podeCriarProduto={podeCriarProduto}
      cega={ctx.tenant.conferenciaCega}
      subcategorias={subcategorias}
    />
  );
}
