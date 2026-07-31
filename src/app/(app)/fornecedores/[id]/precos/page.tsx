import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadItensComHistorico, loadMovimentosPreco } from "../_data";
import { HistoricoPrecos } from "./_client";

const JANELAS = [7, 30, 90, 180];

export default async function PrecosFornecedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;
  const sp = await searchParams;

  const dias = JANELAS.includes(Number(sp.dias)) ? Number(sp.dias) : 30;

  const dados = await withTenant(ctx, async () => {
    const [itens, movimentos] = await Promise.all([
      loadItensComHistorico(id),
      loadMovimentosPreco(id, dias),
    ]);
    return { itens, movimentos };
  });

  return (
    <HistoricoPrecos
      supplierId={id}
      itens={dados.itens}
      movimentos={dados.movimentos}
      dias={dias}
      itemSelecionado={sp.item ?? null}
    />
  );
}
