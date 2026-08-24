"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { isAdmin } from "@/lib/permissoes";
import {
  montarImportacaoVendas,
  gravarVendasImportadas,
  decodificarCsv,
  TAMANHO_MAXIMO_CSV,
  type RelatorioImportacaoVendas,
} from "@/lib/vendas/importar-historico";
import {
  montarImportacaoPlanilha,
  matrizDeCsv,
  matrizDeXlsx,
  pareceExportDeTransacoes,
  type RelatorioPlanilhaVendas,
} from "@/lib/vendas/importar-planilha-transacoes";

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

/**
 * Dois LAYOUTS de origem convivem na mesma tela, e nenhum dos dois é preso à
 * extensão — o export de transações sai tanto em .xlsx quanto em .csv:
 *  - transações: uma linha por VENDA, itens dentro da coluna "Descrição".
 *  - itens: uma linha por ITEM (formato documentado do NoHub).
 * Quem decide é o cabeçalho do arquivo, não o que o usuário escolheu.
 *
 * O conteúdo sempre vem em base64 (Server Action não carrega bytes crus), e o
 * texto é decodificado aqui — planilha exportada do Windows costuma vir em
 * latin1, e o cabeçalho corrompido derrubava a detecção de coluna.
 */
export type TipoArquivo = "csv" | "xlsx";

export type ArquivoImportacao = { formato: TipoArquivo; conteudo: string };

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
  /** Só no formato planilha: linhas que não são venda (sangria, suprimento…). */
  naoVendas: { tipo: string; vezes: number }[];
  canceladas: number;
};

/** O conteúdo chega em base64: 4 caracteres para cada 3 bytes do arquivo. */
function checarTamanho(base64: string) {
  if ((base64.length * 3) / 4 > TAMANHO_MAXIMO_CSV) {
    throw new Error("Arquivo grande demais (máximo 15MB).");
  }
}

function bytesDeBase64(base64: string): Uint8Array {
  const limpo = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  return new Uint8Array(Buffer.from(limpo, "base64"));
}

async function montar(
  arquivo: ArquivoImportacao,
  tenantId: string,
): Promise<RelatorioImportacaoVendas | RelatorioPlanilhaVendas> {
  const bytes = bytesDeBase64(arquivo.conteudo);

  if (arquivo.formato === "xlsx") {
    return montarImportacaoPlanilha(matrizDeXlsx(bytes), `imp:${tenantId}`);
  }

  const texto = decodificarCsv(bytes);
  const matriz = matrizDeCsv(texto);
  // O CSV pode ser qualquer um dos dois layouts — o cabeçalho decide.
  if (pareceExportDeTransacoes(matriz)) {
    return montarImportacaoPlanilha(matriz, `imp:${tenantId}`);
  }
  return montarImportacaoVendas(texto);
}

export async function preVisualizarImportacaoVendas(
  arquivo: ArquivoImportacao,
): Promise<PreVisualizacaoImportacao> {
  const ctx = await requireGestor();
  checarTamanho(arquivo.conteudo);
  const relatorio = await runWithTenant(ctx.tenant.id, () => montar(arquivo, ctx.tenant.id));
  return resumir(relatorio);
}

function resumir(
  relatorio: RelatorioImportacaoVendas | RelatorioPlanilhaVendas,
): PreVisualizacaoImportacao {
  const dePlanilha = relatorio as Partial<RelatorioPlanilhaVendas>;
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
    naoVendas: dePlanilha.naoVendas ?? [],
    canceladas: dePlanilha.canceladas ?? 0,
  };
}

export type ResultadoImportacao = {
  vendasImportadas: number;
  jaImportadas: number;
  totalLiquido: number;
};

export async function confirmarImportacaoVendas(
  arquivo: ArquivoImportacao,
  siteId: string,
): Promise<ResultadoImportacao> {
  const ctx = await requireGestor();
  checarTamanho(arquivo.conteudo);

  return runWithTenant(ctx.tenant.id, async () => {
    const site = await db.site.findFirst({ where: { id: siteId, ativo: true } });
    if (!site) throw new Error("Loja inválida.");

    const relatorio = await montar(arquivo, ctx.tenant.id);
    if (relatorio.vendas.length === 0) {
      throw new Error("Nenhuma venda ficou pronta para importar — confira o arquivo.");
    }

    const { gravadas, jaImportadas } = await gravarVendasImportadas(site.id, relatorio.vendas);

    revalidatePath("/", "layout");
    return {
      vendasImportadas: gravadas,
      jaImportadas,
      totalLiquido: relatorio.totalLiquido,
    };
  });
}
