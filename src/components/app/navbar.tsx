"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  ChevronDown,
  LogOut,
  Store,
  HelpCircle,
  PanelLeft,
  Settings,
  AlertTriangle,
  Menu as MenuIcon,
} from "lucide-react";
import Link from "next/link";
import { ThemeMenuItem } from "@/components/app/theme-toggle";
import { NotificationBell } from "@/components/app/notification-bell";
import { QuickCreate } from "@/components/app/quick-create";
import { FullscreenToggle } from "@/components/app/fullscreen-toggle";
import { CaixaSheet, type CaixaInfo } from "@/components/app/caixa-sheet";
import type { PaymentMethod } from "@/generated/prisma";

export function Navbar({
  onToggleSidebar,
  onAbrirMenu,
  onAbrirBusca,
  sidebarCollapsed,
  tenantNome,
  userNome,
  userEmail,
  userCargo,
  podeConfigurar,
  vocabularioPonto,
  multiPonto,
  caixaInfo,
  metodosCaixa,
  limiteGaveta,
  onSignOut,
}: {
  onToggleSidebar: () => void;
  /** Abre o drawer do celular — abaixo de `md` não há sidebar para recolher. */
  onAbrirMenu: () => void;
  onAbrirBusca: () => void;
  sidebarCollapsed: boolean;
  tenantNome: string;
  userNome: string;
  userEmail: string;
  userCargo: string;
  podeConfigurar: boolean;
  vocabularioPonto: string;
  multiPonto: boolean;
  caixaInfo: CaixaInfo | null;
  metodosCaixa: PaymentMethod[];
  limiteGaveta?: number | null;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [avisoCaixaOpen, setAvisoCaixaOpen] = useState(false);
  const [caixaSheetOpen, setCaixaSheetOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleSignOutClick() {
    setMenuOpen(false);
    if (caixaInfo) {
      setAvisoCaixaOpen(true);
      return;
    }
    onSignOut();
  }

  const iniciais = (userNome || userEmail)
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-1 z-30 flex h-15 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3 shadow-[var(--shadow-float)] print:hidden sm:px-4">
      {/* Abrir menu (mobile) — abaixo de `md` a sidebar não existe. */}
      <button
        onClick={onAbrirMenu}
        className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink md:hidden"
        aria-label="Abrir menu"
        aria-haspopup="dialog"
      >
        <MenuIcon size={18} />
      </button>

      {/* Recolher menu (desktop) */}
      <button
        onClick={onToggleSidebar}
        className="hidden h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink md:grid"
        aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
        aria-controls="menu-lateral"
        aria-expanded={!sidebarCollapsed}
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

      {/* Nome da empresa */}
      <div className="hidden flex-1 items-center sm:flex">
        <span className="truncate text-xl font-semibold text-ink">{tenantNome}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Busca — abre a paleta, que acha tela, produto e ação de uma vez. */}
        <button
          onClick={onAbrirBusca}
          aria-label="Buscar tela, produto ou ação"
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:hidden"
        >
          <Search size={18} />
        </button>
        <button
          onClick={onAbrirBusca}
          className="hidden h-11 w-80 cursor-pointer items-center gap-3 rounded-full border border-line bg-surface-2 pl-4 pr-3 text-sm text-faint transition-colors hover:border-line-strong hover:bg-surface focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:flex lg:w-104"
        >
          <Search size={17} className="shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">
            Buscar tela, produto ou ação…
          </span>
          <kbd className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted lg:block">
            Ctrl K
          </kbd>
        </button>

        {/* Cadastro rápido */}
        <QuickCreate empresa={tenantNome} />

        {/* Alertas */}
        <NotificationBell />

        {/* Tela cheia */}
        <FullscreenToggle />

        <span className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden />

        {/* Perfil */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-2"
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
              {/* No celular o nome da empresa não cabe na barra — mora aqui. */}
              <div className="border-b border-line px-4 py-2.5">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Store size={12} /> {tenantNome}
                </p>
              </div>
              <div className="p-1.5">
                {podeConfigurar && (
                  <Link
                    role="menuitem"
                    href="/configuracoes"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    <Settings size={15} /> Configurações
                  </Link>
                )}
                <ThemeMenuItem />
                {/* Ajuda saiu da barra: no celular ela era o primeiro item a sumir. */}
                <a
                  role="menuitem"
                  href="mailto:suporte@nohub.market"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2"
                >
                  <HelpCircle size={15} /> Ajuda e suporte
                </a>
                <button
                  role="menuitem"
                  onClick={handleSignOutClick}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
                >
                  <LogOut size={15} /> Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {avisoCaixaOpen && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setAvisoCaixaOpen(false)}
        >
          <div
            className="flex w-full max-w-sm flex-col gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-2.5 text-sm font-semibold text-ink">
              <AlertTriangle size={17} className="text-danger" /> Caixa aberto
            </span>
            <p className="text-sm text-muted">
              Você tem um caixa aberto. Feche o caixa antes de sair.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAvisoCaixaOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setAvisoCaixaOpen(false);
                  setCaixaSheetOpen(true);
                }}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                Fechar caixa
              </button>
            </div>
          </div>
        </div>
      )}

      <CaixaSheet
        open={caixaSheetOpen}
        onClose={() => setCaixaSheetOpen(false)}
        sites={[]}
        defaultSiteId={null}
        metodos={metodosCaixa}
        caixa={caixaInfo}
        limiteGaveta={limiteGaveta}
      />
    </header>
  );
}
