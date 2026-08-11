import "server-only";
import { db } from "@/lib/prisma";

/**
 * Promoção agendada — preço com hora de começar e de terminar.
 *
 * Regras, em um lugar só:
 *  · vale quem está DENTRO da janela e com `ativo`;
 *  · `siteId` nulo alcança todas as lojas; com loja, só ela;
 *  · duas promoções vigentes ao mesmo tempo não são erro — vence a mais barata,
 *    que é a que o cliente viu no encarte e vai cobrar no caixa;
 *  · fora de qualquer janela, o preço é o do cadastro. A promoção NUNCA
 *    sobrescreve `Product.precoVenda`: acabou a data, o preço volta sozinho.
 *
 * Assume contexto de tenant ativo (`runWithTenant`) — o extension do Prisma
 * injeta o `tenantId` nas consultas.
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export type PromocaoRow = {
  id: string;
  siteId: string | null;
  siteNome: string | null;
  preco: number;
  inicio: string;
  fim: string;
  nome: string | null;
  ativo: boolean;
  /** Vigente AGORA — o que o caixa cobraria neste instante. */
  vigente: boolean;
};

/** Agenda de um produto: vigentes e futuras primeiro, passadas no fim. */
export async function promocoesDoProduto(productId: string): Promise<PromocaoRow[]> {
  const agora = new Date();
  const linhas = await db.productPromotion.findMany({
    where: { productId },
    orderBy: [{ inicio: "desc" }],
    take: 50,
    select: {
      id: true,
      siteId: true,
      preco: true,
      inicio: true,
      fim: true,
      nome: true,
      ativo: true,
      site: { select: { nome: true } },
    },
  });

  return linhas.map((p) => ({
    id: p.id,
    siteId: p.siteId,
    siteNome: p.site?.nome ?? null,
    preco: num(p.preco),
    inicio: p.inicio.toISOString(),
    fim: p.fim.toISOString(),
    nome: p.nome,
    ativo: p.ativo,
    vigente: p.ativo && p.inicio <= agora && p.fim >= agora,
  }));
}

/**
 * Preço promocional vigente por produto, para a loja informada. Uma consulta
 * para o catálogo inteiro — o PDV e o totem carregam a lista de produtos de uma
 * vez e não podem pagar uma ida por item.
 */
export async function precosPromocionais(
  siteId: string | null,
  agora: Date = new Date(),
): Promise<Map<string, number>> {
  const vigentes = await db.productPromotion.findMany({
    where: {
      ativo: true,
      inicio: { lte: agora },
      fim: { gte: agora },
      // Promoção da rede (siteId nulo) vale em qualquer loja.
      ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
    },
    select: { productId: true, preco: true },
  });

  const menor = new Map<string, number>();
  for (const p of vigentes) {
    const preco = num(p.preco);
    const atual = menor.get(p.productId);
    if (atual == null || preco < atual) menor.set(p.productId, preco);
  }
  return menor;
}
