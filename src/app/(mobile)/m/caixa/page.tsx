import { requirePermissaoMobile } from "@/lib/guard";
import { carregarShell } from "@/lib/shell-context";
import { withTenant } from "@/lib/current-tenant";
import { listSites } from "@/lib/sites";
import { podeEmAlguma } from "@/lib/permissoes";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { CaixaClient } from "./_client";

/**
 * Caixa do operador.
 *
 * Única rota do `/m` que pede `carregarShell({ comCaixa: true })`: o
 * `relatorioCaixa` soma vendas e movimentos da sessão, leitura cara demais
 * para o layout pagar em toda tela. Aqui é o conteúdo da página, então paga.
 */
export default async function CaixaMobilePage() {
  const ctx = await requirePermissaoMobile("caixa.abrir");
  const shell = await carregarShell({ comCaixa: true });

  const sites = await withTenant(ctx, () => listSites());

  return (
    <>
      <MobilePageHeader
        titulo="Caixa"
        descricao={shell.caixaInfo ? shell.caixaInfo.siteNome : "Nenhum caixa aberto"}
      />
      <CaixaClient
        caixa={shell.caixaInfo}
        sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
        limiteGaveta={
          ctx.tenant.caixaLimiteGaveta != null ? Number(ctx.tenant.caixaLimiteGaveta) : null
        }
        podeSangria={podeEmAlguma(ctx.acessos, "caixa.sangria")}
        podeFechar={podeEmAlguma(ctx.acessos, "caixa.fechar")}
      />
    </>
  );
}
