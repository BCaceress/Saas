"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ChevronDown,
  LogOut,
  Store,
  HelpCircle,
  PanelLeft,
  Settings,
  Wine,
  PackageOpen,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { ThemeMenuItem } from "@/components/app/theme-toggle";
import { NotificationBell } from "@/components/app/notification-bell";
import { QuickCreate } from "@/components/app/quick-create";
import { FullscreenToggle } from "@/components/app/fullscreen-toggle";
import { ProductSidePanel, TIPO_LABEL } from "@/components/app/product-side-panel";
import { CaixaSheet, type CaixaInfo } from "@/components/app/caixa-sheet";
import { searchProducts } from "@/app/(app)/produtos/actions";
import { brl } from "@/lib/utils";
import type { ProductRow } from "@/app/(app)/produtos/_types";
import type { PaymentMethod } from "@/generated/prisma";

export function Navbar({
  onToggleSidebar,
  sidebarCollapsed,
  tenantNome,
  userNome,
  userEmail,
  userCargo,
  vocabularioPonto,
  multiPonto,
  caixaInfo,
  metodosCaixa,
  limiteGaveta,
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
  caixaInfo: CaixaInfo | null;
  metodosCaixa: PaymentMethod[];
  limiteGaveta?: number | null;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avisoCaixaOpen, setAvisoCaixaOpen] = useState(false);
  const [caixaSheetOpen, setCaixaSheetOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setSearchOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleQueryChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = value.trim();
    if (term.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchOpen(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      searchProducts(term)
        .then((rows) => {
          setResults(rows);
          setSearchOpen(true);
        })
        .finally(() => setSearching(false));
    }, 300);
  }

  function selectProduct(p: ProductRow) {
    setSelectedProduct(p);
    setSearchOpen(false);
  }

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

      {/* Nome da empresa */}
      <div className="hidden flex-1 items-center sm:flex">
        <span className="truncate text-xl font-semibold text-ink">{tenantNome}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Busca global */}
        <div className="relative hidden sm:block" ref={searchRef}>
          <Search
            size={17}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={q}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => { if (results.length > 0) setSearchOpen(true); }}
            placeholder="Buscar produto, SKU, código de barras…"
            className="h-11 w-80 rounded-full border border-line bg-surface-2 pl-11 pr-4 text-sm text-ink placeholder:text-faint transition-colors focus-visible:border-brand focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:w-104"
          />

          {searchOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-2)] lg:w-96">
              {searching ? (
                <p className="px-4 py-3.5 text-sm text-muted">Buscando…</p>
              ) : results.length === 0 ? (
                <p className="px-4 py-3.5 text-sm text-muted">Nenhum produto encontrado.</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto p-1.5">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => selectProduct(p)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                      >
                        {p.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imagemUrl}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] border border-line object-cover"
                          />
                        ) : (
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
                            {p.tipo === "INSUMO" ? <PackageOpen size={15} /> : <Wine size={15} />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{p.nome}</span>
                          <span className="block truncate text-xs text-muted">
                            {TIPO_LABEL[p.tipo]} · <span className="font-mono">{p.sku}</span>
                            {p.ean && <> · <span className="font-mono">{p.ean}</span></>}
                          </span>
                        </span>
                        {p.precoVenda != null && (
                          <span className="shrink-0 font-mono text-xs font-medium text-ink-2">{brl(p.precoVenda)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Cadastro rápido */}
        <QuickCreate />

        {/* Alertas */}
        <NotificationBell />

        {/* Tela cheia */}
        <FullscreenToggle />

        {/* Ajuda */}
        <a
          href="mailto:suporte@nohub.market"
          className="hidden h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:grid cursor-pointer"
          aria-label="Ajuda e suporte"
          title="Ajuda e suporte"
        >
          <HelpCircle size={18} />
        </a>

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
                <ThemeMenuItem />
                <button
                  role="menuitem"
                  onClick={handleSignOutClick}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
                >
                  <LogOut size={15} /> Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedProduct && (
        <ProductSidePanel
          key={selectedProduct.id}
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onEdit={() => router.push(`/produtos/${selectedProduct.id}/editar`)}
        />
      )}

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
