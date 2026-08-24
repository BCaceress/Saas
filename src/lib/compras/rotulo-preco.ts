// ============================================================
// Como se chama o preço que está sendo pedido.
//
// "Preço unitário" numa linha de fardo é a pergunta errada: o vendedor lê,
// digita o preço da UNIDADE, e a comparação inteira mente por doze. O rótulo
// tem de dizer a embalagem que está na linha — "Preço da caixa (12 un.)",
// "Preço do fardo", "Preço unitário".
//
// Sem `server-only` de propósito: a tela pública do fornecedor é um componente
// de cliente, e o comparativo de mesa também usa o mesmo texto.
// ============================================================

export type EmbalagemItem = {
  /** "Caixa", "Fardo", "Unidade", "kg" — o tipo, sem o fator. */
  nome: string;
  /** Unidades base dentro de uma embalagem. 1 = item avulso. */
  fator: number;
  /** "Caixa (12 un.)" — rótulo completo, o mesmo que sai no WhatsApp. */
  label: string;
};

/**
 * Palavras femininas que a regra do "termina em -a" não pega. Lista curta de
 * propósito: é o vocabulário real de embalagem de bebida e mercearia, e uma
 * exceção esquecida sai como "do grade", não como erro de sistema.
 */
const FEMININAS = new Set(["grade", "embalagem", "unidade", "bag", "saca", "garrafeira"]);

/** Masculinas terminadas em -a — a outra ponta da mesma regra. */
const MASCULINOS = new Set(["display", "pack", "shrink", "rack", "palete", "pallet"]);

function artigo(nome: string): "da" | "do" {
  const chave = nome.trim().toLowerCase();
  if (FEMININAS.has(chave)) return "da";
  if (MASCULINOS.has(chave)) return "do";
  return chave.endsWith("a") ? "da" : "do";
}

/**
 * Rótulo do campo de preço da linha.
 *
 *  · Embalagem de compra → "Preço da caixa (12 un.)" — o fator vai junto
 *    porque é ele que decide o número que o vendedor digita.
 *  · Unidade avulsa → "Preço unitário".
 *  · Produto por peso/volume → "Preço por kg", "Preço por litro".
 */
export function rotuloPreco(emb: EmbalagemItem | null | undefined): string {
  if (!emb) return "Preço unitário";
  const nome = emb.nome.trim();
  if (!nome || /^(un|unidade)$/i.test(nome)) return "Preço unitário";
  if (emb.fator > 1) {
    return `Preço ${artigo(nome)} ${nome.toLowerCase()} (${fmtFator(emb.fator)} un.)`;
  }
  // Peso e volume não têm artigo: "Preço por kg" é como se fala na praça.
  if (/^(kg|g|l|ml|m|cm|t)$/i.test(nome)) return `Preço por ${nome.toLowerCase()}`;
  return `Preço ${artigo(nome)} ${nome.toLowerCase()}`;
}

/** Versão curta, para cabeçalho de coluna: "Preço da caixa", sem o fator. */
export function rotuloPrecoCurto(emb: EmbalagemItem | null | undefined): string {
  return rotuloPreco(emb).replace(/\s*\(.*\)$/, "");
}

const fmtFator = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
