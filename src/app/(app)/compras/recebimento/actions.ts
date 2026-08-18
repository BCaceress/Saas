"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { importarNotasXml, relacionarItemInbound, type ResultadoImportacao } from "@/lib/fiscal/entrada";
import { buscarProdutosParaRelacionar } from "@/lib/compras/busca-produto";
import { createProduct } from "@/app/(app)/produtos/actions";
import {
  conciliar,
  criarPedidoDaNota,
  desvincularPedido,
  conferirItem,
  conferirTudoConformeNota,
  resolverDivergencia,
  aceitarCustoDaNota,
  confirmarEntradaConciliada,
} from "@/lib/compras/conciliacao";
import type { ActiveTenant } from "@/lib/current-tenant";

const ROTA = "/compras/recebimento";

async function tx<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

function revalidar(inboundId?: string) {
  revalidatePath(ROTA);
  if (inboundId) revalidatePath(`${ROTA}/${inboundId}`);
  revalidatePath("/compras");
}

/**
 * Upload do XML. FormData porque o payload é binário — base64 inflaria 33%
 * um arquivo que já pode ter alguns MB, e o contador manda o mês zipado.
 */
export async function importarXmlRecebimentoAction(
  form: FormData,
): Promise<ResultadoImportacao[]> {
  return tx(async (ctx) => {
    const ativo = await getActiveSiteId();
    const siteId = ativo ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id;
    assertSite(ctx, "compras.receber", siteId);

    const arquivos = form.getAll("arquivos").filter((f): f is File => f instanceof File);
    if (arquivos.length === 0) throw new Error("Escolha o XML da nota (ou um ZIP com vários).");

    const emitente = await db.fiscalEmitente.findFirst({
      where: { siteId },
      select: { cnpj: true },
    });

    const payload = await Promise.all(
      arquivos.map(async (f) => ({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );

    const resultado = await importarNotasXml({
      tenantId: ctx.tenant.id,
      siteId,
      arquivos: payload,
      userId: ctx.user.id,
      cnpjDestino: emitente?.cnpj ?? null,
    });

    revalidar();
    revalidatePath("/fiscal/notas-recebidas");
    return resultado;
  });
}

const vincularSchema = z.object({
  inboundId: z.string().min(1),
  purchaseOrderId: z.string().min(1, "Escolha o pedido."),
});

export async function vincularPedidoAction(input: z.input<typeof vincularSchema>) {
  return tx(async (ctx) => {
    const d = vincularSchema.parse(input);
    await conciliar({
      tenantId: ctx.tenant.id,
      inboundId: d.inboundId,
      purchaseOrderId: d.purchaseOrderId,
      userId: ctx.user.id,
    });
    revalidar(d.inboundId);
  });
}

/**
 * O outro caminho do XML: em vez de achar um pedido, gerar um. Precisa de
 * `compras.pedir` — criar pedido é decisão de compra, não de recebimento.
 */
export async function criarPedidoDaNotaAction(inboundId: string) {
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const purchaseOrderId = await criarPedidoDaNota({
      tenantId: ctx.tenant.id,
      inboundId,
      userId: ctx.user.id,
    });
    revalidar(inboundId);
    revalidatePath("/compras/pedidos");
    return purchaseOrderId;
  });
}

export async function desvincularPedidoAction(inboundId: string) {
  return tx(async (ctx) => {
    await desvincularPedido({ tenantId: ctx.tenant.id, inboundId, userId: ctx.user.id });
    revalidar(inboundId);
  });
}

/** Refaz a conciliação — usado depois de relacionar um item ao catálogo. */
export async function reconciliarAction(inboundId: string) {
  return tx(async (ctx) => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id: inboundId },
      select: { purchaseOrderId: true, vinculoAutomatico: true, scoreVinculo: true },
    });
    if (!nota?.purchaseOrderId) throw new Error("Esta nota não está vinculada a um pedido.");
    await conciliar({
      tenantId: ctx.tenant.id,
      inboundId,
      purchaseOrderId: nota.purchaseOrderId,
      userId: ctx.user.id,
      automatico: nota.vinculoAutomatico,
      score: nota.scoreVinculo,
    });
    revalidar(inboundId);
  });
}

const conferirSchema = z.object({
  inboundId: z.string().min(1),
  itemId: z.string().min(1),
  qtdRecebida: z.coerce.number().min(0).nullable().optional(),
  lote: z.string().trim().max(60).nullable().optional(),
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato dd/mm/aaaa.")
    .nullable()
    .optional(),
});

export async function conferirItemAction(input: z.input<typeof conferirSchema>) {
  return tx(async (ctx) => {
    const d = conferirSchema.parse(input);
    await conferirItem({
      tenantId: ctx.tenant.id,
      reconciliationItemId: d.itemId,
      qtdRecebida: d.qtdRecebida ?? null,
      lote: d.lote ?? null,
      validade: d.validade ?? null,
    });
    revalidar(d.inboundId);
  });
}

export async function conferirTudoAction(inboundId: string) {
  return tx(async (ctx) => {
    const n = await conferirTudoConformeNota({ tenantId: ctx.tenant.id, inboundId });
    revalidar(inboundId);
    return n;
  });
}

const resolverSchema = z.object({
  inboundId: z.string().min(1),
  itemId: z.string().min(1),
  resolucao: z.enum(["ACEITO", "IGNORADO", "AJUSTADO"]),
  motivo: z.string().trim().max(200).optional(),
});

export async function resolverDivergenciaAction(input: z.input<typeof resolverSchema>) {
  return tx(async (ctx) => {
    const d = resolverSchema.parse(input);
    await resolverDivergencia({
      tenantId: ctx.tenant.id,
      reconciliationItemId: d.itemId,
      resolucao: d.resolucao,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(d.inboundId);
  });
}

export async function aceitarCustoAction(input: { inboundId: string; itemId: string }) {
  return tx(async (ctx) => {
    await aceitarCustoDaNota({
      tenantId: ctx.tenant.id,
      reconciliationItemId: input.itemId,
      userId: ctx.user.id,
    });
    revalidar(input.inboundId);
  });
}

const relacionarSchema = z.object({
  inboundId: z.string().min(1),
  inboundItemId: z.string().min(1),
  productId: z.string().min(1, "Escolha o produto."),
  packagingId: z.string().nullable().optional(),
  fatorConversao: z.coerce.number().positive().default(1),
});

/**
 * Relaciona um item da nota ao catálogo e refaz a conciliação. Grava o de-para
 * (é `relacionarItemInbound` quem faz), então a próxima nota deste fornecedor
 * já chega resolvida.
 */
export async function relacionarItemRecebimentoAction(
  input: z.input<typeof relacionarSchema>,
) {
  return tx(async (ctx) => {
    const d = relacionarSchema.parse(input);
    const { preenchidos } = await relacionarItemInbound({
      tenantId: ctx.tenant.id,
      itemId: d.inboundItemId,
      productId: d.productId,
      packagingId: d.packagingId ?? null,
      fatorConversao: d.fatorConversao,
    });

    const nota = await db.fiscalInbound.findFirst({
      where: { id: d.inboundId },
      select: { purchaseOrderId: true },
    });
    if (nota?.purchaseOrderId) {
      await conciliar({
        tenantId: ctx.tenant.id,
        inboundId: d.inboundId,
        purchaseOrderId: nota.purchaseOrderId,
        userId: ctx.user.id,
      });
    }
    revalidar(d.inboundId);
    revalidatePath("/produtos");
    return { preenchidos };
  });
}

export async function confirmarEntradaAction(inboundId: string) {
  return tx(async (ctx) => {
    const purchaseId = await confirmarEntradaConciliada({
      tenantId: ctx.tenant.id,
      inboundId,
      userId: ctx.user.id,
    });
    revalidar(inboundId);
    revalidatePath("/estoque");
    revalidatePath("/inicio");
    return purchaseId;
  });
}

/**
 * Busca de produto para relacionar um item da nota. Ordena por relevância ao
 * que foi digitado — `gtin` é o código do item da nota, usado como desempate.
 */
export async function buscarProdutoAction(termo: string, gtin?: string | null) {
  return tx(() => buscarProdutosParaRelacionar(termo, { gtin }));
}

const criarProdutoRapidoSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do produto."),
  subcategoryId: z.string().min(1, "Escolha a categoria."),
  ean: z.string().trim().optional(),
});

/**
 * Cadastro mínimo direto do recebimento — item sem catálogo não devia
 * significar abandonar a nota. `createProduct` faz o resto (SKU, estoque
 * inicial no site padrão, permissão própria de `produto.editar`).
 */
export async function criarProdutoRapidoAction(input: z.input<typeof criarProdutoRapidoSchema>) {
  const d = criarProdutoRapidoSchema.parse(input);
  return createProduct({ nome: d.nome, subcategoryId: d.subcategoryId, ean: d.ean || undefined });
}
