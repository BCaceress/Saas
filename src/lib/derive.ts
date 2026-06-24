import type { BaseUnit } from "@/generated/prisma";

/**
 * Derivações de leitura (PRD Fase 2 §6) — custo e disponibilidade de produtos
 * que NÃO guardam estoque próprio (COMBO, PERSONALIZADO). São calculadas a
 * partir dos componentes; nunca persistidas como estoque.
 *
 * Funções PURAS: recebem números já carregados do banco (Decimal -> number na
 * borda) e devolvem números. Sem acesso a DB — fáceis de testar e reusáveis na
 * listagem, no painel de cadastro e (depois) por variação (fatorEscala).
 */

export type DeriveComponent = {
  /** Quantidade requerida pela receita/kit, na `unidade`. */
  quantidade: number;
  /** UN = item fechado (combo); ML/G = dose fracionada (receita). */
  unidade: BaseUnit;
  /** Custo do componente por UNIDADE base (R$/un). null = sem custo cadastrado. */
  custo: number | null;
  /** Preço de venda avulso do componente (referência da soma do combo). */
  precoVenda: number | null;
  /** Conteúdo por unidade (ml/g de 1 un) — necessário p/ dose fracionada. */
  conteudoPorUnidade: number | null;
  /** Saldo fechado (un inteiras) do componente. */
  estoqueFechado: number;
  /** Saldo aberto (ml/g da unidade em uso). */
  estoqueAberto: number;
};

export type Derived = {
  /** Soma(custo × quantidade). null se algum componente faltar custo. */
  custoTotal: number | null;
  /** true se algum componente não tem custo (margem fica incompleta). */
  custoIncompleto: boolean;
  /** Soma dos preços avulsos (× quantidade). Referência p/ combo; null se faltar preço. */
  somaAvulsos: number | null;
  /** floor(min sobre componentes [ saldoDisponível / quantidadeRequerida ]). */
  disponibilidade: number;
  /** Quantidade de componentes considerados (0 => disponibilidade 0). */
  totalComponentes: number;
};

/**
 * Saldo disponível de um componente, na unidade requerida.
 * - UN (item fechado): só o `estoqueFechado` — venda fechada não lê o aberto.
 * - ML/G (dose): conteúdo total abrível = fechado × conteudoPorUnidade + aberto.
 */
function saldoDisponivel(c: DeriveComponent): number {
  if (c.unidade === "UN") return c.estoqueFechado;
  const conteudo = c.conteudoPorUnidade ?? 0;
  return c.estoqueFechado * conteudo + c.estoqueAberto;
}

/**
 * Custo de um componente na quantidade requerida.
 * - UN: custo × quantidade.
 * - ML/G: fração de 1 unidade base => custo × (quantidade / conteudoPorUnidade).
 */
function custoComponente(c: DeriveComponent, qtd: number): number | null {
  if (c.custo == null) return null;
  if (c.unidade === "UN") return c.custo * qtd;
  const conteudo = c.conteudoPorUnidade || 1;
  return c.custo * (qtd / conteudo);
}

/**
 * Deriva custo/soma-avulsos/disponibilidade a partir dos componentes.
 * `fatorEscala` escala as quantidades (variação de tamanho, §5; default 1).
 */
export function derive(
  components: DeriveComponent[],
  fatorEscala = 1,
): Derived {
  if (components.length === 0) {
    return {
      custoTotal: null,
      custoIncompleto: false,
      somaAvulsos: null,
      disponibilidade: 0,
      totalComponentes: 0,
    };
  }

  let custoTotal = 0;
  let custoIncompleto = false;
  let somaAvulsos = 0;
  let somaIncompleta = false;
  let minRatio = Infinity;

  for (const c of components) {
    const qtd = c.quantidade * fatorEscala;

    const custo = custoComponente(c, qtd);
    if (custo == null) custoIncompleto = true;
    else custoTotal += custo;

    if (c.precoVenda == null) somaIncompleta = true;
    else somaAvulsos += c.precoVenda * (c.unidade === "UN" ? qtd : 1);

    const disponivel = saldoDisponivel(c);
    const ratio = qtd > 0 ? disponivel / qtd : Infinity;
    if (ratio < minRatio) minRatio = ratio;
  }

  return {
    custoTotal: custoIncompleto ? null : custoTotal,
    custoIncompleto,
    somaAvulsos: somaIncompleta ? null : somaAvulsos,
    disponibilidade: Number.isFinite(minRatio) ? Math.max(0, Math.floor(minRatio)) : 0,
    totalComponentes: components.length,
  };
}
