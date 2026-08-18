import "server-only";
import { db } from "@/lib/prisma";
import { onlyDigits } from "@/lib/normalize";
import { ordenarPorRelevancia, tokensDaBusca } from "./busca-produto-rank";
import type { Prisma } from "@/generated/prisma";

// ============================================================
// Busca de produto para relacionar um item de nota ao catálogo.
//
// Duas correções sobre o `contains` ingênuo:
//
//  1. procura PALAVRA A PALAVRA. "CERV HEINEKEN LN" não existe como frase em
//     "Cerveja Heineken Long Neck 330ml" — mas as três palavras existem. Com
//     `contains` da frase inteira, a busca que a tela abre não achava nada.
//  2. traz mais linhas do que mostra e ORDENA POR RELEVÂNCIA. Ordenar por nome
//     no banco com LIMIT chega a cortar fora justamente o produto certo.
//
// Assume contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

export type ProdutoBuscado = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: number;
  embalagens: { id: string; nome: string; ean: string | null; fator: number }[];
};

/** Quantas linhas o banco entrega para o ranqueamento escolher. */
const CANDIDATOS = 60;

export async function buscarProdutosParaRelacionar(
  termo: string,
  opts: { gtin?: string | null; limite?: number } = {},
): Promise<ProdutoBuscado[]> {
  const q = termo.trim();
  const limite = opts.limite ?? 15;
  const tokens = tokensDaBusca(q);
  const digitos = onlyDigits(q);
  const gtin = opts.gtin ? onlyDigits(opts.gtin) : "";

  if (tokens.length === 0 && digitos.length < 4 && !gtin) return [];

  const alternativas: Prisma.ProductWhereInput[] = [];

  // Todas as palavras digitadas, cada uma no nome ou no SKU.
  if (tokens.length > 0) {
    alternativas.push({
      AND: tokens.map((t) => ({
        OR: [
          { nome: { contains: t, mode: "insensitive" as const } },
          { sku: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    });
  }

  // Código de barras digitado — do produto ou de uma embalagem dele.
  if (digitos.length >= 8) {
    alternativas.push({ ean: digitos });
    alternativas.push({ packagings: { some: { ean: digitos } } });
  }

  // O GTIN do item da nota entra como candidato mesmo quando o operador está
  // digitando outra coisa: é o palpite mais forte que existe, e some da lista
  // se o texto digitado não tiver nada a ver.
  if (gtin) {
    alternativas.push({ ean: gtin });
    alternativas.push({ packagings: { some: { ean: gtin } } });
  }

  const produtos = await db.product.findMany({
    where: { ativo: true, OR: alternativas },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      custoMedio: true,
      packagings: { select: { id: true, nome: true, ean: true, fatorConversao: true } },
    },
    take: CANDIDATOS,
  });

  const mapeados: ProdutoBuscado[] = produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    imagemUrl: p.imagemUrl,
    custoMedio: Number(p.custoMedio ?? 0),
    embalagens: p.packagings.map((e) => ({
      id: e.id,
      nome: e.nome,
      ean: e.ean,
      fator: Number(e.fatorConversao),
    })),
  }));

  return ordenarPorRelevancia(mapeados, q, gtin || null).slice(0, limite);
}
