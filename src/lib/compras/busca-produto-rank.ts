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
  /** Apelidos de código: mesma unidade, marcas diferentes. */
  codigos?: { codigo: string }[];
  embalagens: { ean: string | null }[];
  /**
   * Parecença do nome com o termo inteiro (0 a 1), calculada no banco por
   * trigramas. Ausente = o produto entrou por outro caminho (código, palavra).
   */
  similaridade?: number;
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

/** Distância de edição — quantas letras trocar, pôr ou tirar de um para o outro. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * A palavra digitada é esta, com erro de digitação? "heinekn" é "heineken",
 * "refrigerante" é "refrigernte". Palavra curta não ganha folga: "lt" e "kg"
 * com uma letra de diferença já são outra coisa. Vale também para o começo da
 * palavra — quem está digitando "morang" ainda não terminou "morango".
 */
export function quaseIgual(digitada: string, palavra: string): boolean {
  const folga = digitada.length >= 7 ? 2 : digitada.length >= 4 ? 1 : 0;
  if (folga === 0) return false;
  if (Math.abs(palavra.length - digitada.length) <= folga && distancia(digitada, palavra) <= folga) {
    return true;
  }
  return (
    palavra.length > digitada.length &&
    distancia(digitada, palavra.slice(0, digitada.length)) <= folga
  );
}

/**
 * Quanto este produto responde ao que foi digitado. Maior = mais em cima.
 *
 * A escada, do mais forte ao mais fraco:
 *   1. código de barras idêntico (do termo ou do item da nota) — é o produto, ponto;
 *   2. SKU idêntico;
 *   3. o nome COMEÇA com o que foi digitado;
 *   4. cada palavra digitada abre uma palavra do nome ("hein" → "Heineken");
 *   5. a palavra aparece no meio de alguma palavra do nome;
 *   6. a palavra quase bate — erro de digitação ou abreviação ("heinekn").
 *
 * Palavra digitada que não aparece de jeito nenhum tira ponto: "heineken lata"
 * não pode empatar com "heineken long neck" só porque metade bateu. A
 * parecença calculada no banco soma por cima, para desempatar o que chegou
 * por aproximação.
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
  const codigos = [
    p.ean,
    ...(p.codigos ?? []).map((c) => c.codigo),
    ...p.embalagens.map((e) => e.ean),
  ].filter((c): c is string => Boolean(c));

  let pontos = 0;

  // 1. Código de barras — do que foi digitado ou do item que veio na nota.
  //    Piso de 4: código interno de balança é curto e identifica igual.
  if (digitos.length >= 4 && codigos.includes(digitos)) pontos += 1000;
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
    else if (palavras.some((w) => quaseIgual(t, w))) pontos += 20;
    else pontos -= 25; // não apareceu em lugar nenhum
  }

  pontos += (p.similaridade ?? 0) * 60;

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
