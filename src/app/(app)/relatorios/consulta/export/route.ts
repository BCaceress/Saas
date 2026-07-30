import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { decodificarConsulta } from "@/lib/analises/schema";
import { ConsultaInvalidaError, executarConsulta } from "@/lib/analises/motor";
import { nomeArquivo, paraCsv } from "@/lib/analises/formato";
import { gerarXlsx, XLSX_CONTENT_TYPE } from "@/lib/relatorios/xlsx";

/**
 * Download do relatório sob demanda, em CSV (padrão) ou Excel (`?formato=xlsx`).
 *
 * A consulta chega codificada em `?q=` e passa pelo MESMO motor da tela —
 * inclusive o corte de métrica por permissão, que é o ponto: baixar o arquivo
 * não pode ser um atalho para ver margem sem `relatorio.financeiro`.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
    return new Response("Você não tem permissão para exportar relatórios.", { status: 403 });
  }

  const url = new URL(req.url);
  const consulta = decodificarConsulta(url.searchParams.get("q"));
  if (!consulta) return new Response("Consulta inválida.", { status: 400 });

  const xlsx = url.searchParams.get("formato") === "xlsx";

  try {
    const resultado = await withTenant(ctx, async () =>
      executarConsulta({
        consulta,
        acessos: ctx.acessos,
        siteId: await getActiveSiteId(),
        policy: policyDoTenant(ctx.tenant),
      }),
    );

    if (xlsx) {
      // Mesmas colunas e mesma linha de total do CSV — o que muda é só o
      // empacotamento: número vira número de planilha, sem diálogo de separador.
      const arquivo = gerarXlsx({
        aba: resultado.fato.label,
        cabecalho: resultado.colunas.map((c) => c.header),
        linhas: resultado.brutas.map((linha) => resultado.colunas.map((c) => linha[c.id] ?? "")),
        rodape: resultado.colunas.map((c, i) =>
          c.tipo === "metrica" ? (resultado.totais[c.id] ?? 0) : i === 0 ? "Total" : "",
        ),
      });

      return new Response(arquivo as BodyInit, {
        headers: {
          "Content-Type": XLSX_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename="${nomeArquivo(resultado, "xlsx")}"`,
        },
      });
    }

    return new Response(paraCsv(resultado), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeArquivo(resultado, "csv")}"`,
      },
    });
  } catch (e) {
    if (e instanceof ConsultaInvalidaError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
