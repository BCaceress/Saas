import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Unidade de cotação: "2" não é pedido, é adivinhação.
//
// Preço de fardo e preço de unidade não são o mesmo número — e o fornecedor
// que lê "Coca-Cola 350ml — 2" no WhatsApp responde pelo que ele achar que
// foi pedido. Todo lugar que escreve quantidade para FORA (mensagem, e-mail,
// link público) passa por aqui, para o rótulo ser sempre o mesmo texto.
// ============================================================

export type UnidadeItem = {
  /** "Caixa (12 un.)", "kg", "un" — o que vai depois do número. */
  label: string;
  /** Embalagem de compra (fardo, caixa) — muda o formato para "2 × Caixa". */
  embalagem: boolean;
};

/** "Caixa (12 un.)" e não só "Caixa": sem o fator, o preço vem de outra coisa. */
export function rotuloEmbalagem(nome: string, fator: number): string {
  return fator > 1 ? `${nome} (${fator} un.)` : nome;
}

const UNIDADE_AVULSA: UnidadeItem = { label: "un", embalagem: false };

type ItemBase = { id: string; packagingId: string | null; productId: string | null };

/**
 * Rótulo de unidade de cada item, em duas consultas para a lista inteira.
 * Embalagem pedida manda; sem ela, vale a unidade base do produto; sem produto
 * vinculado (item de texto livre), "un".
 *
 * Roda dentro de `runWithTenant` — usa `db`, não o client cru.
 */
export async function unidadesDosItens(itens: ItemBase[]): Promise<Map<string, UnidadeItem>> {
  const packagingIds = [
    ...new Set(itens.map((i) => i.packagingId).filter((v): v is string => v !== null)),
  ];
  const productIds = [
    ...new Set(itens.map((i) => i.productId).filter((v): v is string => v !== null)),
  ];

  const [embalagens, produtos] = await Promise.all([
    packagingIds.length
      ? db.productPackaging.findMany({
          where: { id: { in: packagingIds } },
          select: { id: true, nome: true, fatorConversao: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, unidadeBase: true },
        })
      : Promise.resolve([]),
  ]);

  const porEmbalagem = new Map(
    embalagens.map((e) => [e.id, rotuloEmbalagem(e.nome, Number(e.fatorConversao ?? 1))]),
  );
  const porProduto = new Map(produtos.map((p) => [p.id, p.unidadeBase.toLowerCase()]));

  return new Map(
    itens.map((i) => {
      const emb = i.packagingId ? porEmbalagem.get(i.packagingId) : undefined;
      if (emb) return [i.id, { label: emb, embalagem: true }] as const;
      const base = i.productId ? porProduto.get(i.productId) : undefined;
      return [i.id, base ? { label: base, embalagem: false } : UNIDADE_AVULSA] as const;
    }),
  );
}

/** "2 × Caixa (12 un.)" · "2,5 kg" · "3 un" — o número nunca sai sozinho. */
export function quantidadeComUnidade(quantidade: number, unidade?: UnidadeItem): string {
  const qtd = quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const u = unidade ?? UNIDADE_AVULSA;
  return u.embalagem ? `${qtd} × ${u.label}` : `${qtd} ${u.label}`;
}
