"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { listSitePaymentMethods } from "@/lib/vendas";
import {
  listarTerminaisDoProvedor,
  prepararTerminalNoProvedor,
  type TerminalInfo,
} from "@/lib/pagamentos";

async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
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

    const accessToken = d.accessToken.trim() || existing?.accessToken || "";
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
      select: { provider: true, webhookSecret: true, partnerRef: true, pixAutomatico: true, cartaoIntegrado: true },
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
      // PagSeguro não expõe verificação sem criar cobrança real
      itens.push({
        rotulo: "Credenciais",
        status: "warn",
        detalhe: "O PagSeguro não permite validar a credencial sem criar uma cobrança — confirme com uma venda de teste.",
      });
    }

    itens.push(
      cfg.pixAutomatico
        ? { rotulo: "Pix automático", status: "ok", detalhe: "Ativo — QR Code exclusivo a cada venda." }
        : { rotulo: "Pix automático", status: "warn", detalhe: "Desativado — o operador confirma o Pix manualmente." }
    );
    itens.push(
      cfg.webhookSecret
        ? { rotulo: "Webhook", status: "ok", detalhe: "Assinatura configurada — confirmação em tempo real." }
        : {
            rotulo: "Webhook",
            status: "warn",
            detalhe: "Sem webhook — o Pix pode demorar até 3 segundos para confirmar (consulta periódica).",
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
