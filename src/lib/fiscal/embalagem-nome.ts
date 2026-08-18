// ============================================================
// Nome da embalagem de compra a partir da unidade da NF-e.
//
// O fornecedor escreve "CX", "FD", "DP", "CX24". Chamar isso de "CX" no
// cadastro do produto deixa o operador sem saber o que comprou — e "Embalagem
// 24" também não diz nada. Aqui a sigla vira palavra, com o fator junto.
//
// Puro: a mesma regra nomeia a embalagem criada no de-para e a que a tela
// sugere. Nome errado aqui não quebra conta, mas polui o cadastro para sempre.
// ============================================================

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
 * "CX" + fator 24 → "Caixa com 24". Unidade desconhecida vira o próprio texto
 * do fornecedor, em vez de um nome inventado que ninguém reconhece na nota.
 */
export function nomeDaEmbalagem(unidade: string | null | undefined, fator: number): string {
  const bruto = (unidade ?? "").trim().toUpperCase();
  // "CX24", "FD12" — sigla colada no fator, comum em distribuidor de bebida.
  const soLetras = bruto.replace(/[^A-Z]/g, "");
  const base = NOMES[bruto] ?? NOMES[soLetras] ?? (bruto ? capitalizar(bruto) : "Embalagem");

  if (fator > 1) return `${base} com ${fator.toLocaleString("pt-BR")}`;
  return base;
}

function capitalizar(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
