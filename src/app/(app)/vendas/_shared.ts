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
