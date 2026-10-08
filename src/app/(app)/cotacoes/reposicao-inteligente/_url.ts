import {
  COBERTURAS_MOVIMENTACAO,
  PERIODOS_MOVIMENTACAO,
  policyMovimentacao,
  type BaseSugestao,
  type EstoquePolicy,
} from "@/lib/estoque-estrategia";

/**
 * Tradução URL ⇄ escolha da Reposição. Puro (sem DB, sem React) porque os dois
 * lados precisam: o RSC lê a URL para montar a lista, o controle da tela
 * escreve nela. O link fica compartilhável — "olha o que vendeu em 15 dias e
 * está faltando" vira uma URL que o colega abre igual.
 */

export type EscolhaReposicao = {
  base: BaseSugestao;
  /** Dias de movimentação analisados. Só vale quando `base === "movimentacao"`. */
  janelaDias: number;
  /** Dias que a compra deve cobrir. `null` = cobrir o próprio período analisado. */
  coberturaDias: number | null;
};

export type Params = Record<string, string | string[] | undefined>;

export const JANELA_PADRAO = 30;

const str = (p: Params, k: string): string => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};

const naLista = (n: number, lista: readonly number[]) => lista.includes(n);

export function lerEscolha(p: Params): EscolhaReposicao {
  const base: BaseSugestao = str(p, "base") === "movimentacao" ? "movimentacao" : "metas";
  const janela = Number(str(p, "dias"));
  const cobertura = Number(str(p, "cobrir"));
  return {
    base,
    janelaDias: naLista(janela, PERIODOS_MOVIMENTACAO) ? janela : JANELA_PADRAO,
    coberturaDias: naLista(cobertura, COBERTURAS_MOVIMENTACAO) ? cobertura : null,
  };
}

/** Só o que difere do padrão entra na URL — link curto continua legível. */
export function escolhaParaParams(e: EscolhaReposicao): URLSearchParams {
  const sp = new URLSearchParams();
  if (e.base !== "movimentacao") return sp;
  sp.set("base", "movimentacao");
  if (e.janelaDias !== JANELA_PADRAO) sp.set("dias", String(e.janelaDias));
  if (e.coberturaDias != null) sp.set("cobrir", String(e.coberturaDias));
  return sp;
}

/**
 * Policy efetiva da tela: a da empresa, ou a derivada do período escolhido.
 * Um lugar só, usado pelo RSC — a tela recebe a policy já resolvida.
 */
export function policyDaEscolha(doTenant: EstoquePolicy, e: EscolhaReposicao): EstoquePolicy {
  return e.base === "movimentacao"
    ? policyMovimentacao(doTenant, e.janelaDias, e.coberturaDias)
    : doTenant;
}

/** Chave de remontagem do cliente — trocar a base reinicia a revisão. */
export const chaveEscolha = (e: EscolhaReposicao) =>
  `${e.base}:${e.janelaDias}:${e.coberturaDias ?? "janela"}`;
