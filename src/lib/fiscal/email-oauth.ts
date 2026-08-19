import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FiscalEmailAuth } from "@/generated/prisma";

// ============================================================
// OAuth2 das caixas de e-mail (XOAUTH2 no IMAP).
//
// Por que existe: o Microsoft 365 já desligou autenticação básica no IMAP para
// boa parte dos tenants, e o Google segue apertando a senha de aplicativo.
// Sem isto, o canal de e-mail simplesmente para de conectar um dia.
//
// Decisão importante: o app OAuth é DO CLIENTE, não do NoHub. Ele cria o
// projeto no Google/Azure e cola client id e secret. Custa um passo a mais na
// configuração e evita o pior cenário do outro caminho — um app único do NoHub
// com escopo de leitura da caixa de e-mail de todos os lojistas, que vira alvo
// e, se for suspenso, derruba o canal de todo mundo ao mesmo tempo.
//
// Guardamos só o refresh token (cifrado). O access token vive minutos e é
// pedido a cada varredura: não vale a coluna nem o risco.
// ============================================================

type Provedor = Exclude<FiscalEmailAuth, "SENHA">;

const PROVEDORES: Record<
  Provedor,
  { nome: string; authUrl: (tenantId?: string | null) => string; tokenUrl: (tenantId?: string | null) => string; escopo: string }
> = {
  OAUTH2_GOOGLE: {
    nome: "Google",
    authUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    escopo: "https://mail.google.com/",
  },
  OAUTH2_MICROSOFT: {
    nome: "Microsoft",
    authUrl: (t) => `https://login.microsoftonline.com/${t || "common"}/oauth2/v2.0/authorize`,
    tokenUrl: (t) => `https://login.microsoftonline.com/${t || "common"}/oauth2/v2.0/token`,
    // offline_access é o que faz a Microsoft devolver refresh token.
    escopo: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
  },
};

export function nomeProvedorOauth(p: FiscalEmailAuth): string {
  return p === "SENHA" ? "Senha de aplicativo" : PROVEDORES[p].nome;
}

export function ehOauth(p: FiscalEmailAuth): p is Provedor {
  return p !== "SENHA";
}

/**
 * URI de retorno registrada no painel do provedor. Sai da origem em que o
 * operador está: com subdomínio por tenant, cada cliente registra a dele.
 */
export const CAMINHO_CALLBACK = "/api/fiscal/email/oauth";

export function redirectUriOauth(origem: string): string {
  return `${origem.replace(/\/+$/, "")}${CAMINHO_CALLBACK}`;
}

/** URL do consentimento. `state` amarra a volta à caixa certa. */
export function urlDeConsentimento(input: {
  provider: Provedor;
  clientId: string;
  redirectUri: string;
  state: string;
  oauthTenantId?: string | null;
  loginHint?: string | null;
}): string {
  const p = PROVEDORES[input.provider];
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: p.escopo,
    state: input.state,
    // Sem estes dois o Google só devolve refresh token na PRIMEIRA autorização
    // — reconectar uma conta já autorizada voltaria sem token e sem explicação.
    access_type: "offline",
    prompt: "consent",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${p.authUrl(input.oauthTenantId)}?${params.toString()}`;
}

async function pedirToken(
  provider: Provedor,
  oauthTenantId: string | null | undefined,
  corpo: Record<string, string>,
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }> {
  const resposta = await fetch(PROVEDORES[provider].tokenUrl(oauthTenantId), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo).toString(),
  });

  const json = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resposta.ok) {
    const msg =
      (json.error_description as string) ?? (json.error as string) ?? `HTTP ${resposta.status}`;
    throw new Error(`O provedor recusou a autorização: ${msg}`);
  }
  return json;
}

/** Troca o `code` do consentimento pelo refresh token que fica guardado. */
export async function trocarCodigoPorRefreshToken(input: {
  provider: Provedor;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  oauthTenantId?: string | null;
}): Promise<string> {
  const r = await pedirToken(input.provider, input.oauthTenantId, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  if (!r.refresh_token) {
    throw new Error(
      "O provedor não devolveu refresh token. Refaça a conexão aceitando o acesso offline " +
        "(no Google, remova o app em myaccount.google.com/permissions e autorize de novo).",
    );
  }
  return r.refresh_token;
}

/** Access token para o XOAUTH2 do IMAP. Vale minutos — pedido a cada varredura. */
export async function accessTokenParaImap(input: {
  provider: Provedor;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  oauthTenantId?: string | null;
}): Promise<string> {
  const r = await pedirToken(input.provider, input.oauthTenantId, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    ...(input.provider === "OAUTH2_MICROSOFT"
      ? { scope: PROVEDORES.OAUTH2_MICROSOFT.escopo }
      : {}),
  });

  if (!r.access_token) {
    throw new Error(
      "A autorização desta conta expirou ou foi revogada. Conecte a conta novamente.",
    );
  }
  return r.access_token;
}

// ── state assinado ──────────────────────────────────────────
// O callback chega pelo navegador, por uma URL que o usuário (ou qualquer um)
// pode montar. O state assinado é o que garante que a volta é da ida que NÓS
// começamos, e para a caixa que NÓS escolhemos.

const VALIDADE_STATE_MS = 15 * 60 * 1000;

function segredo(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET ausente — não dá para assinar o retorno do OAuth.");
  return s;
}

function assinar(payload: string): string {
  return createHmac("sha256", segredo()).update(payload).digest("base64url");
}

export function criarState(inboxId: string, tenantId: string): string {
  const payload = `${inboxId}.${tenantId}.${Date.now() + VALIDADE_STATE_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${assinar(payload)}`;
}

export function lerState(state: string): { inboxId: string; tenantId: string } | null {
  const [dados, assinatura] = state.split(".");
  if (!dados || !assinatura) return null;

  const payload = Buffer.from(dados, "base64url").toString();
  const esperada = Buffer.from(assinar(payload));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  const [inboxId, tenantId, expira] = payload.split(".");
  if (!inboxId || !tenantId || Number(expira) < Date.now()) return null;
  return { inboxId, tenantId };
}
