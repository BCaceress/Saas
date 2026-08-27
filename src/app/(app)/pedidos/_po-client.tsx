"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Kanban, List, Plus, ShoppingBag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cancelarPedidoCompraAction,
  enviarPedidoCompraAction,
  excluirPedidoCompraAction,
  marcarAguardandoPedidoAction,
} from "../estoque/actions";
import { PedidoDrawer, type PedidoView } from "./_pedidos";
import { PedidoFormSheetLazy, useFormOptions } from "./_form-options";
import { useAbrirNovoPedido } from "./_novo-pedido";
import { PurchaseOrderFilters } from "./_po-filters";
import {
  escondendoConcluidos,
  filtrosAtivos,
  urlDosFiltros,
  PO_FILTROS_VAZIO,
  type PoFiltros,
} from "./_query";
import { PurchaseOrderList, type PoAcoes } from "./_po-list";
import { PurchaseOrderKanban } from "./_po-kanban";
import { PurchaseOrderSummary } from "./_po-summary";
import type { ResumoPedidos } from "../estoque/_data";
import { transicaoDrag } from "../cotacoes/_ui";

// ── Raiz do módulo Pedidos de Compra ───────────────────────────
// Lista e Kanban consomem exatamente os mesmos dados filtrados —
// trocar de visualização muda só a apresentação; filtros, ordenação
// e permissões são preservados. A preferência fica em cookie e a
// página abre no último modo usado.
//
// Esta tela gerencia PEDIDOS e nada mais. Iniciar, continuar ou conferir
// recebimento saiu daqui inteiro: pedido e recebimento são entidades
// separadas, um pedido gera 0..N recebimentos, e a operação toda mora em
// /recebimento. O que sobra aqui é o reflexo — a coluna Recebimento e o
// status derivado dela.

export type PoView = "lista" | "kanban";

export const PO_VIEW_COOKIE = "nohub-compras-view";

export function PurchaseOrdersClient({
  pedidos,
  total,
  porPagina,
  filtros,
  fornecedores,
  resumo,
  empresa,
  initialView,
}: {
  /** Já é a FATIA da página — filtrar e ordenar aconteceu no banco. */
  pedidos: PedidoView[];
  total: number;
  porPagina: number;
  filtros: PoFiltros;
  fornecedores: { id: string; nome: string }[];
  resumo: ResumoPedidos;
  empresa: string;
  initialView: PoView;
}) {
  const router = useRouter();
  const { options, garantir: garantirFormOptions } = useFormOptions();
  const [view, setView] = useState<PoView>(initialView);
  const [navegando, iniciarNavegacao] = useTransition();

  // O recorte mora na URL: o servidor precisa lê-lo para consultar o banco, e
  // de quebra o filtro fica compartilhável e sobrevive ao F5.
  const irPara = (f: PoFiltros) =>
    iniciarNavegacao(() => router.push(`/pedidos${urlDosFiltros(f)}`, { scroll: false }));

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

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
  const abrirNovoPedido = useAbrirNovoPedido();

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
    // O modo decide QUANTO buscar (a lista pagina de 25, o quadro leva um teto
    // alto), então trocar de visualização precisa voltar ao servidor — senão o
    // Kanban desenharia colunas com a fatia de uma página.
    iniciarNavegacao(() => router.refresh());
  }

  // ── Drag-and-drop: regras de negócio ──
  //
  // Só "enviar" e "confirmar" existem. Parcial e Concluído são derivados dos
  // recebimentos — arrastar até eles concluiria um pedido sem ninguém ter
  // contado a mercadoria.
  async function moverPedido(p: PedidoView, para: string) {
    const acao = transicaoDrag(p.status, para);
    if (!acao) {
      mostrarAviso(
        para === "RECEBIDO_PARCIAL" || para === "RECEBIDO"
          ? "Isso depende do recebimento — conclua a conferência em Compras › Recebimentos."
          : "Movimento não permitido — o pedido só avança no fluxo.",
      );
      return;
    }
    if (acao === "enviar" && !window.confirm(`Enviar o pedido ${p.numero} ao fornecedor?`)) return;
    setMovendoId(p.id);
    try {
      if (acao === "enviar") await enviarPedidoCompraAction(p.id);
      else await marcarAguardandoPedidoAction(p.id);
      router.refresh();
    } catch (e) {
      mostrarAviso(e instanceof Error ? e.message : "Falha ao mover o pedido.");
    } finally {
      setMovendoId(null);
    }
  }

  const acoes: PoAcoes = {
    onVer: (p) => {
      setDetalhe(p);
      // Painel de bonificação do drawer precisa do catálogo — busca já.
      garantirFormOptions();
    },
    onEditar: (p) => {
      setEditar(p);
      garantirFormOptions();
    },
    onDuplicar: (p) => {
      setDuplicar(p);
      garantirFormOptions();
    },
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
  const vazio = pedidos.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <PurchaseOrderSummary resumo={resumo} />

      {/* Toolbar: filtros à esquerda, alternador de visualização à direita —
          ambos valem para lista e kanban. */}
      <div className="flex flex-wrap items-center gap-2">
        <PurchaseOrderFilters
          filtros={filtros}
          onChange={irPara}
          fornecedores={fornecedores}
          pendente={navegando}
        />
        <div className="ml-auto hidden shrink-0 items-center rounded-sm border border-line bg-surface p-0.5 md:flex" role="tablist" aria-label="Modo de visualização">
          <ViewBtn ativo={view === "lista"} onClick={() => trocarView("lista")} icon={List} label="Lista" />
          <ViewBtn ativo={view === "kanban"} onClick={() => trocarView("kanban")} icon={Kanban} label="Kanban" />
        </div>
      </div>

      {/* Conteúdo */}
      {vazio ? (
        <EmptyState
          comFiltro={temFiltro}
          escondendoConcluidos={escondendoConcluidos(filtros)}
          onLimpar={() => irPara({ ...PO_FILTROS_VAZIO, status: "", periodo: "" })}
          onCriar={abrirNovoPedido}
        />
      ) : (
        <>
          {/* Mobile: sempre lista vertical */}
          <div className="md:hidden">
            <PurchaseOrderList
              pedidos={pedidos}
              acoes={acoes}
              statusPendingId={statusPendingId}
              pagina={filtros.pagina}
              totalPaginas={totalPaginas}
              onPagina={(pagina) => irPara({ ...filtros, pagina })}
              compacta
            />
          </div>
          {/* Desktop: modo escolhido */}
          <div className="hidden md:block">
            {view === "lista" ? (
              <PurchaseOrderList
                pedidos={pedidos}
                acoes={acoes}
                statusPendingId={statusPendingId}
                pagina={filtros.pagina}
                totalPaginas={totalPaginas}
                onPagina={(pagina) => irPara({ ...filtros, pagina })}
              />
            ) : (
              <PurchaseOrderKanban
                pedidos={pedidos}
                onAbrir={acoes.onVer}
                onMover={moverPedido}
                movendoId={movendoId}
                concluidosOcultos={escondendoConcluidos(filtros)}
              />
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
        products={options?.products ?? []}
        onClose={() => setDetalhe(null)}
        onEditar={(p) => { setDetalhe(null); setEditar(p); }}
        onStatusChanging={setStatusPendingId}
      />

      {editar && (
        <PedidoFormSheetLazy open onClose={() => setEditar(null)} mode="editar" pedido={editar} empresa={empresa} onDone={() => setEditar(null)} />
      )}

      {/* Duplicar = novo pedido pré-carregado com fornecedor/itens do original */}
      {duplicar && (
        <PedidoFormSheetLazy open onClose={() => setDuplicar(null)} mode="novo" pedido={duplicar} empresa={empresa} onDone={() => setDuplicar(null)} />
      )}

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

function EmptyState({
  comFiltro,
  escondendoConcluidos: semConcluidos,
  onLimpar,
  onCriar,
}: {
  comFiltro: boolean;
  escondendoConcluidos: boolean;
  onLimpar: () => void;
  onCriar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-16 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-brand">
        <ShoppingBag size={28} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-semibold text-ink">Nenhum pedido encontrado.</p>
      {comFiltro ? (
        <>
          <p className="max-w-sm text-xs text-muted">
            {semConcluidos
              ? "A tela mostra só os pedidos em aberto. Pedido concluído ou cancelado aparece ao limpar os filtros."
              : "Ajuste os filtros ou limpe a busca para ver todos os pedidos."}
          </p>
          <button
            type="button"
            onClick={onLimpar}
            className="mt-1 flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <X size={14} className="text-muted" />
            {semConcluidos ? "Ver todos os pedidos" : "Limpar filtros"}
          </button>
        </>
      ) : (
        <>
          <p className="max-w-sm text-xs text-muted">
            Crie o pedido ao fornecedor: escolha os produtos, as quantidades e envie.
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
