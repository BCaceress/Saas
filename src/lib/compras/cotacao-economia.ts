import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// O que a cotação economizou — de verdade.
//
// A cotação virava pedido e a história acabava ali. O vínculo existia só na
// direção cotação→pedido (`QuotationSupplier.purchaseOrderId`), então ninguém
// conseguia responder "valeu a pena cotar?" nem "o fornecedor que ganhou
// entregou?". Com `PurchaseOrder.quotationId` a pergunta vira uma consulta.
//
// Duas economias, e elas quase nunca batem:
//   ESTIMADA — preço escolhido × pior preço cotado, no momento da decisão.
//   REALIZADA — preço escolhido × o que a nota efetivamente cobrou.
//
// A diferença entre as duas é o desvio que só aparece no recebimento: o
// fornecedor que ganhou por centavos e faturou mais caro. É esse número que
// muda a próxima cotação.
// ============================================================

export type EconomiaCotacao = {
  quotationId: string;
  numero: string;
  /** Soma do que foi escolhido, aos preços cotados. */
  valorEscolhido: number;
  /** A mesma cesta, se cada item tivesse saído pelo pior preço recebido. */
  valorPiorCaso: number;
  economiaEstimada: number;
  /** % sobre o pior caso — o número que cabe num selo. */
  percentual: number;
  /** Itens que tiveram ao menos duas respostas (sem comparação não há economia). */
  itensComparados: number;
  /** Pedidos que nasceram desta cotação. */
  pedidos: {
    id: string;
    numero: string;
    status: string;
    supplierNome: string;
    valorTotal: number;
    /** Quanto as entradas desse pedido efetivamente custaram. */
    valorRecebido: number;
  }[];
  /** Soma de `valorTotal` dos pedidos gerados. */
  valorPedido: number;
  /** Soma do que entrou de fato. Zero enquanto nada chegou. */
  valorRecebido: number;
  /**
   * `valorRecebido − valorPedido` nos pedidos que já receberam alguma coisa.
   * Positivo = o fornecedor cobrou mais do que cotou.
   */
  desvioFaturamento: number;
};

export async function economiaDaCotacao(quotationId: string): Promise<EconomiaCotacao | null> {
  const cotacao = await db.quotation.findFirst({
    where: { id: quotationId },
    select: {
      id: true,
      numero: true,
      items: {
        select: {
          id: true,
          quantidade: true,
          responses: {
            select: {
              disponivel: true,
              precoUnitario: true,
              quotationSupplierId: true,
            },
          },
        },
      },
      suppliers: { select: { id: true, purchaseOrderId: true } },
    },
  });
  if (!cotacao) return null;

  // Convite que virou pedido = fornecedor escolhido. Um item só entra na conta
  // quando o vencedor respondeu por ele.
  const vencedores = new Set(
    cotacao.suppliers.filter((s) => s.purchaseOrderId).map((s) => s.id),
  );

  let valorEscolhido = 0;
  let valorPiorCaso = 0;
  let itensComparados = 0;

  for (const item of cotacao.items) {
    const validas = item.responses.filter((r) => r.disponivel && Number(r.precoUnitario) > 0);
    if (validas.length === 0) continue;

    const escolhida = validas.find((r) => vencedores.has(r.quotationSupplierId));
    if (!escolhida) continue;

    const qtd = Number(item.quantidade);
    const precos = validas.map((r) => Number(r.precoUnitario));
    const pior = Math.max(...precos);

    valorEscolhido += qtd * Number(escolhida.precoUnitario);
    valorPiorCaso += qtd * pior;
    if (validas.length > 1) itensComparados += 1;
  }

  const pedidos = await db.purchaseOrder.findMany({
    where: { quotationId },
    select: {
      id: true,
      numero: true,
      status: true,
      valorTotal: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      entradas: { select: { items: { select: { custoTotal: true } } } },
    },
    orderBy: { numero: "asc" },
  });

  const linhas = pedidos.map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    supplierNome: p.supplier.nomeFantasia || p.supplier.razaoSocial,
    valorTotal: Number(p.valorTotal),
    valorRecebido: p.entradas.reduce(
      (a, e) => a + e.items.reduce((b, i) => b + Number(i.custoTotal), 0),
      0,
    ),
  }));

  const valorPedido = linhas.reduce((a, p) => a + p.valorTotal, 0);
  const valorRecebido = linhas.reduce((a, p) => a + p.valorRecebido, 0);
  // Só pedidos que já receberam algo entram no desvio — comparar contra zero
  // diria que todo pedido em trânsito veio 100% mais barato.
  const comEntrada = linhas.filter((p) => p.valorRecebido > 0);
  const desvioFaturamento = comEntrada.reduce(
    (a, p) => a + (p.valorRecebido - p.valorTotal),
    0,
  );

  const economiaEstimada = valorPiorCaso - valorEscolhido;

  return {
    quotationId,
    numero: cotacao.numero,
    valorEscolhido,
    valorPiorCaso,
    economiaEstimada,
    percentual: valorPiorCaso > 0 ? (economiaEstimada / valorPiorCaso) * 100 : 0,
    itensComparados,
    pedidos: linhas,
    valorPedido,
    valorRecebido,
    desvioFaturamento,
  };
}
