import { cookies } from "next/headers";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { listSites } from "@/lib/sites";
import { navTabs } from "@/components/app/nav-config";
import { loadCotacoes } from "./_compra-data";
import { COOKIE_VISAO, ListaCotacoes, type Visao } from "./_client";

export default async function CotacoesPage() {
  const ctx = await requireActiveTenant();
  const visao = (await cookies()).get(COOKIE_VISAO)?.value;
  const { linhas, multiSite } = await withTenant(ctx, async () => {
    const [lista, sites] = await Promise.all([loadCotacoes(), listSites()]);
    return { ...lista, multiSite: sites.length > 1 };
  });

  // O cabeçalho mora no client porque as ações (nova cotação, formato da lista)
  // são estado de tela — separá-los deixaria o botão longe do que ele controla.
  return (
    <ListaCotacoes
      linhas={linhas}
      multiSite={multiSite}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
      descricao={navTabs("/cotacoes").find((a) => a.href === "/cotacoes")?.descricao}
      /* Cartões é o padrão; só quem escolheu "lista" antes recebe lista. */
      visaoInicial={(visao === "lista" ? "lista" : "cards") as Visao}
    />
  );
}
