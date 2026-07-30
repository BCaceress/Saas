import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadCotacoes, loadOpcoes } from "./_data";
import { ListaCotacoes } from "./_client";

export default async function CotacoesPage() {
  const ctx = await requireActiveTenant();
  const { linhas, resumo, opcoes } = await withTenant(ctx, async () => {
    const [lista, opcoes] = await Promise.all([loadCotacoes(), loadOpcoes()]);
    return { ...lista, opcoes };
  });

  return (
    <ListaCotacoes
      linhas={linhas}
      resumo={resumo}
      sites={opcoes.sites}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
