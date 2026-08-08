import "server-only";
import { db } from "@/lib/prisma";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";

// ============================================================
// Saldos para a LISTA do celular.
//
// Por que não `loadSaldos` de `(app)/estoque/_data.ts`: aquele monta a linha da
// tela de mesa, que mostra imagem, marca, categoria, fornecedor, localização,
// custo, percentual da unidade aberta, data de abertura e a próxima reposição
// a caminho. Para isso ele faz cinco idas ao banco — incluindo uma varredura de
// até 5.000 movimentos e todos os itens de pedido em aberto — e hidrata objetos
// aninhados que descem inteiros no payload do RSC.
//
// A lista do celular usa DOZE campos (ver `_client.tsx`): nome, SKU, EAN,
// saldo fechado, saldo aberto, unidade, se controla estoque, se está abaixo do
// mínimo, e o consumo das duas janelas que alimentam a cobertura. Nada mais
// cabe num cartão de 390px.
//
// Então aqui são DUAS consultas: os saldos, e as saídas da maior janela (que
// serve às duas de uma vez). Ficaram de fora a varredura de histórico, a data
// de abertura e os itens de pedido em aberto — nenhuma delas aparece na tela.
// O payload também encolhe: nenhum campo desce para não ser lido.
//
// O CÁLCULO continua sendo o de `lib/estoque-estrategia`, igual ao desktop:
// muda a consulta, nunca a regra.
// ============================================================

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const DIA_MS = 86_400_000;

export type SaldoMobile = {
  productId: string;
  nome: string;
  sku: string;
  ean: string | null;
  unidadeBase: string;
  estoqueFechado: number;
  estoqueAberto: number;
  controlaEstoque: boolean;
  abaixoMinimo: boolean;
  /** Vendido nos últimos 30 dias — alimenta o filtro "sem giro". */
  consumo30: number;
  /** Vendido na janela da estratégia da empresa — alimenta a cobertura. */
  consumoJanela: number;
  janelaDias: number;
};

export async function loadSaldosMobile(
  siteId: string | null,
  policy: EstoquePolicy,
): Promise<SaldoMobile[]> {
  const janelaDias = policy.usaGiro ? policy.periodoMediaDias : 30;
  const agora = Date.now();
  const desdeJanela = new Date(agora - janelaDias * DIA_MS);
  const desde30 = new Date(agora - 30 * DIA_MS);

  const ondeSite: { siteId?: string } = siteId ? { siteId } : {};

  const [stocks, saidas] = await Promise.all([
    db.stock.findMany({
      where: ondeSite,
      select: {
        productId: true,
        estoqueFechado: true,
        estoqueAberto: true,
        estoqueMinimo: true,
        product: {
          select: {
            nome: true,
            sku: true,
            ean: true,
            unidadeBase: true,
            controlaEstoque: true,
          },
        },
      },
      orderBy: { product: { nome: "asc" } },
    }),
    // UMA consulta cobre as duas janelas: busca a maior e separa aqui. Três
    // colunas por linha, nada de relação — é a mesma técnica do `loadSaldos`,
    // sem a varredura de 5.000 movimentos que ele faz em paralelo.
    db.stockMovement.findMany({
      where: {
        tipo: "SAIDA",
        createdAt: { gte: desdeJanela < desde30 ? desdeJanela : desde30 },
        ...ondeSite,
      },
      select: { productId: true, deltaFechado: true, deltaAberto: true, createdAt: true },
    }),
  ]);

  const porJanela = new Map<string, number>();
  const por30 = new Map<string, number>();

  for (const m of saidas) {
    // Por MOVIMENTO, não por soma de coluna: uma saída lança em `deltaFechado`
    // ou em `deltaAberto`, e um fracionado pode abrir uma unidade fechada no
    // mesmo lançamento. Somar as colunas separado contaria a mesma venda duas
    // vezes. É a conta idêntica à de `montarFicha` e à do desktop.
    const consumo = Math.abs(n(m.deltaFechado)) || Math.abs(n(m.deltaAberto));
    if (consumo === 0) continue;
    const em = m.createdAt.getTime();
    if (em >= desdeJanela.getTime()) {
      porJanela.set(m.productId, (porJanela.get(m.productId) ?? 0) + consumo);
    }
    if (em >= desde30.getTime()) {
      por30.set(m.productId, (por30.get(m.productId) ?? 0) + consumo);
    }
  }

  return stocks.map((s) => {
    const fechado = n(s.estoqueFechado);
    return {
      productId: s.productId,
      nome: s.product.nome,
      sku: s.product.sku,
      ean: s.product.ean,
      unidadeBase: s.product.unidadeBase,
      estoqueFechado: fechado,
      estoqueAberto: n(s.estoqueAberto),
      controlaEstoque: s.product.controlaEstoque,
      abaixoMinimo: policy.usaMinimo && fechado < n(s.estoqueMinimo),
      consumo30: por30.get(s.productId) ?? 0,
      consumoJanela: porJanela.get(s.productId) ?? 0,
      janelaDias,
    };
  });
}
