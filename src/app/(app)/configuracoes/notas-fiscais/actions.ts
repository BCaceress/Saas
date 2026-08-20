"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { db } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import {
  dadosOauthDaCaixa,
  listarCaixas,
  removerCaixa,
  salvarCaixa,
  sincronizarCaixa,
  sincronizarCaixasDoTenant,
  testarCaixa,
} from "@/lib/fiscal/email-inbox";
import {
  criarState,
  ehOauth,
  redirectUriOauth,
  urlDeConsentimento,
} from "@/lib/fiscal/email-oauth";
import { listarImportacoes } from "@/lib/fiscal/import-log";
import { sincronizarDistribuicao } from "@/lib/fiscal/distribuicao";
import type { ActiveTenant } from "@/lib/current-tenant";

// ============================================================
// Configuração dos canais de entrada de NF-e.
//
// Permissão: `fiscal.configurar` — quem mexe aqui está entregando a senha da
// caixa de e-mail da empresa e ligando uma automação que movimenta estoque.
// Não é a mesma pessoa que cadastra produto.
// ============================================================

const ROTA = "/configuracoes/notas-fiscais";

async function tx<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await guardAction("fiscal.configurar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

// ── E-mail (IMAP) ───────────────────────────────────────────

const caixaSchema = z.object({
  id: z.string().min(1).nullable().optional(),
  nome: z.string().trim().min(1, "Dê um nome para identificar a conta.").max(60),
  email: z.string().trim().email("E-mail inválido."),
  host: z.string().trim().min(1, "Informe o servidor IMAP.").max(120),
  porta: z.coerce.number().int().min(1).max(65535),
  ssl: z.boolean(),
  usuario: z.string().trim().min(1, "Informe o usuário.").max(160),
  /** Vazio na edição = mantém a senha guardada. */
  senha: z.string().max(300).default(""),
  pasta: z.string().trim().min(1).max(120).default("INBOX"),
  ativo: z.boolean().default(true),
  siteId: z.string().min(1, "Escolha a loja onde a mercadoria entra."),
  autenticacao: z.enum(["SENHA", "OAUTH2_GOOGLE", "OAUTH2_MICROSOFT"]).default("SENHA"),
  oauthClientId: z.string().trim().max(300).optional(),
  /** Vazio na edição = mantém o secret guardado. */
  oauthClientSecret: z.string().max(300).default(""),
  oauthTenantId: z.string().trim().max(100).optional(),
});

export async function salvarCaixaEmailAction(input: z.input<typeof caixaSchema>) {
  return tx(async () => {
    const d = caixaSchema.parse(input);
    const id = await salvarCaixa(d.id ?? null, {
      nome: d.nome,
      email: d.email,
      host: d.host,
      porta: d.porta,
      ssl: d.ssl,
      usuario: d.usuario,
      senha: d.senha,
      pasta: d.pasta,
      ativo: d.ativo,
      siteId: d.siteId,
      autenticacao: d.autenticacao,
      oauthClientId: d.oauthClientId || null,
      oauthClientSecret: d.oauthClientSecret,
      oauthTenantId: d.oauthTenantId || null,
    });
    revalidatePath(ROTA);
    return { id };
  });
}

export async function removerCaixaEmailAction(id: string) {
  return tx(async () => {
    await removerCaixa(id);
    revalidatePath(ROTA);
  });
}

const testeSchema = caixaSchema.pick({
  id: true,
  host: true,
  porta: true,
  ssl: true,
  usuario: true,
  senha: true,
  pasta: true,
  autenticacao: true,
});

/** Conecta com o que está na tela e conta as mensagens — prova de que funciona. */
export async function testarCaixaEmailAction(input: z.input<typeof testeSchema>) {
  return tx(async () => {
    const d = testeSchema.parse(input);
    return testarCaixa({
      id: d.id ?? null,
      host: d.host,
      porta: d.porta,
      ssl: d.ssl,
      usuario: d.usuario,
      senha: d.senha,
      pasta: d.pasta,
      autenticacao: d.autenticacao,
    });
  });
}

/**
 * Monta a URL do consentimento. O redirect_uri sai da origem em que o operador
 * está — é ela que precisa estar registrada no painel do provedor, e num app
 * multi-tenant por subdomínio essa origem muda por cliente.
 */
export async function iniciarConexaoOauthAction(input: { inboxId: string; origem: string }) {
  return tx(async (ctx) => {
    const caixa = await dadosOauthDaCaixa(input.inboxId);
    if (!ehOauth(caixa.autenticacao)) {
      throw new Error("Esta conta usa senha de aplicativo — não há o que conectar.");
    }
    if (!caixa.clientId) {
      throw new Error("Informe o ID do cliente OAuth antes de conectar.");
    }

    return {
      url: urlDeConsentimento({
        provider: caixa.autenticacao,
        clientId: caixa.clientId,
        redirectUri: redirectUriOauth(input.origem),
        state: criarState(input.inboxId, ctx.tenant.id),
        oauthTenantId: caixa.oauthTenantId,
        loginHint: caixa.email,
      }),
    };
  });
}


/** "Verificar agora": não espera o job — o operador quer ver a nota entrar. */
export async function verificarCaixasAction(inboxId?: string | null) {
  return tx(async (ctx) => {
    // `forcar`: o clique do operador ignora o backoff — ele acabou de mexer na
    // configuração e precisa ver o resultado agora.
    const r = inboxId
      ? { ...(await sincronizarCaixa(ctx.tenant.id, inboxId, { forcar: true })), caixas: 1 }
      : await sincronizarCaixasDoTenant(ctx.tenant.id, { forcar: true });

    revalidatePath(ROTA);
    revalidatePath("/recebimento");
    revalidatePath("/fiscal/notas-recebidas");
    return r;
  });
}

export async function listarCaixasAction() {
  return tx(() => listarCaixas());
}

// ── SEFAZ ───────────────────────────────────────────────────

/** Pergunta à SEFAZ o que os fornecedores emitiram contra o nosso CNPJ. */
export async function consultarSefazAction() {
  return tx(async (ctx) => {
    const ativo = await getActiveSiteId();
    const siteId = ativo ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id;

    const r = await sincronizarDistribuicao({
      tenantId: ctx.tenant.id,
      siteId,
      userId: ctx.user.id,
    });

    revalidatePath(ROTA);
    revalidatePath("/recebimento");
    revalidatePath("/fiscal/notas-recebidas");
    return r;
  });
}

/**
 * Liga/desliga a ciência automática. Manifestação NÃO tem desfazer na SEFAZ —
 * por isso a decisão é explícita, com o aviso na tela, e nunca um padrão.
 */
export async function salvarManifestacaoAutomaticaAction(ativa: boolean) {
  return tx(async () => {
    const atual = await db.fiscalConfig.findFirst({ select: { id: true } });
    if (!atual) {
      throw new Error("Configure o provedor fiscal antes de ligar a ciência automática.");
    }
    await db.fiscalConfig.updateMany({
      where: { id: atual.id },
      data: { manifestacaoAutomatica: ativa },
    });
    revalidatePath(ROTA);
  });
}

// ── Histórico ───────────────────────────────────────────────

export async function historicoImportacoesAction(limite = 50) {
  return tx(() => listarImportacoes({ limite }));
}
