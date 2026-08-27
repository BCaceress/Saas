import { fatorDaNota } from "./fator";
import { unidadeComercial, unidadesDaLinha } from "./unidades";
import { casaPorCodigo, origemDoFator } from "./vinculo";

// ============================================================
// O que a nota diz de diferente do que o cadastro guarda.
//
// Puro e sem `server-only` de propósito: a régua que decide o que interrompe o
// operador tem de ser a MESMA no servidor e na tela. Duas cópias viram duas
// respostas para a mesma nota.
//
// Régua: interrompe o que faz ESTOQUE ou DINHEIRO ficarem errados. O fiscal só
// avisa — o perfil nasce `precisaRevisao` e tem um contador na frente, então
// travar a conferência de mercadoria por NCM seria parar a pessoa errada.
// ============================================================

export type TipoDivergencia =
  | "FATOR_DIVERGENTE"
  | "FATOR_CHUTADO"
  | "CONVERSAO_FRACIONADA"
  | "GTIN_DE_OUTRO"
  | "GTIN_NOVO"
  | "CUSTO_FORA_DA_CURVA"
  | "NCM_DIFERENTE";

/**
 * Quão grave é a diferença, na régua que a tela pinta:
 *
 * · CRITICA — erro de verdade; o cadastro fica quebrado se passar (vermelho).
 * · ATENCAO — provavelmente certo, mas alguém tem de olhar (laranja).
 * · INFORMATIVA — vale saber, não muda decisão nenhuma hoje (cinza).
 */
export type Severidade = "CRITICA" | "ATENCAO" | "INFORMATIVA";

export type Divergencia = {
  tipo: TipoDivergencia;
  severidade: Severidade;
  /**
   * Interrompe o fluxo? É outro eixo, de propósito: custo 80% acima da média é
   * grave de LER e não impede receber; conversão nunca confirmada é discreta na
   * tela e põe caixa como unidade no estoque. Num campo só, a tela ou travava
   * demais ou avisava de menos.
   */
  precisaConfirmar: boolean;
  /** Frase curta para o chip da linha. */
  titulo: string;
  /** O que aconteceu e o que fazer — texto que o operador lê ao expandir. */
  detalhe: string;
};

export type ItemParaDivergencia = {
  gtin: string | null;
  ncm: string | null;
  /** uCom — como o fornecedor vende (CX, FD, UN…). */
  unidade: string;
  quantidade: number;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  fatorConversao: number;
  packagingId: string | null;
  bonificacao: boolean;
  /** Custo real da linha: mercadoria + ST + IPI + frete − desconto. */
  custoLinha: number;
};

export type ProdutoParaDivergencia = {
  id: string;
  nome: string;
  ean: string | null;
  /** NCM do perfil fiscal do produto (ou o herdado da subcategoria). */
  ncm: string | null;
  custoMedio: number;
  packagings: { id: string; nome: string; ean: string | null; fatorConversao: number }[];
};

/** Quem já usa este código de barras no catálogo, se alguém usa. */
export type DonoDoGtin = {
  productId: string;
  nome: string;
  sku: string;
  /** "o produto", 'a embalagem "Caixa"'… */
  onde: string;
} | null;

/** Unidade em que o estoque conta — a entrada sempre soma unidade fechada. */
const UNIDADE_ENTRADA = "UN";

/** Acima disto, o custo da nota quase sempre denuncia fator de conversão errado. */
const DESVIO_CUSTO = 0.3;

const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const pct = (v: number) => `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;

/**
 * Tudo que destoa entre a linha da nota e o produto que ela virou.
 *
 * Linha ainda sem produto devolve vazio: ali o trabalho é outro (relacionar),
 * e encher a tela de aviso sobre um produto que ninguém escolheu só atrapalha.
 */
export function divergenciasDoItem(
  item: ItemParaDivergencia,
  produto: ProdutoParaDivergencia | null,
  dono?: DonoDoGtin,
): Divergencia[] {
  if (!produto) return [];
  const out: Divergencia[] = [];
  const uCom = item.unidade.trim().toUpperCase() || UNIDADE_ENTRADA;

  // ── Estoque ────────────────────────────────────────────────
  const daNota = fatorDaNota(item);
  if (daNota != null && daNota !== item.fatorConversao) {
    const embalagem = produto.packagings.find((p) => p.id === item.packagingId);
    out.push({
      tipo: "FATOR_DIVERGENTE",
      severidade: "ATENCAO",
      precisaConfirmar: true,
      titulo: "Quantidade por embalagem diferente do cadastro",
      detalhe: embalagem
        ? `No cadastro, cada ${embalagem.nome} tem ${embalagem.fatorConversao} unidades; esta nota diz ${daNota}. Ou o fornecedor mudou a embalagem — e aí é atualizar o cadastro — ou esta linha veio em outra embalagem, e aí é cadastrar a segunda.`
        : `Está gravado ${item.fatorConversao} por ${uCom}; esta nota diz ${daNota}.`,
    });
  }

  // Fator 1 numa unidade de compra que não é unidade fechada é o chute mais
  // caro desta tela: 3 caixas entram como 3 garrafas e ninguém percebe.
  //
  // Sigla com conversão conhecida (MI, DZ, CENTO) não cai aqui: `origemDoFator`
  // devolve "UNIDADE" e o número já saiu certo. Sobra o que depende do produto
  // — caixa, fardo, quilo — e a sigla que o catálogo não conhece.
  if (
    origemDoFator({
      packagingId: item.packagingId,
      fatorConversao: item.fatorConversao,
      quantidade: item.quantidade,
      unidadeTributavel: item.unidadeTributavel,
      quantidadeTributavel: item.quantidadeTributavel,
      unidade: item.unidade,
    }) === "SEM_CONVERSAO" &&
    uCom !== UNIDADE_ENTRADA
  ) {
    const u = unidadeComercial(item.unidade);
    out.push({
      tipo: "FATOR_CHUTADO",
      severidade: "ATENCAO",
      precisaConfirmar: true,
      titulo: "Conversão necessária",
      detalhe:
        u?.classe === "MEDIDA"
          ? `A nota fatura ${item.quantidade} ${uCom} (${u.nome.toLowerCase()}) e o estoque conta unidades fechadas. Peso e volume não viram peça sozinhos: diga quantas unidades esta linha representa antes de receber.`
          : `A unidade ${uCom}${u ? ` (${u.nome.toLowerCase()})` : ""} do XML não tem conversão cadastrada para este produto. Do jeito que está, ${item.quantidade} ${uCom} entram como ${item.quantidade} unidades no estoque.`,
    });
  }

  // Saldo conta PEÇA: 0,5 CX × 3 = 1,5 garrafas não existe. Ou a caixa não tem
  // 3, ou a linha não veio em caixa — de um jeito ou de outro alguém tem de
  // arrumar antes, porque a entrada recusa a gravar fração.
  const conversao = unidadesDaLinha(item.quantidade, item.fatorConversao);
  if (!conversao.exata) {
    out.push({
      tipo: "CONVERSAO_FRACIONADA",
      severidade: "CRITICA",
      precisaConfirmar: true,
      titulo: "Conversão não fecha em unidades inteiras",
      detalhe: `${fmt(item.quantidade)} ${uCom} × ${fmt(item.fatorConversao)} dá ${fmt(conversao.bruto)} unidades. Meia peça não entra no estoque: corrija quantas unidades vêm em cada ${uCom} — ou relacione esta linha à embalagem certa.`,
    });
  }

  // ── Código de barras ───────────────────────────────────────
  if (item.gtin) {
    if (dono && dono.productId !== produto.id) {
      out.push({
        tipo: "GTIN_DE_OUTRO",
        severidade: "CRITICA",
        precisaConfirmar: true,
        titulo: "Código de barras de outro produto",
        detalhe: `${item.gtin} já é ${dono.onde} de ${dono.nome} (${dono.sku}). Relacionar aqui faria o mesmo código apontar para dois produtos — e o PDV escolheria um deles ao acaso.`,
      });
    } else if (!dono && !casaPorCodigo(produto, item.gtin)) {
      out.push({
        tipo: "GTIN_NOVO",
        severidade: "INFORMATIVA",
        precisaConfirmar: false,
        titulo: "Código de barras novo",
        detalhe: `${item.gtin} ainda não está no cadastro de ${produto.nome}. Ao relacionar, ele entra ${item.fatorConversao > 1 ? "como código da embalagem de compra" : "como código do produto"}.`,
      });
    }
  }

  // ── Dinheiro ───────────────────────────────────────────────
  const unidades = item.quantidade * item.fatorConversao;
  if (!item.bonificacao && produto.custoMedio > 0 && unidades > 0) {
    const desvio = (item.custoLinha / unidades - produto.custoMedio) / produto.custoMedio;
    if (Math.abs(desvio) >= DESVIO_CUSTO) {
      out.push({
        tipo: "CUSTO_FORA_DA_CURVA",
        severidade: "ATENCAO",
        precisaConfirmar: false,
        titulo: `Custo ${pct(desvio)} vs. médio`,
        detalhe: `Esta nota sai a ${(item.custoLinha / unidades).toFixed(2)} por unidade contra ${produto.custoMedio.toFixed(2)} de custo médio. Diferença grande quase sempre é a quantidade por embalagem errada, não preço novo.`,
      });
    }
  }

  // ── Fiscal (só avisa) ──────────────────────────────────────
  const ncmNota = digitos(item.ncm);
  const ncmProduto = digitos(produto.ncm);
  if (ncmNota && ncmProduto && ncmNota !== ncmProduto) {
    out.push({
      tipo: "NCM_DIFERENTE",
      severidade: "INFORMATIVA",
      precisaConfirmar: false,
      titulo: "NCM diferente do perfil",
      detalhe: `A nota classifica como ${ncmNota}; o perfil fiscal do produto usa ${ncmProduto}. Não muda o estoque — é assunto do contador antes da próxima emissão.`,
    });
  }

  return out;
}

/**
 * Alguma destas exige confirmação antes de a mercadoria virar saldo?
 *
 * É o que separa "linha pronta" de "linha a revisar" na tela. O nome fica
 * porque é assim que as duas telas perguntam.
 */
export const bloqueia = (ds: Divergencia[]) => ds.some((d) => d.precisaConfirmar);

/** A pior severidade da lista — o tom da linha inteira sai daqui. */
export function severidadeMaxima(ds: Divergencia[]): Severidade | null {
  if (ds.some((d) => d.severidade === "CRITICA")) return "CRITICA";
  if (ds.some((d) => d.severidade === "ATENCAO")) return "ATENCAO";
  return ds.length > 0 ? "INFORMATIVA" : null;
}
