import type { z } from "zod";
import type { ActiveTenant } from "@/lib/current-tenant";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";

/**
 * Só "query" tem `handler` na Fase 1. "action"/"navigate" já existem no tipo
 * para as fases seguintes entrarem sem redesenhar o registry nem o loop —
 * `paraAnthropicTools()` (agente.ts) filtra por `kind === "query"`, então uma
 * tool sem handler fica automaticamente escondida do Claude.
 */
export type CopilotoToolKind = "query" | "action" | "navigate";

/** Contexto resolvido no servidor — nunca aceito do client. */
export type CopilotoCtx = {
  tenant: ActiveTenant;
  siteId: string | null;
  siteNome: string | null;
  policy: EstoquePolicy;
};

export type ToolExecResult =
  | { ok: true; conteudo: unknown }
  | { ok: false; erro: string };

export type CopilotoTool<TInput = unknown> = {
  name: string;
  description: string;
  kind: CopilotoToolKind;
  inputSchema: z.ZodType<TInput>;
  /** Ausente para tools de "action"/"navigate" ainda não implementadas. */
  handler?: (input: TInput, ctx: CopilotoCtx) => Promise<ToolExecResult>;
};

export type ContextoPagina = {
  pagina: string;
  periodoAtivo?: { preset: string; de?: string; ate?: string } | null;
};

export type MensagemHistorico = { role: "user" | "assistant"; content: string };

/** Eventos do stream — o painel de chat consome cada um incrementalmente. */
export type CopilotoEvento =
  | { tipo: "texto"; texto: string }
  | { tipo: "tool-inicio"; nome: string }
  | { tipo: "tool-fim"; nome: string; ok: boolean }
  | { tipo: "fim" }
  | { tipo: "erro"; mensagem: string };
