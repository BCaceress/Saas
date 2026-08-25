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

// ── Unidade em que o item foi pedido ────────────────────────
// "2" não diz se são duas garrafas ou duas caixas de doze — e é o preço disso
// que o fornecedor está cotando. Todo lugar que mostra quantidade de item de
// cotação mostra a embalagem junto, sempre com a mesma régua.

/** "Caixa (60 un.)" → "Caixa". O que vem dentro é detalhe de outra linha. */
export const embalagemBase = (nome: string | null) =>
  (nome ?? "").replace(/\s*\(.*\)\s*$/, "").trim();

/** Plural pt-BR do suficiente para nome de embalagem (caixa, fardo, barril…). */
function pluralPt(n: string): string {
  if (/[sxz]$/.test(n)) return n;
  if (/ão$/.test(n)) return `${n.slice(0, -2)}ões`;
  if (/il$/.test(n)) return `${n.slice(0, -2)}is`;
  if (/[aeou]l$/.test(n)) return `${n.slice(0, -1)}is`;
  if (/m$/.test(n)) return `${n.slice(0, -1)}ns`;
  if (/[rn]$/.test(n)) return `${n}es`;
  return `${n}s`;
}

/**
 * Só a unidade, concordando com a quantidade: "caixas (60 un.)", "fardo",
 * "unidades". Item fora do catálogo cai em unidade — é como ele foi pedido.
 */
export function unidadeDaQtd(quantidade: number, embalagemNome: string | null): string {
  const base = (embalagemBase(embalagemNome) || "unidade").toLowerCase();
  const detalhe = (embalagemNome ?? "").match(/\(.*\)\s*$/)?.[0]?.trim() ?? "";
  const nome = quantidade === 1 ? base : pluralPt(base);
  return detalhe ? `${nome} ${detalhe}` : nome;
}

/** Quantidade e unidade numa linha só: "2 caixas (60 un.)". */
export const fmtQtdEmbalagem = (quantidade: number, embalagemNome: string | null) =>
  `${fmtQtd(quantidade)} ${unidadeDaQtd(quantidade, embalagemNome)}`;
