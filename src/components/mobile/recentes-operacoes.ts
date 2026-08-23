"use client";

import { useSyncExternalStore } from "react";

/**
 * As duas últimas operações usadas neste aparelho.
 *
 * A ordem da folha "Nova operação" nasceu de um palpite de frequência — e o
 * palpite é médio: quem só recebe mercadoria rolava até "Receber" toda vez, e
 * quem só conta inventário passava por seis linhas que nunca usa. Guardar o que
 * a PESSOA usa custa uma linha de `localStorage` e acerta por operador.
 *
 * Duas, não cinco: subir muita coisa faz a lista dançar a cada uso e destrói a
 * memória de posição, que é justamente o que torna o menu rápido.
 *
 * Store externo (e não `useState` + efeito) pelo mesmo motivo do `InstalarApp`:
 * isto é estado do navegador, não do React — ler num efeito viraria setState em
 * cascata, que o lint do projeto proíbe.
 */

const CHAVE = "nohub:m:operacoes-recentes";
const LIMITE = 2;

/** Identidade estável para o snapshot do servidor — `[]` novo a cada render faz loop. */
const VAZIO: readonly string[] = Object.freeze([]);

let cache: readonly string[] | null = null;
const ouvintes = new Set<() => void>();

function ler(): readonly string[] {
  if (cache) return cache;
  try {
    const cru: unknown = JSON.parse(window.localStorage.getItem(CHAVE) ?? "[]");
    cache = Array.isArray(cru) ? cru.filter((v): v is string => typeof v === "string") : VAZIO;
  } catch {
    // Modo privado, storage cheio, JSON estragado: a folha funciona sem isto.
    cache = VAZIO;
  }
  return cache;
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Marca uma operação como recém-usada. Chamada no toque, não no destino. */
export function registrarOperacao(chave: string): void {
  const nova = [chave, ...ler().filter((c) => c !== chave)].slice(0, LIMITE);
  cache = Object.freeze(nova);
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(nova));
  } catch {}
  for (const o of ouvintes) o();
}

/** As recentes, da mais recente para a mais antiga. Vazio no servidor. */
export function useOperacoesRecentes(): readonly string[] {
  return useSyncExternalStore(inscrever, ler, () => VAZIO);
}
