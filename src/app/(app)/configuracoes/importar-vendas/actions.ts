"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { isAdmin } from "@/lib/permissoes";
import {
  montarImportacaoVendas,
  gravarVendasImportadas,
  TAMANHO_MAXIMO_CSV,
  type RelatorioImportacaoVendas,
} from "@/lib/vendas/importar-historico";

/** Importação de histórico de vendas é irreversível em massa — só administrador. */
async function requireGestor() {
  const ctx = await requireActiveTenant();
  if (!isAdmin(ctx.acessos)) {
    throw new Error("Apenas um administrador pode importar histórico de vendas.");
  }
  return ctx;
}

export type LojaOpcao = { id: string; nome: string };

export async function listarLojasParaImportacao(): Promise<LojaOpcao[]> {
  const ctx = await requireGestor();
  return runWithTenant(ctx.tenant.id, () =>
    db.site.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  );
}

const MAX_NAO_CASADOS_EXIBIDOS = 50;

export type PreVisualizacaoImportacao = {
  totalVendasProntas: number;
  totalLiquido: number;
  vendasPuladas: number;
  itensPulados: number;
  linhasColapsadas: number;
  /** Os mais frequentes primeiro, limitado a MAX_NAO_CASADOS_EXIBIDOS. */
  naoCasados: { nome: string; vezes: number }[];
  /** Contagem total de valores distintos não casados (pode ser maior que a lista acima). */
  totalNaoCasados: number;
  amostra: { dataHora: Date; numItens: number; total: number }[];
};

function checarTamanho(csvTexto: string) {
  if (csvTexto.length > TAMANHO_MAXIMO_CSV) {
    throw new Error("Arquivo grande demais (máximo 15MB).");
  }
}

export async function preVisualizarImportacaoVendas(
  csvTexto: string,
): Promise<PreVisualizacaoImportacao> {
  const ctx = await requireGestor();
  checarTamanho(csvTexto);
  const relatorio = await runWithTenant(ctx.tenant.id, () => montarImportacaoVendas(csvTexto));
  return resumir(relatorio);
}

function resumir(relatorio: RelatorioImportacaoVendas): PreVisualizacaoImportacao {
  return {
    totalVendasProntas: relatorio.vendas.length,
    totalLiquido: relatorio.totalLiquido,
    vendasPuladas: relatorio.vendasPuladas,
    itensPulados: relatorio.itensPulados,
    linhasColapsadas: relatorio.linhasColapsadas,
    naoCasados: relatorio.naoCasados.slice(0, MAX_NAO_CASADOS_EXIBIDOS),
    totalNaoCasados: relatorio.naoCasados.length,
    amostra: relatorio.vendas
      .slice(0, 8)
      .map((v) => ({ dataHora: v.dataHora, numItens: v.itens.length, total: v.total })),
  };
}

export type ResultadoImportacao = { vendasImportadas: number; totalLiquido: number };

export async function confirmarImportacaoVendas(
  csvTexto: string,
  siteId: string,
): Promise<ResultadoImportacao> {
  const ctx = await requireGestor();
  checarTamanho(csvTexto);

  return runWithTenant(ctx.tenant.id, async () => {
    const site = await db.site.findFirst({ where: { id: siteId, ativo: true } });
    if (!site) throw new Error("Loja inválida.");

    const relatorio = await montarImportacaoVendas(csvTexto);
    if (relatorio.vendas.length === 0) {
      throw new Error("Nenhuma venda ficou pronta para importar — confira o arquivo.");
    }

    const vendasImportadas = await gravarVendasImportadas(site.id, relatorio.vendas);

    revalidatePath("/", "layout");
    return { vendasImportadas, totalLiquido: relatorio.totalLiquido };
  });
}
