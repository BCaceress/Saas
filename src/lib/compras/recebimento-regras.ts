import { TOL_QTD } from "./conciliacao-regras";
import type { PurchaseOrderStatus } from "@/generated/prisma";

// ============================================================
// As regras do recebimento — puras, sem I/O.
//
// Separadas do serviço pelo mesmo motivo de `conciliacao-regras`: "este pedido
// já chegou por inteiro?" e "o que ainda não foi explicado?" são as duas
// perguntas que decidem se o estoque se move, e certeza aqui se prova com
// teste, não com clique na tela.
//
// Tudo em UNIDADE BASE do estoque. Converter é responsabilidade de quem chama.
// ============================================================

/** Diferença entre o que se esperava e o que foi contado, linha a linha. */
export type Divergencia = {
  itemId: string;
  descricao: string;
  esperado: number;
  recebido: number;
};

/** A linha da conferência, no mínimo que estas regras precisam enxergar. */
export type LinhaConferida = {
  id: string;
  descricao: string;
  qtdPedida: unknown;
  qtdFaturada: unknown;
  qtdRecebida: unknown;
  resolucao: unknown;
  motivoDivergencia?: unknown;
  /** Veredito pedido × nota (`ReconciliationStatus`). */
  status?: unknown;
};

/**
 * O que a linha esperava receber.
 *
 * Com nota, é o que o fornecedor faturou; sem ela, o que o pedido combinou. A
 * ordem importa: a nota é mais recente que o pedido, e é contra ela que a
 * mercadoria na porta é conferida quando as duas existem.
 *
 * A linha NAO_FATURADO é a exceção que confirma a regra: ela existe porque o
 * pedido tinha o item e a nota não trouxe. Há nota — e ela diz zero. Cair no
 * pedido ali fazia a linha que ninguém contou entrar no estoque pela
 * quantidade pedida, a custo zero, e ainda fechar o pedido como recebido.
 */
export function esperadoDaLinha(
  l: Pick<LinhaConferida, "qtdPedida" | "qtdFaturada" | "status">,
): number {
  if (l.status === "NAO_FATURADO") return 0;
  return Number(l.qtdFaturada) || Number(l.qtdPedida);
}

/** O que entra no estoque por esta linha: o contado, ou o esperado se ninguém contou. */
export function quantidadeQueEntra(
  l: Pick<LinhaConferida, "qtdPedida" | "qtdFaturada" | "qtdRecebida" | "status">,
): number {
  return l.qtdRecebida == null ? esperadoDaLinha(l) : Number(l.qtdRecebida);
}

/**
 * Custo por unidade com que a linha entra no estoque.
 *
 * O custo é o da nota — é o que vai ser pago. A única linha sem custo de nota
 * que ainda assim pode entrar é a NAO_FATURADO contada na porta (veio no
 * caminhão sem estar faturada): ali vale o preço combinado no pedido, porque
 * entrar a zero puxaria o custo médio para baixo sem ninguém ter ganhado nada.
 */
export function custoDeEntradaDaLinha(l: {
  custoFaturado: unknown;
  custoPedido: unknown;
  bonificacao: boolean;
  status?: unknown;
}): number {
  if (l.bonificacao) return 0;
  const faturado = Number(l.custoFaturado);
  if (l.status === "NAO_FATURADO" && !(faturado > 0)) return Math.max(0, Number(l.custoPedido));
  return Math.max(0, faturado);
}

/**
 * O que ainda não foi explicado.
 *
 * "AJUSTADO" NÃO conta como explicação: ele só registra que alguém digitou um
 * número diferente do esperado. O que encerra a pendência é uma frase — a do
 * item (`motivoDivergencia`, escrita ao resolver a linha) ou a do recebimento
 * inteiro, pedida uma única vez ao confirmar a entrada. Sem isso, a diferença vira,
 * meses depois, a palavra do estoquista contra a do fornecedor.
 *
 * Linha nunca contada não é divergência: ela entra pelo esperado.
 */
export function divergenciasDaConferencia(linhas: LinhaConferida[]): Divergencia[] {
  return linhas
    .filter((l) => !l.motivoDivergencia && l.resolucao !== "ACEITO" && l.resolucao !== "IGNORADO")
    .map((l) => {
      const esperado = esperadoDaLinha(l);
      const recebido = l.qtdRecebida == null ? esperado : Number(l.qtdRecebida);
      return { itemId: l.id, descricao: l.descricao, esperado, recebido };
    })
    .filter((d) => Math.abs(d.recebido - d.esperado) > TOL_QTD);
}

/**
 * "Conferi tudo": o que o clique preenche.
 *
 * Só a linha que ninguém contou. A contagem feita é o dado mais caro da doca —
 * alguém abriu a caixa —, e sobrescrevê-la pelo número do papel apagava
 * justamente a diferença que a conferência existe para achar. A linha
 * adicionada na conferência (o "veio a mais") já nasce contada e também fica
 * como está: antes, o clique a zerava, porque ela não tem nota nem pedido.
 */
export function linhasParaConferirTudo<
  L extends Pick<LinhaConferida, "id" | "qtdPedida" | "qtdFaturada" | "qtdRecebida" | "status">,
>(linhas: L[]): { id: string; qtdRecebida: number }[] {
  return linhas
    .filter((l) => l.qtdRecebida == null)
    .map((l) => ({ id: l.id, qtdRecebida: esperadoDaLinha(l) }));
}

/**
 * Status do pedido derivado do saldo dos itens.
 *
 * Derivado, nunca digitado: "parcialmente recebido" é uma leitura do saldo, não
 * uma decisão de alguém. E nada aqui reflete a doca — "em conferência" é estado
 * do RECEBIMENTO e não sobe para o pedido: o pedido segue confirmado enquanto
 * alguém conta caixa na porta.
 *
 * Rascunho e cancelado não se movem por saldo: um não foi enviado, o outro não
 * espera mais nada.
 */
export function statusDoPedidoPeloSaldo(
  itens: { qtdPedida: unknown; qtdRecebida: unknown }[],
  atual: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (atual === "CANCELADO" || atual === "RASCUNHO") return atual;
  if (itens.length === 0) return atual;

  const completo = itens.every((i) => Number(i.qtdRecebida) >= Number(i.qtdPedida) - TOL_QTD);
  if (completo) return "RECEBIDO";

  const algum = itens.some((i) => Number(i.qtdRecebida) > TOL_QTD);
  return algum ? "RECEBIDO_PARCIAL" : atual;
}

// ── Falta que vira dinheiro ─────────────────────────────────

/** Uma linha no mínimo que a conta da falta precisa. */
export type LinhaParaFalta = Pick<
  LinhaConferida,
  "qtdPedida" | "qtdFaturada" | "qtdRecebida" | "status"
> & {
  custoFaturado: unknown;
  custoPedido: unknown;
  bonificacao: boolean;
  /** Só a linha que a NOTA cobra pode ser abatida do que a nota cobra. */
  inboundItemId: string | null;
};

/**
 * Quanto a nota cobra por mercadoria que não entrou — falta e avaria
 * recusada na porta.
 *
 * Só linha da nota (é a nota que vira título), só o que chegou A MENOS (o que
 * veio a mais o fornecedor não cobrou), e pelo custo com que a linha entraria
 * — o mesmo número que o título carrega, com imposto e frete rateados. Linha
 * nunca contada entra pelo esperado: não falta nada nela.
 */
export function faltaDaConferencia(linhas: LinhaParaFalta[]): {
  valor: number;
  itens: number;
} {
  let valor = 0;
  let itens = 0;
  for (const l of linhas) {
    if (!l.inboundItemId || l.bonificacao) continue;
    const faltou = esperadoDaLinha(l) - quantidadeQueEntra(l);
    if (faltou <= TOL_QTD) continue;
    valor += faltou * custoDeEntradaDaLinha(l);
    itens += 1;
  }
  return { valor: Math.round(valor * 100) / 100, itens };
}

// ── Lotes ───────────────────────────────────────────────────

/** Um lote da mesma linha: a carga que veio de duas produções. */
export type LoteDaLinha = { lote: string | null; validade: string | null; quantidade: number };

/**
 * O que está errado numa divisão em lotes — ou `null` se ela pode ser gravada.
 *
 * A soma não passa do que entra pela linha (o resto entra sem lote, como
 * sempre entrou); cada parte é peça inteira; e cada lote diz ALGUMA coisa —
 * lote ou validade —, senão ele é só o resto com outro nome.
 */
export function problemaNosLotes(lotes: LoteDaLinha[], total: number): string | null {
  let soma = 0;
  for (const [i, l] of lotes.entries()) {
    const n = `Lote ${i + 1}`;
    if (!Number.isInteger(l.quantidade) || l.quantidade <= 0) {
      return `${n}: a quantidade é em unidades inteiras, maior que zero.`;
    }
    if (!l.lote?.trim() && !l.validade) return `${n}: informe o lote ou a validade.`;
    if (l.validade && !/^\d{4}-\d{2}-\d{2}$/.test(l.validade)) {
      return `${n}: validade no formato dd/mm/aaaa.`;
    }
    soma += l.quantidade;
  }
  if (soma > total + TOL_QTD) {
    return `Os lotes somam ${soma}, mas entram ${total} por esta linha.`;
  }
  return null;
}

/**
 * Como a quantidade da linha entra no estoque: uma fatia por lote, e o resto
 * (se houver) sem lote — ou no lote único dos campos antigos.
 *
 * É o que faz o FEFO consumir primeiro a cerveja que vence primeiro mesmo
 * quando as duas produções chegaram no mesmo caminhão, na mesma linha da nota.
 */
export function fatiasDeLote(
  quantidade: number,
  lotes: LoteDaLinha[] | null | undefined,
  unico: { lote: string | null; validade: string | null },
): LoteDaLinha[] {
  if (quantidade <= TOL_QTD) return [];
  const validos = (lotes ?? []).filter((l) => l.quantidade > 0);
  if (validos.length === 0) return [{ ...unico, quantidade }];

  const fatias: LoteDaLinha[] = [];
  let resto = quantidade;
  for (const l of validos) {
    if (resto <= TOL_QTD) break;
    const q = Math.min(l.quantidade, resto);
    fatias.push({ lote: l.lote?.trim() || null, validade: l.validade || null, quantidade: q });
    resto -= q;
  }
  if (resto > TOL_QTD) fatias.push({ lote: null, validade: null, quantidade: resto });
  return fatias;
}

/**
 * A validade que vence primeiro numa linha. Dividida em lotes, é a do lote
 * mais curto — o resto sem lote não herda a validade dos campos simples (ver
 * `fatiasDeLote`). É a data que decide o aviso de vencido na porta.
 */
export function validadeMaisCurta(
  validade: string | null,
  lotes: LoteDaLinha[] | null | undefined,
): string | null {
  if (!lotes?.length) return validade;
  const datas = lotes
    .map((x) => x.validade)
    .filter((v): v is string => Boolean(v))
    .sort();
  return datas[0] ?? null;
}

/** Lê o JSON gravado — tolera lixo (vira "sem lotes") em vez de derrubar a tela. */
export function lotesDoJson(valor: unknown): LoteDaLinha[] | null {
  if (!Array.isArray(valor)) return null;
  const lotes = valor
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const quantidade = Number(o.quantidade);
      return {
        lote: typeof o.lote === "string" && o.lote.trim() ? o.lote.trim() : null,
        validade: typeof o.validade === "string" && o.validade ? o.validade.slice(0, 10) : null,
        quantidade: Number.isFinite(quantidade) ? quantidade : 0,
      };
    })
    .filter((l) => l.quantidade > 0);
  return lotes.length > 0 ? lotes : null;
}

// ── Margem depois da entrada ────────────────────────────────

/** A mesma régua do cadastro do produto: abaixo de 15% é "margem baixa". */
export const MARGEM_BAIXA_PCT = 15;

/**
 * Como fica a margem do produto com o custo que acabou de entrar.
 *
 * Não remarca nada — preço de venda mora no cadastro. Só avisa quando o custo
 * novo deixou o preço de hoje abaixo da régua (ou no prejuízo), que é o que
 * ninguém percebe até o fim do mês.
 */
export function margemAposEntrada(
  precoVenda: number | null | undefined,
  custoUnitario: number,
): { pct: number; nivel: "NEGATIVA" | "BAIXA" } | null {
  if (precoVenda == null || precoVenda <= 0 || !(custoUnitario > 0)) return null;
  const pct = Math.round(((precoVenda - custoUnitario) / precoVenda) * 1000) / 10;
  if (pct < 0) return { pct, nivel: "NEGATIVA" };
  if (pct < MARGEM_BAIXA_PCT) return { pct, nivel: "BAIXA" };
  return null;
}

// ── Validade ────────────────────────────────────────────────

export type AvisoValidade =
  | { tipo: "VENCIDO"; dias: number }
  | { tipo: "VENCE_LOGO"; dias: number }
  | null;

/**
 * A validade digitada na porta já passou — ou está perto demais.
 *
 * Só AVISA. Validade é opcional e vencido não bloqueia (decisão do módulo de
 * estoque); o que a doca precisa é ver o problema enquanto o motorista ainda
 * está ali para levar a caixa de volta, não no inventário do mês seguinte.
 *
 * Datas em "aaaa-mm-dd", comparadas como dia — sem `Date` no fuso de quem olha,
 * que faria a meia-noite UTC virar o dia anterior em Brasília.
 */
export function avisoDeValidade(
  validade: string | null | undefined,
  hoje: string,
  alertaDias: number,
): AvisoValidade {
  if (!validade || !/^\d{4}-\d{2}-\d{2}/.test(validade) || !/^\d{4}-\d{2}-\d{2}/.test(hoje)) {
    return null;
  }
  const dia = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const dias = Math.round((dia(validade) - dia(hoje)) / 86_400_000);
  if (dias < 0) return { tipo: "VENCIDO", dias: -dias };
  if (dias <= Math.max(0, alertaDias)) return { tipo: "VENCE_LOGO", dias };
  return null;
}

// ── O que dizer ao fornecedor ───────────────────────────────

/** Uma linha da conferência no mínimo que a mensagem ao fornecedor precisa. */
export type LinhaParaFornecedor = {
  descricao: string;
  status: string;
  qtdPedida: number;
  qtdFaturada: number;
  qtdRecebida: number | null;
  custoPedido: number;
  custoFaturado: number;
  motivoDivergencia: string | null;
  /** Adicionada na conferência — não estava na nota nem no pedido. */
  avulsa: boolean;
};

/**
 * As frases da reclamação, uma por linha que não bateu.
 *
 * Duas camadas, porque são duas conversas diferentes com o representante: o
 * que a NOTA trouxe diferente do pedido (faturou menos, cobrou mais caro) e o
 * que a CAIXA trouxe diferente da nota (faturou 24, chegaram 20). A segunda é
 * a mais comum — e era a que ficava de fora do texto.
 */
export function frasesDeDivergencia(
  linhas: LinhaParaFornecedor[],
  opts: { temNota: boolean },
): string[] {
  const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const referencia = opts.temNota ? "a nota" : "o pedido";

  const frases: string[] = [];
  for (const l of linhas) {
    const partes: string[] = [];
    switch (l.status) {
      case "FALTANDO":
        partes.push(`pedimos ${qtd(l.qtdPedida)}, a nota trouxe ${qtd(l.qtdFaturada)}`);
        break;
      case "NAO_FATURADO":
        partes.push(`pedimos ${qtd(l.qtdPedida)} e não veio na nota`);
        break;
      case "EXCEDENTE":
        partes.push(`a nota trouxe ${qtd(l.qtdFaturada)} e o pedido era de ${qtd(l.qtdPedida)}`);
        break;
      case "NAO_PEDIDO":
        if (!l.avulsa) partes.push(`veio na nota (${qtd(l.qtdFaturada)}) sem estar no pedido`);
        break;
      case "PRECO_ALTERADO":
        partes.push(
          `preço combinado ${moeda(l.custoPedido)}, faturado ${moeda(l.custoFaturado)}`,
        );
        break;
    }

    // A caixa contra o papel. Só quando alguém contou — linha não contada
    // entra pelo esperado e não é reclamação de ninguém.
    const esperado = l.avulsa ? 0 : esperadoDaLinha(l);
    if (l.qtdRecebida != null && Math.abs(l.qtdRecebida - esperado) > TOL_QTD) {
      partes.push(
        l.avulsa
          ? `chegaram ${qtd(l.qtdRecebida)} fora ${opts.temNota ? "da nota" : "do pedido"}`
          : `${referencia} diz ${qtd(esperado)}, chegaram ${qtd(l.qtdRecebida)}`,
      );
    }

    if (partes.length > 0) frases.push(`• ${l.descricao}: ${partes.join("; ")}`);
  }
  return frases;
}
