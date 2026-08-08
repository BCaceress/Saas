"use client";

import * as React from "react";

// ============================================================
// Fila de etiquetas — mora NO APARELHO, não no banco.
//
// É uma decisão, não um atalho: "quero imprimir estas 12 etiquetas" é intenção
// de quem está com o celular na mão agora, não fato da empresa. No banco ela
// viraria estado compartilhado — a fila de um repositor apareceria para o
// outro, e sobraria lixo de listas que ninguém imprimiu. Some ao limpar o
// navegador, e tudo bem: reescanear leva segundos.
//
// A impressão de fato é a folha `/documento/etiquetas`, que recebe os ids pela
// URL e é renderizada no servidor — preço e SKU saem do banco na hora, nunca do
// que estava guardado aqui.
//
// `localStorage` é um estado externo ao React, então o hook é
// `useSyncExternalStore` e não `useState` + efeito: é ele que garante que duas
// telas abertas (a ficha e a fila) enxerguem a mesma lista sem um render a mais.
// ============================================================

const CHAVE = "nohub:etiquetas";
/** Cabe numa folha A4 de etiquetas com folga; acima disso a URL fica grande. */
const MAX = 60;
/** Avisa as outras telas abertas na MESMA aba (o `storage` só cobre as outras). */
const EVENTO = "nohub:etiquetas:mudou";

export type ItemEtiqueta = {
  productId: string;
  nome: string;
  sku: string;
  quantidade: number;
};

const VAZIO: ItemEtiqueta[] = [];

// `getSnapshot` precisa devolver a MESMA referência enquanto nada muda, ou o
// React entra em laço de render. Guardamos o texto cru como assinatura e só
// reparseamos quando ele muda.
let assinatura: string | null = null;
let cache: ItemEtiqueta[] = VAZIO;

function parse(cru: string | null): ItemEtiqueta[] {
  if (!cru) return VAZIO;
  try {
    const v: unknown = JSON.parse(cru);
    if (!Array.isArray(v)) return VAZIO;
    return v
      .filter(
        (i): i is ItemEtiqueta =>
          typeof i === "object" &&
          i !== null &&
          typeof (i as ItemEtiqueta).productId === "string" &&
          typeof (i as ItemEtiqueta).nome === "string",
      )
      .slice(0, MAX)
      .map((i) => ({ ...i, quantidade: Math.max(1, Math.floor(i.quantidade) || 1) }));
  } catch {
    return VAZIO;
  }
}

function ler(): ItemEtiqueta[] {
  if (typeof window === "undefined") return VAZIO;
  let cru: string | null = null;
  try {
    cru = window.localStorage.getItem(CHAVE);
  } catch {
    return VAZIO;
  }
  if (cru !== assinatura) {
    assinatura = cru;
    cache = parse(cru);
  }
  return cache;
}

/** No servidor a fila é sempre vazia — e a referência, sempre a mesma. */
function lerNoServidor(): ItemEtiqueta[] {
  return VAZIO;
}

function assinar(avisar: () => void): () => void {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

function gravar(itens: ItemEtiqueta[]) {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(itens.slice(0, MAX)));
  } catch {
    // Modo anônimo com armazenamento cheio: a fila deixa de persistir. Avisar
    // mesmo assim mantém a tela coerente com o que o navegador aceitou.
  }
  window.dispatchEvent(new CustomEvent(EVENTO));
}

export function useFilaEtiquetas() {
  const itens = React.useSyncExternalStore(assinar, ler, lerNoServidor);

  const adicionar = React.useCallback(
    (item: Omit<ItemEtiqueta, "quantidade">, quantidade = 1): number => {
      const atual = [...ler()];
      const i = atual.findIndex((x) => x.productId === item.productId);
      // Escanear o mesmo produto de novo soma — é o gesto de quem passa pela
      // gôndola contando quantas etiquetas faltam.
      if (i >= 0) atual[i] = { ...atual[i], quantidade: atual[i].quantidade + quantidade };
      else atual.push({ ...item, quantidade });
      gravar(atual);
      return atual.length;
    },
    [],
  );

  const definirQuantidade = React.useCallback((productId: string, quantidade: number) => {
    gravar(
      ler()
        .map((x) =>
          x.productId === productId ? { ...x, quantidade: Math.max(0, quantidade) } : x,
        )
        .filter((x) => x.quantidade > 0),
    );
  }, []);

  const remover = React.useCallback((productId: string) => {
    gravar(ler().filter((x) => x.productId !== productId));
  }, []);

  const limpar = React.useCallback(() => gravar([]), []);

  const total = itens.reduce((a, i) => a + i.quantidade, 0);

  return { itens, total, adicionar, definirQuantidade, remover, limpar, max: MAX };
}

/**
 * URL da folha de impressão. Vai `id:qtd` em vez de repetir o id conforme a
 * quantidade, para a URL não estourar quando alguém pedir 20 de um item só.
 */
export function urlDaFolha(itens: ItemEtiqueta[]): string {
  const q = itens.map((i) => `${i.productId}:${i.quantidade}`).join(",");
  return `/documento/etiquetas?itens=${encodeURIComponent(q)}`;
}
