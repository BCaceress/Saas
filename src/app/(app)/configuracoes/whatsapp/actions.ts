"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertFeature, guardAction } from "@/lib/guard";
import {
  canalAtivo,
  configDoTenant,
  desligarCanal,
  salvarConfig,
  testarCredenciais,
} from "@/lib/whatsapp";
import { numerosPossiveis, parametrosDoTemplate } from "@/lib/compras/cotacao-whatsapp";
import { providerDe } from "@/lib/whatsapp";

// ============================================================
// Configuração do canal WhatsApp (add-on do plano Diamante).
//
// Permissão é `config.gerenciar`: quem mexe aqui está ligando um canal que
// fala com fornecedor em nome da empresa — e colando um token que gasta
// dinheiro por mensagem.
//
// Token e App Secret NUNCA voltam para a tela. Campo vazio no formulário quer
// dizer "mantém o que está guardado", nunca "apaga".
// ============================================================

const ROTA = "/configuracoes/whatsapp";

/** Token colado do painel da Meta costuma vir com espaço ou "Bearer ". */
function limparToken(token: string): string {
  return token.replace(/\s+/g, "").replace(/^bearer/i, "");
}

const configSchema = z.object({
  provider: z.enum(["META_CLOUD", "SIMULADO"]),
  ativo: z.boolean().default(false),
  phoneNumberId: z.string().trim().min(1, "Informe o ID do número na Meta.").max(64),
  wabaId: z.string().trim().max(64).optional().default(""),
  numeroExibicao: z.string().trim().max(40).optional().default(""),
  /** Vazio = mantém o token guardado. */
  accessToken: z.string().optional().default(""),
  appSecret: z.string().optional().default(""),
  templateNome: z.string().trim().min(1).max(120).default("cotacao_fornecedor"),
  templateIdioma: z.string().trim().min(2).max(10).default("pt_BR"),
});

export async function salvarWhatsAppAction(input: z.input<typeof configSchema>) {
  const d = configSchema.parse(input);
  const ctx = await guardAction("config.gerenciar", null, { mesmoSuspenso: true });
  assertFeature(ctx, "compras.whatsapp");

  await salvarConfig({
    tenantId: ctx.tenant.id,
    provider: d.provider,
    ativo: d.ativo,
    phoneNumberId: d.phoneNumberId,
    wabaId: d.wabaId || null,
    numeroExibicao: d.numeroExibicao || null,
    accessToken: d.accessToken ? limparToken(d.accessToken) : null,
    // String vazia é "não mexer"; para APAGAR o segredo o operador troca o
    // provedor ou cola outro — apagar por omissão derrubaria a validação de
    // assinatura do webhook sem ninguém pedir.
    appSecret: d.appSecret ? limparToken(d.appSecret) : null,
    templateNome: d.templateNome,
    templateIdioma: d.templateIdioma,
  });

  revalidatePath(ROTA, "layout");
  return { ok: true as const };
}

const testeSchema = z.object({
  provider: z.enum(["META_CLOUD", "SIMULADO"]),
  phoneNumberId: z.string().trim().min(1),
  /** Vazio = testa com o token já guardado. */
  accessToken: z.string().optional().default(""),
});

/**
 * Confere a credencial contra a Meta sem gravar nada — e devolve o número que
 * o fornecedor vai ver. "Salvei e não sei se funciona" é o pior estado
 * possível para um canal que manda mensagem paga.
 */
export async function testarWhatsAppAction(input: z.input<typeof testeSchema>) {
  const d = testeSchema.parse(input);
  const ctx = await guardAction("config.gerenciar", null, { mesmoSuspenso: true });
  assertFeature(ctx, "compras.whatsapp");

  let token = d.accessToken ? limparToken(d.accessToken) : "";
  if (!token) {
    const cfg = await configDoTenant(ctx.tenant.id);
    token = cfg?.accessToken ?? "";
  }
  if (!token && d.provider !== "SIMULADO") {
    return { ok: false as const, numero: null, nome: null, mensagem: "Cole o token de acesso." };
  }
  return testarCredenciais({
    provider: d.provider,
    phoneNumberId: d.phoneNumberId,
    accessToken: token,
  });
}

const provaSchema = z.object({
  telefone: z.string().trim().min(8, "Informe um número com DDD."),
});

/**
 * Manda o template para o número do próprio operador, com dados de exemplo.
 *
 * Vale o custo de uma mensagem: é o único jeito de descobrir ANTES do primeiro
 * disparo real que o template foi aprovado com os buracos em outra ordem — e
 * de ver a mensagem como o fornecedor vê.
 */
export async function enviarProvaWhatsAppAction(input: z.input<typeof provaSchema>) {
  const d = provaSchema.parse(input);
  const ctx = await guardAction("config.gerenciar", null, { mesmoSuspenso: true });
  assertFeature(ctx, "compras.whatsapp");

  const cfg = await canalAtivo(ctx.tenant.id);
  if (!cfg) {
    return {
      ok: false as const,
      mensagem: "Ligue o canal e salve antes de mandar a mensagem de teste.",
    };
  }
  const [para, ...alternativos] = numerosPossiveis(d.telefone);
  if (!para) return { ok: false as const, mensagem: "Número inválido. Use DDD + número." };

  try {
    await providerDe(cfg).enviarTemplate({
      para,
      alternativos,
      template: cfg.templateNome,
      idioma: cfg.templateIdioma,
      parametros: parametrosDoTemplate({
        empresa: ctx.tenant.nome,
        numero: "COT-00000",
        prazo: null,
        link: "https://nohub.market/cotacao/exemplo",
      }),
    });
    return { ok: true as const, mensagem: "Mensagem de teste enviada." };
  } catch (e) {
    return {
      ok: false as const,
      mensagem: e instanceof Error ? e.message : "Não foi possível enviar a mensagem de teste.",
    };
  }
}

export async function desligarWhatsAppAction() {
  const ctx = await guardAction("config.gerenciar", null, { mesmoSuspenso: true });
  await desligarCanal(ctx.tenant.id);
  revalidatePath(ROTA, "layout");
  return { ok: true as const };
}
