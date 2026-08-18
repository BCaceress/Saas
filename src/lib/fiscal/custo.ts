import "server-only";

/**
 * Custo real da mercadoria de uma linha de NF-e.
 *
 * O que entra no estoque não é só `vProd`: ICMS-ST, FCP-ST, IPI e frete são
 * pagos ao fornecedor e fazem parte do custo — ignorá-los dá margem
 * falsamente alta na venda. Bonificação entra com custo zero.
 *
 * Vive em módulo próprio porque duas coisas dependem dele: a entrada por XML
 * (`fiscal/entrada.ts`) e a conciliação com o pedido (`compras/conciliacao.ts`).
 */
export function custoDoItem(i: {
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorFcpSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
}): number {
  if (i.bonificacao) return 0;
  return Math.max(
    0,
    i.valorTotal - i.valorDesconto + i.valorIcmsSt + i.valorFcpSt + i.valorIpi + i.valorFrete,
  );
}
