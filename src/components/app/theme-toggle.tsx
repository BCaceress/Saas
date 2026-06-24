"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const applied = document.documentElement.getAttribute("data-theme");
    const saved =
      applied === "dark" || applied === "light"
        ? applied
        : localStorage.getItem("theme");
    setTheme(saved === "dark" || saved === "light" ? saved : systemTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    // Cookie permite o servidor aplicar o tema no próximo carregamento (sem flash).
    document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer"
      aria-label={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
    >
      {mounted && isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
