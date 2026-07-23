// Tipos e helpers compartilhados entre o PDV, os modais e a fila do
// autoatendimento (client-side).

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Item do carrinho do PDV (venda direta ou carregada do autoatendimento). */
export type CartItem = {
  key: string;
  productId: string;
  variantId: string | null;
  nome: string;
  variantNome: string | null;
  preco: number;
  quantidade: number;
  restricaoIdade: boolean;
  imagemUrl: string | null;
  selecoes: string[];
  /** PERSONALIZADO: rótulo das escolhas ("Vodka, Gelo, Limão") — a "receita". */
  detalhe: string | null;
};

export type ClienteSel = { id: string; nome: string; cpf: string | null };

// centavos digitados → número (campos monetários)
export const parseCentavos = (s: string) =>
  (parseInt(s.replace(/\D/g, "") || "0", 10) || 0) / 100;

export const fmtCentavos = (s: string) => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export function mascararCpf(cpf: string | null): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "—";
  return `${d.slice(0, 3)}.•••.•••-${d.slice(9)}`;
}

/** CPF formatado progressivamente enquanto se digita (000.000.000-00). */
export function formatarCpf(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11)];
  let out = p[0];
  if (p[1]) out += `.${p[1]}`;
  if (p[2]) out += `.${p[2]}`;
  if (p[3]) out += `-${p[3]}`;
  return out;
}
