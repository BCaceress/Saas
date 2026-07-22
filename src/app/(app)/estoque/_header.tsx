"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Store,
  ChevronDown,
  Plus,
  PackagePlus,
  Gift,
  PackageCheck,
  ClipboardList,
  Loader2,
  ArrowRightLeft,
  History,
  ShoppingBag,
} from "lucide-react";
import { useState, useTransition, useEffect } from "react";
import {
  setSiteAction,
  fetchEntradaFormDataAction,
  fetchTransferenciaFormDataAction,
  loadComprasFormOptionsAction,
} from "./actions";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { NovaEntradaForm, MOTIVO_OPTIONS, type Motivo } from "./entradas/nova/_client";
import { TransferenciaForm } from "./transferencias/_client";
import { PedidoFormSheet } from "../compras/_pedidos";

type SiteRow = { id: string; nome: string; tipo: string; ativo: boolean };
type EntradaPanelId = `entrada:${Motivo}`;
type PanelId = EntradaPanelId | "transferencia" | "pedido" | null;

// ── Lazy panel content ─────────────────────────────────────────

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin text-faint" />
    </div>
  );
}

function EntradaPanel({ motivo, onClose }: { motivo: Motivo; onClose: () => void }) {
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
      motivo={motivo}
      embedded
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

function TransferenciaPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  type Data = Awaited<ReturnType<typeof fetchTransferenciaFormDataAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetchTransferenciaFormDataAction().then(setData);
  }, []);

  if (!data) return <LoadingPanel />;

  return (
    <TransferenciaForm
      {...data}
      embedded
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

// ── Main header ────────────────────────────────────────────────

const CORE_TABS: { href: string; label: string }[] = [];

const ENTRADA_ICON: Record<Motivo, React.ElementType> = {
  COMPRA_SEM_PEDIDO: PackagePlus,
  BONIFICACAO: Gift,
  ESTOQUE_INICIAL: PackageCheck,
};

const ENTRADA_DESC: Record<Motivo, string> = {
  COMPRA_SEM_PEDIDO: "Registrar produtos diretamente no estoque sem um pedido de compra.",
  BONIFICACAO: "Registrar produtos recebidos sem custo.",
  ESTOQUE_INICIAL: "Informar os saldos existentes na implantação.",
};

export const ENTRADA_SHEET_META: Record<Motivo, { title: string; description: string }> = {
  COMPRA_SEM_PEDIDO: { title: "Nova entrada manual", description: "Adicione produtos diretamente ao estoque." },
  BONIFICACAO: { title: "Nova bonificação", description: "Registre produtos recebidos sem custo." },
  ESTOQUE_INICIAL: { title: "Definir estoque inicial", description: "Informe as quantidades existentes antes de iniciar o controle pelo sistema." },
};

// Bonificação de estoque nasce vinculada a um pedido de compra (aba
// Pedidos → recebimento/bonificação) — não faz sentido como entrada avulsa.
// Estoque inicial é opção só da implantação — não aparece no menu do dia a dia.
const ENTRADA_ACOES: { id: EntradaPanelId; label: string; desc: string; icon: React.ElementType }[] =
  MOTIVO_OPTIONS.filter((m) => m.value !== "BONIFICACAO" && m.value !== "ESTOQUE_INICIAL").map((m) => ({
    id: `entrada:${m.value}` as EntradaPanelId,
    label: m.label,
    desc: ENTRADA_DESC[m.value],
    icon: ENTRADA_ICON[m.value],
  }));

function PedidoPanel({ onClose, empresa }: { onClose: () => void; empresa: string }) {
  const router = useRouter();
  type Data = Awaited<ReturnType<typeof loadComprasFormOptionsAction>>;
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    loadComprasFormOptionsAction().then(setData);
  }, []);

  if (!data) {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Novo pedido de compra"
        description="Monte o pedido para o fornecedor."
        width="xl"
      >
        <LoadingPanel />
      </Sheet>
    );
  }

  return (
    <PedidoFormSheet
      open
      onClose={onClose}
      mode="novo"
      formOptions={data}
      empresa={empresa}
      onDone={() => {
        onClose();
        router.refresh();
      }}
    />
  );
}

export function EstoqueHeader({
  sites,
  activeSiteId,
  multiSite,
  topologia,
  empresa,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
  topologia: string;
  empresa: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [panel, setPanel] = useState<PanelId>(null);
  const [pending, startTransition] = useTransition();

  // Inventários e Movimentações têm cabeçalho próprio (PageHeader com voltar)
  // — o header geral de Estoque não aparece nessas rotas.
  if (pathname.startsWith("/estoque/inventarios") || pathname.startsWith("/estoque/movimentacoes")) return null;

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];
  const entradaMotivo = panel?.startsWith("entrada:") ? (panel.split(":")[1] as Motivo) : null;
  const entradaMeta = entradaMotivo ? ENTRADA_SHEET_META[entradaMotivo] : null;

  const distribui = topologia !== "LOCAL";
  const navTabs = [
    ...CORE_TABS,
    ...(distribui
      ? [
          { href: "/estoque/transferencias", label: "Transferências" },
          { href: "/estoque/requisicoes", label: "Requisições" },
        ]
      : []),
  ];

  function changeSite(id: string) {
    startTransition(async () => {
      await setSiteAction(id);
      // refresh() rebusca os RSC sem full reload — preserva filtros na URL.
      router.refresh();
    });
  }

  function closePanel() {
    setPanel(null);
  }

  return (
    <>
      <div className="flex flex-col gap-0">
        {/* Row 1 — cabeçalho padrão + ações + site */}
        <PageHeader
          title="Estoque"
          icon={navIcon("/estoque")}
          description="Acompanhe os saldos, identifique necessidades e gerencie o estoque da loja."
          innerClassName="max-w-none"
          className="pb-3"
          actions={
            <>
          {/* Movimentações — histórico auditável */}
          <Link
            href="/estoque/movimentacoes"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              pathname === "/estoque/movimentacoes"
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-ink hover:bg-surface-2",
            )}
          >
            <History size={15} className="opacity-80" />
            <span>Movimentações</span>
          </Link>

          {/* Inventários — processo separado de contagem */}
          <Link
            href="/estoque/inventarios"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              pathname === "/estoque/inventarios"
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-ink hover:bg-surface-2",
            )}
          >
            <ClipboardList size={15} className="opacity-80" />
            <span>Inventários</span>
          </Link>

          {/* Nova movimentação — menu de ações disponíveis */}
          <Menu
            align="end"
            className="w-80"
            trigger={
              <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                <Plus size={15} />
                <span>Nova movimentação</span>
                <ChevronDown size={13} className="opacity-80" />
              </button>
            }
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Entradas
            </p>
            {ENTRADA_ACOES.map((a) => (
              <MenuItem key={a.id} icon={<a.icon size={16} />} onClick={() => setPanel(a.id)}>
                <span className="block text-sm font-medium text-ink">{a.label}</span>
                <span className="block text-xs text-muted">{a.desc}</span>
              </MenuItem>
            ))}
            <MenuItem icon={<ShoppingBag size={16} />} onClick={() => setPanel("pedido")}>
              <span className="block text-sm font-medium text-ink">Pedido de compra</span>
              <span className="block text-xs text-muted">Criar um pedido para um fornecedor.</span>
            </MenuItem>

            {multiSite && (
              <>
                <div className="my-1 h-px bg-line" />
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Movimentação interna
                </p>
                <MenuItem icon={<ArrowRightLeft size={16} />} onClick={() => setPanel("transferencia")}>
                  <span className="block text-sm font-medium text-ink">Transferência</span>
                  <span className="block text-xs text-muted">Movimentar produtos entre locais.</span>
                </MenuItem>
              </>
            )}
          </Menu>

          {/* Site selector */}
          {multiSite && activeSite && (
            <Menu
              align="end"
              className="w-52"
              trigger={
                <button
                  type="button"
                  disabled={pending}
                  className="ml-1 flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 size={14} className="animate-spin text-muted" />
                  ) : (
                    <Store size={14} className="text-muted" />
                  )}
                  <span className="max-w-30 truncate">{activeSite.nome}</span>
                  <ChevronDown size={13} className="text-muted" />
                </button>
              }
            >
              {sites.map((s) => (
                <MenuItem
                  key={s.id}
                  icon={<Store size={13} />}
                  onClick={() => changeSite(s.id)}
                  trailing={
                    <span className="text-[10px] text-faint">{s.tipo === "CD" ? "CD" : "Loja"}</span>
                  }
                >
                  <span className={cn("block truncate", s.id === activeSiteId && "font-semibold text-brand")}>
                    {s.nome}
                  </span>
                </MenuItem>
              ))}
            </Menu>
          )}
            </>
          }
        />

        {/* Row 2 — tab bar (só aparece quando há navegação secundária) */}
        {navTabs.length > 0 && (
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
          </nav>
        )}
      </div>

      {/* ── Sidepanels ── */}
      <Sheet
        open={panel !== null && panel.startsWith("entrada:")}
        onClose={closePanel}
        title={entradaMeta?.title ?? "Nova movimentação"}
        description={entradaMeta?.description ?? "Lance a movimentação no estoque."}
        width="xl"
      >
        {entradaMotivo && <EntradaPanel motivo={entradaMotivo} onClose={closePanel} />}
      </Sheet>

      <Sheet
        open={panel === "transferencia"}
        onClose={closePanel}
        title="Nova transferência"
        description="Movimente produtos entre locais."
        width="xl"
      >
        {panel === "transferencia" && <TransferenciaPanel onClose={closePanel} />}
      </Sheet>

      {panel === "pedido" && <PedidoPanel onClose={closePanel} empresa={empresa} />}
    </>
  );
}
