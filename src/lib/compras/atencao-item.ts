// ============================================================
// Item que pede decisão no comparativo.
//
// Com 30 itens, a maioria tem vencedor claro. O operador precisa ver primeiro
// os que NÃO têm: empate, proposta única, ninguém cotou, marca diferente,
// fornecedor mais barato atendendo só parte, promoção por volume. A tabela
// continua completa — estes sobem para o topo com o motivo escrito.
// Função pura: a tela e os testes usam a mesma régua.
// ============================================================

/** Diferença entre as duas melhores propostas abaixo disto é empate prático. */
export const EMPATE_PCT = 2;

export type TipoAtencao =
  | "ninguem"
  | "unica"
  | "empate"
  | "parcial"
  | "marca"
  | "promocao";

export type Atencao = { tipo: TipoAtencao; texto: string };

export type EntradaAtencao = {
  /** Valores (preço ou custo) das propostas DISPONÍVEIS deste item. */
  valores: number[];
  /** Quantos fornecedores já responderam a cotação (tenham ou não o item). */
  respondidos: number;
  /** A proposta mais barata atende só parte da quantidade. */
  melhorParcial: boolean;
  marcasDivergem: boolean;
  temPromocao: boolean;
};

const pct = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function atencaoDoItem(e: EntradaAtencao): Atencao | null {
  if (e.respondidos === 0) return null;
  if (e.valores.length === 0) return { tipo: "ninguem", texto: "ninguém cotou este item" };
  if (e.valores.length === 1 && e.respondidos > 1) {
    return { tipo: "unica", texto: "só uma proposta — sem com quem comparar" };
  }
  if (e.valores.length >= 2) {
    const [a, b] = [...e.valores].sort((x, y) => x - y);
    // Arredondada: 40,80 − 40 dá 0,7999… em ponto flutuante, e 2% cravado
    // viraria empate.
    const dif = a > 0 ? Math.round(((b - a) / a) * 10000) / 100 : 0;
    if (dif < EMPATE_PCT) {
      return {
        tipo: "empate",
        texto: dif < 0.05 ? "empate: mesmo preço" : `empate: diferença de ${pct(dif)}`,
      };
    }
  }
  if (e.melhorParcial) {
    return { tipo: "parcial", texto: "o mais barato atende só parte da quantidade" };
  }
  if (e.marcasDivergem) return { tipo: "marca", texto: "fornecedores cotaram marcas diferentes" };
  if (e.temPromocao) return { tipo: "promocao", texto: "tem promoção por volume" };
  return null;
}
