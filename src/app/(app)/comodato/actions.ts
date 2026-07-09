"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";

/** Roda `fn` no contexto de tenant. */
async function tx<T>(fn: (ctx: { tid: string }) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn({ tid: ctx.tenant.id }));
}

const ok = () => revalidatePath("/comodato");

/** dd/mm/aaaa → Date (UTC, sem hora). null se vazio/inválido. */
function parseData(s?: string | null): Date | null {
  const d = onlyDigits(s ?? "");
  if (d.length !== 8) return null;
  const dia = Number(d.slice(0, 2));
  const mes = Number(d.slice(2, 4));
  const ano = Number(d.slice(4, 8));
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 2000) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// ── Equipamentos ────────────────────────────────────────────

const assetSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do equipamento."),
  identificacao: z.string().trim().min(1, "Informe o serial ou nº de patrimônio."),
  valorEstimado: z.number().min(0).max(9_999_999).nullable(),
  observacao: z.string().trim().optional().nullable(),
});

export async function createAsset(input: z.input<typeof assetSchema>) {
  return tx(async ({ tid }) => {
    const d = assetSchema.parse(input);
    const dup = await db.comodatoAsset.findFirst({
      where: { identificacao: d.identificacao.trim() },
    });
    if (dup) throw new Error(`Já existe um equipamento com essa identificação: «${dup.nome}».`);
    const a = await db.comodatoAsset.create({
      data: {
        tenantId: tid,
        nome: d.nome.trim(),
        identificacao: d.identificacao.trim(),
        valorEstimado: d.valorEstimado,
        observacao: d.observacao?.trim() || null,
      },
    });
    ok();
    return a.id;
  });
}

export async function updateAsset(id: string, input: z.input<typeof assetSchema>) {
  return tx(async () => {
    const d = assetSchema.parse(input);
    const dup = await db.comodatoAsset.findFirst({
      where: { identificacao: d.identificacao.trim(), id: { not: id } },
    });
    if (dup) throw new Error(`Já existe um equipamento com essa identificação: «${dup.nome}».`);
    await db.comodatoAsset.update({
      where: { id },
      data: {
        nome: d.nome.trim(),
        identificacao: d.identificacao.trim(),
        valorEstimado: d.valorEstimado,
        observacao: d.observacao?.trim() || null,
      },
    });
    ok();
  });
}

const loanSchema = z.object({
  assetId: z.string().min(1),
  customerId: z.string().min(1, "Escolha o cliente."),
  previsaoDevolucao: z.string().optional().nullable(), // dd/mm/aaaa
  condicaoSaida: z.string().trim().optional().nullable(),
  observacao: z.string().trim().optional().nullable(),
});

export async function loanAssetAction(input: z.input<typeof loanSchema>) {
  return tx(async ({ tid }) => {
    const d = loanSchema.parse(input);
    const asset = await db.comodatoAsset.findFirst({ where: { id: d.assetId } });
    if (!asset) throw new Error("Equipamento não encontrado.");
    if (asset.status !== "DISPONIVEL") {
      throw new Error("Equipamento não está disponível para empréstimo.");
    }
    const aberto = await db.comodatoLoan.findFirst({
      where: { assetId: d.assetId, devolvidoEm: null },
    });
    if (aberto) throw new Error("Este equipamento já tem um empréstimo em aberto.");

    await db.comodatoLoan.create({
      data: {
        tenantId: tid,
        assetId: d.assetId,
        customerId: d.customerId,
        previsaoDevolucao: parseData(d.previsaoDevolucao),
        condicaoSaida: d.condicaoSaida?.trim() || null,
        observacao: d.observacao?.trim() || null,
      },
    });
    await db.comodatoAsset.update({ where: { id: d.assetId }, data: { status: "EMPRESTADO" } });
    ok();
  });
}

const returnSchema = z.object({
  loanId: z.string().min(1),
  condicaoRetorno: z.string().trim().optional().nullable(),
  paraManutencao: z.boolean().optional(),
});

export async function returnAssetAction(input: z.input<typeof returnSchema>) {
  return tx(async () => {
    const d = returnSchema.parse(input);
    const loan = await db.comodatoLoan.findFirst({
      where: { id: d.loanId, devolvidoEm: null },
    });
    if (!loan) throw new Error("Empréstimo não encontrado ou já devolvido.");

    await db.comodatoLoan.update({
      where: { id: loan.id },
      data: { devolvidoEm: new Date(), condicaoRetorno: d.condicaoRetorno?.trim() || null },
    });
    await db.comodatoAsset.update({
      where: { id: loan.assetId },
      data: { status: d.paraManutencao ? "MANUTENCAO" : "DISPONIVEL" },
    });
    ok();
  });
}

export async function setAssetStatusAction(
  id: string,
  status: "DISPONIVEL" | "MANUTENCAO" | "BAIXADO",
) {
  return tx(async () => {
    const aberto = await db.comodatoLoan.findFirst({ where: { assetId: id, devolvidoEm: null } });
    if (aberto) throw new Error("Devolva o empréstimo antes de mudar o status.");
    await db.comodatoAsset.update({ where: { id }, data: { status } });
    ok();
  });
}

// ── Vasilhames ──────────────────────────────────────────────

const containerTypeSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do vasilhame."),
  valorUnitario: z.number().min(0).max(999_999).nullable(),
});

export async function createContainerType(input: z.input<typeof containerTypeSchema>) {
  return tx(async ({ tid }) => {
    const d = containerTypeSchema.parse(input);
    const dup = await db.containerType.findFirst({ where: { nome: d.nome.trim() } });
    if (dup) throw new Error("Já existe um tipo de vasilhame com esse nome.");
    const t = await db.containerType.create({
      data: { tenantId: tid, nome: d.nome.trim(), valorUnitario: d.valorUnitario },
    });
    ok();
    return t.id;
  });
}

export async function updateContainerType(id: string, input: z.input<typeof containerTypeSchema>) {
  return tx(async () => {
    const d = containerTypeSchema.parse(input);
    const dup = await db.containerType.findFirst({
      where: { nome: d.nome.trim(), id: { not: id } },
    });
    if (dup) throw new Error("Já existe um tipo de vasilhame com esse nome.");
    await db.containerType.update({
      where: { id },
      data: { nome: d.nome.trim(), valorUnitario: d.valorUnitario },
    });
    ok();
  });
}

export async function setContainerTypeActive(id: string, ativo: boolean) {
  return tx(async () => {
    await db.containerType.update({ where: { id }, data: { ativo } });
    ok();
  });
}

const movementSchema = z.object({
  containerTypeId: z.string().min(1, "Escolha o tipo de vasilhame."),
  customerId: z.string().min(1, "Escolha o cliente."),
  tipo: z.enum(["ENTREGA", "DEVOLUCAO", "AJUSTE"]),
  quantidade: z.number().int("Quantidade inteira.").refine((q) => q !== 0, "Quantidade não pode ser zero."),
  observacao: z.string().trim().optional().nullable(),
});

export async function registerContainerMovementAction(input: z.input<typeof movementSchema>) {
  return tx(async ({ tid }) => {
    const d = movementSchema.parse(input);
    if (d.tipo !== "AJUSTE" && d.quantidade < 0) {
      throw new Error("Use quantidade positiva — o sinal vem do tipo de movimento.");
    }

    // Sinal do razão: ENTREGA soma, DEVOLUCAO subtrai, AJUSTE vai como veio.
    const assinada =
      d.tipo === "ENTREGA" ? d.quantidade : d.tipo === "DEVOLUCAO" ? -d.quantidade : d.quantidade;

    if (d.tipo === "DEVOLUCAO") {
      const agg = await db.containerMovement.aggregate({
        where: { containerTypeId: d.containerTypeId, customerId: d.customerId },
        _sum: { quantidade: true },
      });
      const saldo = agg._sum.quantidade ?? 0;
      if (d.quantidade > saldo) {
        throw new Error(
          `Cliente tem apenas ${saldo} vasilhame(s) desse tipo — use um ajuste se precisar corrigir.`,
        );
      }
    }

    await db.containerMovement.create({
      data: {
        tenantId: tid,
        containerTypeId: d.containerTypeId,
        customerId: d.customerId,
        tipo: d.tipo,
        quantidade: assinada,
        observacao: d.observacao?.trim() || null,
      },
    });
    ok();
  });
}
