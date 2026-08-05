import { z } from "zod";
import { getActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { isAdmin } from "@/lib/permissoes";
import { featureAtiva } from "@/lib/planos";
import { llmConfigured } from "@/lib/llm";
import { consumir } from "@/lib/rate-limit";
import { rodarLoopCopiloto } from "@/lib/copiloto/agente";
import { encodeSse } from "@/lib/copiloto/sse";

/**
 * Chat do NoHub IA — streaming (SSE) do loop de tool-calling.
 *
 * NUNCA usa `requireActiveTenant()`/`guardAction()` aqui: essas funções
 * redirecionam (`next/navigation redirect()`) quando faltam tenant/sessão/
 * permissão, o que é certo para página e Server Action mas devolveria um
 * redirect no meio de um `fetch()` de chat. Em vez disso resolve o contexto
 * com `getActiveTenant()` (retorna `null`) e devolve `Response` de erro normal.
 *
 * POST /api/copiloto/chat
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pergunta: z.string().min(1).max(400),
  historico: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .default([]),
  contexto: z
    .object({
      pagina: z.string().max(200).default(""),
      periodoAtivo: z
        .object({
          preset: z.string().max(20),
          de: z.string().max(10).optional(),
          ate: z.string().max(10).optional(),
        })
        .nullable()
        .optional(),
    })
    .default({ pagina: "" }),
});

export async function POST(req: Request) {
  const ctx = await getActiveTenant();
  if (!ctx) return new Response("Não autenticado.", { status: 401 });
  if (!isAdmin(ctx.acessos)) {
    return new Response("Só administradores podem usar o copiloto.", { status: 403 });
  }
  if (!featureAtiva(ctx.tenant, "ia.copiloto")) {
    return new Response("Recurso não contratado neste plano.", { status: 402 });
  }
  if (!llmConfigured()) {
    return new Response("IA não configurada neste ambiente.", { status: 503 });
  }

  const limite = await consumir(`copiloto:${ctx.membershipId}`, 20, 60);
  if (!limite.ok) {
    return new Response("Muitas perguntas seguidas. Aguarde um instante.", { status: 429 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return new Response("Pergunta inválida.", { status: 400 });
    body = parsed.data;
  } catch {
    return new Response("Corpo da requisição inválido.", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await withTenant(ctx, async () => {
          const siteId = await getActiveSiteId();
          const siteNome = siteId
            ? ((await listSites()).find((s) => s.id === siteId)?.nome ?? null)
            : null;

          for await (const evento of rodarLoopCopiloto({
            ctx: { tenant: ctx, siteId, siteNome, policy: policyDoTenant(ctx.tenant) },
            historico: body.historico,
            pergunta: body.pergunta,
            contextoPagina: body.contexto,
            signal: req.signal,
          })) {
            controller.enqueue(encoder.encode(encodeSse(evento)));
          }
        });
      } catch {
        controller.enqueue(
          encoder.encode(encodeSse({ tipo: "erro", mensagem: "Falha ao responder. Tente novamente." })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
