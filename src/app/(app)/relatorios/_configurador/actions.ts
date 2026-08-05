"use server";

import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { getRelatorio } from "@/lib/relatorios/catalogo";
import { getDefinicao } from "@/lib/relatorios/definicoes";
import { carregarOpcoes } from "@/lib/relatorios/fontes";
import {
  configPadrao,
  normalizarConfig,
  reportConfigSchema,
  type ReportConfig,
} from "@/lib/relatorios/config";
import {
  definicaoParaCliente,
  type OpcaoFiltro,
  type ReportDefinition,
  type ReportDefinitionCliente,
} from "@/lib/relatorios/definicao";
import { executarRelatorio, type ResultadoRelatorio } from "@/lib/relatorios/executar";
import {
  configPadraoDoUsuario,
  excluirModelo,
  limparPadrao,
  listarModelos,
  salvarModelo,
  salvarPadrao,
  type ModeloSalvo,
} from "@/lib/relatorios/modelos-salvos";
import { registrarExecucao } from "@/lib/relatorios/historico";

/**
 * Ações da tela "Configurar relatório".
 *
 * Uma tela só serve TODOS os relatórios, então estas ações também: elas
 * recebem o id do relatório, resolvem a definição no servidor e devolvem
 * objetos serializáveis. Nenhuma delas conhece um relatório em particular.
 *
 * As três checam a permissão DO RELATÓRIO, não só a de abrir a Central — sem
 * isso, chamar a action na mão viraria o atalho para ler o que a tela esconde.
 */

type Resultado<T = undefined> = { ok: true; dados: T } | { ok: false; erro: string };

const idSchema = z.string().trim().min(1).max(60);

/** Definição + permissão, ou o erro pronto para virar toast. */
async function comDefinicao(relatorioId: unknown) {
  const parsed = idSchema.safeParse(relatorioId);
  if (!parsed.success) throw new SemPermissaoError("Relatório não informado.");

  const rel = getRelatorio(parsed.data);
  if (!rel) throw new SemPermissaoError("Esse relatório não existe mais.");

  const ctx = await guardAction("relatorio.ver", null, { mesmoSuspenso: true });
  if (!podeEmAlguma(ctx.acessos, rel.permissao)) throw new SemPermissaoError();

  const def = getDefinicao(rel.id);
  if (!def) throw new SemPermissaoError("Esse relatório abre na tela dedicada.");

  return { ctx, def };
}

// ── Abrir a configuração ────────────────────────────────────

export type AberturaRelatorio = {
  definicao: ReportDefinitionCliente;
  /** Ponto de partida: padrão pessoal, se existir; senão o padrão da definição. */
  config: ReportConfig;
  modelos: ModeloSalvo[];
  lojaAtiva: string | null;
  podeExportar: boolean;
  /** De onde veio a configuração — a tela avisa em vez de o operador adivinhar. */
  origem: "padrao" | "meu-padrao";
};

/**
 * Tudo que a tela de configuração precisa, em uma ida ao servidor.
 *
 * É carregado sob demanda (no clique em "Executar") de propósito: mandar as
 * definições dos quarenta relatórios junto com a Central seria pagar por
 * trinta e nove que ninguém abriu.
 */
export async function abrirRelatorioAction(
  relatorioId: unknown,
): Promise<Resultado<AberturaRelatorio>> {
  try {
    const { ctx, def } = await comDefinicao(relatorioId);

    const dados = await runWithTenant(ctx.tenant.id, async () => {
      const [opcoes, modelos, meuPadrao, sites, siteId] = await Promise.all([
        resolverOpcoes(def),
        listarModelos(def, ctx.user.id),
        configPadraoDoUsuario(def, ctx.user.id),
        listSites(),
        getActiveSiteId(),
      ]);

      return {
        definicao: definicaoParaCliente(def, ctx.acessos, opcoes),
        config: meuPadrao ?? configPadrao(def),
        origem: (meuPadrao ? "meu-padrao" : "padrao") as "padrao" | "meu-padrao",
        modelos,
        lojaAtiva: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : "Todas as lojas",
        podeExportar: podeEmAlguma(ctx.acessos, "relatorio.exportar"),
      };
    });

    return { ok: true, dados };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Listas dos filtros de seleção — uma consulta por fonte, sem repetir. */
async function resolverOpcoes(def: ReportDefinition): Promise<Record<string, OpcaoFiltro[]>> {
  const pedidas = def.filtros.flatMap((f) =>
    f.tipo === "opcoes" && f.fonteOpcoes ? [[f.id, f.fonteOpcoes] as const] : [],
  );
  if (pedidas.length === 0) return {};

  const fontes = [...new Set(pedidas.map(([, fonte]) => fonte))];
  const carregadas = await Promise.all(fontes.map((f) => carregarOpcoes(f)));
  const porFonte = new Map(fontes.map((f, i) => [f, carregadas[i] ?? []]));

  return Object.fromEntries(pedidas.map(([id, fonte]) => [id, porFonte.get(fonte) ?? []]));
}

// ── Prévia ──────────────────────────────────────────────────

export async function previaRelatorioAction(entrada: unknown): Promise<Resultado<ResultadoRelatorio>> {
  const parsed = z
    .object({ relatorioId: idSchema, config: reportConfigSchema })
    .safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Configuração inválida." };

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);

    const dados = await runWithTenant(ctx.tenant.id, async () => {
      const siteId = await getActiveSiteId();
      const sites = await listSites();
      return executarRelatorio({
        def,
        config: parsed.data.config,
        acessos: ctx.acessos,
        siteId,
        siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
        policy: policyDoTenant(ctx.tenant),
      });
    });

    // A prévia É uma execução: entra no histórico e vira a "última
    // configuração" da próxima vez. Falhar no log não pode derrubar o relatório.
    await runWithTenant(ctx.tenant.id, () =>
      registrarExecucao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        parametros: dados.config,
        formato: "tela",
      }),
    ).catch(() => {});

    return { ok: true, dados };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

export type PreviaPadrao = {
  previa: ResultadoRelatorio;
  podeExportar: boolean;
  /** O padrão saiu de um modelo pessoal ou da definição? */
  origem: "padrao" | "meu-padrao";
};

/**
 * "Visualizar" — o caminho que não pergunta nada.
 *
 * Uma ida ao servidor: resolve a definição, pega o padrão (pessoal, se houver)
 * e já devolve o relatório executado. Sem carregar definição no cliente, sem
 * montar configuração, sem segunda chamada — é o que faz a tela abrir com o
 * resultado em vez de abrir com um formulário.
 */
export async function previaPadraoAction(relatorioId: unknown): Promise<Resultado<PreviaPadrao>> {
  try {
    const { ctx, def } = await comDefinicao(relatorioId);

    const dados = await runWithTenant(ctx.tenant.id, async () => {
      const [meuPadrao, siteId, sites] = await Promise.all([
        configPadraoDoUsuario(def, ctx.user.id),
        getActiveSiteId(),
        listSites(),
      ]);

      const previa = await executarRelatorio({
        def,
        config: meuPadrao ?? configPadrao(def),
        acessos: ctx.acessos,
        siteId,
        siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
        policy: policyDoTenant(ctx.tenant),
      });

      return {
        previa,
        podeExportar: podeEmAlguma(ctx.acessos, "relatorio.exportar"),
        origem: (meuPadrao ? "meu-padrao" : "padrao") as "padrao" | "meu-padrao",
      };
    });

    await runWithTenant(ctx.tenant.id, () =>
      registrarExecucao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        parametros: dados.previa.config,
        formato: "tela",
      }),
    ).catch(() => {});

    return { ok: true, dados };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/**
 * "Exportar" direto do card: o arquivo sai com o padrão, e o servidor é quem
 * sabe qual é. O client só precisa do id e do formato — a rota do arquivo roda
 * sem `?c=` e cai no mesmo padrão.
 */
export async function registrarSaidaPadraoAction(entrada: unknown): Promise<Resultado<null>> {
  const parsed = z
    .object({
      relatorioId: idSchema,
      formato: z.enum(["csv", "xlsx", "pdf", "impressao"]),
    })
    .safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Parâmetros inválidos." };

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);
    if (!podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
      throw new SemPermissaoError("Você não tem permissão para exportar relatórios.");
    }

    await runWithTenant(ctx.tenant.id, async () => {
      const meuPadrao = await configPadraoDoUsuario(def, ctx.user.id);
      await registrarExecucao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        parametros: meuPadrao ?? configPadrao(def),
        formato: parsed.data.formato,
      });
    });
    return { ok: true, dados: null };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Registra uma saída em arquivo. A navegação já aconteceu no client. */
export async function registrarSaidaAction(entrada: unknown): Promise<Resultado<null>> {
  const parsed = z
    .object({
      relatorioId: idSchema,
      config: reportConfigSchema,
      formato: z.enum(["csv", "xlsx", "pdf", "impressao"]),
    })
    .safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Parâmetros inválidos." };

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);
    if (!podeEmAlguma(ctx.acessos, "relatorio.exportar")) {
      throw new SemPermissaoError("Você não tem permissão para exportar relatórios.");
    }

    await runWithTenant(ctx.tenant.id, () =>
      registrarExecucao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        parametros: normalizarConfig(def, parsed.data.config),
        formato: parsed.data.formato,
      }),
    );
    return { ok: true, dados: null };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

// ── Modelos salvos ──────────────────────────────────────────

const salvarSchema = z.object({
  relatorioId: idSchema,
  nome: z.string().trim().min(2, "Dê um nome ao modelo.").max(60),
  config: reportConfigSchema,
  compartilhado: z.boolean().default(false),
});

export async function salvarModeloAction(entrada: unknown): Promise<Resultado<ModeloSalvo[]>> {
  const parsed = salvarSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);
    const config = normalizarConfig(def, parsed.data.config);

    const modelos = await runWithTenant(ctx.tenant.id, async () => {
      await salvarModelo({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        nome: parsed.data.nome,
        config,
        compartilhado: parsed.data.compartilhado,
      });
      return listarModelos(def, ctx.user.id);
    });

    return { ok: true, dados: modelos };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

/**
 * "Salvar como padrão" — desta pessoa, para este relatório. A partir daqui,
 * Visualizar e Exportar saem assim, sem perguntar.
 */
export async function salvarPadraoAction(entrada: unknown): Promise<Resultado<ReportConfig>> {
  const parsed = z
    .object({ relatorioId: idSchema, config: reportConfigSchema })
    .safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Configuração inválida." };

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);
    const config = normalizarConfig(def, parsed.data.config);

    await runWithTenant(ctx.tenant.id, () =>
      salvarPadrao({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        relatorioId: def.id,
        config,
      }),
    );

    return { ok: true, dados: config };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Volta ao padrão de fábrica do relatório: some com o padrão pessoal. */
export async function limparPadraoAction(relatorioId: unknown): Promise<Resultado<ReportConfig>> {
  try {
    const { ctx, def } = await comDefinicao(relatorioId);
    await runWithTenant(ctx.tenant.id, () => limparPadrao(def.id, ctx.user.id));
    return { ok: true, dados: configPadrao(def) };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

export async function excluirModeloAction(entrada: unknown): Promise<Resultado<ModeloSalvo[]>> {
  const parsed = z.object({ relatorioId: idSchema, id: idSchema }).safeParse(entrada);
  if (!parsed.success) return { ok: false, erro: "Modelo não informado." };

  try {
    const { ctx, def } = await comDefinicao(parsed.data.relatorioId);

    const modelos = await runWithTenant(ctx.tenant.id, async () => {
      const apagou = await excluirModelo(parsed.data.id, ctx.user.id);
      if (!apagou) throw new SemPermissaoError("Esse modelo não é seu para excluir.");
      return listarModelos(def, ctx.user.id);
    });

    return { ok: true, dados: modelos };
  } catch (e) {
    if (e instanceof SemPermissaoError) return { ok: false, erro: e.message };
    throw e;
  }
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Não foi possível gerar o relatório. Tente de novo.";
}
