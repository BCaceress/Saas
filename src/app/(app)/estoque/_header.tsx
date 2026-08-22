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
  Loader2,
  ArrowRightLeft,
  ShoppingBag,
  FlaskConical,
  Repeat,
  Undo2,
} from "lucide-react";
import { useState, useTransition, useEffect } from "react";
import {
  setSiteAction,
  fetchEntradaFormDataAction,
  fetchTransferenciaFormDataAction,
  loadComprasFormOptionsAction,
} from "./actions";
import { cn } from "@/lib/utils";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import { EstrategiaChip } from "./_estrategia-chip";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { NovaEntradaForm, MOTIVO_OPTIONS, type Motivo } from "./entradas/nova/_client";
import { TransferenciaForm } from "./transferencias/_client";
import { PedidoFormSheet } from "../pedidos/_pedidos";

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
  BRINDE: Gift,
  AMOSTRA: FlaskConical,
  TROCA: Repeat,
  ESTOQUE_INICIAL: PackageCheck,
};

const ENTRADA_DESC: Record<Motivo, string> = {
  COMPRA_SEM_PEDIDO: "Mercadoria comprada que chegou sem pedido — vira documento e conta a pagar.",
  BONIFICACAO: "Registrar produtos recebidos sem custo.",
  BRINDE: "Cortesia do fornecedor, fora da negociação de compra.",
  AMOSTRA: "Degustação ou teste enviado pelo fornecedor.",
  TROCA: "Reposição do que o fornecedor trocou.",
  ESTOQUE_INICIAL: "Informar os saldos existentes na implantação.",
};

export const ENTRADA_SHEET_META: Record<Motivo, { title: string; description: string }> = {
  COMPRA_SEM_PEDIDO: { title: "Nova entrada manual", description: "Mercadoria comprada que chegou sem pedido no sistema." },
  BONIFICACAO: { title: "Nova bonificação", description: "Registre produtos recebidos sem custo." },
  BRINDE: { title: "Entrada de brinde", description: "Cortesia do fornecedor — entra no saldo sem custo." },
  AMOSTRA: { title: "Entrada de amostra", description: "Degustação ou teste enviado pelo fornecedor." },
  TROCA: { title: "Entrada por troca", description: "Reposição do que o fornecedor trocou." },
  ESTOQUE_INICIAL: { title: "Definir estoque inicial", description: "Informe as quantidades existentes antes de iniciar o controle pelo sistema." },
};

// Duas famílias, e a diferença importa: COMPRA_SEM_PEDIDO é mercadoria que
// alguém vai cobrar (nasce com pedido e título a pagar); brinde, amostra e
// troca entram no saldo sem dívida nenhuma. Estavam no mesmo botão, e era isso
// que fazia cortesia virar custo.
//
// Bonificação avulsa continua fora: nasce vinculada a um pedido (aba Pedidos →
// recebimento/bonificação). Estoque inicial é só da implantação.
type EntradaAcao = { id: EntradaPanelId; label: string; desc: string; icon: React.ElementType };

const acaoDe = (m: { value: Motivo; label: string }): EntradaAcao => ({
  id: `entrada:${m.value}` as EntradaPanelId,
  label: m.label,
  desc: ENTRADA_DESC[m.value],
  icon: ENTRADA_ICON[m.value],
});

const ENTRADA_COMPRA: EntradaAcao[] = MOTIVO_OPTIONS.filter(
  (m) => m.value === "COMPRA_SEM_PEDIDO",
).map(acaoDe);

const ENTRADA_SEM_CUSTO: EntradaAcao[] = MOTIVO_OPTIONS.filter(
  (m) => m.value === "BRINDE" || m.value === "AMOSTRA" || m.value === "TROCA",
).map(acaoDe);


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
  policy,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
  topologia: string;
  empresa: string;
  /** Estratégia de controle da empresa — contexto do chip "Medindo por". */
  policy: EstoquePolicy;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [panel, setPanel] = useState<PanelId>(null);
  const [pending, startTransition] = useTransition();

  // Inventários e Movimentações têm cabeçalho próprio (PageHeader com voltar)
  // — o header geral de Estoque não aparece nessas rotas.
  if (pathname.startsWith("/estoque/inventarios") || pathname.startsWith("/estoque/movimentacoes") || pathname.startsWith("/estoque/validade")) return null;

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
          {/* Opção B — régua ativa como contexto da tela, ao lado da loja.
              Só na lista de saldos: nas outras rotas de Estoque a régua não
              muda nada do que está na tela. */}
          {pathname === "/estoque" && <EstrategiaChip policy={policy} variant="chip" className="mr-1" />}

          {/* Movimentações, Validade e Inventários saíram daqui: viraram itens
              da gaveta "Estoque" no menu lateral. O cabeçalho fica só com o
              que é ação (criar movimentação) e contexto (loja ativa). */}

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
              Compra
            </p>
            {ENTRADA_COMPRA.map((a) => (
              <MenuItem key={a.id} icon={<a.icon size={16} />} onClick={() => setPanel(a.id)}>
                <span className="block text-sm font-medium text-ink">{a.label}</span>
                <span className="block text-xs text-muted">{a.desc}</span>
              </MenuItem>
            ))}
            <MenuItem icon={<ShoppingBag size={16} />} onClick={() => setPanel("pedido")}>
              <span className="block text-sm font-medium text-ink">Pedido de compra</span>
              <span className="block text-xs text-muted">Criar um pedido para um fornecedor.</span>
            </MenuItem>

            <div className="my-1 h-px bg-line" />
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Entrada sem custo
            </p>
            {ENTRADA_SEM_CUSTO.map((a) => (
              <MenuItem key={a.id} icon={<a.icon size={16} />} onClick={() => setPanel(a.id)}>
                <span className="block text-sm font-medium text-ink">{a.label}</span>
                <span className="block text-xs text-muted">{a.desc}</span>
              </MenuItem>
            ))}

            <div className="my-1 h-px bg-line" />
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
              Saída
            </p>
            <MenuItem icon={<Undo2 size={16} />} onClick={() => router.push("/estoque/devolucoes")}>
              <span className="block text-sm font-medium text-ink">Devolver ao fornecedor</span>
              <span className="block text-xs text-muted">
                Mercadoria que volta — abate o que se deve ao fornecedor.
              </span>
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
