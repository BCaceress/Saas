import Papa from "papaparse";
import { db } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant-context";
import { criarCasadorDeProdutos } from "./casar-produto-venda";

/**
 * Importação de histórico de vendas (sistema antigo → NoHub), PRD ad-hoc.
 * Chame dentro de `runWithTenant` — usa `db`.
 *
 * Decisões de mapeamento (ver AskUserQuestion na conversa que originou isto):
 *  - 1 linha de CSV = 1 SaleItem; linhas com o mesmo venda_id viram um Sale.
 *  - Produto casa por NOME (fuzzy, mesmo ranqueador do vínculo de nota fiscal).
 *    Não casou → item fica de fora; SaleItem.productId é obrigatório.
 *  - NÃO dá baixa de estoque — é só histórico, Stock/StockLot ficam intactos.
 *  - Sale.origem = IMPORTADA, status = PAGA. Sem CashSession/Payment/Customer.
 *  - total = valor líquido (total_liquido_item), igual ao que os relatórios
 *    somam como receita (src/lib/relatorios/fontes.ts).
 *  - Linha com quantidade <= 0 é descartada. Linhas IDÊNTICAS repetidas dentro
 *    do mesmo venda_id são colapsadas em uma só (padrão de export com JOIN
 *    duplicado) — desligue com `semDedupe`.
 */

export const TAMANHO_MAXIMO_CSV = 15 * 1024 * 1024;

type LinhaHistoricoVenda = {
  venda_id: string;
  data_hora: string;
  produto: string;
  quantidade: string;
  preco_unitario: string;
  total_item: string;
  total_liquido_item: string;
  desconto_item: string;
};

export type ItemVendaPronto = {
  productId: string;
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  total: number;
};

export type PagamentoImportado = {
  metodo: "DINHEIRO" | "CARTAO_CREDITO" | "CARTAO_DEBITO" | "PIX" | "OUTRO";
  valor: number;
  troco: number | null;
};

export type VendaProntaImportar = {
  vendaIdOriginal: string;
  dataHora: Date;
  subtotal: number;
  desconto: number;
  total: number;
  itens: ItemVendaPronto[];
  /**
   * Chave de idempotência gravada em `Sale.clientId` (único no banco inteiro,
   * por isso vem prefixada pelo tenant). Reimportar o mesmo arquivo não
   * duplica. Null = arquivo sem número de transação — sem proteção.
   */
  chaveExterna?: string | null;
  /** Meio de pagamento reconstruído do arquivo. Vazio = não veio na origem. */
  pagamentos?: PagamentoImportado[];
};

export type RelatorioImportacaoVendas = {
  vendas: VendaProntaImportar[];
  vendasPuladas: number;
  itensPulados: number;
  linhasColapsadas: number;
  naoCasados: { nome: string; vezes: number }[];
  totalLiquido: number;
};

/** Aceita "11.5" (decimal com ponto, formato mais comum de export) e "11,5" (vírgula). */
function num(s: string | undefined): number {
  if (!s) return 0;
  const t = s.trim();
  const limpo = t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

/** Planilha exportada do Windows costuma vir em latin1; export moderno vem em UTF-8. */
export function decodificarCsv(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(bytes).replace(/^﻿/, "");
}

function chaveLinha(l: LinhaHistoricoVenda): string {
  return [
    l.data_hora,
    l.produto,
    l.quantidade,
    l.preco_unitario,
    l.total_item,
    l.total_liquido_item,
    l.desconto_item,
  ].join("|");
}

/**
 * Casa cada linha do CSV a um produto do catálogo e monta as vendas prontas
 * para gravar. Não escreve nada — puramente leitura + cálculo.
 */
export async function montarImportacaoVendas(
  texto: string,
  opts: { semDedupe?: boolean } = {},
): Promise<RelatorioImportacaoVendas> {
  const parsed = Papa.parse<LinhaHistoricoVenda>(texto, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const porVenda = new Map<string, LinhaHistoricoVenda[]>();
  for (const linha of parsed.data) {
    if (!linha.venda_id) continue;
    const grupo = porVenda.get(linha.venda_id) ?? [];
    grupo.push(linha);
    porVenda.set(linha.venda_id, grupo);
  }

  const casarProduto = await criarCasadorDeProdutos();

  const relatorio: RelatorioImportacaoVendas = {
    vendas: [],
    vendasPuladas: 0,
    itensPulados: 0,
    linhasColapsadas: 0,
    naoCasados: [],
    totalLiquido: 0,
  };
  const naoCasadosMapa = new Map<string, number>();

  for (const [vendaId, linhasOriginais] of porVenda) {
    let linhas = linhasOriginais;
    if (!opts.semDedupe) {
      const vistos = new Set<string>();
      const dedup: LinhaHistoricoVenda[] = [];
      for (const l of linhas) {
        const chave = chaveLinha(l);
        if (vistos.has(chave)) {
          relatorio.linhasColapsadas++;
          continue;
        }
        vistos.add(chave);
        dedup.push(l);
      }
      linhas = dedup;
    }

    const itens: ItemVendaPronto[] = [];
    for (const linha of linhas) {
      const quantidade = num(linha.quantidade);
      if (quantidade <= 0) {
        relatorio.itensPulados++;
        continue;
      }
      const match = casarProduto(linha.produto);
      if (!match) {
        naoCasadosMapa.set(linha.produto, (naoCasadosMapa.get(linha.produto) ?? 0) + 1);
        relatorio.itensPulados++;
        continue;
      }
      itens.push({
        productId: match.id,
        produtoNome: match.nome,
        quantidade,
        precoUnitario: num(linha.preco_unitario),
        desconto: num(linha.desconto_item),
        total: num(linha.total_liquido_item),
      });
    }

    if (itens.length === 0) {
      relatorio.vendasPuladas++;
      continue;
    }

    const primeira = linhas[0];
    const dataHora = new Date(primeira.data_hora.replace(" ", "T"));
    const subtotal = linhas.reduce((s, l) => s + num(l.total_item), 0);
    const desconto = linhas.reduce((s, l) => s + num(l.desconto_item), 0);
    const total = itens.reduce((s, i) => s + i.total, 0);

    relatorio.vendas.push({ vendaIdOriginal: vendaId, dataHora, subtotal, desconto, total, itens });
    relatorio.totalLiquido += total;
  }

  relatorio.naoCasados = [...naoCasadosMapa]
    .map(([nome, vezes]) => ({ nome, vezes }))
    .sort((a, b) => b.vezes - a.vezes);

  return relatorio;
}

export type ResultadoGravacao = {
  gravadas: number;
  /** Já existiam com a mesma `chaveExterna` — reimportação do mesmo arquivo. */
  jaImportadas: number;
};

/**
 * Grava as vendas já montadas. Vendas com `chaveExterna` que já existem são
 * puladas — reimportar o mesmo arquivo não duplica nada.
 */
export async function gravarVendasImportadas(
  siteId: string,
  vendas: VendaProntaImportar[],
): Promise<ResultadoGravacao> {
  const tenantId = requireTenantId();

  const chaves = vendas.map((v) => v.chaveExterna).filter((c): c is string => !!c);
  const existentes = new Set<string>();
  for (let i = 0; i < chaves.length; i += 1000) {
    const lote = await db.sale.findMany({
      where: { clientId: { in: chaves.slice(i, i + 1000) } },
      select: { clientId: true },
    });
    for (const s of lote) if (s.clientId) existentes.add(s.clientId);
  }

  let gravadas = 0;
  let jaImportadas = 0;
  for (const v of vendas) {
    if (v.chaveExterna && existentes.has(v.chaveExterna)) {
      jaImportadas++;
      continue;
    }
    await db.sale.create({
      data: {
        tenantId,
        siteId,
        origem: "IMPORTADA",
        status: "PAGA",
        clientId: v.chaveExterna ?? null,
        subtotal: v.subtotal,
        desconto: v.desconto,
        total: v.total,
        createdAt: v.dataHora,
        paidAt: v.dataHora,
        items: {
          create: v.itens.map((i) => ({
            tenantId,
            productId: i.productId,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            desconto: i.desconto,
            total: i.total,
          })),
        },
        ...(v.pagamentos?.length
          ? {
              payments: {
                create: v.pagamentos.map((p) => ({
                  tenantId,
                  metodo: p.metodo,
                  status: "CONFIRMADO" as const,
                  valor: p.valor,
                  troco: p.troco,
                  createdAt: v.dataHora,
                })),
              },
            }
          : {}),
      },
    });
    gravadas++;
  }
  return { gravadas, jaImportadas };
}
