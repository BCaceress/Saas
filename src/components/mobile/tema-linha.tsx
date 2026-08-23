"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Claro ou escuro, no menu do celular.
 *
 * O `ThemeToggle` do desktop mora na navbar, que o `/m` não tem — a superfície
 * de mão simplesmente não tinha como trocar o tema, e é justamente ela que se
 * usa no escuro do depósito às seis da manhã.
 *
 * A escrita é a MESMA do desktop (atributo no `<html>`, `localStorage` e cookie
 * `theme`), então a preferência atravessa as duas superfícies. O cookie é o que
 * deixa o servidor pintar o tema certo no próximo carregamento, sem flash.
 *
 * Store externo em vez de `useState` + efeito: o tema é estado do documento, e
 * ler num efeito viraria setState em cascata (o lint do projeto barra).
 */

type Tema = "light" | "dark";

const ouvintes = new Set<() => void>();
let atual: Tema | null = null;

function doSistema(): Tema {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ler(): Tema {
  if (atual) return atual;
  const aplicado = document.documentElement.getAttribute("data-theme");
  if (aplicado === "dark" || aplicado === "light") {
    atual = aplicado;
    return atual;
  }
  let salvo: string | null = null;
  try {
    salvo = window.localStorage.getItem("theme");
  } catch {}
  atual = salvo === "dark" || salvo === "light" ? salvo : doSistema();
  return atual;
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

function trocar() {
  const proximo: Tema = ler() === "dark" ? "light" : "dark";
  atual = proximo;
  document.documentElement.setAttribute("data-theme", proximo);
  try {
    window.localStorage.setItem("theme", proximo);
  } catch {}
  document.cookie = `theme=${proximo};path=/;max-age=31536000;samesite=lax`;
  for (const o of ouvintes) o();
}

export function TemaLinha() {
  // No servidor assume claro: o cookie já pintou o `<html>` certo, e a linha só
  // precisa acertar o rótulo depois da hidratação.
  const tema = useSyncExternalStore(inscrever, ler, () => "light" as Tema);
  const escuro = tema === "dark";

  return (
    <button
      type="button"
      onClick={trocar}
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      {escuro ? (
        <Sun className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
      ) : (
        <Moon className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
      )}
      <span className="flex-1 text-sm font-medium text-ink">Aparência</span>
      <span className="shrink-0 text-sm text-muted">{escuro ? "Escuro" : "Claro"}</span>
    </button>
  );
}
