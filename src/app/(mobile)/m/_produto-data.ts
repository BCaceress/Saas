import "server-only";
import { db } from "@/lib/prisma";
import { can, podeEmAlguma, type Acesso } from "@/lib/permissoes";
import {
  mediaDiaria,
  coberturaDias,
  nivelCobertura,
  fmtCobertura,
  alvoReposicao,
  type EstoquePolicy,
  type NivelCobertura,
} from "@/lib/estoque-estrategia";

/**
 * Ficha de UM produto para a superfície mobile.
 *
 * Por que não `loadSaldos`/`loadLotes` de `(app)/estoque/_data.ts`: aqueles
 * varrem o catálogo inteiro — todos os Stock, todos os lotes e até 5.000
 * movimentos — para depois filtrar um item. É o certo para a tela de saldos;
 * no celular, para ler UM código de barras, é varredura de catálogo por bipe.
 *
 * O que NÃO se reinventa aqui é a regra: média diária, cobertura, nível e alvo
 * de reposição saem todos de `lib/estoque-estrategia`, o mesmo módulo que o
 * desktop usa. Muda a consulta, não o cálculo.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const DIA_MS = 86_400_000;

export type SaldoSite = {
  siteId: string | null;
  siteNome: string;
  fechado: number;
  aberto: number;
  minimo: number;
  ideal: number;
};

export type LoteFicha = {
  id: string;
  lote: string | null;
  validade: string | null;
  quantidade: number;
  diasParaVencer: number | null;
  status: "vencido" | "vencendo" | "ok" | "sem-validade";
};

export type EmbalagemFicha = {
  id: string;
  nome: string;
  ean: string | null;
  fator: number;
};

export type FichaProduto = {
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

  /** null quando a pessoa não tem `produto.preco`. */
  precoVenda: number | null;
  /** null quando a pessoa não tem `produto.custo`. */
  custoMedio: number | null;
  /** Margem sobre o preço, em %. Precisa das DUAS permissões. */
  margemPct: number | null;

  saldos: SaldoSite[];
  totalFechado: number;
  totalAberto: number;

  cobertura: {
    mediaDia: number;
    dias: number | null;
    label: string;
    nivel: NivelCobertura;
    /** Quanto comprar para voltar ao alvo da estratégia da empresa. */
    sugestao: number;
  } | null;

  lotes: LoteFicha[];
  embalagens: EmbalagemFicha[];

  /** Como o código escaneado casou — o operador precisa saber se bipou o fardo. */
  casouPor: "ean" | "sku" | "embalagem" | "id";
  embalagemCasada: EmbalagemFicha | null;
};

/** Só o necessário para a lista de resultados quando o código não casa exato. */
export type ProdutoResumo = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
};

const SELECT_FICHA = {
  id: true,
  nome: true,
  sku: true,
  ean: true,
  imagemUrl: true,
  unidadeBase: true,
  ativo: true,
  controlaEstoque: true,
  precoVenda: true,
  custoMedio: true,
  brand: { select: { nome: true } },
  subcategory: { select: { nome: true } },
  packagings: {
    select: { id: true, nome: true, ean: true, fatorConversao: true },
    orderBy: { fatorConversao: "asc" },
  },
  stocks: {
    select: {
      siteId: true,
      estoqueFechado: true,
      estoqueAberto: true,
      estoqueMinimo: true,
      estoqueIdeal: true,
      site: { select: { nome: true } },
    },
  },
} as const;

type ProdutoCru = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  unidadeBase: string;
  ativo: boolean;
  controlaEstoque: boolean;
  precoVenda: unknown;
  custoMedio: unknown;
  brand: { nome: string } | null;
  subcategory: { nome: string } | null;
  packagings: Array<{ id: string; nome: string; ean: string | null; fatorConversao: unknown }>;
  stocks: Array<{
    siteId: string | null;
    estoqueFechado: unknown;
    estoqueAberto: unknown;
    estoqueMinimo: unknown;
    estoqueIdeal: unknown;
    site: { nome: string } | null;
  }>;
};

/**
 * Monta a ficha. `siteId` null = consolidado de todas as lojas que a pessoa
 * enxerga. Roda dentro do contexto de tenant.
 */
export async function montarFicha(
  produto: ProdutoCru,
  args: {
    acessos: Acesso[];
    siteId: string | null;
    policy: EstoquePolicy;
    validadeAlertaDias: number;
    casouPor: FichaProduto["casouPor"];
    embalagemCasada?: EmbalagemFicha | null;
  },
): Promise<FichaProduto> {
  const { acessos, siteId, policy } = args;

  // Preço e custo são permissões separadas de propósito: o repositor confere
  // saldo e validade sem enxergar margem.
  const vePreco = podeEmAlguma(acessos, "produto.preco");
  const veCusto = podeEmAlguma(acessos, "produto.custo");

  const stocksVisiveis = produto.stocks.filter(
    // Sem loja definida o registro é global; com loja, exige permissão naquela
    // loja — o mesmo corte que `whereSite` faz nas listagens.
    (s) => (siteId ? s.siteId === siteId : true) && (!s.siteId || can(acessos, "estoque.ver", s.siteId)),
  );

  const saldos: SaldoSite[] = stocksVisiveis.map((s) => ({
    siteId: s.siteId,
    siteNome: s.site?.nome ?? "Sem loja",
    fechado: n(s.estoqueFechado),
    aberto: n(s.estoqueAberto),
    minimo: n(s.estoqueMinimo),
    ideal: n(s.estoqueIdeal),
  }));

  const totalFechado = saldos.reduce((a, s) => a + s.fechado, 0);
  const totalAberto = saldos.reduce((a, s) => a + s.aberto, 0);
  const totalMinimo = saldos.reduce((a, s) => a + s.minimo, 0);
  const totalIdeal = saldos.reduce((a, s) => a + s.ideal, 0);

  const janelaDias = policy.usaGiro ? policy.periodoMediaDias : 30;
  const desde = new Date(Date.now() - janelaDias * DIA_MS);
  const alertaMs = args.validadeAlertaDias * DIA_MS;

  const [saidas, lotesCrus] = await Promise.all([
    db.stockMovement.findMany({
      where: {
        productId: produto.id,
        tipo: "SAIDA",
        createdAt: { gte: desde },
        ...(siteId ? { siteId } : {}),
      },
      select: { deltaFechado: true, deltaAberto: true },
    }),
    produto.controlaEstoque
      ? db.stockLot.findMany({
          where: {
            productId: produto.id,
            quantidade: { gt: 0 },
            ...(siteId ? { siteId } : {}),
          },
          select: { id: true, lote: true, validade: true, quantidade: true },
          // FEFO: o que vence primeiro é o que sai primeiro, e é o que o
          // operador precisa ver no topo.
          orderBy: [{ validade: "asc" }, { createdAt: "asc" }],
          take: 20,
        })
      : Promise.resolve([]),
  ]);

  const consumoJanela = saidas.reduce(
    (a, m) => a + (Math.abs(n(m.deltaFechado)) || Math.abs(n(m.deltaAberto))),
    0,
  );

  const mediaDia = mediaDiaria(consumoJanela, janelaDias);
  const dias = coberturaDias(totalFechado, mediaDia);
  const alvo = alvoReposicao(policy, {
    minimo: totalMinimo,
    ideal: totalIdeal,
    mediaDia,
  });

  const cobertura = produto.controlaEstoque
    ? {
        mediaDia,
        dias,
        label: fmtCobertura(dias),
        nivel: nivelCobertura(dias, policy.diasCobertura),
        sugestao: Math.max(0, alvo - totalFechado),
      }
    : null;

  const agora = Date.now();
  const lotes: LoteFicha[] = lotesCrus.map((l) => {
    const validade = l.validade ? l.validade.getTime() : null;
    const diasParaVencer =
      validade == null ? null : Math.floor((validade - agora) / DIA_MS);
    return {
      id: l.id,
      lote: l.lote,
      validade: l.validade?.toISOString() ?? null,
      quantidade: n(l.quantidade),
      diasParaVencer,
      status:
        validade == null
          ? "sem-validade"
          : validade < agora
            ? "vencido"
            : validade - agora <= alertaMs
              ? "vencendo"
              : "ok",
    };
  });

  const precoVenda = vePreco ? n(produto.precoVenda) || null : null;
  const custoMedio = veCusto ? n(produto.custoMedio) || null : null;

  return {
    id: produto.id,
    nome: produto.nome,
    sku: produto.sku,
    ean: produto.ean,
    imagemUrl: produto.imagemUrl,
    marca: produto.brand?.nome ?? null,
    categoria: produto.subcategory?.nome ?? null,
    unidadeBase: produto.unidadeBase,
    ativo: produto.ativo,
    controlaEstoque: produto.controlaEstoque,

    precoVenda,
    custoMedio,
    margemPct:
      precoVenda && custoMedio && precoVenda > 0
        ? ((precoVenda - custoMedio) / precoVenda) * 100
        : null,

    saldos,
    totalFechado,
    totalAberto,
    cobertura,
    lotes,
    embalagens: produto.packagings.map((p) => ({
      id: p.id,
      nome: p.nome,
      ean: p.ean,
      fator: n(p.fatorConversao),
    })),

    casouPor: args.casouPor,
    embalagemCasada: args.embalagemCasada ?? null,
  };
}

export { SELECT_FICHA };
export type { ProdutoCru };
