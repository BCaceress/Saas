import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { policyDoTenant, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { gerarXlsx, XLSX_CONTENT_TYPE } from "@/lib/relatorios/xlsx";
import {
  rankingProdutos,
  posicaoEstoque,
  perdas,
  comprasPorProduto,
  rentabilidadeDrinks,
  fechamentosCaixa,
  curvaABC,
  type Range,
} from "../../_data";

/**
 * Exportação CSV server-side (PRD §7). Respeita os filtros (período + site) e o
 * contexto de tenant — nada de dado de outro tenant. Formato pt-BR: separador `;`
 * e decimal `,`, com BOM UTF-8 para abrir certo no Excel.
 */

export const dynamic = "force-dynamic";

type Linha = (string | number)[];

function dec(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csv(cabecalho: string[], linhas: Linha[]): string {
  const esc = (v: string | number) => {
    const s = typeof v === "number" ? dec(v) : String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [cabecalho, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n");
  return "﻿" + corpo; // BOM
}

async function montar(
  tipo: string,
  range: Range,
  siteId: string | null,
  policy: EstoquePolicy,
): Promise<{ cabecalho: string[]; linhas: Linha[] } | null> {
  switch (tipo) {
    case "vendas": {
      const r = await rankingProdutos(range, siteId);
      return { cabecalho: ["Produto", "SKU", "Categoria", "Quantidade", "Faturamento"], linhas: r.map((p) => [p.nome, p.sku, p.categoria ?? "", p.quantidade, p.receita]) };
    }
    case "margem": {
      const r = await rankingProdutos(range, siteId);
      return { cabecalho: ["Produto", "SKU", "Receita", "CMV", "Margem", "Margem %"], linhas: r.map((p) => [p.nome, p.sku, p.receita, p.custo, p.margem, Math.round(p.margemPct)]) };
    }
    case "estoque": {
      // Quem controla por giro não tem mínimo: a coluna de meta some do CSV.
      const r = await posicaoEstoque(siteId, policy);
      const base = ["Produto", "SKU", "Site", "Fechado", "Aberto", "Custo medio", "Valor"];
      return {
        cabecalho: policy.usaMinimo ? [...base, "Abaixo minimo"] : base,
        linhas: r.map((p) => [
          p.nome, p.sku, p.siteNome, p.estoqueFechado, p.estoqueAberto, p.custoMedio ?? 0, p.valorEstoque,
          ...(policy.usaMinimo ? [p.abaixoMinimo ? "sim" : "nao"] : []),
        ]),
      };
    }
    case "perdas": {
      const r = await perdas(range, siteId);
      return { cabecalho: ["Produto", "SKU", "Quantidade", "Custo da perda"], linhas: r.itens.map((p) => [p.nome, p.sku, p.quantidade, p.custo]) };
    }
    case "compras": {
      const r = await comprasPorProduto(range, siteId);
      return { cabecalho: ["Produto", "SKU", "Quantidade", "Custo unitario medio", "Total"], linhas: r.map((p) => [p.nome, p.sku, p.quantidade, p.custoMedioCompra, p.total]) };
    }
    case "producao": {
      const r = await rentabilidadeDrinks(range, siteId);
      return { cabecalho: ["Drink", "Vendidos", "Receita", "Custo insumos", "Margem", "Margem %"], linhas: r.map((p) => [p.nome, p.quantidade, p.receita, p.custo, p.margem, Math.round(p.margemPct)]) };
    }
    case "pagamentos": {
      const r = await fechamentosCaixa(range, siteId);
      return { cabecalho: ["Fechado em", "Site", "Abertura", "Vendas dinheiro", "Esperado", "Contado", "Quebra"], linhas: r.map((f) => [f.fechadaEm ? f.fechadaEm.toLocaleDateString("pt-BR") : "", f.siteNome, f.valorAbertura, f.vendasDinheiro, f.esperado, f.contado ?? 0, f.quebra ?? 0]) };
    }
    case "abc": {
      const r = await curvaABC(range, siteId);
      return { cabecalho: ["Classe", "Produto", "SKU", "Faturamento", "% acumulado"], linhas: r.map((p) => [p.classe, p.nome, p.sku, p.receita, Math.round(p.acumuladoPct)]) };
    }
    default:
      return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const ctx = await requireActiveTenant();

  // Mesma trava do export do motor: baixar o arquivo não pode ser o atalho de
  // quem não tem `relatorio.exportar`.
  if (!podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
    return new Response("Você não tem permissão para exportar relatórios.", { status: 403 });
  }

  const url = new URL(req.url);
  const periodo = resolvePeriodo({
    periodo: url.searchParams.get("periodo") ?? undefined,
    de: url.searchParams.get("de") ?? undefined,
    ate: url.searchParams.get("ate") ?? undefined,
  });
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const policy = policyDoTenant(ctx.tenant);
  const resultado = await withTenant(ctx, async () => montar(tipo, range, await getActiveSiteId(), policy));
  if (!resultado) return new Response("Relatório não exportável.", { status: 404 });

  const nome = (extensao: string) => `relatorio-${tipo}-${periodo.preset}.${extensao}`;

  if (url.searchParams.get("formato") === "xlsx") {
    const arquivo = gerarXlsx({
      aba: tipo,
      cabecalho: resultado.cabecalho,
      linhas: resultado.linhas,
    });
    return new Response(arquivo as BodyInit, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${nome("xlsx")}"`,
      },
    });
  }

  return new Response(csv(resultado.cabecalho, resultado.linhas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome("csv")}"`,
    },
  });
}
