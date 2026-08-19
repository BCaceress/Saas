import { NextResponse } from "next/server";
import { requireActiveTenant } from "@/lib/current-tenant";
import { can, podeEmAlguma } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { decifrar } from "@/lib/crypto";
import { logErro } from "@/lib/log";
import { salvarRefreshToken } from "@/lib/fiscal/email-inbox";
import {
  ehOauth,
  lerState,
  redirectUriOauth,
  trocarCodigoPorRefreshToken,
} from "@/lib/fiscal/email-oauth";

/**
 * Volta do consentimento OAuth da caixa de e-mail.
 *
 * Três travas, porque esta URL chega pelo navegador e qualquer um pode montar
 * uma parecida:
 *   1. sessão ativa com `fiscal.configurar` — não basta ter o link;
 *   2. `state` assinado (HMAC do AUTH_SECRET, com validade) — prova que a ida
 *      partiu daqui e aponta para a caixa certa;
 *   3. o tenant do state tem de ser o tenant da sessão — senão um link vazado
 *      gravaria a caixa de e-mail de um cliente dentro de outro.
 *
 * O `code` é de uso único e some da URL na hora: a resposta é um redirect.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DESTINO = "/configuracoes/notas-fiscais";

function voltar(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL(DESTINO, new URL(req.url).origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const erroProvedor = url.searchParams.get("error");
  if (erroProvedor) {
    return voltar(req, { oauth: "erro", motivo: erroProvedor.slice(0, 120) });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return voltar(req, { oauth: "erro", motivo: "Retorno incompleto." });

  const alvo = lerState(state);
  if (!alvo) {
    return voltar(req, { oauth: "erro", motivo: "Link de conexão expirado. Tente de novo." });
  }

  const ctx = await requireActiveTenant();
  if (ctx.tenant.id !== alvo.tenantId || !podeEmAlguma(ctx.acessos, "fiscal.configurar")) {
    return voltar(req, { oauth: "erro", motivo: "Sem permissão para conectar esta conta." });
  }

  try {
    await runWithTenant(ctx.tenant.id, async () => {
      const caixa = await db.fiscalEmailInbox.findFirst({
        where: { id: alvo.inboxId },
        select: {
          id: true,
          siteId: true,
          autenticacao: true,
          oauthClientId: true,
          oauthClientSecret: true,
          oauthTenantId: true,
        },
      });
      if (!caixa) throw new Error("Conta de e-mail não encontrada.");
      if (!ehOauth(caixa.autenticacao)) throw new Error("Esta conta não usa OAuth.");
      // Acesso por loja vale aqui também: a caixa movimenta o estoque dela.
      if (!can(ctx.acessos, "fiscal.configurar", caixa.siteId)) {
        throw new Error("Sem acesso à loja desta conta.");
      }
      if (!caixa.oauthClientId || !caixa.oauthClientSecret) {
        throw new Error("Cadastre o ID e o segredo do cliente OAuth antes de conectar.");
      }

      const refresh = await trocarCodigoPorRefreshToken({
        provider: caixa.autenticacao,
        clientId: caixa.oauthClientId,
        clientSecret: decifrar(caixa.oauthClientSecret) ?? "",
        code,
        redirectUri: redirectUriOauth(url.origin),
        oauthTenantId: caixa.oauthTenantId,
      });

      await salvarRefreshToken(caixa.id, refresh);
    });

    return voltar(req, { oauth: "ok" });
  } catch (e) {
    logErro("fiscal.email.oauth", e);
    return voltar(req, {
      oauth: "erro",
      motivo: e instanceof Error ? e.message.slice(0, 160) : "Falha ao conectar a conta.",
    });
  }
}
