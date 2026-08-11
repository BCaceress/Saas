/**
 * Filtros do extrato — os mesmos nomes que `loadMovimentacoes` entende, num
 * módulo sem banco para que a página (servidor) e os chips (cliente) leiam a
 * lista da MESMA fonte. Chip que não existe no `CHIP_WHERE` do `_data` viraria
 * um filtro silenciosamente ignorado.
 */

export const CHIPS: Array<{ valor: string; label: string }> = [
  { valor: "todos", label: "Tudo" },
  { valor: "entradas", label: "Entradas" },
  { valor: "vendas", label: "Vendas" },
  { valor: "saidas", label: "Saídas" },
  { valor: "ajustes", label: "Ajustes" },
  { valor: "transferencias", label: "Transferências" },
  { valor: "producao", label: "Produção" },
];

export const PERIODOS: Array<{ valor: string; label: string }> = [
  { valor: "0", label: "Hoje" },
  { valor: "7", label: "7 dias" },
  { valor: "30", label: "30 dias" },
  { valor: "tudo", label: "Tudo" },
];

/** `null` = todo o período; `0` = de hoje à meia-noite (contrato do `_data`). */
export function diasDoPeriodo(valor: string): number | null {
  if (valor === "tudo") return null;
  const n = Number.parseInt(valor, 10);
  return Number.isNaN(n) ? 7 : n;
}
