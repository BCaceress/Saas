"use client";

import { useSyncExternalStore } from "react";

/**
 * Os slide-overs de /produtos viajam em pedaços próprios de JavaScript.
 *
 * Todos eles — gerenciar marcas/categorias/armazenagem/fornecedores, importar
 * CSV (que arrasta o papaparse junto), etiquetas, imagens, edição em lote —
 * eram importados no topo da listagem. Quem só abre /produtos para conferir um
 * preço baixava o código dos seis painéis antes de ver a primeira linha.
 *
 * `next/dynamic` resolveria o corte, mas a fronteira de Suspense dele troca o
 * componente no meio da animação: o painel entra como "Carregando…", desmonta e
 * o slide-in roda duas vezes. Aqui o módulo é uma loja externa — quem já
 * pré-buscou (o mouse encostou em "Gerenciar") recebe o painel PRONTO já na
 * primeira renderização, e o Sheet monta uma vez só.
 */
function moduloSobDemanda<T>(carregar: () => Promise<T>) {
  let valor: T | null = null;
  let voo: Promise<unknown> | null = null;
  const ouvintes = new Set<() => void>();

  const assinar = (fn: () => void) => {
    ouvintes.add(fn);
    return () => {
      ouvintes.delete(fn);
    };
  };
  const ler = () => valor;

  /** Põe o pedaço no forno. Idempotente — pode ser chamado a cada hover. */
  function preparar() {
    if (valor || voo) return;
    voo = carregar().then((m) => {
      valor = m;
      ouvintes.forEach((f) => f());
    });
  }

  return {
    preparar,
    /**
     * O módulo, ou `null` enquanto o pedaço não chegou. `ativo` marca quem
     * precisa dele AGORA — é o que dispara a busca de quem não pré-buscou.
     */
    useModulo(ativo: boolean): T | null {
      if (ativo) preparar();
      return useSyncExternalStore(assinar, ler, () => null);
    },
  };
}

export const painelGerenciar = moduloSobDemanda(() => import("./sidepanels"));
export const painelCsv = moduloSobDemanda(() => import("./csv-sheet"));
export const painelEtiquetas = moduloSobDemanda(() => import("./etiquetas-sheet"));
export const painelImagens = moduloSobDemanda(() => import("./imagens-sheet"));
export const painelLote = moduloSobDemanda(() => import("./lote-sheet"));

/** Pedaços do menu "Gerenciar" — pré-buscados ao primeiro sinal de intenção. */
export function prepararGerenciar() {
  painelGerenciar.preparar();
  painelCsv.preparar();
}

/** Pedaços da barra de ações em lote — pré-buscados quando algo é selecionado. */
export function prepararLote() {
  painelLote.preparar();
  painelEtiquetas.preparar();
  painelImagens.preparar();
}
