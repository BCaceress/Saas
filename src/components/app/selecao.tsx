"use client";

import {
  createContext, useCallback, useContext, useState, useSyncExternalStore,
} from "react";

/**
 * Seleção em lote fora do estado do React.
 *
 * Compartilhado por /produtos e /estoque — as duas listagens têm o mesmo
 * problema (centenas de linhas caras) e a mesma solução.
 *
 * Guardar `Set<string>` num `useState` da listagem custava caro: marcar UMA
 * caixa re-renderizava a página inteira — 200 linhas, cada uma com menu,
 * célula de preço, medidor de estoque e tooltip. O clique ficava com um atraso
 * visível, e piorava quanto maior o catálogo.
 *
 * Aqui os ids moram numa loja externa e cada interessado assina só o que lhe
 * diz respeito:
 *
 * - a LINHA assina o próprio id (`useSelecionado`) — marcar uma caixa re-renderiza
 *   uma linha, não a tabela;
 * - a barra de ações e o cabeçalho assinam o total (`useQtdSelecionada`);
 * - a listagem NÃO assina nada: lê por método quando precisa exportar/editar em
 *   lote, e por isso nunca re-renderiza por causa de um clique de seleção.
 */
type Ouvinte = () => void;

export class SelecaoStore {
  private ids = new Set<string>();
  private geral = new Set<Ouvinte>();
  private porId = new Map<string, Set<Ouvinte>>();
  /** Índice da última linha tocada — âncora do shift-clique. */
  private ancora: number | null = null;

  // ── Leitura imperativa (não assina nada) ──
  get tamanho() {
    return this.ids.size;
  }

  lista(): string[] {
    return [...this.ids];
  }

  contem(id: string) {
    return this.ids.has(id);
  }

  /** Quantos, de uma lista, estão marcados — o cabeçalho da página usa isto. */
  quantosDe(ids: readonly string[]) {
    let n = 0;
    for (const id of ids) if (this.ids.has(id)) n++;
    return n;
  }

  // ── Assinaturas ──
  // Propriedades-seta, não métodos: `useSyncExternalStore` re-assina toda vez
  // que a função `subscribe` muda de identidade.
  assinarGeral = (fn: Ouvinte) => {
    this.geral.add(fn);
    return () => {
      this.geral.delete(fn);
    };
  };

  assinarId = (id: string, fn: Ouvinte) => {
    let alvo = this.porId.get(id);
    if (!alvo) {
      alvo = new Set();
      this.porId.set(id, alvo);
    }
    alvo.add(fn);
    return () => {
      alvo.delete(fn);
      if (alvo.size === 0) this.porId.delete(id);
    };
  };

  /** Avisa as linhas que mudaram + quem acompanha o total. */
  private avisar(mudados: Iterable<string>) {
    for (const id of mudados) this.porId.get(id)?.forEach((f) => f());
    this.geral.forEach((f) => f());
  }

  // ── Escrita ──
  /**
   * Marca/desmarca uma linha. Com `shift`, marca o intervalo desde a última
   * linha tocada — é como o operador seleciona "essa prateleira inteira" sem
   * 40 cliques.
   */
  alternar(id: string, idx: number, shift: boolean, lista: readonly { id: string }[]) {
    if (shift && this.ancora !== null) {
      const [ini, fim] = [this.ancora, idx].sort((a, b) => a - b);
      const marcar = !this.ids.has(id);
      const mudados: string[] = [];
      for (let i = ini; i <= fim; i++) {
        const alvo = lista[i]?.id;
        if (!alvo || this.ids.has(alvo) === marcar) continue;
        if (marcar) this.ids.add(alvo);
        else this.ids.delete(alvo);
        mudados.push(alvo);
      }
      this.ancora = idx;
      this.avisar(mudados);
      return;
    }
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.ancora = idx;
    this.avisar([id]);
  }

  /** Marca (ou desmarca) um bloco de uma vez — "todos desta página". */
  alternarVarios(ids: readonly string[], marcar: boolean) {
    const mudados = ids.filter((id) => this.ids.has(id) !== marcar);
    for (const id of mudados) {
      if (marcar) this.ids.add(id);
      else this.ids.delete(id);
    }
    this.ancora = null;
    this.avisar(mudados);
  }

  definir(ids: Iterable<string>) {
    const antes = this.ids;
    this.ids = new Set(ids);
    const mudados = new Set<string>();
    for (const id of antes) if (!this.ids.has(id)) mudados.add(id);
    for (const id of this.ids) if (!antes.has(id)) mudados.add(id);
    this.ancora = null;
    if (mudados.size) this.avisar(mudados);
  }

  limpar() {
    if (this.ids.size === 0) return;
    this.definir([]);
  }
}

const Ctx = createContext<SelecaoStore | null>(null);

/** Cria a loja de seleção da tela (uma por montagem da listagem). */
export function useNovaSelecao(): SelecaoStore {
  return useState(() => new SelecaoStore())[0];
}

export function SelecaoProvider({
  store, children,
}: {
  store: SelecaoStore;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function useStore(): SelecaoStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("Faltou o SelecaoProvider em volta da listagem.");
  return store;
}

/** Esta linha está marcada? Assina só o próprio id. */
export function useSelecionado(id: string): boolean {
  const store = useStore();
  return useSyncExternalStore(
    useCallback((fn: Ouvinte) => store.assinarId(id, fn), [store, id]),
    () => store.contem(id),
    () => false,
  );
}

/** Total marcado (atravessa páginas). */
export function useQtdSelecionada(): number {
  const store = useStore();
  return useSyncExternalStore(store.assinarGeral, () => store.tamanho, () => 0);
}

/** Quantos, dos ids desta página, estão marcados. */
export function useQtdDaPagina(ids: readonly string[]): number {
  const store = useStore();
  return useSyncExternalStore(store.assinarGeral, () => store.quantosDe(ids), () => 0);
}

/** A loja em si, para ler/escrever sem assinar nada. */
export function useSelecao(): SelecaoStore {
  return useStore();
}
