"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kanban, List, PackageCheck, Plus, ShoppingBag, Truck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import {
  cancelarPedidoCompraAction,
  enviarPedidoCompraAction,
  excluirPedidoCompraAction,
  marcarAguardandoPedidoAction,
  marcarEmTransitoPedidoAction,
} from "../estoque/actions";
import { PedidoDrawer, PedidoFormSheet, type FormOptions, type PedidoView } from "./_pedidos";
import { PedidoReceber, TransferReceber, type Transfer } from "./_recebimentos";
import { aplicarFiltros, filtrosAtivos, PurchaseOrderFilters, PO_FILTROS_VAZIO, type PoFiltros } from "./_po-filters";
import { PurchaseOrderList, type PoAcoes } from "./_po-list";
import { PurchaseOrderKanban } from "./_po-kanban";
import { PurchaseOrderSummary } from "./_po-summary";
import { relDia, transicaoDrag } from "./_ui";

// ── Raiz do módulo Pedidos de Compra ───────────────────────────
// Lista e Kanban consomem exatamente os mesmos dados filtrados —
// trocar de visualização muda só a apresentação; filtros, ordenação
// e permissões são preservados. A preferência fica em cookie e a
// página abre no último modo usado.

export type PoView = "lista" | "kanban";

export const PO_VIEW_COOKIE = "nohub-compras-view";

export function PurchaseOrdersClient({
  pedidos,
  transferencias,
  formOptions,
  empresa,
  initialView,
  initialQuery,
}: {
  pedidos: PedidoView[];
  transferencias: Transfer[];
  formOptions: FormOptions;
  empresa: string;
  initialView: PoView;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<PoView>(initialView);
  const [filtros, setFiltros] = useState<PoFiltros>({ ...PO_FILTROS_VAZIO, q: initialQuery?.trim() ?? "" });

  // Sobreposições
  const [detalhe, setDetalhe] = useState<PedidoView | null>(null);
  // `detalhe` é a foto de quando o drawer abriu — depois de um
  // router.refresh() (ex: bonificação adicionada) a lista `pedidos` vem
  // atualizada mas o state antigo não. Busca a versão viva pelo id, sem
  // fechar o drawer nem perder o pedido se ele sumir da lista filtrada.
  const detalheAtual = useMemo(
    () => (detalhe ? (pedidos.find((p) => p.id === detalhe.id) ?? detalhe) : null),
    [detalhe, pedidos],
  );
  const [editar, setEditar] = useState<PedidoView | null>(null);
  const [duplicar, setDuplicar] = useState<PedidoView | null>(null);
  const [receber, setReceber] = useState<PedidoView | null>(null);
  const [receberTransfer, setReceberTransfer] = useState<Transfer | null>(null);
  const [novo, setNovo] = useState(false);

  // Feedback do drag inválido / ações de status
  const [movendoId, setMovendoId] = useState<string | null>(null);
  // Status sendo alterado a partir do drawer (lista mostra loading na coluna Status).
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function mostrarAviso(msg: string) {
    setAviso(msg);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), 3500);
  }

  function trocarView(v: PoView) {
    setView(v);
    document.cookie = `${PO_VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  }

  const fornecedores = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pedidos) map.set(p.supplierId, p.supplierNome);
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [pedidos]);

  const filtrados = useMemo(() => aplicarFiltros(pedidos, filtros), [pedidos, filtros]);

  // ── Drag-and-drop: regras de negócio ──
  async function moverPedido(p: PedidoView, para: string) {
    const acao = transicaoDrag(p.status, para);
    if (!acao) {
      mostrarAviso("Movimento não permitido — o pedido só avança no fluxo.");
      return;
    }
    if (acao === "receber") {
      // Concluir exige conferência — abre o recebimento em vez de trocar status direto.
      setReceber(p);
      return;
    }
    if (acao === "enviar" && !window.confirm(`Enviar o pedido ${p.numero} ao fornecedor?`)) return;
    setMovendoId(p.id);
    try {
      if (acao === "enviar") await enviarPedidoCompraAction(p.id);
      else if (acao === "confirmar") await marcarAguardandoPedidoAction(p.id);
      else await marcarEmTransitoPedidoAction(p.id);
      router.refresh();
    } catch (e) {
      mostrarAviso(e instanceof Error ? e.message : "Falha ao mover o pedido.");
    } finally {
      setMovendoId(null);
    }
  }

  const acoes: PoAcoes = {
    onVer: setDetalhe,
    onEditar: setEditar,
    onDuplicar: setDuplicar,
    onCancelar: async (p) => {
      if (!window.confirm(`Cancelar o pedido ${p.numero}?`)) return;
      try {
        await cancelarPedidoCompraAction(p.id);
        router.refresh();
      } catch (e) {
        mostrarAviso(e instanceof Error ? e.message : "Falha ao cancelar.");
      }
    },
    onExcluir: async (p) => {
      if (!window.confirm(`Excluir o pedido ${p.numero}? Essa ação não pode ser desfeita.`)) return;
      try {
        await excluirPedidoCompraAction(p.id);
        router.refresh();
      } catch (e) {
        mostrarAviso(e instanceof Error ? e.message : "Falha ao excluir.");
      }
    },
  };

  const temFiltro = filtrosAtivos(filtros);
  const vazio = filtrados.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <PurchaseOrderSummary pedidos={pedidos} />

      {/* Transferências CD→loja aguardando conferência — recebimento também mora aqui */}
      {transferencias.length > 0 && (
        <div className="flex flex-col gap-2">
          {transferencias.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Truck size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">Transferência de {t.origemNome}</p>
                <p className="truncate text-xs text-muted">
                  {t.items.length} {t.items.length === 1 ? "produto" : "produtos"} em trânsito
                  {t.expedidoEm && <> · expedida {relDia(t.expedidoEm)}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceberTransfer(t)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                <PackageCheck size={14} /> Receber
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: alternador + filtros — valem para as duas visualizações */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="hidden items-center rounded-lg border border-line bg-surface p-0.5 md:flex" role="tablist" aria-label="Modo de visualização">
          <ViewBtn ativo={view === "lista"} onClick={() => trocarView("lista")} icon={List} label="Lista" />
          <ViewBtn ativo={view === "kanban"} onClick={() => trocarView("kanban")} icon={Kanban} label="Kanban" />
        </div>
        <PurchaseOrderFilters filtros={filtros} onChange={setFiltros} fornecedores={fornecedores} />
      </div>

      {/* Conteúdo */}
      {vazio ? (
        <EmptyState
          comFiltro={temFiltro}
          onLimpar={() => setFiltros({ ...PO_FILTROS_VAZIO })}
          onCriar={() => setNovo(true)}
        />
      ) : (
        <>
          {/* Mobile: sempre lista vertical */}
          <div className="md:hidden">
            <PurchaseOrderList pedidos={filtrados} acoes={acoes} statusPendingId={statusPendingId} compacta />
          </div>
          {/* Desktop: modo escolhido */}
          <div className="hidden md:block">
            {view === "lista" ? (
              <PurchaseOrderList pedidos={filtrados} acoes={acoes} statusPendingId={statusPendingId} />
            ) : (
              <PurchaseOrderKanban pedidos={filtrados} onAbrir={setDetalhe} onMover={moverPedido} movendoId={movendoId} />
            )}
          </div>
        </>
      )}

      {/* ── Aviso flutuante (drag inválido / erros) ── */}
      {aviso && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <p className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-(--shadow-2)">
            {aviso}
            <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-muted hover:text-ink">
              <X size={13} />
            </button>
          </p>
        </div>
      )}

      {/* ── Sobreposições ── */}
      <PedidoDrawer
        pedido={detalheAtual}
        empresa={empresa}
        products={formOptions.products}
        onClose={() => setDetalhe(null)}
        onEditar={(p) => { setDetalhe(null); setEditar(p); }}
        onReceber={(p) => { setDetalhe(null); setReceber(p); }}
        onStatusChanging={setStatusPendingId}
      />

      {editar && (
        <PedidoFormSheet open onClose={() => setEditar(null)} mode="editar" pedido={editar} formOptions={formOptions} empresa={empresa} onDone={() => setEditar(null)} />
      )}

      {/* Duplicar = novo pedido pré-carregado com fornecedor/itens do original */}
      {duplicar && (
        <PedidoFormSheet open onClose={() => setDuplicar(null)} mode="novo" pedido={duplicar} formOptions={formOptions} empresa={empresa} onDone={() => setDuplicar(null)} />
      )}

      {novo && (
        <PedidoFormSheet open onClose={() => setNovo(false)} mode="novo" formOptions={formOptions} empresa={empresa} onDone={() => setNovo(false)} />
      )}

      <Sheet
        open={receber !== null}
        onClose={() => setReceber(null)}
        title={receber ? `Receber ${receber.numero}` : ""}
        description={receber ? `${receber.supplierNome} · confira o que chegou para gerar a entrada no estoque.` : ""}
        width="2xl"
      >
        {receber && <PedidoReceber pedido={receber} onDone={() => setReceber(null)} />}
      </Sheet>

      <Sheet
        open={receberTransfer !== null}
        onClose={() => setReceberTransfer(null)}
        title="Receber transferência"
        description={receberTransfer ? `De ${receberTransfer.origemNome} — confira as quantidades recebidas.` : ""}
        width="xl"
      >
        {receberTransfer && <TransferReceber transfer={receberTransfer} onDone={() => setReceberTransfer(null)} />}
      </Sheet>
    </div>
  );
}

function ViewBtn({ ativo, onClick, icon: Icon, label }: { ativo: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        ativo ? "bg-brand-soft text-brand" : "text-muted hover:text-ink",
      )}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function EmptyState({ comFiltro, onLimpar, onCriar }: { comFiltro: boolean; onLimpar: () => void; onCriar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-16 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-brand">
        <ShoppingBag size={28} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-semibold text-ink">Nenhum pedido encontrado.</p>
      {comFiltro ? (
        <>
          <p className="max-w-sm text-xs text-muted">Ajuste os filtros ou limpe a busca para ver todos os pedidos.</p>
          <button
            type="button"
            onClick={onLimpar}
            className="mt-1 flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <X size={14} className="text-muted" /> Limpar filtros
          </button>
        </>
      ) : (
        <>
          <p className="max-w-sm text-xs text-muted">
            Crie um pedido manual ou use a Reposição inteligente para gerar pedidos a partir do estoque.
          </p>
          <button
            type="button"
            onClick={onCriar}
            className="mt-1 flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={15} /> Criar primeiro pedido
          </button>
        </>
      )}
    </div>
  );
}
