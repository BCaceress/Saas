/**
 * Entrada de dinheiro digitada à mão.
 *
 * Duas telas diferentes pedem exatamente o mesmo comportamento — a do
 * fornecedor (link público) e o registro manual da resposta feito pelo
 * operador —, e a regra é a da maquininha: cada dígito entra pela direita.
 * Sem isso, "5" fica ambíguo (cinco reais? cinco centavos?) e a vírgula vira
 * obrigação de quem está com pressa.
 */

/** "589" → "5,89". Aceita texto já formatado (refaz a máscara por cima). */
export function mascaraMoeda(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 11);
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Valor gravado (5.89) de volta para o formato da máscara ("5,89"). */
export function paraMascara(valor: number): string {
  if (!valor) return "";
  return mascaraMoeda(String(Math.round(valor * 100)));
}

/** Aceita "5,89", "5.89" e "1.234,56" — devolve `null` quando não é número. */
export function paraNumero(texto: string): number | null {
  const limpo = texto.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
