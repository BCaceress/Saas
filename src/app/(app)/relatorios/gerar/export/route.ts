import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { getRelatorio } from "@/lib/relatorios/catalogo";
import { getDefinicao } from "@/lib/relatorios/definicoes";
import { decodificarConfig } from "@/lib/relatorios/config";
import { configPadraoDoUsuario } from "@/lib/relatorios/modelos-salvos";
import { executarRelatorio, type ResultadoRelatorio } from "@/lib/relatorios/executar";
import { gerarXlsx, XLSX_CONTENT_TYPE } from "@/lib/relatorios/xlsx";
import { semAcento } from "@/lib/normalize";

/**
 * Export único — CSV e Excel de QUALQUER relatório do motor genérico.
 *
 * Substitui o `switch` por tipo de relatório: a rota não sabe o que é
 * inventário nem o que é margem, só executa a definição com a configuração que
 * veio na URL. Relatório novo já nasce exportável.
 *
 * A configuração viaja codificada (`?c=`) para que o arquivo saia com
 * exatamente o que a prévia mostrou — mesmas colunas, mesma ordem, mesmos
 * filtros. E ela é revalidada aqui: `?c=` vem do usuário.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const relatorioId = url.searchParams.get("rel") ?? "";
  const formato = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "csv";

  const rel = getRelatorio(relatorioId);
  const def = rel ? getDefinicao(rel.id) : null;
  if (!rel || !def) return new Response("Relatório não encontrado.", { status: 404 });

  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, rel.permissao)) {
    return new Response("Você não tem acesso a este relatório.", { status: 403 });
  }
  // Baixar o arquivo não pode ser o atalho de quem não tem `relatorio.exportar`.
  if (!podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
    return new Response("Você não tem permissão para exportar relatórios.", { status: 403 });
  }

  const resultado = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const sites = await listSites();
    // Sem `?c=` (exportar direto do card), vale o padrão desta pessoa — o mesmo
    // que "Visualizar" mostra. Senão o arquivo divergiria da tela.
    const config =
      decodificarConfig(url.searchParams.get("c")) ??
      (await configPadraoDoUsuario(def, ctx.user.id)) ??
      {};
    return executarRelatorio({
      def,
      config,
      acessos: ctx.acessos,
      siteId,
      siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
      policy: policyDoTenant(ctx.tenant),
      incluirCruas: true,
    });
  });

  const nome = nomeArquivo(resultado, formato);

  if (formato === "xlsx") {
    const arquivo = gerarXlsx({
      aba: resultado.nome.slice(0, 28),
      cabecalho: resultado.colunas.map((c) => c.label),
      linhas: resultado.cruas ?? [],
      rodape: temTotal(resultado) ? resultado.totais.map((t) => t ?? "") : undefined,
    });
    return new Response(arquivo as BodyInit, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${nome}"`,
      },
    });
  }

  return new Response(csv(resultado), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}

/**
 * CSV no dialeto que o Excel brasileiro abre sem perguntar nada: separador `;`,
 * decimal `,` e BOM UTF-8. Números saem CRUS (sem "R$" e sem separador de
 * milhar) para que a planilha some a coluna em vez de tratá-la como texto.
 */
function csv(r: ResultadoRelatorio): string {
  const dec = (v: number) =>
    v.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });
  const esc = (v: string | number | null) => {
    const s = typeof v === "number" ? dec(v) : (v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const linhas = [
    r.colunas.map((c) => c.label),
    ...(r.cruas ?? []),
    ...(temTotal(r) ? [r.totais.map((t) => t ?? "")] : []),
  ];
  return "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
}

function temTotal(r: ResultadoRelatorio): boolean {
  return r.colunas.some((c) => c.totalizar) && r.linhas.length > 0;
}

/** Nome estável e legível: `inventario-30d.csv`. */
function nomeArquivo(r: ResultadoRelatorio, extensao: string): string {
  const slug = semAcento(`${r.nome} ${r.periodoLabel ?? ""}`)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "relatorio"}.${extensao}`;
}
