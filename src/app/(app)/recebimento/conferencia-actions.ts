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
  conferirItem,
  conferirTudoConformeNota,
  remontarConferencia,
  resolverDivergencia,
  aceitarCustoDaNota,
  confirmarEntradaConciliada,
  devolverItemDivergente,
  resumoDivergenciasParaFornecedor,
} from "@/lib/compras/conciliacao";
import type { ActiveTenant } from "@/lib/current-tenant";

const ROTA = "/recebimento";

async function tx<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

function revalidar(inboundId?: string) {
  if (inboundId) revalidatePath(`${ROTA}/${inboundId}`);
  // A fila de recebimento deixou de existir: quem lista o que está por
  // conferir agora é a própria lista de pedidos.
  revalidatePath("/pedidos");
  revalidatePath("/cotacoes");
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

    await registrarImportacoes(
      { origem: "UPLOAD", siteId, usuarioId: ctx.user.id },
      resultado,
    );

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
    revalidar(inboundId);
    revalidatePath("/fiscal/notas-recebidas");
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
    await remontarConferencia(ctx.tenant.id, inboundId, ctx.user.id);
    revalidar(inboundId);
  });
}

const conferirSchema = z.object({
  inboundId: z.string().min(1),
  itemId: z.string().min(1),
  // Contagem é de PEÇA: quem está na doca conta garrafa, não meia garrafa.
  // O saldo só guarda inteiro, então aceitar 1,5 aqui só adiaria o erro para
  // a hora de receber — e aí a nota inteira trava.
  qtdRecebida: z.coerce
    .number()
    .min(0)
    .int("A contagem é em unidades inteiras — o estoque não guarda meia peça.")
    .nullable()
    .optional(),
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
    // Sem `?? null`: a tela salva um campo por vez, e ausente tem de chegar
    // ausente. Convertê-lo em null aqui fazia o bipe (que manda só a
    // quantidade) apagar lote e validade — ver `conferirItem`.
    await conferirItem({
      tenantId: ctx.tenant.id,
      reconciliationItemId: d.itemId,
      qtdRecebida: d.qtdRecebida,
      lote: d.lote,
      validade: d.validade,
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

const restaurarSchema = z.object({
  inboundId: z.string().min(1),
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
 * Desfazer o "conferi tudo conforme a nota".
 *
 * A tela manda de volta o retrato que tinha antes do clique — inclusive as
 * linhas que já estavam contadas e foram sobrescritas. Sem isto, um clique
 * errado num botão sem confirmação apagava a contagem da nota inteira, e o
 * único caminho de volta era recontar.
 */
export async function restaurarContagemAction(input: z.input<typeof restaurarSchema>) {
  return tx(async (ctx) => {
    const d = restaurarSchema.parse(input);
    for (const i of d.itens) {
      await conferirItem({
        tenantId: ctx.tenant.id,
        reconciliationItemId: i.itemId,
        qtdRecebida: i.qtdRecebida,
      });
    }
    revalidar(d.inboundId);
  });
}

const resolverSchema = z.object({
  inboundId: z.string().min(1),
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
    revalidar(d.inboundId);
  });
}

const devolucaoSchema = z.object({
  inboundId: z.string().min(1),
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
    revalidar(d.inboundId);
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

