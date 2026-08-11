import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Lista de PRODUTOS do celular — cadastro, não saldo.
//
// Vizinha de `/m/estoque/_data.ts`, e de propósito separada: lá a pergunta é
// "quanto tem e quanto falta" (consumo, cobertura, mínimo); aqui é "que produto
// é esse" — nome, marca, categoria, código e preço. Quem consulta na gôndola
// abre esta; quem vai contar ou repor abre aquela.
//
// UMA consulta: o saldo do site ativo vem junto, pela relação, porque o cartão
// mostra o número mas não calcula nada com ele. Nada de movimentos.
// ============================================================

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export type ProdutoLista = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  marca: string | null;
  categoria: string | null;
  unidadeBase: string;
  ativo: boolean;
  controlaEstoque: boolean;
  restricaoIdade: boolean;
  /** null quando a pessoa não tem `produto.preco` — nem desce no payload. */
  precoVenda: number | null;
  /** Saldo fechado (em UNIDADES) no site ativo; null se não controla estoque. */
  saldo: number | null;
  /**
   * Sobra da embalagem em uso (ml/g) — só interessa como "tem uma aberta", que
   * é como o desktop mostra. Nunca soma com o fechado: são grandezas
   * diferentes.
   */
  aberto: number;
};

export async function loadProdutosLista(
  siteId: string | null,
  podeVerPreco: boolean,
): Promise<ProdutoLista[]> {
  const produtos = await db.product.findMany({
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      unidadeBase: true,
      ativo: true,
      controlaEstoque: true,
      restricaoIdade: true,
      precoVenda: true,
      brand: { select: { nome: true } },
      subcategory: { select: { nome: true } },
      // Sem site ativo (tenant recém-criado) o saldo é a soma do que existir.
      stocks: {
        where: siteId ? { siteId } : {},
        select: { estoqueFechado: true, estoqueAberto: true },
      },
    },
  });

  return produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    imagemUrl: p.imagemUrl,
    marca: p.brand?.nome ?? null,
    categoria: p.subcategory?.nome ?? null,
    unidadeBase: p.unidadeBase,
    ativo: p.ativo,
    controlaEstoque: p.controlaEstoque,
    restricaoIdade: p.restricaoIdade,
    precoVenda: podeVerPreco ? (p.precoVenda == null ? null : Number(p.precoVenda)) : null,
    saldo: p.controlaEstoque ? p.stocks.reduce((s, e) => s + n(e.estoqueFechado), 0) : null,
    aberto: p.controlaEstoque ? p.stocks.reduce((s, e) => s + n(e.estoqueAberto), 0) : 0,
  }));
}
