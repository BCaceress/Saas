"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { assertSite } from "@/lib/guard";
import {
  importarNotasXml,
  relacionarItemInbound,
  vincularPedidoInbound,
  gerarEntradaDaNota,
  descartarNota,
  type ResultadoImportacao,
} from "@/lib/fiscal/entrada";
import type { ActiveTenant } from "@/lib/current-tenant";

const ROTA = "/fiscal/notas-recebidas";
const ok = () => revalidatePath(ROTA);

async function tx<T>(
  permissao: "fiscal.importar" | "fiscal.ver",
  fn: (ctx: ActiveTenant) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

/** Loja onde a mercadoria entra: a selecionada no seletor, ou a padrão. */
async function siteDaEntrada(ctx: ActiveTenant): Promise<string> {
  const ativo = await getActiveSiteId();
  const siteId = ativo ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id;
  // Importar XML movimenta estoque daquela loja — o acesso tem de valer lá.
  assertSite(ctx, "fiscal.importar", siteId);
  return siteId;
}

/**
 * Recebe .xml ou .zip. FormData porque o payload é binário — base64 inflaria
 * 33% um upload que já pode ter alguns MB.
 */
export async function importarXmlAction(form: FormData): Promise<ResultadoImportacao[]> {
  return tx("fiscal.importar", async (ctx) => {
    const siteId = await siteDaEntrada(ctx);

    const arquivos = form.getAll("arquivos").filter((f): f is File => f instanceof File);
    if (arquivos.length === 0) throw new Error("Escolha ao menos um arquivo XML ou ZIP.");

    const emitente = await db.fiscalEmitente.findFirst({
      where: { siteId },
      select: { cnpj: true },
    });

    const payload = await Promise.all(
      arquivos.map(async (f) => ({
        nome: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
      })),
    );

    const resultado = await importarNotasXml({
      tenantId: ctx.tenant.id,
      siteId,
      arquivos: payload,
      userId: ctx.user.id,
      cnpjDestino: emitente?.cnpj ?? null,
    });

    ok();
    return resultado;
  });
}

const relacionarSchema = z.object({
  itemId: z.string().min(1),
  productId: z.string().min(1, "Escolha o produto."),
  packagingId: z.string().optional().nullable(),
  fatorConversao: z.coerce.number().positive().default(1),
});

export async function relacionarItemAction(input: z.input<typeof relacionarSchema>) {
  return tx("fiscal.importar", async (ctx) => {
    const d = relacionarSchema.parse(input);
    await relacionarItemInbound({ tenantId: ctx.tenant.id, ...d });
    ok();
  });
}

export async function vincularPedidoAction(input: {
  inboundId: string;
  purchaseOrderId: string | null;
}) {
  return tx("fiscal.importar", async () => {
    await vincularPedidoInbound(input);
    ok();
  });
}

export async function receberNotaAction(inboundId: string) {
  return tx("fiscal.importar", async (ctx) => {
    const purchaseId = await gerarEntradaDaNota({
      tenantId: ctx.tenant.id,
      inboundId,
      userId: ctx.user.id,
    });
    ok();
    revalidatePath("/estoque");
    return purchaseId;
  });
}

const descartarSchema = z.object({
  inboundId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que está descartando — isso fica no histórico."),
});

export async function descartarNotaAction(input: z.input<typeof descartarSchema>) {
  return tx("fiscal.importar", async () => {
    const d = descartarSchema.parse(input);
    await descartarNota(d);
    ok();
  });
}

/** Produtos para o seletor de de-para. Busca leve, por nome/SKU/EAN. */
export async function buscarProdutosAction(termo: string) {
  return tx("fiscal.ver", async () => {
    const q = termo.trim();
    if (q.length < 2) return [];
    const produtos = await db.product.findMany({
      where: {
        ativo: true,
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { ean: { contains: q.replace(/\D/g, "") || "___" } },
        ],
      },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        packagings: { select: { id: true, nome: true, fatorConversao: true } },
      },
      orderBy: { nome: "asc" },
      take: 20,
    });
    return produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      ean: p.ean,
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        nome: pk.nome,
        fatorConversao: Number(pk.fatorConversao),
      })),
    }));
  });
}

/** Pedidos em aberto do fornecedor, para conferir a nota contra o pedido. */
export async function pedidosDoFornecedorAction(supplierId: string) {
  return tx("fiscal.ver", async () => {
    const pedidos = await db.purchaseOrder.findMany({
      where: {
        supplierId,
        status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] },
      },
      select: { id: true, numero: true, status: true, valorTotal: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return pedidos.map((p) => ({
      id: p.id,
      numero: p.numero,
      status: p.status,
      valorTotal: Number(p.valorTotal),
    }));
  });
}
