import type { EstoquePolicy } from "@/lib/estoque-estrategia";

/**
 * Filtros da lista de saldos — quais existem depende da estratégia da empresa
 * (lib/estoque-estrategia). Filtrar por "abaixo do ideal" numa empresa que
 * controla por rotatividade não significa nada, então o filtro nem existe lá.
 *
 * Fonte única: as pills da tela e o saneamento do `?filtro=` da URL saem daqui,
 * senão um link antigo (ou colado de outra empresa) filtraria por uma régua que
 * a empresa não usa e a lista viria vazia sem explicação.
 */
export type Filtro =
  | "todos"
  | "sem"
  | "baixoMinimo"
  | "repor"
  | "quaseIdeal"
  | "baixaCobertura"
  | "aberto";

export const FILTRO_LABEL: Record<Filtro, string> = {
  todos: "Todos",
  sem: "Sem estoque",
  baixoMinimo: "Abaixo do mínimo",
  repor: "Abaixo do ideal",
  quaseIdeal: "Quase do ideal",
  baixaCobertura: "Cobertura baixa",
  aberto: "Estoque aberto",
};

/** Tom da pill — segue a rampa de severidade do status correspondente. */
export const FILTRO_TOM: Record<Filtro, "neutral" | "danger" | "warn" | "brand"> = {
  todos: "neutral",
  sem: "danger",
  baixoMinimo: "danger",
  repor: "brand",
  quaseIdeal: "warn",
  baixaCobertura: "brand",
  aberto: "neutral",
};

/** Filtros válidos na estratégia ativa, na ordem em que aparecem na tela. */
export function filtrosDaPolicy(policy: EstoquePolicy): Filtro[] {
  if (policy.usaGiro) return ["todos", "sem", "baixaCobertura", "aberto"];
  return [
    "todos",
    "sem",
    "baixoMinimo",
    ...(policy.usaIdeal ? (["repor", "quaseIdeal"] as Filtro[]) : []),
    "aberto",
  ];
}

/** Filtro da URL saneado pela estratégia — desconhecido ou inválido vira "todos". */
export function filtroValido(valor: unknown, policy: EstoquePolicy): Filtro {
  return typeof valor === "string" && filtrosDaPolicy(policy).includes(valor as Filtro)
    ? (valor as Filtro)
    : "todos";
}
