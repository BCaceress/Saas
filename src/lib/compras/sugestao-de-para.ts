import "server-only";
import { db } from "@/lib/prisma";
import { buscarProdutosParaRelacionar } from "./busca-produto";
import { termoDeBuscaDoItem } from "./conciliacao-regras";
import { casaPorCodigo, inferirVinculo } from "@/lib/fiscal/vinculo";

// ============================================================
// Melhor palpite de produto para cada linha da nota ainda sem de-para.
//
// Vive no domínio (e não numa server action) porque a tela precisa dele DUAS
// vezes com origens diferentes: carregado junto com a nota, no servidor, para
// a tabela já nascer com os palpites; e recalculado depois de cada de-para,
// porque relacionar uma linha pode criar embalagem/EAN que muda o palpite das
// outras.
// ============================================================

export type SugestaoDePara = {
  itemId: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  unidade: string;
  /** EAN é prova; NOME é palpite — e o operador confia diferente em cada um. */
  motivo: "EAN" | "NOME";
  packagingId: string | null;
  fatorConversao: number;
};

export async function sugestoesDaNota(inboundId: string): Promise<SugestaoDePara[]> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      items: {
        where: { productId: null },
        select: {
          id: true,
          descricao: true,
          gtin: true,
          unidade: true,
          quantidade: true,
          unidadeTributavel: true,
          quantidadeTributavel: true,
        },
      },
    },
  });
  if (!nota) return [];

  const sugestoes = await Promise.all(
    nota.items.map(async (i) => {
      const item = {
        gtin: i.gtin,
        // uCom viaja junto: é ela que responde "0,6 MI são 600 unidades"
        // quando a nota não declara qTrib.
        unidade: i.unidade,
        quantidade: Number(i.quantidade),
        unidadeTributavel: i.unidadeTributavel,
        quantidadeTributavel:
          i.quantidadeTributavel == null ? null : Number(i.quantidadeTributavel),
      };
      const achados = await buscarProdutosParaRelacionar(termoDeBuscaDoItem(i.descricao), {
        gtin: i.gtin,
        limite: 2,
      });
      const p = achados[0];
      if (!p) return null;

      const produto = {
        ean: p.ean,
        packagings: p.embalagens.map((e) => ({
          id: e.id,
          ean: e.ean,
          fatorConversao: e.fator,
        })),
      };
      // Código de barras batendo é prova; nome parecido é palpite. A tela
      // trata os dois de forma diferente, então a diferença viaja junto.
      const porCodigo = casaPorCodigo(produto, i.gtin);
      // Palpite fraco com concorrente à vista não é sugestão, é chute: o
      // operador decide mais rápido na busca do que desfazendo um erro.
      if (!porCodigo && achados.length > 1) return null;

      return {
        itemId: i.id,
        productId: p.id,
        nome: p.nome,
        sku: p.sku,
        imagemUrl: p.imagemUrl,
        unidade: p.unidadeBase,
        motivo: porCodigo ? ("EAN" as const) : ("NOME" as const),
        ...inferirVinculo(produto, item),
      };
    }),
  );

  return sugestoes.filter((s): s is SugestaoDePara => s != null);
}
