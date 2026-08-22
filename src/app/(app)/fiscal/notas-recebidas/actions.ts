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
import { registrarImportacoes } from "@/lib/fiscal/import-log";
import {
  entradasAguardandoDocumento,
  vincularNotaAEntradaManual,
} from "@/lib/compras/documento";
import { buscarProdutosParaRelacionar } from "@/lib/compras/busca-produto";
import {
  sincronizarDistribuicao,
  listarAguardandoManifestacao,
  manifestarNota,
} from "@/lib/fiscal/distribuicao";
import type { ActiveTenant } from "@/lib/current-tenant";
import type { ManifestacaoTipo } from "@/generated/prisma";

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

    await registrarImportacoes(
      { origem: "UPLOAD", siteId, usuarioId: ctx.user.id },
      resultado,
    );

    ok();
    return resultado;
  });
}

// ── Distribuição DF-e ───────────────────────────────────────

/** Pergunta à SEFAZ o que os fornecedores emitiram contra o nosso CNPJ. */
export async function sincronizarSefazAction() {
  return tx("fiscal.importar", async (ctx) => {
    const siteId = await siteDaEntrada(ctx);
    const r = await sincronizarDistribuicao({
      tenantId: ctx.tenant.id,
      siteId,
      userId: ctx.user.id,
    });
    ok();
    return r;
  });
}

/** Notas que a SEFAZ já mostra mas cujo XML depende de manifestação. */
export async function notasAguardandoManifestacaoAction() {
  return tx("fiscal.ver", async (ctx) => {
    const siteId = await siteDaEntrada(ctx);
    return listarAguardandoManifestacao(ctx.tenant.id, siteId);
  });
}

const manifestarSchema = z.object({
  chave: z.string().trim().length(44, "A chave de acesso tem 44 dígitos."),
  tipo: z.enum(["CIENCIA", "CONFIRMACAO", "DESCONHECIMENTO", "NAO_REALIZADA"]),
  justificativa: z.string().trim().optional(),
});

export async function manifestarNotaAction(input: z.input<typeof manifestarSchema>) {
  return tx("fiscal.importar", async (ctx) => {
    const d = manifestarSchema.parse(input);
    const siteId = await siteDaEntrada(ctx);
    const r = await manifestarNota({
      tenantId: ctx.tenant.id,
      siteId,
      chave: d.chave,
      tipo: d.tipo as ManifestacaoTipo,
      justificativa: d.justificativa,
      userId: ctx.user.id,
    });
    ok();
    revalidatePath("/fiscal/eventos");
    return r;
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
    const r = await relacionarItemInbound({ tenantId: ctx.tenant.id, ...d });
    ok();
    // O cadastro do produto pode ter ganhado embalagem, EAN ou custo.
    revalidatePath("/produtos");
    return r;
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

export async function receberNotaAction(inboundId: string, ignorarDuplicidade = false) {
  return tx("fiscal.importar", async (ctx) => {
    const purchaseId = await gerarEntradaDaNota({
      tenantId: ctx.tenant.id,
      inboundId,
      userId: ctx.user.id,
      // Chegou pela SEFAZ/e-mail: ninguém pediu, o fornecedor mandou. A origem
      // fica registrada no pedido retroativo que a entrada cria.
      origem: "DFE",
      ignorarDuplicidade,
    });
    ok();
    revalidatePath("/estoque");
    revalidatePath("/pedidos", "layout");
    revalidatePath("/financeiro", "layout");
    return purchaseId;
  });
}

/**
 * Entradas lançadas à mão que esta nota pode estar documentando. A tela
 * pergunta antes de receber — depois vira divergência de inventário.
 */
export async function candidatasEntradaManualAction(inboundId: string) {
  return tx("fiscal.ver", async () => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id: inboundId },
      select: {
        siteId: true,
        supplierId: true,
        dataEmissao: true,
        valorTotal: true,
        items: { select: { productId: true } },
      },
    });
    if (!nota) return [];
    return entradasAguardandoDocumento({
      supplierId: nota.supplierId,
      siteId: nota.siteId,
      dataEmissao: nota.dataEmissao,
      valorTotal: Number(nota.valorTotal),
      produtoIds: nota.items.map((i) => i.productId).filter((i): i is string => Boolean(i)),
    });
  });
}

const vincularManualSchema = z.object({
  inboundId: z.string().min(1),
  purchaseId: z.string().min(1),
});

/**
 * "Esta nota é aquela entrada que eu já lancei." Fecha o par sem tocar no
 * estoque — que é exatamente o ponto: a mercadoria já entrou uma vez.
 */
export async function vincularEntradaManualAction(
  input: z.input<typeof vincularManualSchema>,
) {
  const d = vincularManualSchema.parse(input);
  return tx("fiscal.importar", async (ctx) => {
    await vincularNotaAEntradaManual({
      tenantId: ctx.tenant.id,
      inboundId: d.inboundId,
      purchaseId: d.purchaseId,
      userId: ctx.user.id,
    });
    ok();
    revalidatePath("/estoque");
    revalidatePath("/pedidos", "layout");
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

/**
 * Produtos para o seletor de de-para, por nome, SKU ou código de barras.
 * A ordem é a relevância ao que foi digitado (ver `busca-produto.ts`) —
 * alfabético com LIMIT chegava a esconder o produto certo.
 */
export async function buscarProdutosAction(termo: string, gtin?: string | null) {
  return tx("fiscal.ver", async () => {
    const produtos = await buscarProdutosParaRelacionar(termo, { gtin, limite: 20 });
    return produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      ean: p.ean,
      imagemUrl: p.imagemUrl,
      custoMedio: p.custoMedio,
      packagings: p.embalagens.map((e) => ({
        id: e.id,
        nome: e.nome,
        ean: e.ean,
        fatorConversao: e.fator,
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
        status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "CONFERENCIA", "RECEBIDO_PARCIAL"] },
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
