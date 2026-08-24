import Papa from "papaparse";
import { lerXlsx } from "@/lib/compras/connectors/planilha";
import { criarCasadorDeProdutos, type ProdutoCasado } from "./casar-produto-venda";
import type {
  ItemVendaPronto,
  PagamentoImportado,
  RelatorioImportacaoVendas,
  VendaProntaImportar,
} from "./importar-historico";

/**
 * Importação de histórico a partir de uma planilha de TRANSAÇÕES — o export
 * padrão dos PDVs de mercadinho/conveniência: uma linha por transação, com os
 * itens espremidos dentro da coluna "Descrição" no formato `3 X Bala Fini 15g`.
 *
 * Difere do CSV item-a-item (`importar-historico.ts`) em três pontos:
 *  - Os itens saem de texto livre, não de colunas.
 *  - Não existe preço por item, só o total da transação → o valor é RATEADO
 *    entre os itens usando o preço de venda cadastrado como peso, com a sobra
 *    de centavos caindo no último item (a soma bate exatamente com a base).
 *  - `Sale.total` é o Total Final do arquivo (verdade do sistema antigo), não a
 *    soma dos itens: item que não casou não pode encolher o faturamento.
 *
 * Linhas que não são venda (Sangria de Caixa, suprimento) e transações
 * canceladas ficam de fora. `No.Tran` vira a chave de idempotência.
 */

// ── Cabeçalho ───────────────────────────────────────────────

/** "Vl.Produtos" → "vlprodutos". Sem acento, sem pontuação, minúsculo. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * "Descrição" com o encoding errado vira "DescriÃ§Ã£o", e `normalizar` devolve
 * "descriaao" — não casa com nada. Jogar fora TODO caractere não-ASCII resolve:
 * "Descrição" e "DescriÃ§Ã£o" viram os dois "descrio", porque a sujeira mora
 * exatamente onde estavam as letras acentuadas.
 */
function soAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * As duas leituras de um rótulo. Casar por interseção cobre os três arquivos que
 * aparecem na prática: acentuado certo, acentuado corrompido e sem acento.
 */
function chavesDe(rotulo: string): string[] {
  return [normalizar(rotulo), soAscii(rotulo)];
}

/** Primeiro alias que existir vence — ordem importa. Escreva com acento. */
const ALIASES = {
  transacao: ["No.Tran", "Nr.Tran", "Num.Tran", "No.Transação", "Transação", "Cupom", "Número Venda"],
  data: ["Data", "Data Venda", "Dt.Venda", "Data Emissão"],
  hora: ["Hora", "Horário", "Hora Venda"],
  tipo: ["Tipo", "Tipo Transação", "Operação"],
  descricao: ["Descrição", "Itens", "Produtos", "Detalhes"],
  cliente: ["Cliente", "Nome Cliente"],
  vlProdutos: ["Vl.Produtos", "Valor Produtos", "Total Produtos", "Subtotal", "Vlr.Produtos"],
  desconto: ["Desconto", "Vl.Desconto", "Descontos", "Vlr.Desconto"],
  taxaEntrega: ["Tx.Entrega/Frete", "Tx.Entrega", "Taxa Entrega", "Frete"],
  totalFinal: ["Total Final", "Total", "Valor Total", "Vl.Total", "Vlr.Total"],
  valorPago: ["Valor Pago", "Vl.Pago", "Pago", "Vlr.Pago"],
  meioPagto: ["Meio Pagto", "Meio Pagamento", "Forma Pagamento", "Forma Pagto", "Pagamento"],
  cancelado: ["Cancelado", "Cancelada", "Estornado"],
} as const;

type Campo = keyof typeof ALIASES;
type MapaColunas = Partial<Record<Campo, number>>;

function acharCabecalho(matriz: string[][]): { linha: number; mapa: MapaColunas } | null {
  const limite = Math.min(matriz.length, 30);
  for (let i = 0; i < limite; i++) {
    const chavesDaLinha = (matriz[i] ?? []).map((c) => chavesDe((c ?? "").toString()));
    const mapa: MapaColunas = {};
    for (const campo of Object.keys(ALIASES) as Campo[]) {
      const alvos = ALIASES[campo].flatMap(chavesDe);
      for (const alvo of alvos) {
        if (!alvo) continue;
        const idx = chavesDaLinha.findIndex((chaves) => chaves.includes(alvo));
        if (idx !== -1) {
          mapa[campo] = idx;
          break;
        }
      }
    }
    // Descrição + um identificador de linha é o mínimo para montar uma venda.
    if (mapa.descricao != null && (mapa.transacao != null || mapa.data != null)) {
      return { linha: i, mapa };
    }
  }
  return null;
}

/** O arquivo tem cara de export de transações? Decide qual importador roda. */
export function pareceExportDeTransacoes(matriz: string[][]): boolean {
  return acharCabecalho(matriz) !== null;
}

// ── Valores ─────────────────────────────────────────────────

/** "R$ 1.234,56", "-R$ 50,00", "1234.56" e "" → number. */
export function moeda(bruto: string | undefined): number {
  if (!bruto) return 0;
  let t = String(bruto).trim().replace(/r\$/gi, "").replace(/\s/g, "");
  if (!t) return 0;
  const negativo = t.startsWith("-") || /^\(.*\)$/.test(t);
  t = t.replace(/[()+-]/g, "");
  // pt-BR usa vírgula decimal; export "cru" usa ponto. A vírgula manda quando existe.
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return negativo ? -n : n;
}

/** Serial do Excel (dias desde 1899-12-30) → partes de data/hora. */
function serialParaPartes(serial: number) {
  const ms = Math.round(serial * 86400 * 1000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth(),
    dia: d.getUTCDate(),
    hora: d.getUTCHours(),
    min: d.getUTCMinutes(),
    seg: d.getUTCSeconds(),
  };
}

const SERIAL_MINIMO = 20000; // ~1954 — abaixo disso é número solto, não data

const DATA_RE = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})/;

/**
 * Ordem dos dois primeiros números da data. `24/08/2026` e `08/24/2026` são o
 * MESMO dia escrito por sistemas diferentes, e nada na linha diz qual é qual —
 * só o arquivo inteiro diz (ver `detectarOrdemData`).
 */
export type OrdemData = "dmy" | "mdy";

/**
 * Olha o arquivo todo antes de interpretar qualquer data: um valor com o
 * segundo número > 12 só pode ser mês na primeira posição (mdy), e um com o
 * primeiro > 12 só pode ser dia na primeira (dmy). Sem evidência, dmy — é o
 * formato do operador brasileiro. Data ambígua linha a linha jogaria vendas
 * para meses errados sem erro nenhum, por isso a decisão é global.
 */
export function detectarOrdemData(valores: string[]): OrdemData {
  for (const bruto of valores) {
    const m = (bruto ?? "").trim().match(DATA_RE);
    if (!m || m[1].length === 4) continue;
    const primeiro = Number(m[1]);
    const segundo = Number(m[2]);
    if (primeiro > 12 && segundo <= 12) return "dmy";
    if (segundo > 12 && primeiro <= 12) return "mdy";
  }
  return "dmy";
}

/**
 * Junta as colunas Data e Hora numa Date local. Aceita as formas em que Excel e
 * PDV entregam o valor: serial numérico, texto `24/08/2026`, texto `08/24/2026`
 * e hora de 12 horas com AM/PM (`12:42:47 AM` = 00:42).
 * Sem `ordem`, decide pela própria data quando ela for inequívoca.
 */
export function montarDataHora(
  dataBruta: string,
  horaBruta: string,
  ordem?: OrdemData,
): Date | null {
  const dataTexto = (dataBruta ?? "").trim();
  if (!dataTexto) return null;

  let ano: number;
  let mes: number;
  let dia: number;
  const serial = Number(dataTexto.replace(",", "."));
  if (Number.isFinite(serial) && serial >= SERIAL_MINIMO) {
    const p = serialParaPartes(serial);
    ano = p.ano;
    mes = p.mes;
    dia = p.dia;
  } else {
    const m = dataTexto.match(DATA_RE);
    if (!m) return null;
    if (m[1].length === 4) {
      ano = Number(m[1]);
      mes = Number(m[2]) - 1;
      dia = Number(m[3]);
    } else {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const mdy = ordem ? ordem === "mdy" : detectarOrdemData([dataTexto]) === "mdy";
      dia = mdy ? b : a;
      mes = (mdy ? a : b) - 1;
      ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    }
  }

  let hora = 0;
  let min = 0;
  let seg = 0;
  const horaTexto = (horaBruta ?? "").trim();
  if (horaTexto) {
    const fracao = Number(horaTexto.replace(",", "."));
    if (Number.isFinite(fracao) && !horaTexto.includes(":")) {
      const p = serialParaPartes(fracao);
      hora = p.hora;
      min = p.min;
      seg = p.seg;
    } else {
      const m = horaTexto.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        hora = Number(m[1]);
        min = Number(m[2]);
        seg = Number(m[3] ?? 0);
        // Relógio de 12 horas: meia-noite vem como 12 AM, meio-dia como 12 PM.
        if (/a\.?m\.?/i.test(horaTexto) && hora === 12) hora = 0;
        else if (/p\.?m\.?/i.test(horaTexto) && hora < 12) hora += 12;
      }
    }
  }

  const d = new Date(ano, mes, dia, hora, min, seg);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Itens dentro da Descrição ───────────────────────────────

const ITEM_RE = /^\s*(\d+(?:[.,]\d+)?)\s*[xX*]\s*(.+?)\s*$/;

/**
 * `"3 X Bala Fini 15g\n1 X Refr Fanta 350ml"` → dois itens.
 * Linha que não começa com "N X" é continuação do nome anterior — export com
 * quebra de linha no meio do nome do produto é comum.
 */
export function separarItens(descricao: string): { quantidade: number; nome: string }[] {
  if (!descricao) return [];
  const itens: { quantidade: number; nome: string }[] = [];

  for (const bruta of descricao.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;

    // Alguns exports jogam a lista inteira numa linha só: "3 X Bala 1 X Refri".
    const pedacos = linha.split(/\s+(?=\d+(?:[.,]\d+)?\s*[xX*]\s)/);
    for (const pedaco of pedacos) {
      const m = pedaco.match(ITEM_RE);
      if (m) {
        const quantidade = Number(m[1].replace(",", "."));
        itens.push({ quantidade: Number.isFinite(quantidade) ? quantidade : 0, nome: m[2] });
      } else if (itens.length > 0) {
        const ultimo = itens[itens.length - 1];
        ultimo.nome = `${ultimo.nome} ${pedaco}`.trim();
      }
    }
  }
  return itens;
}

// ── Rateio ──────────────────────────────────────────────────

/**
 * Distribui `base` (em reais) entre os pesos, em centavos, com a sobra caindo
 * no último. A soma do resultado é exatamente `base` — nenhum centavo evapora.
 * Todos os pesos zerados → divisão igual.
 */
export function ratear(base: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  const efetivos = somaPesos > 0 ? pesos : pesos.map(() => 1);
  const soma = efetivos.reduce((s, p) => s + p, 0);

  const centavos = Math.round(base * 100);
  const saida: number[] = [];
  let acumulado = 0;
  for (let i = 0; i < efetivos.length; i++) {
    if (i === efetivos.length - 1) {
      saida.push((centavos - acumulado) / 100);
      break;
    }
    const c = Math.round(centavos * (efetivos[i] / soma));
    acumulado += c;
    saida.push(c / 100);
  }
  return saida;
}

// ── Pagamento e tipo de transação ───────────────────────────

function metodoPagamento(bruto: string): PagamentoImportado["metodo"] {
  const t = normalizar(bruto);
  if (!t) return "OUTRO";
  if (t.includes("pix")) return "PIX";
  if (t.includes("dinheiro") || t.includes("especie")) return "DINHEIRO";
  if (t.includes("debito")) return "CARTAO_DEBITO";
  if (t.includes("credito") || t.includes("cartao")) return "CARTAO_CREDITO";
  return "OUTRO";
}

/** Só entra o que é venda. Sangria e suprimento mexem no caixa, não são receita. */
function ehVenda(tipo: string): boolean {
  const t = normalizar(tipo);
  if (!t) return true; // planilha sem coluna Tipo: tudo é venda
  return t.startsWith("venda") || t.startsWith("pedido") || t.startsWith("cupom");
}

function ehCancelado(valor: string): boolean {
  const t = normalizar(valor);
  return t === "sim" || t === "s" || t === "1" || t === "true" || t === "cancelado";
}

// ── Montagem ────────────────────────────────────────────────

export type RelatorioPlanilhaVendas = RelatorioImportacaoVendas & {
  /** Linhas descartadas por não serem venda, agrupadas pelo rótulo do arquivo. */
  naoVendas: { tipo: string; vezes: number }[];
  canceladas: number;
};

/** O mesmo export sai em .xlsx ou em .csv — as duas portas viram a mesma matriz. */
export function matrizDeXlsx(bytes: Uint8Array): string[][] {
  return lerXlsx(bytes);
}

export function matrizDeCsv(texto: string): string[][] {
  const parsed = Papa.parse<string[]>(texto, { skipEmptyLines: "greedy" });
  return parsed.data.map((l) => (Array.isArray(l) ? l : []));
}

/**
 * Monta as vendas prontas para gravar a partir da matriz. Não escreve nada.
 * `prefixoChave` isola a chave de idempotência por tenant (Sale.clientId é
 * único no banco inteiro, não por tenant).
 */
export async function montarImportacaoPlanilha(
  matriz: string[][],
  prefixoChave: string,
): Promise<RelatorioPlanilhaVendas> {
  const cabecalho = acharCabecalho(matriz);
  if (!cabecalho) {
    throw new Error(
      'Não achei o cabeçalho da planilha. Ela precisa ter a coluna "Descrição" e mais "No.Tran" ou "Data".',
    );
  }

  const { linha: iCabecalho, mapa } = cabecalho;
  const casar = await criarCasadorDeProdutos();

  const relatorio: RelatorioPlanilhaVendas = {
    vendas: [],
    vendasPuladas: 0,
    itensPulados: 0,
    linhasColapsadas: 0,
    naoCasados: [],
    totalLiquido: 0,
    naoVendas: [],
    canceladas: 0,
  };
  const naoCasadosMapa = new Map<string, number>();
  const naoVendasMapa = new Map<string, number>();
  const chavesVistas = new Set<string>();

  const cel = (linha: string[], campo: Campo): string => {
    const i = mapa[campo];
    return i == null ? "" : (linha[i] ?? "").toString();
  };

  const corpo = matriz.slice(iCabecalho + 1);
  const ordemData = detectarOrdemData(corpo.map((l) => cel(l, "data")));

  for (let i = iCabecalho + 1; i < matriz.length; i++) {
    const linha = matriz[i] ?? [];
    if (linha.every((c) => (c ?? "").toString().trim() === "")) continue;
    // Rodapé de totais: sem transação, sem data e sem itens. Não é venda pulada.
    if (!cel(linha, "transacao").trim() && !cel(linha, "data").trim()) continue;

    const tipo = cel(linha, "tipo");
    if (!ehVenda(tipo)) {
      const rotulo = tipo.trim() || "(sem tipo)";
      naoVendasMapa.set(rotulo, (naoVendasMapa.get(rotulo) ?? 0) + 1);
      continue;
    }
    if (ehCancelado(cel(linha, "cancelado"))) {
      relatorio.canceladas++;
      continue;
    }

    const dataHora = montarDataHora(cel(linha, "data"), cel(linha, "hora"), ordemData);
    if (!dataHora) {
      relatorio.vendasPuladas++;
      continue;
    }

    const transacao = cel(linha, "transacao").trim();
    const chaveExterna = transacao ? `${prefixoChave}:${transacao}` : null;
    // Mesma transação repetida no arquivo (export com JOIN duplicado) entra uma vez só.
    if (chaveExterna) {
      if (chavesVistas.has(chaveExterna)) {
        relatorio.linhasColapsadas++;
        continue;
      }
      chavesVistas.add(chaveExterna);
    }

    const brutos = separarItens(cel(linha, "descricao"));
    if (brutos.length === 0) {
      relatorio.vendasPuladas++;
      continue;
    }

    const vlProdutos = moeda(cel(linha, "vlProdutos"));
    const desconto = Math.abs(moeda(cel(linha, "desconto")));
    const taxaEntrega = moeda(cel(linha, "taxaEntrega"));
    const totalBruto = moeda(cel(linha, "totalFinal"));
    const totalFinal = totalBruto !== 0 ? totalBruto : vlProdutos - desconto + taxaEntrega;

    // Base do rateio = mercadoria, líquida de desconto. Frete não é item.
    const baseItens = (vlProdutos !== 0 ? vlProdutos : totalFinal - taxaEntrega) - desconto;

    const casados: { quantidade: number; produto: ProdutoCasado }[] = [];
    for (const bruto of brutos) {
      if (bruto.quantidade <= 0) {
        relatorio.itensPulados++;
        continue;
      }
      const produto = casar(bruto.nome);
      if (!produto) {
        naoCasadosMapa.set(bruto.nome, (naoCasadosMapa.get(bruto.nome) ?? 0) + 1);
        relatorio.itensPulados++;
        continue;
      }
      casados.push({ quantidade: bruto.quantidade, produto });
    }

    if (casados.length === 0) {
      relatorio.vendasPuladas++;
      continue;
    }

    // Sem preço por item no arquivo: rateia pelo preço de venda cadastrado.
    // Produto sem preço puxa peso 0; se NENHUM tiver preço, `ratear` divide igual.
    const pesos = casados.map((c) => c.quantidade * c.produto.precoVenda);
    const totais = ratear(baseItens, pesos);

    const itens: ItemVendaPronto[] = casados.map((c, idx) => {
      const total = totais[idx] ?? 0;
      return {
        productId: c.produto.id,
        produtoNome: c.produto.nome,
        quantidade: c.quantidade,
        precoUnitario: Math.round((total / c.quantidade) * 100) / 100,
        desconto: 0,
        total,
      };
    });

    const valorPago = moeda(cel(linha, "valorPago"));
    const metodo = metodoPagamento(cel(linha, "meioPagto"));
    const troco = metodo === "DINHEIRO" && valorPago > totalFinal ? valorPago - totalFinal : null;
    const pagamentos: PagamentoImportado[] =
      totalFinal > 0 ? [{ metodo, valor: totalFinal, troco }] : [];

    const venda: VendaProntaImportar = {
      vendaIdOriginal: transacao || `linha-${i + 1}`,
      chaveExterna,
      dataHora,
      subtotal: vlProdutos !== 0 ? vlProdutos : baseItens + desconto,
      desconto,
      // Verdade do sistema antigo. Item não casado não pode encolher o faturamento.
      total: totalFinal,
      itens,
      pagamentos,
    };

    relatorio.vendas.push(venda);
    relatorio.totalLiquido += venda.total;
  }

  relatorio.naoCasados = [...naoCasadosMapa]
    .map(([nome, vezes]) => ({ nome, vezes }))
    .sort((a, b) => b.vezes - a.vezes);
  relatorio.naoVendas = [...naoVendasMapa]
    .map(([tipo, vezes]) => ({ tipo, vezes }))
    .sort((a, b) => b.vezes - a.vezes);

  return relatorio;
}
