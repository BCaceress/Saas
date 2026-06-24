import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata número como BRL. */
export function brl(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/** Aplica máscara de moeda BR a partir de dígitos crus (trata como centavos). */
export function maskMoney(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Número → string mascarada ("1.234,56"). Vazio se null. */
export function moneyToMask(value: number | null | undefined): string {
  if (value == null) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** String mascarada ("1.234,56") → número. null se vazio. */
export function parseMoney(masked: string): number | null {
  const digits = masked.replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits) / 100;
}

/** Margem % entre preço e custo. null se faltar dado. */
export function margem(preco?: number | null, custo?: number | null): number | null {
  if (preco == null || custo == null || preco <= 0) return null;
  return Math.round(((preco - custo) / preco) * 100);
}
