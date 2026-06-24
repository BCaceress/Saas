"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import {
  registrarEntrada,
  registrarAjuste,
  registrarPerda,
  registrarTransferencia,
  registrarProducao,
} from "@/lib/estoque";
import { getOrCreateDefaultSite } from "@/lib/sites";

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => revalidatePath("/estoque", "layout");

// ── Sites ────────────────────────────────────────────────────

const siteSchema = z.object({
  nome: z.string().min(2, "Informe o nome do site."),
  tipo: z.enum(["LOJA", "CD"]),
  cep: z.string().optional().nullable(),
  rua: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  estoquePropio: z.boolean().default(true),
  cdAbastecedorId: z.string().optional().nullable(),
});

export async function createSite(input: z.input<typeof siteSchema>) {
  return tx(async (tid) => {
    const d = siteSchema.parse(input);
    const nome = d.nome.trim();
    const dup = await db.site.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (dup) throw new Error(`Já existe um site com o nome "${nome}".`);
    const site = await db.site.create({
      data: {
        tenantId: tid,
        nome,
        tipo: d.tipo,
        cep: d.cep,
        rua: d.rua,
        numero: d.numero,
        cidade: d.cidade,
        estado: d.estado,
        estoquePropio: d.estoquePropio,
        cdAbastecedorId: d.cdAbastecedorId,
      },
    });
    ok();
    return site.id;
  });
}

export async function updateSite(id: string, input: z.input<typeof siteSchema>) {
  return tx(async () => {
    const d = siteSchema.parse(input);
    const nome = d.nome.trim();
    const dup = await db.site.findFirst({ where: { nome: { equals: nome, mode: "insensitive" }, id: { not: id } } });
    if (dup) throw new Error(`Já existe um site com o nome "${nome}".`);
    await db.site.update({
      where: { id },
      data: {
        nome,
        tipo: d.tipo,
        cep: d.cep,
        rua: d.rua,
        numero: d.numero,
        cidade: d.cidade,
        estado: d.estado,
        estoquePropio: d.estoquePropio,
        cdAbastecedorId: d.cdAbastecedorId,
      },
    });
    ok();
  });
}

export async function toggleSiteAtivo(id: string, ativo: boolean) {
  return tx(async () => {
    await db.site.update({ where: { id }, data: { ativo } });
    ok();
  });
}

// ── Entrada ──────────────────────────────────────────────────

const entradaItemSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().positive(),
  custoTotal: z.number().nonnegative(),
  packagingId: z.string().optional().nullable(),
});

const entradaSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  tipo: z.enum(["MANUAL", "FORNECEDOR"]),
  supplierId: z.string().optional().nullable(),
  numeroNota: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  items: z.array(entradaItemSchema).min(1, "Adicione ao menos um item."),
});

export async function registrarEntradaAction(input: z.input<typeof entradaSchema>) {
  return tx(async (tid, userId) => {
    const d = entradaSchema.parse(input);
    const id = await registrarEntrada(tid, d.siteId, d.items, {
      tipo: d.tipo,
      supplierId: d.supplierId,
      numeroNota: d.numeroNota,
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Ajuste ───────────────────────────────────────────────────

const ajusteSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  deltaFechado: z.number().default(0),
  deltaAberto: z.number().default(0),
  observacao: z.string().min(3, "Informe o motivo do ajuste."),
});

export async function registrarAjusteAction(input: z.input<typeof ajusteSchema>) {
  return tx(async (tid, userId) => {
    const d = ajusteSchema.parse(input);
    await registrarAjuste(tid, d.siteId, d.productId, {
      fechado: d.deltaFechado,
      aberto: d.deltaAberto,
    }, d.observacao, userId);
    ok();
  });
}

// ── Perda ────────────────────────────────────────────────────

const perdaSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  deltaFechado: z.number().nonnegative().default(0),
  deltaAberto: z.number().nonnegative().default(0),
  observacao: z.string().min(3, "Informe o motivo da perda."),
});

export async function registrarPerdaAction(input: z.input<typeof perdaSchema>) {
  return tx(async (tid, userId) => {
    const d = perdaSchema.parse(input);
    await registrarPerda(tid, d.siteId, d.productId, {
      fechado: d.deltaFechado,
      aberto: d.deltaAberto,
    }, d.observacao, userId);
    ok();
  });
}

// ── Transferência ─────────────────────────────────────────────

const transferenciaItemSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().positive(),
});

const transferenciaSchema = z.object({
  origemSiteId: z.string().min(1),
  destinoSiteId: z.string().min(1),
  observacao: z.string().optional().nullable(),
  items: z.array(transferenciaItemSchema).min(1, "Adicione ao menos um item."),
});

export async function registrarTransferenciaAction(input: z.input<typeof transferenciaSchema>) {
  return tx(async (tid, userId) => {
    const d = transferenciaSchema.parse(input);
    if (d.origemSiteId === d.destinoSiteId) throw new Error("Origem e destino devem ser diferentes.");
    const id = await registrarTransferencia(tid, d.origemSiteId, d.destinoSiteId, d.items, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Produção ─────────────────────────────────────────────────

const producaoSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantidade: z.number().int().positive().default(1),
  observacao: z.string().optional().nullable(),
});

export async function registrarProducaoAction(input: z.input<typeof producaoSchema>) {
  return tx(async (tid, userId) => {
    const d = producaoSchema.parse(input);
    const id = await registrarProducao(tid, d.siteId, d.productId, d.variantId ?? null, d.quantidade, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Cookie de site ────────────────────────────────────────────

import { cookies } from "next/headers";

export async function setSiteAction(siteId: string) {
  const store = await cookies();
  store.set("nohub-site", siteId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}
