import { z } from "zod";

/**
 * DSL de análise — a ÚNICA linguagem de consulta do módulo de relatórios.
 *
 * Nem a IA nem a tela escrevem SQL: as duas preenchem este objeto, que é
 * validado por Zod e executado pelo motor (`motor.ts`) sobre `db` — com o
 * `tenantId` injetado pelo client estendido. É o que garante que uma pergunta
 * em texto livre nunca vire query arbitrária no banco.
 *
 * Substitui o schema antigo de `/relatorios/ia` (que só escolhia uma de 8
 * "fontes" fechadas). Aqui a consulta é `fato × dimensões × métricas`, então
 * "faturamento por fornecedor por mês" cabe sem precisar de código novo.
 */

export const FATOS = [
  "venda-item",
  "movimento-estoque",
  "entrada-compra",
  "posicao-estoque",
  "caixa",
] as const;

export type FatoId = (typeof FATOS)[number];

export const OPERADORES = ["=", "!=", ">=", "<=", "contem", "em"] as const;
export type Operador = (typeof OPERADORES)[number];

export const GRANULARIDADES = ["dia", "semana", "mes", "hora"] as const;
export type Granularidade = (typeof GRANULARIDADES)[number];

export const PRESETS = ["hoje", "7d", "30d", "mes", "custom"] as const;

/** Intervalo [inicio, fim) — fim exclusivo, como em `resolvePeriodo`. */
export type Range = { inicio: Date; fim: Date };

const valorFiltro = z.union([
  z.string().max(120),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(120), z.number()])).max(50),
]);

export const filtroSchema = z.object({
  campo: z.string().min(1).max(40),
  op: z.enum(OPERADORES).default("="),
  valor: valorFiltro,
});

export type Filtro = z.infer<typeof filtroSchema>;

export const consultaSchema = z.object({
  fato: z.enum(FATOS),
  /**
   * Como quebrar o resultado. Vazio = uma linha só (total do período).
   * Três é o teto: além disso a tabela deixa de ser legível e vira export.
   */
  dimensoes: z.array(z.string().min(1).max(40)).max(3).default([]),
  metricas: z.array(z.string().min(1).max(40)).min(1).max(6),
  filtros: z.array(filtroSchema).max(8).default([]),
  periodo: z
    .object({
      preset: z.enum(PRESETS).default("30d"),
      de: z.string().max(10).optional(),
      ate: z.string().max(10).optional(),
    })
    .default({ preset: "30d" }),
  /** Só tem efeito quando a dimensão `tempo` está na consulta. */
  granularidade: z.enum(GRANULARIDADES).optional(),
  /** Compara com o período imediatamente anterior, de mesma duração. */
  comparar: z.boolean().default(false),
  ordenar: z
    .object({ por: z.string().min(1).max(40), ordem: z.enum(["asc", "desc"]).default("desc") })
    .optional(),
  limite: z.number().int().min(1).max(500).default(20),
});

export type Consulta = z.infer<typeof consultaSchema>;

/**
 * Teto de linhas lidas do banco por consulta. Estourou, o motor devolve
 * `truncado: true` e a tela avisa em vez de mostrar um número errado com cara
 * de certo. Um mercado de porte médio fica muito abaixo disso em 30 dias.
 */
export const MAX_LINHAS_FATO = 50_000;

// ── Consulta ↔ URL ──────────────────────────────────────────
// A consulta viaja na URL (`/relatorios/consulta?q=…`) para que o resultado
// seja compartilhável, recarregável e exportável sem estado de servidor.

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

export function codificarConsulta(consulta: Consulta): string {
  return b64urlEncode(JSON.stringify(consulta));
}

/** Decodifica e REVALIDA — `q` vem do usuário, então nada entra sem passar pelo Zod. */
export function decodificarConsulta(q: string | null | undefined): Consulta | null {
  if (!q) return null;
  try {
    const parsed = consultaSchema.safeParse(JSON.parse(b64urlDecode(q)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
