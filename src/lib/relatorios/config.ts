import { z } from "zod";
import { colunasPadrao, type ReportDefinition, type ReportDefinitionCliente } from "./definicao";

/**
 * Configuração de um relatório — o que o OPERADOR escolheu.
 *
 * A definição diz o que é possível; isto diz o que foi pedido. Um objeto só,
 * validado por Zod, que serve de uma ponta à outra: estado da tela de
 * configuração, corpo da prévia, query string do export, JSON do modelo salvo e
 * memória da última execução.
 *
 * Módulo puro — o client monta, o servidor revalida. Nada entra no motor sem
 * passar pelo `normalizarConfig` contra a definição: coluna que não existe
 * some, obrigatória volta, limite fora da faixa é cortado.
 */

const valorFiltro = z.union([
  z.string().max(160),
  z.number(),
  z.boolean(),
  z.array(z.string().max(160)).max(50),
]);

export const reportConfigSchema = z.object({
  /** Por `id` do FiltroDef. O período mora aqui como `{preset,de,ate}`. */
  filtros: z.record(z.string().max(40), valorFiltro).default({}),
  periodo: z
    .object({
      preset: z.enum(["hoje", "7d", "30d", "mes", "6m", "1a", "custom"]).default("30d"),
      de: z.string().max(10).optional(),
      ate: z.string().max(10).optional(),
    })
    .default({ preset: "30d" }),
  /** Colunas visíveis, NA ORDEM escolhida. Vazio = as padrão da definição. */
  colunas: z.array(z.string().max(60)).max(60).default([]),
  ordenar: z
    .object({ coluna: z.string().max(60), ordem: z.enum(["asc", "desc"]).default("desc") })
    .optional(),
  /** `id` do AgrupamentoDef. Ausente = tabela plana. */
  agrupar: z.string().max(60).optional(),
  limite: z.number().int().min(1).max(5000).default(1000),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;

export type PeriodoConfig = ReportConfig["periodo"];

type Definicao = ReportDefinition | ReportDefinitionCliente;

/** Configuração inicial de um relatório: colunas padrão e ordenação sugerida. */
export function configPadrao(def: Definicao): ReportConfig {
  const filtros = Object.fromEntries(
    def.filtros.flatMap((f) => (f.padrao === undefined ? [] : [[f.id, f.padrao] as const])),
  );
  return reportConfigSchema.parse({
    filtros,
    periodo: { preset: "30d" },
    colunas: colunasPadrao(def),
    ordenar: def.ordenacaoPadrao,
    limite: def.limitePadrao ?? 1000,
  });
}

/**
 * Configuração saneada contra a definição. Um modelo salvo em janeiro pode
 * apontar para colunas que o relatório não tem mais — em vez de quebrar, o
 * motor descarta o que sumiu e mantém o resto.
 */
export function normalizarConfig(def: Definicao, entrada: unknown): ReportConfig {
  const parsed = reportConfigSchema.safeParse(entrada ?? {});
  const bruta = parsed.success ? parsed.data : configPadrao(def);

  const existentes = new Set(def.colunas.map((c) => c.id));
  const obrigatorias = def.colunas.filter((c) => c.obrigatoria).map((c) => c.id);

  let colunas = bruta.colunas.filter((id) => existentes.has(id));
  // Obrigatória removida (por modelo antigo ou por URL editada à mão) volta na
  // posição em que a definição a declara — sem ela a linha perde a identidade.
  for (const id of obrigatorias) {
    if (colunas.includes(id)) continue;
    const pos = def.colunas.findIndex((c) => c.id === id);
    const antes = def.colunas.slice(0, pos).map((c) => c.id);
    const alvo = colunas.findIndex((c) => !antes.includes(c));
    colunas = alvo < 0 ? [...colunas, id] : [...colunas.slice(0, alvo), id, ...colunas.slice(alvo)];
  }
  if (colunas.length === 0) colunas = colunasPadrao(def);

  const ordenar =
    bruta.ordenar && podeOrdenar(def, bruta.ordenar.coluna) ? bruta.ordenar : def.ordenacaoPadrao;

  const agrupar =
    bruta.agrupar && def.agrupamentos.some((g) => g.id === bruta.agrupar) ? bruta.agrupar : undefined;

  const filtrosValidos = new Set(def.filtros.map((f) => f.id));
  const filtros = Object.fromEntries(
    Object.entries(bruta.filtros).filter(([k, v]) => filtrosValidos.has(k) && !vazio(v)),
  );

  return {
    filtros,
    periodo: bruta.periodo,
    colunas,
    ordenar,
    agrupar,
    limite: Math.min(bruta.limite, def.limitePadrao ?? 5000),
  };
}

function podeOrdenar(def: Definicao, coluna: string): boolean {
  return def.ordenacoes.some((o) => o.coluna === coluna) || def.colunas.some((c) => c.id === coluna);
}

export function vazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * As duas configurações pedem a mesma coisa?
 *
 * É o que decide se a tela mostra "Configuração personalizada": comparar por
 * conteúdo, não por referência nem por `JSON.stringify` direto — a ordem das
 * chaves de `filtros` varia conforme quem montou o objeto, e isso não é
 * diferença nenhuma para o operador. Em `colunas`, ao contrário, a ordem É o
 * conteúdo.
 */
export function mesmaConfig(a: ReportConfig, b: ReportConfig): boolean {
  return chave(a) === chave(b);
}

function chave(c: ReportConfig): string {
  const filtros = Object.entries(c.filtros)
    .filter(([, v]) => !vazio(v))
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? [...v].sort().join("|") : String(v)}`);

  return JSON.stringify([
    c.colunas,
    c.ordenar ? [c.ordenar.coluna, c.ordenar.ordem] : null,
    c.agrupar ?? null,
    c.limite,
    [c.periodo.preset, c.periodo.de ?? "", c.periodo.ate ?? ""],
    filtros,
  ]);
}

// ── Config ↔ URL ────────────────────────────────────────────
// A configuração viaja na query string do export e do PDF, para que o arquivo
// saia com exatamente o que a prévia mostrou — sem estado de servidor no meio.

function b64urlEncode(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(texto: string): string {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const bin =
    typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function codificarConfig(config: ReportConfig): string {
  return b64urlEncode(JSON.stringify(config));
}

/** Decodifica e REVALIDA — `c` vem do usuário, nada entra sem passar pelo Zod. */
export function decodificarConfig(c: string | null | undefined): ReportConfig | null {
  if (!c) return null;
  try {
    const parsed = reportConfigSchema.safeParse(JSON.parse(b64urlDecode(c)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ── Resumo em português ─────────────────────────────────────

/** O que esta configuração pede, em uma frase. Vai no cabeçalho do PDF. */
export function descreverConfig(def: Definicao, config: ReportConfig): string {
  const partes: string[] = [`${config.colunas.length} colunas`];

  const grupo = def.agrupamentos.find((g) => g.id === config.agrupar);
  if (grupo) partes.push(`agrupado por ${grupo.label.toLowerCase()}`);

  if (config.ordenar) {
    const col = def.colunas.find((c) => c.id === config.ordenar!.coluna);
    const nome = col?.label ?? config.ordenar.coluna;
    partes.push(`${config.ordenar.ordem === "desc" ? "maior" : "menor"} ${nome.toLowerCase()} primeiro`);
  }

  for (const f of def.filtros) {
    const v = config.filtros[f.id];
    if (vazio(v) || f.tipo === "periodo" || f.tipo === "site") continue;
    partes.push(`${f.label.toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  }

  return partes.join(" · ");
}
