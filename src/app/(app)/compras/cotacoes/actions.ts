"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { db } from "@/lib/prisma";

// ============================================================
// Cotações (RFQ) — pedir preço, registrar resposta, decidir.
//
// Nada aqui mexe em estoque: a cotação é conversa. Só o passo final
// ("gerar pedidos") cria PurchaseOrder, e aí o fluxo volta a ser o de
// sempre — /compras/pedidos manda no resto da vida do pedido.
// ============================================================

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

async function txp<T>(
  permissao: Permissao,
  siteId: string | null,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => revalidatePath("/compras", "layout");

/** Gera o próximo número sequencial COT-00001 por tenant. */
async function proximoNumero(): Promise<string> {
  const total = await db.quotation.count();
  return `COT-${String(total + 1).padStart(5, "0")}`;
}

/** Cotação em RASCUNHO ou ABERTA ainda aceita edição de itens/convidados. */
async function exigirEditavel(id: string) {
  const c = await db.quotation.findFirst({ where: { id }, select: { status: true, siteId: true } });
  if (!c) throw new Error("Cotação não encontrada.");
  if (c.status === "CANCELADA" || c.status === "DECIDIDA") {
    throw new Error("Esta cotação já foi fechada e não aceita mais mudanças.");
  }
  return c;
}

// ── Cotação ─────────────────────────────────────────────────

const criarSchema = z.object({
  titulo: z.string().trim().min(3, "Dê um nome que você reconheça depois."),
  siteId: z.string().min(1, "Escolha para qual loja é a compra."),
  prazoResposta: z.string().optional().nullable(), // yyyy-mm-dd
  observacao: z.string().trim().max(1000).optional().nullable(),
});

export async function criarCotacaoAction(input: z.input<typeof criarSchema>) {
  const d = criarSchema.parse(input);
  return txp("compras.pedir", d.siteId, async (tid, userId) => {
    const numero = await proximoNumero();
    const cotacao = await db.quotation.create({
      data: {
        tenantId: tid,
        siteId: d.siteId,
        numero,
        titulo: d.titulo,
        prazoResposta: d.prazoResposta ? new Date(`${d.prazoResposta}T23:59:59`) : null,
        observacao: d.observacao ?? null,
        createdBy: userId,
      },
      select: { id: true, numero: true },
    });
    ok();
    return cotacao;
  });
}

const editarSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().trim().min(3),
  prazoResposta: z.string().optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
});

export async function editarCotacaoAction(input: z.input<typeof editarSchema>) {
  const d = editarSchema.parse(input);
  return tx(async () => {
    await exigirEditavel(d.id);
    await db.quotation.updateMany({
      where: { id: d.id },
      data: {
        titulo: d.titulo,
        prazoResposta: d.prazoResposta ? new Date(`${d.prazoResposta}T23:59:59`) : null,
        observacao: d.observacao ?? null,
      },
    });
    ok();
  });
}

export async function encerrarCotacaoAction(id: string) {
  return tx(async () => {
    await exigirEditavel(id);
    await db.quotation.updateMany({
      where: { id },
      data: { status: "ENCERRADA", encerradaEm: new Date() },
    });
    ok();
  });
}

export async function reabrirCotacaoAction(id: string) {
  return tx(async () => {
    const c = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (c?.status !== "ENCERRADA") throw new Error("Só uma cotação encerrada pode ser reaberta.");
    await db.quotation.updateMany({
      where: { id },
      data: { status: "ABERTA", encerradaEm: null },
    });
    ok();
  });
}

export async function cancelarCotacaoAction(id: string) {
  return tx(async () => {
    const c = await db.quotation.findFirst({ where: { id }, select: { status: true } });
    if (!c) throw new Error("Cotação não encontrada.");
    if (c.status === "DECIDIDA") throw new Error("Cotação já virou pedido — não dá para cancelar.");
    await db.quotation.updateMany({
      where: { id },
      data: { status: "CANCELADA", canceladaEm: new Date() },
    });
    ok();
  });
}

// ── Itens ───────────────────────────────────────────────────

const itemSchema = z.object({
  quotationId: z.string().min(1),
  productId: z.string().optional().nullable(),
  packagingId: z.string().optional().nullable(),
  descricao: z.string().trim().min(2, "Descreva o item para o fornecedor entender."),
  quantidade: z.number().positive("A quantidade precisa ser maior que zero."),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function adicionarItemAction(input: z.input<typeof itemSchema>) {
  const d = itemSchema.parse(input);
  return tx(async (tid) => {
    await exigirEditavel(d.quotationId);
    const ultimo = await db.quotationItem.findFirst({
      where: { quotationId: d.quotationId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });
    await db.quotationItem.create({
      data: {
        tenantId: tid,
        quotationId: d.quotationId,
        productId: d.productId || null,
        packagingId: d.packagingId || null,
        descricao: d.descricao,
        quantidade: d.quantidade,
        observacao: d.observacao ?? null,
        ordem: (ultimo?.ordem ?? -1) + 1,
      },
    });
    ok();
  });
}

const editarItemSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().trim().min(2),
  quantidade: z.number().positive(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

export async function editarItemAction(input: z.input<typeof editarItemSchema>) {
  const d = editarItemSchema.parse(input);
  return tx(async () => {
    const item = await db.quotationItem.findFirst({
      where: { id: d.id },
      select: { quotationId: true },
    });
    if (!item) throw new Error("Item não encontrado.");
    await exigirEditavel(item.quotationId);
    await db.quotationItem.updateMany({
      where: { id: d.id },
      data: {
        descricao: d.descricao,
        quantidade: d.quantidade,
        observacao: d.observacao ?? null,
      },
    });
    ok();
  });
}

export async function removerItemAction(id: string) {
  return tx(async () => {
    const item = await db.quotationItem.findFirst({
      where: { id },
      select: { quotationId: true },
    });
    if (!item) throw new Error("Item não encontrado.");
    await exigirEditavel(item.quotationId);
    await db.quotationItem.deleteMany({ where: { id } });
    ok();
  });
}

// ── Convidados ──────────────────────────────────────────────

const convidarSchema = z.object({
  quotationId: z.string().min(1),
  supplierIds: z.array(z.string().min(1)).min(1, "Escolha ao menos um fornecedor."),
});

export async function convidarFornecedoresAction(input: z.input<typeof convidarSchema>) {
  const d = convidarSchema.parse(input);
  return tx(async (tid) => {
    await exigirEditavel(d.quotationId);
    // createMany + skipDuplicates: reconvidar quem já está na lista não é erro,
    // é clique repetido.
    await db.quotationSupplier.createMany({
      data: d.supplierIds.map((supplierId) => ({
        tenantId: tid,
        quotationId: d.quotationId,
        supplierId,
      })),
      skipDuplicates: true,
    });
    ok();
  });
}

export async function removerConviteAction(id: string) {
  return tx(async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id },
      select: { quotationId: true, status: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);
    if (convite.status === "RESPONDIDA") {
      throw new Error("Este fornecedor já respondeu — encerre a cotação em vez de apagar a resposta.");
    }
    await db.quotationSupplier.deleteMany({ where: { id } });
    ok();
  });
}

// ── Envio ───────────────────────────────────────────────────

/** Texto que o operador manda ao fornecedor — mesma ideia do cupom: sem
 *  gateway de mensageria, devolvemos a mensagem pronta e o link wa.me. */
function montarMensagem(
  empresa: string,
  numero: string,
  titulo: string,
  prazo: Date | null,
  itens: { descricao: string; quantidade: number }[],
): string {
  const linhas = itens.map((i) => `• ${i.descricao} — ${i.quantidade.toLocaleString("pt-BR")}`);
  const prazoTexto = prazo
    ? `\nPreciso da resposta até ${prazo.toLocaleDateString("pt-BR")}.`
    : "";
  return [
    `Olá! Aqui é da ${empresa}.`,
    `Pedido de cotação ${numero} — ${titulo}:`,
    "",
    ...linhas,
    prazoTexto,
    "\nPode me passar preço, prazo de entrega e condição de pagamento?",
  ].join("\n");
}

const enviarSchema = z.object({
  quotationId: z.string().min(1),
  /** Vazio = manda para todos os convidados que ainda não receberam. */
  conviteIds: z.array(z.string().min(1)).optional(),
});

export async function enviarCotacaoAction(input: z.input<typeof enviarSchema>) {
  const d = enviarSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        numero: true,
        titulo: true,
        status: true,
        prazoResposta: true,
        items: { select: { descricao: true, quantidade: true }, orderBy: { ordem: "asc" } },
        suppliers: {
          select: {
            id: true,
            status: true,
            supplier: { select: { razaoSocial: true, nomeFantasia: true, telefone: true } },
          },
        },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    if (cotacao.items.length === 0) throw new Error("Adicione ao menos um item antes de enviar.");
    if (cotacao.suppliers.length === 0) throw new Error("Convide ao menos um fornecedor.");

    const alvos = cotacao.suppliers.filter(
      (s) =>
        (d.conviteIds?.length ? d.conviteIds.includes(s.id) : true) && s.status === "PENDENTE",
    );
    if (alvos.length === 0) throw new Error("Todos os fornecedores escolhidos já receberam.");

    const agora = new Date();
    await db.quotationSupplier.updateMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      data: { status: "ENVIADA", enviadaEm: agora },
    });
    await db.quotation.updateMany({
      where: { id: d.quotationId },
      data: {
        status: "ABERTA",
        enviadaEm: cotacao.status === "RASCUNHO" ? agora : undefined,
      },
    });

    const mensagem = montarMensagem(
      ctx.tenant.nome,
      cotacao.numero,
      cotacao.titulo,
      cotacao.prazoResposta,
      cotacao.items.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade) })),
    );

    ok();
    return alvos.map((a) => {
      const tel = a.supplier.telefone?.replace(/\D/g, "") ?? "";
      const numeroWa = tel.length && tel.length <= 11 ? `55${tel}` : tel;
      return {
        conviteId: a.id,
        fornecedor: a.supplier.nomeFantasia || a.supplier.razaoSocial,
        mensagem,
        waLink: numeroWa ? `https://wa.me/${numeroWa}?text=${encodeURIComponent(mensagem)}` : null,
      };
    });
  });
}

// ── Resposta do fornecedor ──────────────────────────────────

const respostaSchema = z.object({
  conviteId: z.string().min(1),
  prazoEntregaDias: z.number().int().min(0).max(365).optional().nullable(),
  condicaoPagamento: z.string().trim().max(120).optional().nullable(),
  frete: z.number().min(0).optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
  itens: z
    .array(
      z.object({
        quotationItemId: z.string().min(1),
        disponivel: z.boolean().default(true),
        precoUnitario: z.number().min(0).default(0),
        quantidadeOfertada: z.number().min(0).optional().nullable(),
        marca: z.string().trim().max(120).optional().nullable(),
        observacao: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1, "Registre ao menos um item."),
});

export async function registrarRespostaAction(input: z.input<typeof respostaSchema>) {
  const d = respostaSchema.parse(input);
  return txp("compras.pedir", null, async (tid) => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: d.conviteId },
      select: { quotationId: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);

    // Regravar por cima: corrigir um preço digitado errado é rotina, e a
    // resposta é sempre a última que o fornecedor mandou.
    await db.quotationResponse.deleteMany({ where: { quotationSupplierId: d.conviteId } });
    await db.quotationResponse.createMany({
      data: d.itens.map((i) => ({
        tenantId: tid,
        quotationSupplierId: d.conviteId,
        quotationItemId: i.quotationItemId,
        disponivel: i.disponivel,
        precoUnitario: i.disponivel ? i.precoUnitario : 0,
        quantidadeOfertada: i.quantidadeOfertada ?? null,
        marca: i.marca ?? null,
        observacao: i.observacao ?? null,
      })),
    });
    await db.quotationSupplier.updateMany({
      where: { id: d.conviteId },
      data: {
        status: "RESPONDIDA",
        respondidaEm: new Date(),
        prazoEntregaDias: d.prazoEntregaDias ?? null,
        condicaoPagamento: d.condicaoPagamento ?? null,
        frete: d.frete ?? null,
        observacao: d.observacao ?? null,
      },
    });
    ok();
  });
}

export async function recusarConviteAction(conviteId: string, motivo?: string) {
  return txp("compras.pedir", null, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: conviteId },
      select: { quotationId: true },
    });
    if (!convite) throw new Error("Convite não encontrado.");
    await exigirEditavel(convite.quotationId);
    await db.quotationSupplier.updateMany({
      where: { id: conviteId },
      data: {
        status: "RECUSADA",
        respondidaEm: new Date(),
        observacao: motivo?.trim() || null,
      },
    });
    ok();
  });
}

// ── Decisão: cotação vira pedido ────────────────────────────

const decidirSchema = z.object({
  quotationId: z.string().min(1),
  /** Item → convite escolhido. Item de fora fica sem pedido, de propósito. */
  escolhas: z
    .array(z.object({ quotationItemId: z.string().min(1), conviteId: z.string().min(1) }))
    .min(1, "Escolha ao menos um item."),
  enviar: z.boolean().default(true),
});

export async function gerarPedidosAction(input: z.input<typeof decidirSchema>) {
  const d = decidirSchema.parse(input);
  const ctx = await guardAction("compras.pedir");

  return runWithTenant(ctx.tenant.id, async () => {
    const cotacao = await db.quotation.findFirst({
      where: { id: d.quotationId },
      select: {
        id: true,
        numero: true,
        siteId: true,
        status: true,
        items: {
          select: { id: true, productId: true, packagingId: true, quantidade: true, descricao: true },
        },
        suppliers: {
          select: {
            id: true,
            supplierId: true,
            prazoEntregaDias: true,
            responses: {
              select: { quotationItemId: true, disponivel: true, precoUnitario: true },
            },
          },
        },
      },
    });
    if (!cotacao) throw new Error("Cotação não encontrada.");
    if (cotacao.status === "DECIDIDA") throw new Error("Esta cotação já virou pedido.");
    if (cotacao.status === "CANCELADA") throw new Error("Cotação cancelada.");

    const itemPorId = new Map(cotacao.items.map((i) => [i.id, i]));
    const convitePorId = new Map(cotacao.suppliers.map((s) => [s.id, s]));

    // Agrupa por fornecedor: cada um vira um pedido de compra independente.
    const porConvite = new Map<string, { productId: string; packagingId: string | null; qtdPedida: number; custoUnitario: number }[]>();
    const semProduto: string[] = [];

    for (const escolha of d.escolhas) {
      const item = itemPorId.get(escolha.quotationItemId);
      const convite = convitePorId.get(escolha.conviteId);
      if (!item || !convite) continue;

      // Item de texto livre não tem para onde ir no estoque — avisa em vez de
      // criar pedido pela metade em silêncio.
      if (!item.productId) {
        semProduto.push(item.descricao);
        continue;
      }

      const resposta = convite.responses.find((r) => r.quotationItemId === item.id);
      if (!resposta?.disponivel) continue;

      const lista = porConvite.get(convite.id) ?? [];
      lista.push({
        productId: item.productId,
        packagingId: item.packagingId,
        qtdPedida: Number(item.quantidade),
        custoUnitario: Number(resposta.precoUnitario),
      });
      porConvite.set(convite.id, lista);
    }

    if (porConvite.size === 0) {
      throw new Error(
        semProduto.length
          ? "Os itens escolhidos não estão vinculados a um produto do catálogo. Vincule antes de gerar o pedido."
          : "Nenhum item escolhido tem preço disponível.",
      );
    }

    // Sequencial de propósito: o número do pedido (PC-000NN) é gerado por
    // tenant e criações paralelas colidiriam no unique.
    const criados: { id: string; conviteId: string }[] = [];
    for (const [conviteId, items] of porConvite) {
      const convite = convitePorId.get(conviteId)!;
      const previsao = convite.prazoEntregaDias
        ? new Date(Date.now() + convite.prazoEntregaDias * 24 * 60 * 60 * 1000)
        : null;

      const id = await criarPedidoCompra(
        ctx.tenant.id,
        {
          siteId: cotacao.siteId,
          supplierId: convite.supplierId,
          previsaoEntrega: previsao,
          observacao: `Gerado da cotação ${cotacao.numero}`,
          items,
        },
        { enviar: d.enviar, createdBy: ctx.user.id ?? undefined },
      );
      criados.push({ id, conviteId });
      await db.quotationSupplier.updateMany({
        where: { id: conviteId },
        data: { purchaseOrderId: id },
      });
    }

    await db.quotation.updateMany({
      where: { id: cotacao.id },
      data: { status: "DECIDIDA", decididaEm: new Date() },
    });

    revalidatePath("/compras", "layout");
    revalidatePath("/estoque", "layout");
    return { pedidos: criados.length, semProduto };
  });
}
