// ============================================================
// Nome da embalagem de compra a partir da unidade da NF-e.
//
// O fornecedor escreve "CX", "FD", "DP", "CX24". Chamar isso de "CX" no
// cadastro do produto deixa o operador sem saber o que comprou. Aqui a sigla
// vira palavra — e SÓ a palavra.
//
// O nome não carrega o fator. "Caixa com 6" no campo nome duplicava o que
// `fatorConversao` já guarda: mudava o fator e o nome mentia para sempre, e a
// tela ainda mostrava "Caixa com 6 (6)". Nome é "Caixa"; quantas cabem é
// `fatorConversao`, num campo só.
//
// Puro: a mesma regra nomeia a embalagem criada no de-para e a que a tela
// sugere. Nome errado aqui não quebra conta, mas polui o cadastro para sempre.
// ============================================================

import { unidadeComercial } from "./unidades";

const NOMES: Record<string, string> = {
  CX: "Caixa",
  CAIXA: "Caixa",
  CS: "Caixa",
  FD: "Fardo",
  FARDO: "Fardo",
  DP: "Display",
  DISPLAY: "Display",
  PC: "Pacote",
  PCT: "Pacote",
  PACOTE: "Pacote",
  BD: "Bandeja",
  BDJ: "Bandeja",
  ENG: "Engradado",
  EG: "Engradado",
  SC: "Saco",
  SACO: "Saco",
  GF: "Garrafa",
  BB: "Bombona",
  KIT: "Kit",
  UN: "Unidade",
  UND: "Unidade",
  PT: "Pote",
};

/**
 * "CX" → "Caixa". Unidade desconhecida vira o próprio texto do fornecedor, em
 * vez de um nome inventado que ninguém reconhece na nota.
 */
export function nomeDaEmbalagem(unidade: string | null | undefined): string {
  const bruto = (unidade ?? "").trim().toUpperCase();
  // "CX24", "FD12" — sigla colada no fator, comum em distribuidor de bebida.
  // O número é descartado: quantas cabem é o `fatorConversao`.
  const soLetras = bruto.replace(/[^A-Z]/g, "");
  // O catálogo de unidades comerciais responde pelas siglas que ele conhece
  // (inclusive MI, DZ, CENTO); a tabela local segue valendo para os apelidos
  // que só aparecem como nome de embalagem.
  const doCatalogo = unidadeComercial(bruto)?.nome;
  return (
    NOMES[bruto] ??
    NOMES[soLetras] ??
    doCatalogo ??
    (soLetras ? capitalizar(soLetras) : "Embalagem")
  );
}

/**
 * Tipos que o cadastro oferece numa lista — os mesmos nomes que `NOMES` dá às
 * siglas da nota, para "FD" no XML e "Fardo" na tela serem a mesma palavra.
 * Fora da lista, o operador escreve o seu ("Outro").
 */
export const TIPOS_EMBALAGEM = ["Unidade", "Fardo", "Caixa", "Pacote"] as const;

/** "fardo" → "Fardo"; nome fora da lista devolve null (vira "Outro" na tela). */
export function tipoEmbalagemDaLista(nome: string | null | undefined): string | null {
  const k = (nome ?? "").trim().toLowerCase();
  return TIPOS_EMBALAGEM.find((t) => t.toLowerCase() === k) ?? null;
}

function capitalizar(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
