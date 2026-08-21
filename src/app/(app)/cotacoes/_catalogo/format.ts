// Formatadores puros de compras — sem "use client" de propósito: RSC também
// precisa formatar moeda/quantidade, e função exportada de módulo client não
// pode ser chamada do servidor.

export const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Preço unitário de tabela — 3 casas quando o centavo é fracionado. */
export const fmtPreco = (v: number) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: Number.isInteger(v * 100) ? 2 : 3,
  });

export const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function fmtQuando(iso: string | null): string {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(hoje) - dia(d);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Hoje às ${hora}`;
  if (diff === 1) return `Ontem às ${hora}`;
  if (diff < 30) return `Há ${diff} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
