"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { getActiveSiteId, getOrCreateDefaultSite } from "@/lib/sites";
import { importarNotasXml, type ResultadoImportacao } from "@/lib/fiscal/entrada";
import { registrarImportacoes } from "@/lib/fiscal/import-log";
import type { Permissao } from "@/lib/permissoes";
import {
  conciliar,
  conferirSemPedido,
  criarPedidoDaNota,
  desvincularPedido,
  remontarConferencia,
  resolverDivergencia,
  aceitarCustoDaNota,
  devolverItemDivergente,
  enviarAvisoPorEmail,
  resumoDivergenciasParaFornecedor,
} from "@/lib/compras/conciliacao";
import {
  iniciarRecebimentoDoPedido,
  abrirRecebimentoAvulso,
  garantirRecebimentoDaNota,
  notasParaVincular,
  vincularNotaAoRecebimento,
  vincularPedidoAoRecebimento,
  adicionarItemAoRecebimento,
  removerItemDoRecebimento,
  registrarContagem,
  somarContagem,
  finalizarRecebimento,
  cancelarRecebimento,
  salvarRascunhoRecebimento,
  marcarEmConferencia,
} from "@/lib/compras/recebimento";
import { linhasParaConferirTudo } from "@/lib/compras/recebimento-regras";
import { registrarVasilhameDoRecebimento } from "@/lib/compras/vasilhame";
import { estornarRecebimento } from "@/lib/compras/estorno";
import { vincularNotaAEntradaManual } from "@/lib/compras/documento";
import { featureAtiva } from "@/lib/planos";
import type { ActiveTenant } from "@/lib/current-tenant";

// ── Ações da doca ───────────────────────────────────────────
//
// Tudo aqui gira em torno do RECEBIMENTO (o `receiptId` da URL). As ações que
// ainda falam em `inboundId` são as do XML — vincular pedido, gerar pedido pela
// nota, conferir sem pedido — porque é a nota que está sendo decidida ali.
//
// O estoque só se move em `finalizarRecebimentoAction`.
//
// Toda escrita exige a permissão NA LOJA do recebimento (ou da nota), não "em
// alguma loja": quem confere a doca da loja A não fecha, cancela nem estorna a
// carga da loja B mandando o id dela. Server action é endpoint público — a
// tela esconder o botão não protege nada.

const ROTA = "/recebimento";

type RecebimentoAlvo = { id: string; siteId: string; status: string; inboundId: string | null };

/** Permissão + contexto de tenant + a loja do recebimento. */
async function comRecebimento<T>(
  receiptId: string,
  permissao: Permissao,
  fn: (ctx: ActiveTenant, receipt: RecebimentoAlvo) => Promise<T>,
): Promise<T> {
  const id = z.string().min(1, "Recebimento não informado.").parse(receiptId);
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, async () => {
    const receipt = await db.goodsReceipt.findFirst({
      where: { id },
      select: { id: true, siteId: true, status: true, inboundId: true },
    });
    if (!receipt) throw new Error("Recebimento não encontrado.");
    assertSite(ctx, permissao, receipt.siteId);
    return fn(ctx, receipt);
  });
}

/** O mesmo, para as ações que decidem a NOTA (antes de haver conferência). */
async function comNota<T>(
  inboundId: string,
  permissao: Permissao,
  fn: (ctx: ActiveTenant, nota: { id: string; siteId: string }) => Promise<T>,
): Promise<T> {
  const id = z.string().min(1, "Nota não informada.").parse(inboundId);
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, async () => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id },
      select: { id: true, siteId: true },
    });
    if (!nota) throw new Error("Nota não encontrada.");
    assertSite(ctx, permissao, nota.siteId);
    return fn(ctx, nota);
  });
}

/**
 * A linha tem de ser DESTE recebimento. As regras de divergência recebem só o
 * id da linha; sem esta conferência, o recebimento autorizado era um e a linha
 * mexida, de outro.
 */
async function exigirLinhaDoRecebimento(receiptId: string, itemId: string): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: itemId, receiptId },
    select: { id: true },
  });
  if (!linha) throw new Error("Item não encontrado neste recebimento.");
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
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, async () => {
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
    assertSite(ctx, "estoque.ajustar", siteId);
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
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, async () => {
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

    // Cada nota importada já volta com o seu recebimento (`receiptId`) — quem o
    // cria é a própria importação, para valer em todo canal.

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
  const d = vincularSchema.parse(input);
  return comNota(d.inboundId, "compras.receber", async (ctx) => {
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
  return comNota(inboundId, "compras.pedir", async (ctx) => {
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
  return comNota(inboundId, "compras.receber", async (ctx) => {
    await conferirSemPedido({ tenantId: ctx.tenant.id, inboundId, userId: ctx.user.id });
    const receiptId = await recebimentoDaNota(ctx.tenant.id, inboundId, ctx.user.id);
    revalidar(receiptId);
    revalidatePath("/fiscal/notas-recebidas");
    return receiptId;
  });
}

export async function desvincularPedidoAction(input: { receiptId: string; inboundId: string }) {
  return comRecebimento(input.receiptId, "compras.receber", async (ctx, receipt) => {
    if (receipt.inboundId !== input.inboundId) {
      throw new Error("Esta nota não é a deste recebimento.");
    }
    if (receipt.status === "FINALIZADO" || receipt.status === "CANCELADO") {
      throw new Error("Este recebimento está encerrado — o pedido não muda mais.");
    }
    await desvincularPedido({
      tenantId: ctx.tenant.id,
      inboundId: input.inboundId,
      userId: ctx.user.id,
    });
    await db.goodsReceipt.update({
      where: { id: receipt.id },
      data: { purchaseOrderId: null, status: "PENDENTE" },
    });
    revalidar(receipt.id);
  });
}

/** Refaz a conciliação — usado depois de relacionar um item ao catálogo. */
export async function reconciliarAction(input: { receiptId: string; inboundId: string }) {
  return comRecebimento(input.receiptId, "compras.receber", async (ctx, receipt) => {
    if (receipt.inboundId !== input.inboundId) {
      throw new Error("Esta nota não é a deste recebimento.");
    }
    await remontarConferencia(ctx.tenant.id, input.inboundId, ctx.user.id);
    revalidar(receipt.id);
  });
}

// ── XML que chega depois da mercadoria ──────────────────────

const vincularNotaSchema = z.object({
  receiptId: z.string().min(1),
  inboundId: z.string().min(1, "Escolha a nota."),
});

/**
 * Depois do vínculo, a conferência ainda aberta passa a ser a da nota: com
 * pedido, conciliada contra ele; sem pedido, a nota contra si mesma. A
 * contagem fica — inclusive a das linhas abertas à mão antes de o XML chegar,
 * que vira a contagem da linha da nota do mesmo produto. Fechado, não remonta:
 * a nota só documenta o que entrou.
 */
async function conferenciaDaNotaVinculada(ctx: ActiveTenant, receiptId: string, inboundId: string) {
  const depois = await db.goodsReceipt.findFirst({
    where: { id: receiptId },
    select: { status: true, purchaseOrderId: true },
  });
  if (!depois || depois.status === "FINALIZADO" || depois.status === "CANCELADO") return;
  if (depois.purchaseOrderId) {
    await conciliar({
      tenantId: ctx.tenant.id,
      inboundId,
      purchaseOrderId: depois.purchaseOrderId,
      userId: ctx.user.id,
      absorverAvulsas: true,
    });
  } else {
    await conferirSemPedido({
      tenantId: ctx.tenant.id,
      inboundId,
      userId: ctx.user.id,
      absorverAvulsas: true,
    });
  }
}

/**
 * A NF-e chegou depois. Documenta o recebimento que já existe em vez de abrir
 * outro — é o que impede a mesma carga de entrar duas vezes. Com a conferência
 * ainda aberta, ela é refeita contra a nota (a contagem fica).
 */
export async function vincularNotaAction(input: z.input<typeof vincularNotaSchema>) {
  const d = vincularNotaSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx, receipt) => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id: d.inboundId },
      select: { siteId: true },
    });
    if (!nota) throw new Error("Nota não encontrada.");
    assertSite(ctx, "compras.receber", nota.siteId);

    await vincularNotaAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: d.receiptId,
      inboundId: d.inboundId,
      userId: ctx.user.id,
    });
    await conferenciaDaNotaVinculada(ctx, receipt.id, d.inboundId);
    revalidar(receipt.id);
    revalidatePath("/fiscal/notas-recebidas");
    // A nota que documenta o recebimento fechado traz o boleto (títulos novos).
    revalidatePath("/financeiro", "layout");
  });
}

const vincularEntradaSchema = z.object({
  inboundId: z.string().min(1),
  purchaseId: z.string().min(1),
});

/**
 * "Esta nota é aquela entrada que já entrou." O par se fecha sem tocar no
 * estoque, e o recebimento que a importação reservou para a nota sai do
 * caminho. Devolve o recebimento que ficou com a nota — é para lá que a tela
 * leva quem clicou, já que o reservado deixa de existir para ela.
 */
export async function vincularNotaAEntradaAction(
  input: z.input<typeof vincularEntradaSchema>,
): Promise<{ receiptId: string | null }> {
  const d = vincularEntradaSchema.parse(input);
  return comNota(d.inboundId, "fiscal.importar", async (ctx) => {
    const r = await vincularNotaAEntradaManual({
      tenantId: ctx.tenant.id,
      inboundId: d.inboundId,
      purchaseId: d.purchaseId,
      userId: ctx.user.id,
    });
    revalidar(r.receiptId ?? undefined);
    revalidatePath("/fiscal/notas-recebidas");
    // A nota que documenta o recebimento fechado traz o boleto (títulos novos).
    revalidatePath("/financeiro", "layout");
    revalidatePath("/estoque", "layout");
    return r;
  });
}

/** O avulso era, afinal, de um pedido. */
export async function vincularPedidoAoRecebimentoAction(input: {
  receiptId: string;
  purchaseOrderId: string;
}) {
  return comRecebimento(input.receiptId, "compras.receber", async (ctx, receipt) => {
    await vincularPedidoAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      purchaseOrderId: input.purchaseOrderId,
      userId: ctx.user.id,
    });
    revalidar(receipt.id);
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
  /** A linha dividida em lotes; `null` ou `[]` volta a um lote só. */
  lotes: z
    .array(
      z.object({
        lote: z.string().trim().max(60).nullable(),
        validade: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato dd/mm/aaaa.")
          .nullable(),
        quantidade: z.coerce
          .number()
          .int("A quantidade do lote é em unidades inteiras.")
          .positive("A quantidade do lote precisa ser maior que zero."),
      }),
    )
    .max(20, "No máximo 20 lotes por linha.")
    .nullable()
    .optional(),
});

/**
 * Grava um campo da contagem. NÃO revalida a página: a tela já mostra o que
 * a pessoa digitou, e re-renderizar a conferência inteira no servidor a cada
 * campo era o que fazia contar quarenta itens parecer lento. As listas são
 * dinâmicas — a próxima visita lê o banco de qualquer jeito.
 */
export async function conferirItemAction(input: z.input<typeof conferirSchema>) {
  const d = conferirSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx) => {
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
      lotes: d.lotes,
      userId: ctx.user.id,
    });
  });
}

const somarSchema = z.object({
  receiptId: z.string().min(1),
  itemId: z.string().min(1),
  incremento: z.coerce.number().int().positive().max(100_000),
});

/**
 * O bipe: soma no servidor e devolve o total de verdade — com dois
 * celulares na mesma carga, o número que a tela tinha pode estar velho.
 */
export async function somarContagemAction(input: z.input<typeof somarSchema>): Promise<number> {
  const d = somarSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", (ctx) =>
    somarContagem({
      receiptId: d.receiptId,
      itemId: d.itemId,
      incremento: d.incremento,
      userId: ctx.user.id,
    }),
  );
}

/**
 * "Conferi tudo como está" — o caminho de 90% dos recebimentos.
 *
 * Preenche só o que ninguém contou (ver `linhasParaConferirTudo`): a contagem
 * já feita e a linha acrescentada na doca ficam como estão. Devolve quantas
 * linhas mudaram — a tela diz o número, e o "Desfazer" volta exatamente elas.
 */
export async function conferirTudoAction(receiptId: string) {
  return comRecebimento(receiptId, "compras.receber", async (ctx, receipt) => {
    if (receipt.status === "FINALIZADO" || receipt.status === "CANCELADO") {
      throw new Error("Este recebimento está encerrado.");
    }
    // Na conferência cega a pessoa não vê o número da nota — confirmar "tudo
    // igual à nota" seria assinar embaixo do que ela não viu.
    if (ctx.tenant.conferenciaCega) {
      throw new Error("Conferência cega ligada: conte item a item.");
    }
    const linhas = await db.purchaseReconciliationItem.findMany({
      where: { receiptId: receipt.id, qtdRecebida: null },
      select: { id: true, status: true, qtdPedida: true, qtdFaturada: true, qtdRecebida: true },
    });
    const preencher = linhasParaConferirTudo(linhas);
    const agora = new Date();
    for (const l of preencher) {
      await db.purchaseReconciliationItem.update({
        where: { id: l.id },
        // Bateu com o esperado: se havia ajuste registrado, ele deixa de valer.
        data: {
          qtdRecebida: l.qtdRecebida,
          resolucao: null,
          contadoPor: ctx.user.id,
          contadoEm: agora,
        },
      });
    }
    if (preencher.length > 0) await marcarEmConferencia(receipt.id);
    revalidar(receipt.id);
    return preencher.length;
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
 * A tela manda de volta o retrato que as linhas tinham antes do clique. Sem
 * isto, um clique errado num botão sem confirmação só se desfazia recontando.
 */
export async function restaurarContagemAction(input: z.input<typeof restaurarSchema>) {
  const d = restaurarSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx) => {
    for (const i of d.itens) {
      await registrarContagem({
        receiptId: d.receiptId,
        itemId: i.itemId,
        qtdRecebida: i.qtdRecebida,
        userId: ctx.user.id,
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
  const d = itemExtraSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx) => {
    // A tela conta na unidade de COMPRA (caixa); a conferência pensa em peça.
    const fator = d.packagingId
      ? Number(
          (
            await db.productPackaging.findFirst({
              where: { id: d.packagingId, productId: d.productId },
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
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
    return id;
  });
}

export async function removerItemAction(input: { receiptId: string; itemId: string }) {
  return comRecebimento(input.receiptId, "compras.receber", async (_ctx, receipt) => {
    if (receipt.status === "FINALIZADO" || receipt.status === "CANCELADO") {
      throw new Error("Este recebimento está encerrado.");
    }
    await removerItemDoRecebimento(input);
    revalidar(receipt.id);
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
  const d = resolverSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx) => {
    await exigirLinhaDoRecebimento(d.receiptId, d.itemId);
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
  quantidade: z.coerce
    .number()
    .positive("Informe a quantidade devolvida.")
    .int("A devolução é em unidades inteiras."),
  tipoMotivo: z.enum(["AVARIA", "VALIDADE", "DIVERGENCIA", "RECUSA", "OUTRO"]).default("DIVERGENCIA"),
  motivo: z.string().trim().min(3, "Explique o motivo da devolução.").max(240),
});

/**
 * Devolve ao fornecedor o excedente/avaria que já entrou no estoque — como
 * devolução de verdade (documento DEV, saída do estoque e abatimento do que
 * se deve). Exige `compras.devolver`, a mesma permissão de /estoque/devolucoes.
 */
export async function devolverDivergenciaAction(input: z.input<typeof devolucaoSchema>) {
  const d = devolucaoSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.devolver", async (ctx) => {
    await exigirLinhaDoRecebimento(d.receiptId, d.itemId);
    const r = await devolverItemDivergente({
      tenantId: ctx.tenant.id,
      reconciliationItemId: d.itemId,
      quantidade: d.quantidade,
      tipoMotivo: d.tipoMotivo,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(d.receiptId);
    revalidatePath("/estoque", "layout");
    revalidatePath("/financeiro", "layout");
    return r;
  });
}

/** Texto pronto da reclamação — o desfecho acontece no WhatsApp do vendedor. */
export async function resumoDivergenciasAction(receiptId: string) {
  return comRecebimento(receiptId, "compras.receber", (ctx, receipt) =>
    resumoDivergenciasParaFornecedor({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      empresa: ctx.tenant.nome,
    }),
  );
}

const avisoEmailSchema = z.object({
  receiptId: z.string().min(1),
  email: z.string().trim().email("Informe um e-mail válido."),
  nomeContato: z.string().trim().max(120).nullable().optional(),
  texto: z.string().trim().min(10, "O texto do aviso está vazio.").max(8000),
});

/** Manda a reclamação por e-mail ao contato, com a planilha da conferência. */
export async function enviarAvisoPorEmailAction(input: z.input<typeof avisoEmailSchema>) {
  const d = avisoEmailSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx, receipt) => {
    await enviarAvisoPorEmail({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      email: d.email,
      nomeContato: d.nomeContato ?? null,
      texto: d.texto,
      empresa: ctx.tenant.nome,
      userId: ctx.user.id,
    });
    revalidar(receipt.id);
  });
}

// ── Vasilhame ───────────────────────────────────────────────

const vasilhameSchema = z.object({
  receiptId: z.string().min(1),
  containerTypeId: z.string().min(1),
  recebidos: z.coerce.number().int("Cascos são inteiros.").min(0),
  devolvidos: z.coerce.number().int("Cascos são inteiros.").min(0),
});

/** O que o caminhão trouxe cheio e levou vazio de um tipo de casco. */
export async function salvarVasilhameAction(input: z.input<typeof vasilhameSchema>) {
  const d = vasilhameSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx, receipt) => {
    if (!featureAtiva(ctx.tenant, "comodato")) {
      throw new Error("O controle de vasilhame faz parte do módulo de comodato, que está desligado.");
    }
    if (receipt.status === "CANCELADO") throw new Error("Este recebimento foi cancelado.");
    const comFornecedor = await db.goodsReceipt.findFirst({
      where: { id: receipt.id },
      select: { supplierId: true },
    });
    if (!comFornecedor?.supplierId) {
      throw new Error("Vasilhame é conta com o fornecedor — este recebimento não tem fornecedor cadastrado.");
    }
    await registrarVasilhameDoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      supplierId: comFornecedor.supplierId,
      containerTypeId: d.containerTypeId,
      recebidos: d.recebidos,
      devolvidos: d.devolvidos,
      userId: ctx.user.id,
    });
    revalidar(receipt.id);
  });
}

// ── Vincular a NF-e que chegou depois ───────────────────────

/** NF-e livres que podem documentar este recebimento (mesma loja e fornecedor). */
export async function notasParaVincularAction(receiptId: string) {
  return comRecebimento(receiptId, "compras.receber", (_ctx, receipt) =>
    notasParaVincular(receipt.id),
  );
}

/**
 * O XML chegou e ainda não está no sistema: importa NA LOJA do recebimento e
 * já vincula. Se a nota já tinha sido importada (chave repetida), usa a que
 * existe — o objetivo da pessoa é documentar a carga, não colecionar notas.
 */
export async function importarXmlParaRecebimentoAction(receiptId: string, form: FormData) {
  return comRecebimento(receiptId, "compras.receber", async (ctx, receipt) => {
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) throw new Error("Escolha o XML da nota.");

    const emitente = await db.fiscalEmitente.findFirst({
      where: { siteId: receipt.siteId },
      select: { cnpj: true },
    });
    const [r] = await importarNotasXml({
      tenantId: ctx.tenant.id,
      siteId: receipt.siteId,
      arquivos: [{ nome: arquivo.name, bytes: new Uint8Array(await arquivo.arrayBuffer()) }],
      userId: ctx.user.id,
      cnpjDestino: emitente?.cnpj ?? null,
    });
    await registrarImportacoes(
      { origem: "UPLOAD", siteId: receipt.siteId, usuarioId: ctx.user.id },
      r ? [r] : [],
    );
    if (!r || r.status === "ERRO") {
      throw new Error(r?.motivo ?? "Não deu para ler este XML.");
    }

    let inboundId = r.inboundId ?? null;
    if (!inboundId && r.chave) {
      inboundId =
        (await db.fiscalInbound.findFirst({ where: { chave: r.chave }, select: { id: true } }))?.id ??
        null;
    }
    if (!inboundId) throw new Error("A nota não pôde ser localizada depois da importação.");

    await vincularNotaAoRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      inboundId,
      userId: ctx.user.id,
    });
    await conferenciaDaNotaVinculada(ctx, receipt.id, inboundId);
    revalidar(receipt.id);
    revalidatePath("/fiscal/notas-recebidas");
    // A nota que documenta o recebimento fechado traz o boleto (títulos novos).
    revalidatePath("/financeiro", "layout");
    return { inboundId };
  });
}

export async function aceitarCustoAction(input: { receiptId: string; itemId: string }) {
  return comRecebimento(input.receiptId, "compras.receber", async (ctx) => {
    await exigirLinhaDoRecebimento(input.receiptId, input.itemId);
    await aceitarCustoDaNota({
      tenantId: ctx.tenant.id,
      reconciliationItemId: input.itemId,
      userId: ctx.user.id,
    });
    revalidar(input.receiptId);
  });
}

// ── Observações ─────────────────────────────────────────────

const observacaoSchema = z.object({
  receiptId: z.string().min(1),
  observacao: z.string().trim().max(500, "A observação cabe em até 500 caracteres."),
});

/**
 * A anotação livre do recebimento — "motorista avisou que o resto vem na
 * sexta". Não muda estoque nem custo; fica com o recebimento, para quem abrir
 * depois.
 */
export async function salvarObservacaoAction(input: z.input<typeof observacaoSchema>) {
  const d = observacaoSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (_ctx, receipt) => {
    await db.goodsReceipt.update({
      where: { id: receipt.id },
      data: { observacao: d.observacao || null },
    });
    revalidatePath(`${ROTA}/${receipt.id}`);
  });
}

// ── Fechar ──────────────────────────────────────────────────

/** Avulso sai do provisório e entra na lista — a contagem segue de onde parou. */
export async function salvarRascunhoAction(receiptId: string) {
  return comRecebimento(receiptId, "compras.receber", async (_ctx, receipt) => {
    await salvarRascunhoRecebimento(receipt.id);
    revalidar(receipt.id);
  });
}

const finalizarSchema = z.object({
  receiptId: z.string().min(1),
  motivoDivergencia: z.string().trim().max(240).nullable().optional(),
  /** Abater dos títulos da nota o que ela cobra e não chegou. */
  abaterFalta: z.boolean().optional(),
});

/**
 * O único ponto em que a mercadoria entra no estoque.
 *
 * Preço de venda não passa por aqui: ele mora no cadastro do produto, e o
 * recebimento só atualiza estoque e custo.
 */
export async function finalizarRecebimentoAction(input: z.input<typeof finalizarSchema>) {
  const d = finalizarSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx, receipt) => {
    const r = await finalizarRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      motivoDivergencia: d.motivoDivergencia,
      abaterFalta: d.abaterFalta,
      userId: ctx.user.id,
    });

    revalidar(receipt.id);
    revalidatePath("/estoque");
    revalidatePath("/inicio");
    if (r.faltaAbatida > 0) revalidatePath("/financeiro", "layout");
    return r;
  });
}

const cancelarSchema = z.object({
  receiptId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que a conferência não vai continuar.").max(240),
});

export async function cancelarRecebimentoAction(input: z.input<typeof cancelarSchema>) {
  const d = cancelarSchema.parse(input);
  return comRecebimento(d.receiptId, "compras.receber", async (ctx, receipt) => {
    await cancelarRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(receipt.id);
  });
}

const estornoSchema = z.object({
  receiptId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que está estornando — isso fica na razão de estoque.").max(240),
});

/**
 * Desfaz a entrada do recebimento inteiro — compra e bonificação — e reabre
 * a conferência. Exige `estoque.ajustar` na loja, como todo estorno: quem
 * confere carga não desfaz lançamento.
 */
export async function estornarRecebimentoAction(input: z.input<typeof estornoSchema>) {
  const d = estornoSchema.parse(input);
  return comRecebimento(d.receiptId, "estoque.ajustar", async (ctx, receipt) => {
    const r = await estornarRecebimento({
      tenantId: ctx.tenant.id,
      receiptId: receipt.id,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar(receipt.id);
    revalidatePath("/estoque", "layout");
    revalidatePath("/financeiro", "layout");
    revalidatePath("/fiscal/notas-recebidas");
    revalidatePath("/inicio");
    return r;
  });
}

// ── Painel "Receber mercadoria" ─────────────────────────────

/**
 * O recebimento de uma nota que já está no sistema, achada pela chave.
 *
 * Serve ao painel quando o XML arrastado é de uma nota já importada: em vez de
 * só avisar "duplicada", leva ao recebimento dela — que é o que o operador
 * queria ao arrastar o arquivo. Null = a chave não está aqui.
 */
export async function recebimentoDaChaveAction(chaveBruta: string): Promise<string | null> {
  const chave = chaveBruta.replace(/\D/g, "");
  if (chave.length !== 44) return null;
  const ctx = await guardAction("compras.receber");
  return runWithTenant(ctx.tenant.id, async () => {
    const nota = await db.fiscalInbound.findFirst({
      where: { chave },
      select: { id: true, siteId: true },
    });
    if (!nota) return null;
    assertSite(ctx, "compras.receber", nota.siteId);
    const id = await recebimentoDaNota(ctx.tenant.id, nota.id, ctx.user.id);
    revalidar(id);
    return id;
  });
}
