import "server-only";
import { db } from "@/lib/prisma";
import { aplicarMovimento } from "@/lib/estoque";
import { registrarEvento } from "@/lib/compras/eventos";

// ============================================================
// Desfazer uma entrada lançada errada.
//
// Antes não havia caminho: `descartarNota` recusava nota já recebida e mandava
// "registre uma devolução ou um ajuste" — que é empurrar o problema para o
// operador reconstruir à mão o que o sistema fez sozinho, em três lugares
// (saldo, custo médio, contas a pagar) e sem nenhum vínculo entre eles.
//
// Devolução ≠ estorno. Devolução é um FATO comercial: a mercadoria existiu,
// entrou, e voltou — o fornecedor sabe. Estorno é a correção de um REGISTRO:
// aquela entrada nunca deveria ter existido. Confundir os dois enche o
// histórico do fornecedor de devoluções que nunca aconteceram.
//
// A entrada não é apagada. A razão de estoque é append-only e o estorno é um
// fato: quem lançou, quem desfez, quando e por quê. Apagar deixaria um buraco
// que ninguém explica seis meses depois.
// ============================================================

export type ResultadoEstorno = {
  purchaseId: string;
  itens: number;
  titulosCancelados: number;
  notaLiberada: boolean;
};

/**
 * Reverte a entrada: tira do estoque o que ela somou, cancela os títulos que
 * ela gerou, devolve o pedido ao estado anterior e libera a nota para ser
 * recebida de novo (quando havia uma).
 */
export async function estornarEntrada(input: {
  tenantId: string;
  purchaseId: string;
  motivo: string;
  userId?: string | null;
}): Promise<ResultadoEstorno> {
  const { tenantId, purchaseId, motivo, userId } = input;
  if (motivo.trim().length < 3) {
    throw new Error("Diga por que está estornando — isso fica na razão de estoque.");
  }

  const entrada = await db.purchase.findFirst({
    where: { id: purchaseId },
    select: {
      id: true,
      siteId: true,
      data: true,
      numeroNota: true,
      estornadaEm: true,
      purchaseOrderId: true,
      supplierId: true,
      items: {
        select: { productId: true, quantidade: true, custoTotal: true, packagingId: true },
      },
      fiscalInbound: { select: { id: true, status: true, numero: true, serie: true } },
      devolucoes: { select: { id: true, numero: true, status: true } },
    },
  });
  if (!entrada) throw new Error("Entrada não encontrada.");
  if (entrada.estornadaEm) throw new Error("Esta entrada já foi estornada.");

  // Devolução confirmada em cima desta entrada já tirou parte do estoque.
  // Estornar por cima tiraria duas vezes — e o crédito com o fornecedor
  // passaria a apontar para uma compra que o sistema diz que nunca houve.
  const devolvida = entrada.devolucoes.find((d) => d.status === "CONFIRMADA");
  if (devolvida) {
    throw new Error(
      `A devolução ${devolvida.numero} já saiu desta entrada. Cancele o efeito dela antes de estornar, ou registre um ajuste de estoque.`,
    );
  }

  // Converte para unidade base, do mesmo jeito que `registrarEntrada` fez ao
  // somar — senão o estorno tira garrafa onde entrou caixa.
  const pacotes = await db.productPackaging.findMany({
    where: {
      id: { in: entrada.items.map((i) => i.packagingId).filter((i): i is string => Boolean(i)) },
    },
    select: { id: true, fatorConversao: true },
  });
  const fator = new Map(pacotes.map((p) => [p.id, Number(p.fatorConversao)]));

  const linhas = entrada.items.map((i) => {
    const f = (i.packagingId ? fator.get(i.packagingId) : null) ?? 1;
    const qtdBase = Number(i.quantidade) * f;
    return {
      productId: i.productId,
      qtdBase,
      custoTotal: Number(i.custoTotal),
      custoUnitario: qtdBase > 0 ? Number(i.custoTotal) / qtdBase : 0,
    };
  });

  // Confere ANTES de mexer em qualquer coisa: estorno parcial deixaria saldo
  // negativo em uns produtos e correto em outros, que é pior do que recusar.
  const saldos = await db.stock.findMany({
    where: { siteId: entrada.siteId, productId: { in: linhas.map((l) => l.productId) } },
    select: { productId: true, estoqueFechado: true },
  });
  const saldoDe = new Map(saldos.map((s) => [s.productId, Number(s.estoqueFechado)]));

  const insuficientes = linhas.filter((l) => (saldoDe.get(l.productId) ?? 0) < l.qtdBase - 0.001);
  if (insuficientes.length > 0) {
    const nomes = await db.product.findMany({
      where: { id: { in: insuficientes.map((l) => l.productId) } },
      select: { id: true, nome: true },
    });
    throw new Error(
      `Parte desta entrada já foi vendida ou consumida: ${nomes
        .map((n) => n.nome)
        .join(", ")}. Corrija pelo inventário — estornar deixaria o saldo negativo.`,
    );
  }

  for (const l of linhas) {
    await aplicarMovimento(
      tenantId,
      entrada.siteId,
      l.productId,
      "ESTORNO",
      { deltaFechado: -l.qtdBase },
      {
        custoUnitario: l.custoUnitario,
        purchaseId: entrada.id,
        observacao: `Estorno da entrada${entrada.numeroNota ? ` (nota ${entrada.numeroNota})` : ""} — ${motivo}`,
        createdBy: userId ?? undefined,
      },
    );
  }

  // Títulos: só os que ninguém pagou. Título com baixa é dinheiro que já saiu —
  // cancelar em silêncio esconderia um pagamento feito.
  const titulos = await db.accountPayable.findMany({
    where: { purchaseId: entrada.id },
    select: { id: true, status: true, valorPago: true, descricao: true },
  });
  const pagos = titulos.filter((t) => t.status === "PAGO" || Number(t.valorPago) > 0);
  const canceláveis = titulos.filter((t) => t.status === "ABERTO" && Number(t.valorPago) === 0);

  for (const t of canceláveis) {
    await db.accountPayable.update({
      where: { id: t.id },
      data: { status: "CANCELADO", observacao: `Entrada estornada: ${motivo}` },
    });
  }

  // Pedido: devolve `qtdRecebida` ao que era antes desta entrada e reabre o
  // status. Sem isso o pedido continuaria "recebido" sem mercadoria nenhuma.
  let notaLiberada = false;
  if (entrada.purchaseOrderId) {
    await reverterRecebimentoNoPedido(entrada.purchaseOrderId, linhas, fator);
    await registrarEvento({
      tenantId,
      purchaseOrderId: entrada.purchaseOrderId,
      inboundId: entrada.fiscalInbound?.id ?? null,
      tipo: "ESTOQUE_ATUALIZADO",
      descricao:
        `Entrada estornada: ${linhas.length} item(ns) saíram do estoque. Motivo: ${motivo}` +
        (canceláveis.length ? ` · ${canceláveis.length} título(s) cancelado(s).` : "") +
        (pagos.length
          ? ` · ATENÇÃO: ${pagos.length} título(s) já pago(s) continuam válidos — trate o crédito com o fornecedor.`
          : ""),
      meta: { purchaseId: entrada.id, itens: linhas.length },
      createdBy: userId,
    });
  }

  // Nota volta a CONCILIADO: os itens continuam relacionados, então basta
  // conferir de novo. Voltar para PENDENTE faria o operador refazer o de-para.
  if (entrada.fiscalInbound) {
    await db.fiscalInbound.update({
      where: { id: entrada.fiscalInbound.id },
      data: {
        status: "CONCILIADO",
        purchaseId: null,
        observacao: `Entrada estornada em ${new Date().toLocaleDateString("pt-BR")}: ${motivo}`,
      },
    });
    notaLiberada = true;
  }

  await db.purchase.update({
    where: { id: entrada.id },
    data: {
      estornadaEm: new Date(),
      estornoMotivo: motivo,
      estornadaPor: userId ?? null,
      // Deixa de esperar documento: a entrada não existe mais para efeito de
      // saldo, e continuar na fila de "aguardando XML" seria cobrar por nada.
      aguardandoDocumento: false,
    },
  });

  return {
    purchaseId: entrada.id,
    itens: linhas.length,
    titulosCancelados: canceláveis.length,
    notaLiberada,
  };
}

/** Desconta do pedido o que esta entrada tinha somado em `qtdRecebida`. */
async function reverterRecebimentoNoPedido(
  purchaseOrderId: string,
  linhas: { productId: string; qtdBase: number }[],
  fator: Map<string, number>,
): Promise<void> {
  const itens = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { id: true, productId: true, packagingId: true, qtdPedida: true, qtdRecebida: true },
  });

  const porProduto = new Map<string, number>();
  for (const l of linhas) {
    porProduto.set(l.productId, (porProduto.get(l.productId) ?? 0) + l.qtdBase);
  }

  let algumRecebido = false;
  for (const it of itens) {
    const baixar = porProduto.get(it.productId);
    if (baixar != null) {
      const f = (it.packagingId ? fator.get(it.packagingId) : null) ?? 1;
      const novo = Math.max(0, Number(it.qtdRecebida) - baixar / (f > 0 ? f : 1));
      await db.purchaseOrderItem.update({ where: { id: it.id }, data: { qtdRecebida: novo } });
      if (novo > 0.001) algumRecebido = true;
    } else if (Number(it.qtdRecebida) > 0.001) {
      algumRecebido = true;
    }
  }

  await db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      // Ainda há mercadoria de outra entrada → parcial. Nada → volta a esperar.
      //
      // AGUARDANDO (Confirmado), não EM_TRANSITO: "em trânsito" saiu do
      // vocabulário do pedido — descrevia a entrega, que é assunto do
      // recebimento. Estornar devolve o pedido ao estado anterior à chegada da
      // mercadoria, e esse estado é "o fornecedor confirmou, nada chegou".
      status: algumRecebido ? "RECEBIDO_PARCIAL" : "AGUARDANDO",
      recebidoEm: null,
      saldoResolucao: "PENDENTE",
      saldoResolvidoEm: null,
      financeiroGerado: false,
    },
  });
}

/**
 * Desfaz o vínculo "esta nota documenta aquela entrada manual". Ao contrário do
 * estorno, não toca no estoque — o vínculo nunca movimentou nada. A entrada
 * volta a esperar documento e a nota volta à fila.
 */
export async function desvincularNotaDaEntrada(input: {
  tenantId: string;
  inboundId: string;
  motivo: string;
  userId?: string | null;
}): Promise<void> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: { id: true, status: true, purchaseId: true, purchaseOrderId: true, numero: true, serie: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status !== "VINCULADO") {
    throw new Error("Esta nota não está vinculada a uma entrada lançada à mão.");
  }

  if (nota.purchaseId) {
    await db.purchase.update({
      where: { id: nota.purchaseId },
      data: {
        aguardandoDocumento: true,
        chaveNfe: null,
        documentoVinculadoEm: null,
      },
    });
  }

  await db.fiscalInbound.update({
    where: { id: nota.id },
    data: {
      status: "CONCILIADO",
      purchaseId: null,
      semEstoqueMotivo: null,
      observacao: `Vínculo desfeito: ${input.motivo}`,
    },
  });

  if (nota.purchaseOrderId) {
    await registrarEvento({
      tenantId: input.tenantId,
      purchaseOrderId: nota.purchaseOrderId,
      inboundId: nota.id,
      tipo: "VINCULO_ALTERADO",
      descricao: `NF-e ${nota.numero}/${nota.serie} deixou de documentar a entrada manual. Motivo: ${input.motivo}`,
      createdBy: input.userId,
    });
  }
}
