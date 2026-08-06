import { z } from "zod";
import { getActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";

/**
 * Inscrição de push do aparelho.
 *
 * Segue o padrão de `api/copiloto/chat`: resolve o contexto com
 * `getActiveTenant()` (devolve null) em vez de `requireActiveTenant()`, que
 * REDIRECIONA — num `fetch()` isso viraria um HTML de login com status 200, e
 * o cliente acharia que deu certo.
 *
 * Sessão ausente é barrada antes daqui, pelo middleware, que manda para o
 * login do domínio raiz. O 401 abaixo cobre o caso restante: cookie de sessão
 * válido mas sem tenant/membership resolvível (subdomínio errado, acesso
 * revogado). O cliente trata os dois como falha — ver `ativar-notificacoes`.
 *
 * POST   grava/atualiza a inscrição deste navegador.
 * DELETE remove (a pessoa desligou as notificações).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inscricaoSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

const naoAutenticado = () =>
  Response.json({ erro: "Sessão expirada." }, { status: 401 });

export async function POST(req: Request) {
  const ctx = await getActiveTenant();
  if (!ctx?.user.id) return naoAutenticado();

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  const parsed = inscricaoSchema.safeParse(corpo);
  if (!parsed.success) {
    return Response.json({ erro: "Inscrição inválida." }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  const userId = ctx.user.id;
  const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

  await runWithTenant(ctx.tenant.id, async () => {
    await db.pushSubscription.upsert({
      // Chave composta: o mesmo endpoint pode existir em tenants diferentes se
      // a pessoa usa o mesmo aparelho em duas contas.
      where: { tenantId_endpoint: { tenantId: ctx.tenant.id, endpoint } },
      create: {
        tenantId: ctx.tenant.id,
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
      // Reinscrição do mesmo aparelho: as chaves mudam e o contador de falhas
      // volta a zero — o aparelho está claramente vivo.
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        falhas: 0,
      },
    });
  });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await getActiveTenant();
  if (!ctx?.user.id) return naoAutenticado();

  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) return Response.json({ erro: "Endpoint ausente." }, { status: 400 });

  await runWithTenant(ctx.tenant.id, async () => {
    await db.pushSubscription.deleteMany({ where: { endpoint } });
  });

  return Response.json({ ok: true });
}
