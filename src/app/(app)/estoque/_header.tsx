"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Store,
  ChevronDown,
  PackagePlus,
  SlidersHorizontal,
  Undo2,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { useState, useTransition, useEffect } from "react";
import {
  setSiteAction,
  fetchAjustesFormDataAction,
  fetchEntradaFormDataAction,
} from "./actions";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { AjustesForm } from "./ajustes/_client";
import { DevolucaoForm } from "./devolucoes/_client";
import { NovaEntradaForm } from "./entradas/nova/_client";

type SiteRow = { id: string; nome: string; tipo: string; ativo: boolean };
type PanelId = "entrada" | "ajuste" | "devolucao" | null;

// ── Lazy panel content ─────────────────────────────────────────

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin text-faint" />
    </div>
  );
}

function EntradaPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  type Data = Awaited<ReturnType<typeof fetchEntradaFormDataAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetchEntradaFormDataAction().then(setData);
  }, []);

  if (!data) return <LoadingPanel />;

  return (
    <NovaEntradaForm
      {...data}
      embedded
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

function AjustePanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  type Data = Awaited<ReturnType<typeof fetchAjustesFormDataAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetchAjustesFormDataAction().then(setData);
  }, []);

  if (!data) return <LoadingPanel />;

  return (
    <AjustesForm
      sites={data.sites}
      defaultSiteId={data.siteId}
      products={data.products}
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

function DevolucaoPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  type Data = Awaited<ReturnType<typeof fetchAjustesFormDataAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetchAjustesFormDataAction().then(setData);
  }, []);

  if (!data) return <LoadingPanel />;

  return (
    <DevolucaoForm
      sites={data.sites}
      defaultSiteId={data.siteId}
      products={data.products}
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

// ── Main header ────────────────────────────────────────────────

const CORE_TABS = [
  { href: "/estoque/saldos", label: "Saldos" },
  { href: "/estoque/compras", label: "Compras" },
  { href: "/estoque/recebimentos", label: "Recebimentos" },
  { href: "/estoque/entradas", label: "Entradas" },
];

const PRODUCAO_TAB = { href: "/estoque/producao", label: "Produção" };
const INVENTARIO_TAB = { href: "/estoque/inventario", label: "Inventário" };

export function EstoqueHeader({
  sites,
  activeSiteId,
  multiSite,
  topologia,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
  topologia: string;
}) {
  const pathname = usePathname();
  const [siteOpen, setSiteOpen] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [pending, startTransition] = useTransition();

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  const distribui = topologia !== "LOCAL";
  const navTabs = [
    ...CORE_TABS,
    ...(distribui
      ? [
          { href: "/estoque/transferencias", label: "Transferências" },
          { href: "/estoque/requisicoes", label: "Requisições" },
        ]
      : []),
    PRODUCAO_TAB,
    INVENTARIO_TAB,
  ];

  function changeSite(id: string) {
    setSiteOpen(false);
    startTransition(async () => {
      await setSiteAction(id);
      window.location.reload();
    });
  }

  function closePanel() {
    setPanel(null);
  }

  return (
    <>
      <div className="flex flex-col gap-0">
        {/* Row 1 — title + actions + site */}
        <div className="flex items-center gap-2.5 pb-3">
          <h1 className="mr-auto text-xl font-semibold text-ink">Estoque</h1>

          {/* Quick action buttons */}
          <button
            type="button"
            onClick={() => setPanel("entrada")}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <PackagePlus size={15} />
            <span className="hidden sm:inline">Entrada</span>
          </button>

          <button
            type="button"
            onClick={() => setPanel("ajuste")}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <SlidersHorizontal size={15} className="text-muted" />
            <span className="hidden sm:inline">Ajustar</span>
          </button>

          <button
            type="button"
            onClick={() => setPanel("devolucao")}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Undo2 size={15} className="text-muted" />
            <span className="hidden sm:inline">Devolução</span>
          </button>

          {/* Site selector */}
          {multiSite && activeSite && (
            <div className="relative ml-1">
              <button
                onClick={() => setSiteOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                disabled={pending}
              >
                <Store size={14} className="text-muted" />
                <span className="max-w-30 truncate">{activeSite.nome}</span>
                <ChevronDown size={13} className="text-muted" />
              </button>
              {siteOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => changeSite(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                        s.id === activeSiteId ? "font-semibold text-brand" : "text-ink",
                      )}
                    >
                      <Store size={13} className="shrink-0 text-muted" />
                      <span className="truncate">{s.nome}</span>
                      <span className="ml-auto text-[10px] text-faint">
                        {s.tipo === "CD" ? "CD" : "Loja"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2 — tab bar */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-line">
          {navTabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-b-2 border-brand text-brand"
                    : "text-muted hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            );
          })}

          {/* Subtle razão link */}
          <Link
            href="/estoque/movimentacoes"
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1 px-3.5 py-2.5 text-xs text-faint transition-colors hover:text-muted",
              pathname === "/estoque/movimentacoes" && "text-muted",
            )}
          >
            Razão
            <ArrowRight size={11} />
          </Link>
        </nav>
      </div>

      {/* ── Sidepanels ── */}
      <Sheet
        open={panel === "entrada"}
        onClose={closePanel}
        title="Registrar entrada"
        description="Lance a compra ou reposição no estoque."
        width="xl"
      >
        {panel === "entrada" && <EntradaPanel onClose={closePanel} />}
      </Sheet>

      <Sheet
        open={panel === "ajuste"}
        onClose={closePanel}
        title="Ajustar estoque"
        description="Corrija saldos por contagem física ou registre quebras."
        width="md"
      >
        {panel === "ajuste" && <AjustePanel onClose={closePanel} />}
      </Sheet>

      <Sheet
        open={panel === "devolucao"}
        onClose={closePanel}
        title="Registrar devolução"
        description="Cliente devolve (entra) ou devolução ao fornecedor (sai)."
        width="md"
      >
        {panel === "devolucao" && <DevolucaoPanel onClose={closePanel} />}
      </Sheet>
    </>
  );
}
