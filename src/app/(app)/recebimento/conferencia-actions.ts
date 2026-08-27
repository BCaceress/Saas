"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { importarNotasXml, type ResultadoImportacao } from "@/lib/fiscal/entrada";
import { registrarImportacoes } from "@/lib/fiscal/import-log";
import {
  conciliar,
  conferirSemPedido,
  criarPedidoDaNota,
  desvincularPedido,
  remontarConferencia,
  resolverDivergencia,
  aceitarCustoDaNota,
  devolverItemDivergente,
  resumoDivergenciasParaFornecedor,
} from "@/lib/compras/conciliacao";
import {
  iniciarRecebimentoDoPedido,
  abrirRecebimentoAvulso,
  garantirRecebimentoDaNota,
  vincularNotaAoRecebimento,
  vincularPedidoAoRecebimento,
  adicionarItemAoRecebimento,
  removerItemDoRecebimento,
  registrarContagem,
  finalizarRecebimento,
  cancelarRecebimento,
} from "@/lib/compras/recebimento";
import type { ActiveTenant } from "@/lib/current-tenant";

// ── Ações da doca ───────────────────────────────────────────
//
// Tudo aqui gira em torno do RECEBIMENTO (o `receiptId` da URL). As ações que
// ainda falam em `inboundId` são as do XML — vincular pedido, gerar pedido pela
// nota, conferir sem pedido — porque é a nota que está sendo decidida ali.
//
// O estoque só se move em `finalizarRecebimentoAction`.

const ROTA = "/recebimento";

async function tx<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

function revalidar(receiptId?: string) {
  if (receiptId) revalidatePath(`${ROTA}/${receiptId}`);
  revalidatePath(ROTA);
  revalidatePath("/pedidos");
  revalidatePath("/cotacoes");
}

/** O recebimento de uma nota — para as ações que ainda entram pelo XML. */
async function recebimentoDaNota(tenantId: string, inboundId: string, userId?: string | null) {
  const r = await garantirRecebimentoDaNota({ tenantId, inboundId, userId });
  return r.id;
}

// ── Abrir ───────────────────────────────────────────────────

/**
 * "Iniciar recebimento" a partir de um pedido.
 *
 * O pedido NÃO se transforma em nada: ele continua existindo e ganha mais um
 * recebimento pendurado. Devolve o id para a tela levar o operador direto à
 * conferência — que é o que ele queria ao clicar.
 */
export async function iniciarRecebimentoAction(purchaseOrderId: string): Promise<string> {
  return tx(async (ctx) => {
    const pedido = await db.purchaseOrder.findFirst({
      where: { id: purchaseOrderId },
      select: { siteId: true },
    });
    if (!pedido) throw new Error("Pedido não encontrado.");
    assertSite(ctx, "compras.receber", pedido.siteId);

    const r = await iniciarRecebimentoDoPedido({
      tenantId: ctx.tenant.id,
      purchaseOrderId,
      userId: ctx.user.id,
    });
    revalidar(r.id);
    return r.id;
  });
}

/** Mercadoria na porta sem pedido e sem nota. Exige `estoque.ajustar`. */
export async function abrirRecebimentoAvulsoAction(input?: {
  supplierId?: string | null;
  fornecedorLivre?: string | null;
}): Promise<string> {
  const ctx = await guardAction("estoque.ajustar");
  return runWithTenant(ctx.tenant.id, async () => {
    const ativo = await getActiveSiteId();
    const siteId = ativo ?? (await getOrCreateDefaultSite(ctx.tenant.id)).id;
    const r = await abrirRecebimentoAvulso({
      tenantId: ctx.tenant.id,
      siteId,
      supplierId: input?.supplierId ?? null,
      fornecedorLivre: input?.fornecedorLivre ?? null,
      userId: ctx.user.id,
    });
    revalidar(r.id);
    return r.id;
  });
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

    await registrarImportacoes({ origem: "UPLOAD", siteId, usuarioId: ctx.user.id }, resultado);

    // Cada nota importada já ganha o seu recebimento: é ele que a tela abre, e
    // criá-lo aqui evita que a nota fique num limbo sem endereço.
    for (const r of resultado) {
      if (r.status === "IMPORTADA" && r.inboundId) {
        r.receiptId = await recebimentoDaNota(ctx.tenant.id, r.inboundId, ctx.user.id);
      }
    }

    revalidar();
    revalidatePath("/fiscal/notas-recebidas");
    return resultado;
  });
}

// ── Portas do XML ───────────────────────────────────────────

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
    const receiptId = await recebimentoDaNota(ctx.tenant.id, d.inboundId, ctx.user.id);
    revalidar(receiptId);
    return receiptId;
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
    const receiptId = await recebimentoDaNota(ctx.tenant.id, inboundId, ctx.user.id);
    revalidar(receiptId);
    revalidatePath("/pedidos");
    return purchaseOrderId;
  });
}

/**
 * A terceira porta: nem achar um pedido, nem criar um. A mercadoria chegou, a
 * nota descreve o que era para vir, e o operador confere contra ela.
 *
 * Fica em `compras.receber` (e não em `compras.pedir`) de propósito: quem está
 * na porta pode receber sem que isso vire uma decisão de compra no sistema.
 */
export async function receberSemPedidoAction(inboundId: string) {
  return tx(async (ctx) => {
    await conferirSemPedido({ tenantId: ctx.tenant.id, inboundId, userId: ctx.user.id });
    const receiptId = await recebimentoDaNota(ctx.tenant.id, inboundId, ctx.user.id);
    revalidar(receiptId);
    revalidatePath("/fiscal/notas-recebidas");
    return receiptId;
  });
}

export async function desvincularPedidoAction(input: { receiptId: string; inboundId: string }) {
  return tx(async (ctx) => {
    await desvincularPedido({
      tenantId: ctx.tenant.id,
      inboundId: input.inboundId,
      userId: ctx.user.id,
    });
    await db.goodsReceipt.update({
      where: { id: input.receiptId },
      data: { purchaseOrderId: null, status: "PENDENTE" },
    });
    revalidar(input.receiptId);
  });
}

/** Refaz a conciliação — usado depois de relacionar um item ao catálogo. */
export async function reconciliarAction(input: { receiptId: string; inboundId: string }) {
  return tx(async (ctx) => {
    await remontarConferencia(ctx.tenant.id, input.inboundId, ctx.user.id);
    revalidar(input.receiptId);
  });
}

// ── XML que chega depois da mercadoria ──────────────────────

const vincularNotaSchema = z.object({
  receiptId: z.string().min(1),
  inboundId: z.string().min(1, "Escolha a nota."),
});

/**
 * A NF-e chegou depois. Documenta o recebimento que já existe em vez de abrir
 * outro — é o que impede a mesma carga de entrar duas vezes.
 */
export async function vincularNotaAction(input: z.input<typeof vincularNotaSchema>) {
  return tx(async (ctx) => {
    const d = vincularNotaSchema.parse(input);
    await vincularNotaAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: d.receiptId,
      inboundId: d.inboundId,
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
    revalidatePath("/fiscal/notas-recebidas");
  });
}

/** O avulso era, afinal, de um pedido. */
export async function vincularPedidoAoRecebimentoAction(input: {
  receiptId: string;
  purchaseOrderId: string;
}) {
  return tx(async (ctx) => {
    await vincularPedidoAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: input.receiptId,
      purchaseOrderId: input.purchaseOrderId,
      userId: ctx.user.id,
    });
    revalidar(input.receiptId);
  });
}

// ── Conferência física ──────────────────────────────────────

const conferirSchema = z.object({
  receiptId: z.string().min(1),
  itemId: z.string().min(1),
  // Contagem é de PEÇA: quem está na doca conta garrafa, não meia garrafa.
  // O saldo só guarda inteiro, então aceitar 1,5 aqui só adiaria o erro para
  // a hora de receber — e aí o recebimento inteiro trava.
  qtdRecebida: z.coerce
    .number()
    .min(0)
    .int("A contagem é em unidades inteiras — o estoque não guarda meia peça.")
    .nullable()
    .optional(),
  custoUnitario: z.coerce.number().min(0).nullable().optional(),
  lote: z.string().trim().max(60).nullable().optional(),
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato dd/mm/aaaa.")
    .nullable()
    .optional(),
});

export async function conferirItemAction(input: z.input<typeof conferirSchema>) {
  return tx(async () => {
    const d = conferirSchema.parse(input);
    // Sem `?? null`: a tela salva um campo por vez, e ausente tem de chegar
    // ausente. Convertê-lo em null aqui fazia o bipe (que manda só a
    // quantidade) apagar lote e validade.
    await registrarContagem({
      receiptId: d.receiptId,
      itemId: d.itemId,
      qtdRecebida: d.qtdRecebida,
      custoUnitario: d.custoUnitario,
      lote: d.lote,
      validade: d.validade,
    });
    revalidar(d.receiptId);
  });
}

/** "Conferi tudo como está" — o caminho de 90% dos recebimentos. */
export async function conferirTudoAction(receiptId: string) {
  return tx(async () => {
    const linhas = await db.purchaseReconciliationItem.findMany({
      where: { receiptId },
      select: { id: true, qtdPedida: true, qtdFaturada: true },
    });
    for (const l of linhas) {
      await db.purchaseReconciliationItem.update({
        where: { id: l.id },
        data: {
          qtdRecebida: Number(l.qtdFaturada) || Number(l.qtdPedida),
          // Bateu com o esperado: se havia ajuste registrado, ele deixa de valer.
          resolucao: null,
        },
      });
    }
    revalidar(receiptId);
    return linhas.length;
  });
}

const restaurarSchema = z.object({
  receiptId: z.string().min(1),
  itens: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qtdRecebida: z.coerce.number().min(0).nullable(),
      }),
    )
    .max(500),
});

/**
 * Desfazer o "conferi tudo".
 *
 * A tela manda de volta o retrato que tinha antes do clique — inclusive as
 * linhas que já estavam contadas e foram sobrescritas. Sem isto, um clique
 * errado num botão sem confirmação apagava a contagem inteira, e o único
 * caminho de volta era recontar.
 */
export async function restaurarContagemAction(input: z.input<typeof restaurarSchema>) {
  return tx(async () => {
    const d = restaurarSchema.parse(input);
    for (const i of d.itens) {
      await registrarContagem({
        receiptId: d.receiptId,
        itemId: i.itemId,
        qtdRecebida: i.qtdRecebida,
      });
    }
    revalidar(d.receiptId);
  });
}

const itemExtraSchema = z.object({
  receiptId: z.string().min(1),
  productId: z.string().min(1),
  packagingId: z.string().nullable().optional(),
  quantidade: z.coerce.number().positive("Informe a quantidade conferida."),
  custoUnitario: z.coerce.number().min(0).default(0),
  lote: z.string().trim().max(60).nullable().optional(),
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato dd/mm/aaaa.")
    .nullable()
    .optional(),
  bonificacao: z.boolean().default(false),
  motivo: z.string().trim().max(240).nullable().optional(),
});

/**
 * Item conferido que ninguém esperava — o que veio a mais no caminhão, ou a
 * linha inteira do recebimento avulso.
 */
export async function adicionarItemAction(input: z.input<typeof itemExtraSchema>) {
  return tx(async (ctx) => {
    const d = itemExtraSchema.parse(input);
    // A tela conta na unidade de COMPRA (caixa); a conferência pensa em peça.
    const fator = d.packagingId
      ? Number(
          (
            await db.productPackaging.findFirst({
              where: { id: d.packagingId },
              select: { fatorConversao: true },
            })
          )?.fatorConversao ?? 1,
        ) || 1
      : 1;

    const id = await adicionarItemAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: d.receiptId,
      productId: d.productId,
      quantidade: d.quantidade * fator,
      custoUnitario: fator > 0 ? d.custoUnitario / fator : d.custoUnitario,
      lote: d.lote,
      validade: d.validade,
      bonificacao: d.bonificacao,
      motivo: d.motivo,
    });
    revalidar(d.receiptId);
    return id;
  });
}

export async function removerItemAction(input: { receiptId: string; itemId: string }) {
  return tx(async () => {
    await removerItemDoRecebimento(input);
    revalidar(input.receiptId);
  });
}

// ── Divergências ────────────────────────────────────────────

const resolverSchema = z.object({
  receiptId: z.string().min(1),
  itemId: z.string().min(1),
  resolucao: z.enum(["ACEITO", "IGNORADO", "AJUSTADO"]),
  // Obrigatório: divergência resolvida sem justificativa vira discussão com o
  // fornecedor sem prova, semanas depois, quando ninguém lembra o que chegou.
  motivo: z.string().trim().min(3, "Explique a divergência em uma frase.").max(240),
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
    revalidar(d.receiptId);
  });
}

const devolucaoSchema = z.object({
  receiptId: z.string().min(1),
  itemId: z.string().min(1),
  quantidade: z.coerce.number().positive("Informe a quantidade devolvida."),
  motivo: z.string().trim().min(3, "Explique o motivo da devolução.").max(240),
});

/** Devolve ao fornecedor o excedente/avaria que já entrou no estoque. */
export async function devolverDivergenciaAction(input: z.input<typeof devolucaoSchema>) {
  return tx(async (ctx) => {
    const d = devolucaoSchema.parse(input);
    await devolverItemDivergente({
      tenantId: ctx.tenant.id,
      reconciliationItemId: d.itemId,
      quantidade: d.quantidade,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
    revalidatePath("/estoque/saldos");
  });
}

/** Texto pronto da reclamação — o desfecho acontece no WhatsApp do vendedor. */
export async function resumoDivergenciasAction(inboundId: string) {
  return tx((ctx) =>
    resumoDivergenciasParaFornecedor({
      tenantId: ctx.tenant.id,
      inboundId,
      empresa: ctx.tenant.nome,
    }),
  );
}

export async function aceitarCustoAction(input: { receiptId: string; itemId: string }) {
  return tx(async (ctx) => {
    await aceitarCustoDaNota({
      tenantId: ctx.tenant.id,
      reconciliationItemId: input.itemId,
      userId: ctx.user.id,
    });
    revalidar(input.receiptId);
  });
}

// ── Fechar ──────────────────────────────────────────────────

const finalizarSchema = z.object({
  receiptId: z.string().min(1),
  motivoDivergencia: z.string().trim().max(240).nullable().optional(),
});

/** O único ponto em que a mercadoria entra no estoque. */
export async function finalizarRecebimentoAction(input: z.input<typeof finalizarSchema>) {
  return tx(async (ctx) => {
    const d = finalizarSchema.parse(input);
    const r = await finalizarRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: d.receiptId,
      motivoDivergencia: d.motivoDivergencia,
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
    revalidatePath("/estoque");
    revalidatePath("/inicio");
    return r;
  });
}

const cancelarSchema = z.object({
  receiptId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que a conferência não vai continuar.").max(240),
});

export async function cancelarRecebimentoAction(input: z.input<typeof cancelarSchema>) {
  return tx(async (ctx) => {
    const d = cancelarSchema.parse(input);
    await cancelarRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: d.receiptId,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
  });
}
