import "server-only";
import { db } from "@/lib/prisma";
import { logAviso } from "@/lib/log";
import { ingerir } from "./ingest";
import type { OfertaBruta } from "./types";

// ============================================================
// Resposta de cotação → preço vigente no catálogo do fornecedor.
//
// Sem isto, a cotação era uma ilha: o fornecedor mandava o preço, o operador
// decidia e o número morria ali. O comparador continuava cego para quem só
// fala por cotação, e o histórico de preço não registrava a metade negociada
// da vida do produto — justamente a que mais se move.
//
// Preço cotado É preço: entra no MESMO catálogo que uma tabela importada
// alimentaria, pelo mesmo caminho (`ingerir`), com as mesmas garantias — item
// não duplica, e o histórico só ganha ponto quando o valor muda.
//
// `substituirCatalogo: false` é obrigatório aqui: a cotação fala de 12 itens,
// não da tabela inteira. Substituir apagaria de linha os outros 800.
// ============================================================

/**
 * Grava no catálogo os preços que um fornecedor respondeu.
 *
 * Roda dentro de `runWithTenant`. NUNCA lança: a resposta do fornecedor já
 * está salva quando isto roda, e perder a proposta porque o catálogo falhou
 * seria trocar o ouro pelo troco. Falha vira aviso no log.
 */
export async function registrarPrecosDaCotacao(quotationSupplierId: string): Promise<void> {
  try {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: quotationSupplierId },
      select: {
        supplierId: true,
        status: true,
        responses: {
          where: { disponivel: true },
          select: {
            precoUnitario: true,
            marca: true,
            quotationItem: {
              select: { descricao: true, quantidade: true, productId: true, packagingId: true },
            },
          },
        },
      },
    });
    if (!convite || convite.status !== "RESPONDIDA" || convite.responses.length === 0) return;

    const productIds = [
      ...new Set(
        convite.responses
          .map((r) => r.quotationItem.productId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const produtos = productIds.length
      ? await db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nome: true, ean: true },
        })
      : [];
    const porProduto = new Map(produtos.map((p) => [p.id, p]));

    // Embalagem cotada: "Fardo 12" precisa viajar junto, senão o comparador
    // põe lado a lado o preço da caixa de um e o da unidade do outro.
    const packagingIds = [
      ...new Set(
        convite.responses
          .map((r) => r.quotationItem.packagingId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const embalagens = packagingIds.length
      ? await db.productPackaging.findMany({
          where: { id: { in: packagingIds } },
          select: { id: true, nome: true, fatorConversao: true },
        })
      : [];
    const porEmbalagem = new Map(embalagens.map((e) => [e.id, e]));

    const ofertas: OfertaBruta[] = convite.responses.map((r) => {
      const item = r.quotationItem;
      const produto = item.productId ? porProduto.get(item.productId) : null;
      const embalagem = item.packagingId ? porEmbalagem.get(item.packagingId) : null;
      return {
        // Descrição do PRODUTO quando existe vínculo: é a chave que o índice de
        // matching usa (nome normalizado), então o item cotado cai na mesma
        // linha do catálogo que a tabela do fornecedor já criou — e não vira um
        // segundo item do mesmo produto no comparador.
        descricao: produto?.nome ?? item.descricao,
        ean: produto?.ean ?? null,
        marca: r.marca ?? null,
        unidade: embalagem?.nome ?? null,
        fatorConversao: embalagem ? Number(embalagem.fatorConversao) : null,
        preco: Number(r.precoUnitario),
        // O preço respondido vale para a quantidade que foi perguntada — quem
        // olhar depois precisa saber que 8,10 era para 12 fardos, não para um.
        quantidadeMinima: Number(item.quantidade) || null,
      };
    });

    await ingerir({
      supplierId: convite.supplierId,
      kind: "MANUAL",
      origem: "cotacao",
      fonte: { tipo: "manual", ofertas },
      substituirCatalogo: false,
    });
  } catch (e) {
    logAviso(
      "cotacao.precos",
      `Não foi possível levar a resposta da cotação para o catálogo: ${
        e instanceof Error ? e.message : "erro desconhecido"
      }`,
      { quotationSupplierId },
    );
  }
}
