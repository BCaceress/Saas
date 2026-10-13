import { semAcento } from "@/lib/normalize";

// ============================================================
// Palpite de produto olhando só para o PEDIDO que a nota fatura.
//
// A busca no catálogo inteiro precisa escolher entre mil produtos; o pedido
// tem vinte, e a nota quase sempre fatura exatamente eles. Reduzir o universo
// é o que transforma "CERV HNK LN 330 CX24" num palpite que dá para aceitar.
//
// Puro de propósito: o que decide se um palpite aparece é a parte que se prova
// com teste. Quem lê o banco é `sugestao-de-para.ts`.
// ============================================================

export type ItemDaNota = {
  id: string;
  descricao: string;
  gtin: string | null;
};

export type ProdutoDoPedido = {
  id: string;
  nome: string;
  /** Todo código que bipa neste produto: EAN, apelidos e embalagens. */
  codigos: string[];
};

export type ParPeloPedido = {
  itemId: string;
  productId: string;
  /** Código de barras é prova; nome é palpite. */
  motivo: "EAN" | "NOME";
};

/** Quanto do nome do produto precisa aparecer na descrição da nota. */
const SEMELHANCA_MINIMA = 0.5;
/** Distância para o segundo colocado — empate quem resolve é o operador. */
const FOLGA_MINIMA = 0.2;

/**
 * Abreviações que todo fornecedor usa e nenhum cadastro usa. Sem isto,
 * "CERV" e "Cerveja" não se encontram e o palpite mais óbvio some.
 */
const mesmaPalavra = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));

export function palavrasDe(texto: string): string[] {
  return semAcento(texto)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Fração das palavras do PRODUTO que a descrição da nota contém.
 *
 * Mede a partir do produto, não da nota: a descrição do fornecedor carrega
 * lixo ("CX24", "PET", "RET") que nunca estará no cadastro, e contá-lo como
 * palavra faltante derrubaria todo palpite bom.
 */
export function semelhanca(descricaoDaNota: string, nomeDoProduto: string): number {
  const daNota = palavrasDe(descricaoDaNota);
  const doProduto = palavrasDe(nomeDoProduto);
  if (doProduto.length === 0 || daNota.length === 0) return 0;
  const achadas = doProduto.filter((p) => daNota.some((n) => mesmaPalavra(n, p))).length;
  return achadas / doProduto.length;
}

/**
 * Casa os itens ainda sem produto com os produtos do pedido.
 *
 * `jaUsados` são os produtos do pedido que outra linha da nota já ocupou: o
 * pedido de Heineken não pode responder por duas linhas diferentes da nota.
 * Cada produto é entregue a no máximo um item — o de palpite mais forte.
 */
export function casarComPedido(
  itens: ItemDaNota[],
  produtos: ProdutoDoPedido[],
  jaUsados: Iterable<string> = [],
): ParPeloPedido[] {
  const ocupados = new Set(jaUsados);
  const pares: ParPeloPedido[] = [];
  const semPar: ItemDaNota[] = [];

  // Código de barras primeiro: é resposta, não palpite, e tira o produto da
  // disputa antes que um nome parecido o reivindique.
  for (const item of itens) {
    const dono = item.gtin
      ? produtos.find((p) => !ocupados.has(p.id) && p.codigos.includes(item.gtin as string))
      : undefined;
    if (dono) {
      ocupados.add(dono.id);
      pares.push({ itemId: item.id, productId: dono.id, motivo: "EAN" });
    } else {
      semPar.push(item);
    }
  }

  // Depois o nome — todos os candidatos de todos os itens numa fila só, do
  // mais parecido para o menos, para o melhor par ficar com o produto.
  const candidatos = semPar
    .map((item) => {
      const notas = produtos
        .filter((p) => !ocupados.has(p.id))
        .map((p) => ({ productId: p.id, nota: semelhanca(item.descricao, p.nome) }))
        .sort((a, b) => b.nota - a.nota);
      const [primeiro, segundo] = notas;
      if (!primeiro || primeiro.nota < SEMELHANCA_MINIMA) return null;
      if (segundo && primeiro.nota - segundo.nota < FOLGA_MINIMA) return null;
      return { itemId: item.id, productId: primeiro.productId, nota: primeiro.nota };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => b.nota - a.nota);

  for (const c of candidatos) {
    if (ocupados.has(c.productId)) continue;
    ocupados.add(c.productId);
    pares.push({ itemId: c.itemId, productId: c.productId, motivo: "NOME" });
  }

  return pares;
}

// ── Camadas de correspondência ──────────────────────────────

export type MotivoSugestao = "EAN" | "PEDIDO" | "NOME";

/**
 * Quanto dá para confiar em cada camada, e a frase que justifica o palpite.
 *
 * A ordem é a do motor: código de barras é prova; estar no pedido que a nota
 * fatura é um bom indício; nome parecido é só um ponto de partida. O código do
 * fornecedor já relacionado nem chega aqui — ele resolve o item na importação
 * (`SupplierItemMap`), sem perguntar.
 */
export const CONFIANCA: Record<
  MotivoSugestao,
  { nivel: "alta" | "media" | "baixa"; rotulo: string; justificativa: string }
> = {
  EAN: {
    nivel: "alta",
    rotulo: "Confiança alta",
    justificativa: "O código de barras da nota é o deste produto.",
  },
  PEDIDO: {
    nivel: "media",
    rotulo: "Confiança média",
    justificativa: "O nome parece e o produto está no pedido desta nota.",
  },
  NOME: {
    nivel: "baixa",
    rotulo: "Confiança baixa",
    justificativa: "Só o nome parece — confira marca, volume e embalagem.",
  },
};

/** Só a prova grava em lote. Nome parecido nunca é confirmado sem um clique. */
export const ehProva = (motivo: MotivoSugestao) => CONFIANCA[motivo].nivel === "alta";

const PESO: Record<MotivoSugestao, number> = { EAN: 3, PEDIDO: 2, NOME: 1 };

/**
 * Junta os palpites do catálogo com os do pedido: um por item, o de camada
 * mais forte. Empate fica com o primeiro da lista — por isso o pedido entra
 * antes do catálogo.
 */
export function mesclarSugestoes<T extends { itemId: string; motivo: MotivoSugestao }>(
  ...listas: T[][]
): T[] {
  const melhor = new Map<string, T>();
  for (const s of listas.flat()) {
    const atual = melhor.get(s.itemId);
    if (!atual || PESO[s.motivo] > PESO[atual.motivo]) melhor.set(s.itemId, s);
  }
  return [...melhor.values()];
}
