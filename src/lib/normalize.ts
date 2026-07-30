/**
 * Normaliza nome de marca para deduplicação (PRD §8.2):
 * uppercase + trim + sem acentos + sem pontuação + espaços colapsados.
 * "Coca-Cola®" e "coca  cola" -> "COCA COLA".
 */
export function normalizeBrand(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ") // pontuação -> espaço
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefixo de SKU: A–Z/0–9, uppercase, sem acento, 3–4 chars. */
export function normalizeSkuPrefix(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}

/**
 * Minúsculas e sem acento, para casar busca digitada com texto da tela —
 * quem procura "cotacoes" tem que achar "Cotações".
 */
export function semAcento(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Só dígitos (CNPJ, EAN). */
export function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}
