"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { rootUrl } from "@/lib/urls";
import { listSitePaymentMethods } from "@/lib/vendas";
import {
  listarTerminaisDoProvedor,
  prepararTerminalNoProvedor,
  testarCredenciaisProvedor,
  type TerminalInfo,
} from "@/lib/pagamentos";

async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("config.gerenciar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

// Token colado do painel pode vir com espaços/quebra de linha ou "Bearer "
// duplicado — normaliza antes de salvar/testar (evita erro de parse no PSP).
function limparToken(token: string): string {
  return token.replace(/\s+/g, "").replace(/^bearer/i, "");
}

const schema = z.object({
  siteId: z.string().min(1),
  metodo: z.enum(["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"]),
  ativo: z.boolean(),
});

export async function toggleMetodoPagamentoAction(input: z.input<typeof schema>) {
  return tx(async (tid) => {
    const d = schema.parse(input);
    // garante que os defaults existem antes de alternar
    await listSitePaymentMethods(tid, d.siteId);
    const existing = await db.sitePaymentMethod.findFirst({
      where: { siteId: d.siteId, metodo: d.metodo },
      select: { id: true },
    });
    if (existing) {
      await db.sitePaymentMethod.update({ where: { id: existing.id }, data: { ativo: d.ativo } });
    } else {
      await db.sitePaymentMethod.create({
        data: { tenantId: tid, siteId: d.siteId, metodo: d.metodo, ativo: d.ativo },
      });
    }
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

// ============================================================
// Pagamento integrado — provedor (PSP) e maquininhas
// ============================================================

const provedorSchema = z.object({
  provider: z.enum(["MERCADO_PAGO", "STONE", "PAGSEGURO", "SIMULADO"]),
  /** Vazio no update = mantém o token salvo. */
  accessToken: z.string().optional().default(""),
  webhookSecret: z.string().optional().default(""),
  /** Stone Connect: código do Programa de Parcerias (ServiceRefererName). */
  partnerRef: z.string().optional().default(""),
  /** PagBank: produção x sandbox — hosts de API diferentes. */
  ambiente: z.enum(["PRODUCAO", "SANDBOX"]).default("PRODUCAO"),
  ativo: z.boolean().default(true),
  pixAutomatico: z.boolean().default(true),
  cartaoIntegrado: z.boolean().default(false),
});

export async function salvarProvedorPagamentoAction(input: z.input<typeof provedorSchema>) {
  return tx(async (tid) => {
    const d = provedorSchema.parse(input);
    const existing = await db.paymentProviderConfig.findFirst({
      select: { id: true, accessToken: true, webhookSecret: true, partnerRef: true },
    });

    const accessToken = limparToken(d.accessToken) || existing?.accessToken || "";
    if (d.provider !== "SIMULADO" && !accessToken) {
      throw new Error(
        d.provider === "STONE"
          ? "Informe a Secret Key da Stone (Pagar.me, sk_…)."
          : d.provider === "PAGSEGURO"
            ? "Informe o token de aplicação do PagSeguro."
            : "Informe o Access Token do Mercado Pago.",
      );
    }
    const partnerRef = d.partnerRef.trim() || existing?.partnerRef || null;
    // Cartão no POS Stone (Connect 2.0) só funciona com o código de parceiro
    if (d.provider === "STONE" && d.cartaoIntegrado && !partnerRef) {
      throw new Error(
        "Cartão integrado Stone exige o código do Programa de Parcerias (ServiceRefererName).",
      );
    }
    if (d.provider === "PAGSEGURO" && d.cartaoIntegrado) {
      throw new Error("PagSeguro ainda não suporta cartão integrado — use maquininha externa.");
    }

    const data = {
      provider: d.provider,
      accessToken,
      webhookSecret: d.webhookSecret.trim() || existing?.webhookSecret || null,
      partnerRef,
      ambiente: d.ambiente,
      ativo: d.ativo,
      pixAutomatico: d.pixAutomatico,
      cartaoIntegrado: d.cartaoIntegrado,
    };
    if (existing) {
      await db.paymentProviderConfig.update({ where: { id: existing.id }, data });
    } else {
      await db.paymentProviderConfig.create({ data: { tenantId: tid, ...data } });
    }
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

// ── Testar token — valida a credencial no PSP antes de salvar ──
const testarTokenSchema = z.object({
  provider: z.enum(["MERCADO_PAGO", "STONE", "PAGSEGURO"]),
  accessToken: z.string().optional().default(""),
  partnerRef: z.string().optional().default(""),
  ambiente: z.enum(["PRODUCAO", "SANDBOX"]).default("PRODUCAO"),
});

export type TesteTokenResultado = {
  ok: boolean;
  /** PSP não expõe validação sem efeito colateral (ex.: Stone). */
  suportado: boolean;
  mensagem?: string;
};

export async function testarTokenPagamentoAction(
  input: z.input<typeof testarTokenSchema>
): Promise<TesteTokenResultado> {
  return tx(async () => {
    const d = testarTokenSchema.parse(input);
    const existing = await db.paymentProviderConfig.findFirst({
      select: { provider: true, accessToken: true },
    });
    const token =
      limparToken(d.accessToken) ||
      (existing?.provider === d.provider ? existing.accessToken : "");
    if (!token) {
      return { ok: false, suportado: true, mensagem: "Cole o token antes de testar." };
    }
    return testarCredenciaisProvedor({
      provider: d.provider,
      accessToken: token,
      partnerRef: d.partnerRef.trim() || null,
      ambiente: d.ambiente,
    });
  });
}

// ── Segredo do webhook — gerado pelo sistema, nunca digitado à mão ──
const WEBHOOK_PATH: Record<string, string> = {
  MERCADO_PAGO: "/api/webhooks/mercadopago",
  STONE: "/api/webhooks/stone",
  PAGSEGURO: "/api/webhooks/pagseguro",
};

export async function gerarSegredoWebhookAction(): Promise<void> {
  return tx(async () => {
    const existing = await db.paymentProviderConfig.findFirst({ select: { id: true } });
    if (!existing) throw new Error("Conecte um provedor antes de configurar o webhook.");
    const segredo = randomBytes(24).toString("hex");
    await db.paymentProviderConfig.update({
      where: { id: existing.id },
      data: { webhookSecret: segredo },
    });
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

/**
 * Monta a URL de notificação já com o segredo — só existe no momento da
 * cópia (não fica em nenhum estado de tela nem é reenviada depois).
 */
export async function obterUrlWebhookAction(): Promise<string> {
  return tx(async () => {
    const cfg = await db.paymentProviderConfig.findFirst({
      select: { provider: true, webhookSecret: true },
    });
    const path = cfg && WEBHOOK_PATH[cfg.provider];
    if (!cfg || !path) throw new Error("Configure o provedor antes de gerar a URL de notificação.");
    if (!cfg.webhookSecret) throw new Error("Gere o segredo do webhook antes de copiar a URL.");
    return `${rootUrl(path)}?token=${cfg.webhookSecret}`;
  });
}

// Modo de processamento por método (Pix automático/manual, cartão
// terminal integrado/maquininha externa) — grava nos flags da config.
const recursosSchema = z.object({
  pixAutomatico: z.boolean().optional(),
  cartaoIntegrado: z.boolean().optional(),
});

export async function atualizarRecursosPagamentoAction(input: z.input<typeof recursosSchema>) {
  return tx(async () => {
    const d = recursosSchema.parse(input);
    const existing = await db.paymentProviderConfig.findFirst({ select: { id: true } });
    if (!existing) {
      // sem provedor tudo já é manual — só bloqueia se tentar ligar automação
      if (d.pixAutomatico || d.cartaoIntegrado) {
        throw new Error("Conecte um provedor de pagamentos antes de ativar o modo automático.");
      }
      return;
    }
    await db.paymentProviderConfig.update({
      where: { id: existing.id },
      data: {
        ...(d.pixAutomatico !== undefined && { pixAutomatico: d.pixAutomatico }),
        ...(d.cartaoIntegrado !== undefined && { cartaoIntegrado: d.cartaoIntegrado }),
      },
    });
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

// ── Testar conexão — checklist em linguagem de operador ─────
export type TesteConexaoItem = {
  rotulo: string;
  status: "ok" | "warn" | "erro";
  detalhe?: string;
};
export type TesteConexaoResultado = { ok: boolean; itens: TesteConexaoItem[] };

export async function testarConexaoPagamentoAction(): Promise<TesteConexaoResultado> {
  return tx(async (tid) => {
    const cfg = await db.paymentProviderConfig.findFirst({
      select: {
        provider: true,
        accessToken: true,
        webhookSecret: true,
        partnerRef: true,
        ambiente: true,
        pixAutomatico: true,
        cartaoIntegrado: true,
      },
    });
    if (!cfg) {
      return {
        ok: false,
        itens: [{ rotulo: "Provedor", status: "erro" as const, detalhe: "Nenhum provedor conectado." }],
      };
    }

    const itens: TesteConexaoItem[] = [];

    if (cfg.provider === "SIMULADO") {
      itens.push({
        rotulo: "Credenciais",
        status: "ok",
        detalhe: "Provedor simulado — as cobranças aprovam sozinhas, sem dinheiro real.",
      });
    } else if (cfg.provider === "MERCADO_PAGO") {
      try {
        const encontrados = await listarTerminaisDoProvedor(tid);
        itens.push({ rotulo: "Credenciais", status: "ok", detalhe: "Access Token válido." });
        if (cfg.cartaoIntegrado) {
          itens.push(
            encontrados.length > 0
              ? {
                  rotulo: "Terminais",
                  status: "ok",
                  detalhe: `${encontrados.length} ${encontrados.length === 1 ? "terminal encontrado" : "terminais encontrados"} na conta.`,
                }
              : {
                  rotulo: "Terminais",
                  status: "warn",
                  detalhe: "Nenhum terminal na conta — o cartão integrado não vai funcionar até vincular um.",
                }
          );
        }
      } catch (e) {
        itens.push({
          rotulo: "Credenciais",
          status: "erro",
          detalhe: e instanceof Error ? e.message : "Não foi possível falar com o Mercado Pago.",
        });
      }
    } else if (cfg.provider === "STONE") {
      // Stone não expõe verificação sem criar cobrança real
      itens.push({
        rotulo: "Credenciais",
        status: "warn",
        detalhe: "A Stone não permite validar a credencial sem criar uma cobrança — confirme com uma venda de teste.",
      });
      if (cfg.cartaoIntegrado && !cfg.partnerRef) {
        itens.push({
          rotulo: "Cartão integrado",
          status: "erro",
          detalhe: "Falta o código de parceiro Stone Connect — o envio ao terminal não vai funcionar.",
        });
      }
    } else {
      const r = await testarCredenciaisProvedor({
        provider: "PAGSEGURO",
        accessToken: cfg.accessToken,
        ambiente: cfg.ambiente,
      });
      itens.push(
        r.ok
          ? { rotulo: "Credenciais", status: "ok", detalhe: "Conexão estabelecida com o PagBank." }
          : { rotulo: "Credenciais", status: "erro", detalhe: r.mensagem ?? "Não foi possível validar o token." }
      );
    }

    itens.push(
      cfg.pixAutomatico
        ? { rotulo: "Pix automático", status: "ok", detalhe: "Ativo — QR Code exclusivo a cada venda." }
        : { rotulo: "Pix automático", status: "warn", detalhe: "Desativado — o operador confirma o Pix manualmente." }
    );
    itens.push(
      cfg.webhookSecret
        ? { rotulo: "Notificações", status: "ok", detalhe: "Webhook configurado — confirmação em tempo real." }
        : {
            rotulo: "Notificações",
            status: "warn",
            detalhe: "Sem webhook — o sistema confirma por verificação automática de segurança.",
          }
    );

    return { ok: itens.every((i) => i.status !== "erro"), itens };
  });
}

export async function removerProvedorPagamentoAction() {
  return tx(async () => {
    await db.paymentProviderConfig.deleteMany({});
    await db.paymentTerminal.deleteMany({});
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

/** Consulta as maquininhas disponíveis na conta do PSP. */
export async function buscarTerminaisAction(): Promise<TerminalInfo[]> {
  return tx(async (tid) => listarTerminaisDoProvedor(tid));
}

const vincularSchema = z.object({
  siteId: z.string().min(1),
  externalId: z.string().min(1),
  nome: z.string().min(1, "Dê um nome à maquininha (ex.: Point Caixa 01)."),
});

export async function vincularTerminalAction(input: z.input<typeof vincularSchema>) {
  return tx(async (tid) => {
    const d = vincularSchema.parse(input);
    const cfg = await db.paymentProviderConfig.findFirst({ select: { provider: true } });
    if (!cfg) throw new Error("Configure o provedor antes de vincular maquininhas.");

    // MP Point: coloca o dispositivo em modo PDV (aceita intenções via API)
    await prepararTerminalNoProvedor(tid, d.externalId);

    const existing = await db.paymentTerminal.findFirst({
      where: { externalId: d.externalId },
      select: { id: true },
    });
    if (existing) {
      await db.paymentTerminal.update({
        where: { id: existing.id },
        data: { siteId: d.siteId, nome: d.nome, ativo: true },
      });
    } else {
      await db.paymentTerminal.create({
        data: {
          tenantId: tid,
          siteId: d.siteId,
          nome: d.nome,
          provider: cfg.provider,
          externalId: d.externalId,
        },
      });
    }
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

// Renomear / mudar a loja de um terminal já vinculado (não toca no provedor).
const terminalUpdateSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1, "Dê um nome ao terminal.").optional(),
  siteId: z.string().min(1).optional(),
});

export async function atualizarTerminalAction(input: z.input<typeof terminalUpdateSchema>) {
  return tx(async () => {
    const d = terminalUpdateSchema.parse(input);
    const existing = await db.paymentTerminal.findFirst({
      where: { id: d.id },
      select: { id: true },
    });
    if (!existing) throw new Error("Terminal não encontrado.");
    await db.paymentTerminal.update({
      where: { id: existing.id },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.siteId !== undefined && { siteId: d.siteId }),
      },
    });
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}

export async function removerTerminalAction(terminalId: string) {
  return tx(async () => {
    await db.paymentTerminal.deleteMany({ where: { id: terminalId } });
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}
