"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

/** Alterna claro/escuro. Grava cookie para o servidor pintar o próximo load. */
function TemaBotao({ temaInicial }: { temaInicial: Theme }) {
  // O tema vem resolvido do servidor (cookie) — sem efeito de sincronização e
  // sem o piscar de ícone errado no primeiro paint.
  const [theme, setTheme] = useState<Theme>(temaInicial);

  function alternar() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
  }

  const escuro = theme === "dark";

  return (
    <button
      type="button"
      onClick={alternar}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-full border border-[var(--auth-line-strong)]",
        "bg-[var(--auth-card)]/70 text-[var(--auth-muted)] backdrop-blur-sm",
        "transition-all duration-200 hover:text-[var(--auth-ink)] hover:shadow-[0_6px_18px_-8px_rgba(15,23,42,0.25)]",
      )}
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      title={escuro ? "Tema claro" : "Tema escuro"}
    >
      {escuro ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}

export function AuthTopbar({ temaInicial }: { temaInicial: Theme }) {
  return (
    <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
      <TemaBotao temaInicial={temaInicial} />
    </div>
  );
}
