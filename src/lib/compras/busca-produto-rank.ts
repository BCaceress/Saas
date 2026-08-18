import { semAcento, onlyDigits } from "@/lib/normalize";

// ============================================================
// Ordem da busca de produto ao relacionar um item de nota.
//
// Ordem alfabética é inútil aqui: quem digita "heineken ln" quer o long neck
// no topo, não "Água Crystal" porque começa com A. Pior, com LIMIT no banco o
// alfabético chega a NÃO TRAZER o produto certo.
//
// Puro de propósito — a ordem é a parte que se prova com teste, não com
// clique. O SQL só decide QUEM entra na lista; quem decide a ordem é isto.
// ============================================================

export type ProdutoRanqueavel = {
  nome: string;
  sku: string;
  ean: string | null;
  embalagens: { ean: string | null }[];
};

/** Termo de busca partido em pedaços comparáveis. */
export function tokensDaBusca(termo: string): string[] {
  return semAcento(termo)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5);
}

const limpo = (s: string) => semAcento(s).toLowerCase();

/**
 * Quanto este produto responde ao que foi digitado. Maior = mais em cima.
 *
 * A escada, do mais forte ao mais fraco:
 *   1. código de barras idêntico (do termo ou do item da nota) — é o produto, ponto;
 *   2. SKU idêntico;
 *   3. o nome COMEÇA com o que foi digitado;
 *   4. cada palavra digitada abre uma palavra do nome ("hein" → "Heineken");
 *   5. a palavra aparece no meio de alguma palavra do nome.
 *
 * Palavra digitada que não aparece de jeito nenhum tira ponto: "heineken lata"
 * não pode empatar com "heineken long neck" só porque metade bateu.
 */
export function pontuarProduto(
  p: ProdutoRanqueavel,
  termo: string,
  gtinDaNota?: string | null,
): number {
  const tokens = tokensDaBusca(termo);
  const nome = limpo(p.nome);
  const sku = limpo(p.sku);
  const digitos = onlyDigits(termo);
  const codigos = [p.ean, ...p.embalagens.map((e) => e.ean)].filter(
    (c): c is string => Boolean(c),
  );

  let pontos = 0;

  // 1. Código de barras — do que foi digitado ou do item que veio na nota.
  if (digitos.length >= 8 && codigos.includes(digitos)) pontos += 1000;
  if (gtinDaNota && codigos.includes(gtinDaNota)) pontos += 800;

  // 2. SKU exato (e prefixo de SKU, que é como o operador digita na correria).
  const termoLimpo = limpo(termo).trim();
  if (sku === termoLimpo) pontos += 600;
  else if (termoLimpo.length >= 3 && sku.startsWith(termoLimpo)) pontos += 300;

  // 3. O nome começa com o que foi digitado.
  if (termoLimpo && nome.startsWith(termoLimpo)) pontos += 200;

  // 4/5. Palavra a palavra.
  const palavras = nome.split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    if (palavras.some((w) => w === t)) pontos += 60;
    else if (palavras.some((w) => w.startsWith(t))) pontos += 40;
    else if (nome.includes(t)) pontos += 15;
    else if (sku.includes(t)) pontos += 10;
    else pontos -= 25; // não apareceu em lugar nenhum
  }

  // Empate entre dois que batem igual: o nome mais curto é o mais específico
  // ("Heineken 330ml" antes de "Heineken 330ml kit festa 12un").
  pontos -= Math.min(nome.length, 60) / 100;

  return pontos;
}

/** Ordena por relevância; empate resolve no alfabeto, para a lista não dançar. */
export function ordenarPorRelevancia<T extends ProdutoRanqueavel>(
  produtos: T[],
  termo: string,
  gtinDaNota?: string | null,
): T[] {
  return [...produtos]
    .map((p) => ({ p, pontos: pontuarProduto(p, termo, gtinDaNota) }))
    .sort((a, b) => b.pontos - a.pontos || a.p.nome.localeCompare(b.p.nome, "pt-BR"))
    .map((x) => x.p);
}
