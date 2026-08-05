import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { COPILOTO_TOOLS, getCopilotoTool } from "./registry";
import { systemPromptCopiloto } from "./prompt";
import type { CopilotoCtx, CopilotoEvento, ContextoPagina, MensagemHistorico } from "./tipos";

/**
 * Loop de tool-calling manual sobre `client.messages.stream()`. Cada volta:
 * stream de texto → se o Claude pediu tool_use, executa (dentro do tenant que
 * o caller já abriu) → devolve tool_result → repete. Teto de turnos contém
 * custo e loop que não converge.
 */

const MAX_TURNOS = 6;
const MAX_TOKENS = 2048;

function modeloCopiloto(): string {
  return (
    process.env.ANTHROPIC_MODEL_COPILOTO ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"
  );
}

function ferramentasAnthropic(): Anthropic.Tool[] {
  return COPILOTO_TOOLS.filter((t) => t.kind === "query" && t.handler).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema.toJSONSchema({ io: "input" }) as unknown as Anthropic.Tool.InputSchema,
  }));
}

/** Nunca deixa detalhe de erro interno vazar pro `tool_result` (que o Claude lê). */
async function executarTool(
  uso: Anthropic.ToolUseBlock,
  ctx: CopilotoCtx,
): Promise<{ conteudo: string; erro: boolean }> {
  const tool = getCopilotoTool(uso.name);
  if (!tool || !tool.handler) {
    return { conteudo: JSON.stringify({ erro: "Essa ferramenta não está disponível." }), erro: true };
  }

  const parsed = tool.inputSchema.safeParse(uso.input);
  if (!parsed.success) {
    return { conteudo: JSON.stringify({ erro: "Entrada inválida para essa ferramenta." }), erro: true };
  }

  try {
    const resultado = await tool.handler(parsed.data, ctx);
    if (!resultado.ok) return { conteudo: JSON.stringify({ erro: resultado.erro }), erro: true };
    return { conteudo: JSON.stringify(resultado.conteudo), erro: false };
  } catch {
    return {
      conteudo: JSON.stringify({ erro: "Falha ao executar essa consulta. Tente novamente." }),
      erro: true,
    };
  }
}

export async function* rodarLoopCopiloto(args: {
  ctx: CopilotoCtx;
  historico: MensagemHistorico[];
  pergunta: string;
  contextoPagina: ContextoPagina;
  signal?: AbortSignal;
}): AsyncGenerator<CopilotoEvento> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = ferramentasAnthropic();
  const system = systemPromptCopiloto(args.ctx, args.contextoPagina);

  const messages: Anthropic.MessageParam[] = [
    ...args.historico.slice(-20).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: args.pergunta },
  ];

  for (let turno = 0; turno < MAX_TURNOS; turno++) {
    const stream = client.messages.stream(
      { model: modeloCopiloto(), max_tokens: MAX_TOKENS, system, tools, messages },
      { signal: args.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { tipo: "texto", texto: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    messages.push({ role: "assistant", content: final.content } as Anthropic.MessageParam);

    if (final.stop_reason !== "tool_use") {
      yield { tipo: "fim" };
      return;
    }

    const usos = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const uso of usos) {
      yield { tipo: "tool-inicio", nome: uso.name };
      const { conteudo, erro } = await executarTool(uso, args.ctx);
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: conteudo, is_error: erro });
      yield { tipo: "tool-fim", nome: uso.name, ok: !erro };
    }
    messages.push({ role: "user", content: resultados });
  }

  yield {
    tipo: "erro",
    mensagem: "Muitas etapas para responder — tente reformular a pergunta de um jeito mais direto.",
  };
}
