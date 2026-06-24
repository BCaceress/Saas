"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Store,
  HelpCircle,
  PanelLeft,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/app/theme-toggle";

export function Navbar({
  onToggleSidebar,
  sidebarCollapsed,
  tenantNome,
  userNome,
  userEmail,
  userCargo,
  vocabularioPonto,
  multiPonto,
  onSignOut,
}: {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  tenantNome: string;
  userNome: string;
  userEmail: string;
  userCargo: string;
  vocabularioPonto: string;
  multiPonto: boolean;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const iniciais = (userNome || userEmail)
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-1 z-30 flex h-15 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3 shadow-[var(--shadow-float)] sm:px-4">
      {/* Recolher menu */}
      <button
        onClick={onToggleSidebar}
        className="hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink md:grid cursor-pointer"
        aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        aria-pressed={sidebarCollapsed}
      >
        <PanelLeft size={18} />
      </button>

      {/* Seletor de loja (multi) */}
      {multiPonto && (
        <button className="hidden items-center gap-2 rounded-full border border-line px-3.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2 lg:flex">
          <Store size={15} className="text-muted" />
          <span className="font-medium">
            Todas as {vocabularioPonto.toLowerCase()}s
          </span>
          <ChevronDown size={14} className="text-muted" />
        </button>
      )}

      {/* Busca global */}
      <div className="relative hidden flex-1 sm:block">
        <Search
          size={17}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          placeholder="Buscar produto, SKU, código de barras…"
          className="h-11 w-full max-w-lg rounded-full border border-line bg-surface-2 pl-11 pr-4 text-sm text-ink placeholder:text-faint transition-colors focus-visible:border-brand focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Tema claro/escuro */}
        <ThemeToggle />

        {/* Ajuda */}
        <a
          href="mailto:suporte@nohub.market"
          className="hidden h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:grid cursor-pointer"
          aria-label="Ajuda e suporte"
        >
          <HelpCircle size={18} />
        </a>

        {/* Notificações */}
        <button
          className="relative grid h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer"
          aria-label="Notificações"
        >
          <Bell size={18} />
          <span
            className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-brand ring-2 ring-surface"
            aria-hidden
          />
        </button>

        <span className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden />

        {/* Perfil */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-2"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">
              {iniciais}
            </span>
            <span className="hidden min-w-0 text-left lg:block">
              <span className="block truncate text-sm font-semibold leading-tight text-ink">
                {userNome || "Operador"}
              </span>
              <span className="block truncate text-xs leading-tight text-muted">
                {userCargo}
              </span>
            </span>
            <ChevronDown size={15} className="hidden text-muted lg:block" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-2)]"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                  {iniciais}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {userNome || "Operador"}
                  </p>
                  <p className="truncate text-xs text-muted">{userEmail}</p>
                </div>
              </div>
              <div className="border-b border-line px-4 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Store size={12} /> {tenantNome}
                </p>
              </div>
              <div className="p-1.5">
                <Link
                  role="menuitem"
                  href="/configuracoes"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2"
                >
                  <Settings size={15} /> Configurações
                </Link>
                <button
                  role="menuitem"
                  onClick={onSignOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
                >
                  <LogOut size={15} /> Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
