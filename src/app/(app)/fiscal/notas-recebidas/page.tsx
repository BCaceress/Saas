import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { distribuicaoDisponivel } from "@/lib/fiscal/distribuicao";
import { NotasRecebidasClient } from "./_client";

export const metadata = { title: "Notas recebidas — NoHub Market" };

export default async function NotasRecebidasPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    // Fila é fila: cinco colunas por linha. Os itens da nota (e o produto de
    // cada um) são assunto de `/recebimento/[id]` — carregá-los aqui era ler o
    // mês fiscal inteiro para desenhar uma tabela que não os mostra.
    const notas = await db.fiscalInbound.findMany({
      orderBy: [{ dataEmissao: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        chave: true,
        numero: true,
        serie: true,
        dataEmissao: true,
        valorTotal: true,
        emitCnpj: true,
        emitRazaoSocial: true,
        emitUf: true,
      },
    });

    // Distribuição DF-e depende do provedor e do CNPJ da loja — sem isso o
    // painel de busca na SEFAZ nem aparece.
    const siteAtivo = (await getActiveSiteId()) ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id;
    const distribuicaoAtiva = await distribuicaoDisponivel(ctx.tenant.id, siteAtivo);

    return (
      <NotasRecebidasClient
        podeImportar={podeEmAlguma(ctx.acessos, "fiscal.importar")}
        // Aplicar sugestão do XML mexe no CADASTRO do fornecedor: quem só
        // importa nota vê o que mudou, mas não decide por ele.
        podeEditarFornecedor={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
        distribuicaoAtiva={distribuicaoAtiva}
        notas={notas.map((n) => ({
          id: n.id,
          status: n.status,
          chave: n.chave,
          numero: n.numero,
          serie: n.serie,
          dataEmissao: n.dataEmissao.toISOString(),
          valorTotal: Number(n.valorTotal),
          emitCnpj: n.emitCnpj,
          emitRazaoSocial: n.emitRazaoSocial,
          emitUf: n.emitUf,
        }))}
      />
    );
  });
}
