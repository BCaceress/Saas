"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#recursos", label: "Recursos" },
  { href: "#telas", label: "Por dentro" },
  { href: "#planos", label: "Planos" },
  { href: "#faq", label: "Dúvidas" },
];

/**
 * Cabeçalho da landing. Duas coisas o separam do header anterior (só logo +
 * dois botões): navegação âncora — o visitante precisa ver que a página tem
 * conteúdo abaixo — e a borda que só aparece depois que a página rola, para o
 * herói começar sem nenhuma linha cortando o topo.
 */
export function SiteHeader() {
  const [rolou, setRolou] = useState(false);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const onScroll = () => setRolou(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Menu aberto trava a rolagem do fundo — senão o dedo rola a página atrás.
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-200",
        rolou
          ? "border-b border-line bg-canvas/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label="NoHub Market — início" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Seções" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              Entrar
            </Button>
          </Link>
          <Link href="/cadastro">
            <Button size="sm">Testar grátis</Button>
          </Link>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label={aberto ? "Fechar menu" : "Abrir menu"}
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface-2 md:hidden"
          >
            {aberto ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {aberto && (
        <div className="border-t border-line bg-canvas md:hidden">
          <nav aria-label="Seções" className="mx-auto flex max-w-6xl flex-col px-5 py-3">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setAberto(false)}
                className="rounded-[var(--radius)] px-3 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
              <Link href="/login" onClick={() => setAberto(false)} className="flex-1">
                <Button variant="secondary" size="sm" className="w-full">
                  Entrar
                </Button>
              </Link>
              <ThemeToggle />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
