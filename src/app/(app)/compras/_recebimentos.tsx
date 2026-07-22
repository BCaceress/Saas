"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCheck,
  FileText,
  Loader2,
  PackageCheck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { receberTransferenciaAction, receberPedidoCompraAction } from "../estoque/actions";
import { fmtMoney, fmtQtd, previsaoLabel, Thumb } from "./_ui";
import { BonusBadge } from "./_bonus";
import type { TipoItemPedido } from "./_types";

// ── Tipos ─────────────────────────────────────────────────────

type PedidoItem = {
  id: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagingNome: string | null;
  tipo: TipoItemPedido;
  qtdPedida: number;
  qtdRecebida: number;
  custoUnitario: number;
};
type Pedido = {
  id: string;
  numero: string;
  status: string;
  supplierNome: string;
  siteNome: string;
  previsaoEntrega: string | null;
  valorTotal: number;
  observacao: string | null;
  items: PedidoItem[];
};

type TransferItem = { productId: string; nome: string; sku: string; imagemUrl: string | null; qtdExpedida: number };
export type Transfer = {
  id: string;
  origemNome: string;
  destinoNome: string;
  expedidoEm: string | null;
  observacao: string | null;
  items: TransferItem[];
};

// ── Conferência de pedido de fornecedor ───────────────────────
// Renderizada dentro de um Sheet: pedido × recebendo agora, diferença
// em destaque, resumo e o botão único "Gerar entrada".

export function PedidoReceber({ pedido, onDone }: { pedido: Pedido; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [numeroNota, setNumeroNota] = useState("");
  const [gerarFinanceiro, setGerarFinanceiro] = useState(false);
  // itemId (linha do pedido, não productId — um produto pode ter linha de
  // compra e linha de bonificação separadas) -> recebido agora.
  const [recebido, setRecebido] = useState<Record<string, number>>(() =>
    Object.fromEntries(pedido.items.map((it) => [it.id, Math.max(0, it.qtdPedida - it.qtdRecebida)])),
  );

  const setQtd = (itemId: string, v: number) => setRecebido((p) => ({ ...p, [itemId]: Math.max(0, v) }));

  const produtos = useMemo(() => pedido.items.filter((it) => it.tipo === "COMPRA"), [pedido.items]);
  const bonificados = useMemo(() => pedido.items.filter((it) => it.tipo !== "COMPRA"), [pedido.items]);

  const resumo = useMemo(() => {
    let completos = 0;
    let faltantes = 0;
    let valorRecebido = 0;
    let valorPendente = 0;
    for (const it of pedido.items) {
      const restante = Math.max(0, it.qtdPedida - it.qtdRecebida);
      const agora = recebido[it.id] ?? 0;
      if (agora >= restante && restante > 0) completos += 1;
      else if (agora < restante) faltantes += 1;
      valorRecebido += agora * it.custoUnitario;
      valorPendente += Math.max(0, restante - agora) * it.custoUnitario;
    }
    return { completos, faltantes, valorRecebido, valorPendente };
  }, [pedido.items, recebido]);

  const algumItem = pedido.items.some((it) => (recebido[it.id] ?? 0) > 0);
  const parcial = pedido.status === "RECEBIDO_PARCIAL";

  function receberTudo() {
    setRecebido(Object.fromEntries(pedido.items.map((it) => [it.id, Math.max(0, it.qtdPedida - it.qtdRecebida)])));
  }

  function receber() {
    setError(null);
    const items = pedido.items.map((it) => ({ itemId: it.id, qtdRecebida: recebido[it.id] ?? 0 }));
    startTransition(async () => {
      try {
        await receberPedidoCompraAction({ pedidoId: pedido.id, numeroNota: numeroNota || null, gerarFinanceiro, items });
        onDone();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Contexto do pedido */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock size={13} /> {previsaoLabel(pedido.previsaoEntrega)} · {pedido.siteNome}
          {parcial && <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand">parcial</span>}
        </span>
        <button
          type="button"
          onClick={receberTudo}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <CheckCheck size={13} className="text-ok" /> Chegou tudo
        </button>
      </div>

      {/* Itens — produtos e bonificações conferidos separadamente, nunca misturados */}
      {produtos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Produtos</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {produtos.map((it) => (
              <ConferenciaRow key={it.id} item={it} agora={recebido[it.id] ?? 0} onChange={(v) => setQtd(it.id, v)} parcial={parcial} />
            ))}
          </ul>
        </div>
      )}

      {bonificados.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Bonificações</p>
          <ul className="divide-y divide-line rounded-xl border border-violet/30 bg-violet-soft/20">
            {bonificados.map((it) => (
              <ConferenciaRow key={it.id} item={it} agora={recebido[it.id] ?? 0} onChange={(v) => setQtd(it.id, v)} parcial={parcial} />
            ))}
          </ul>
        </div>
      )}

      {/* Nota + financeiro */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 items-center gap-2 text-xs font-medium text-muted">
          <FileText size={14} className="shrink-0 text-faint" />
          <input
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value)}
            placeholder="Nº da nota fiscal (opcional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted">
          <input type="checkbox" checked={gerarFinanceiro} onChange={(e) => setGerarFinanceiro(e.target.checked)} className="accent-brand" />
          <Wallet size={13} /> Marcar a pagar
        </label>
      </div>

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {/* Resumo + gerar entrada */}
      <div className="flex flex-col gap-3 rounded-xl bg-surface-2/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="text-muted">
            Completos <span className="font-semibold tabular-nums text-ok">{resumo.completos}</span>
          </span>
          <span className="text-muted">
            Faltando <span className={cn("font-semibold tabular-nums", resumo.faltantes > 0 ? "text-danger" : "text-faint")}>{resumo.faltantes}</span>
          </span>
          <span className="text-muted">
            Recebendo <span className="font-semibold tabular-nums text-ink">{fmtMoney(resumo.valorRecebido)}</span>
          </span>
          {resumo.valorPendente > 0.004 && (
            <span className="text-muted">
              Pendente <span className="font-semibold tabular-nums text-warn">{fmtMoney(resumo.valorPendente)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={receber}
          disabled={pending || !algumItem}
          className="flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />}
          Gerar entrada
        </button>
      </div>
    </div>
  );
}

function ConferenciaRow({
  item: it,
  agora,
  onChange,
  parcial,
}: {
  item: PedidoItem;
  agora: number;
  onChange: (v: number) => void;
  parcial: boolean;
}) {
  const restante = Math.max(0, it.qtdPedida - it.qtdRecebida);
  const dif = agora - restante;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
            {it.nome}
            {it.tipo !== "COMPRA" && <BonusBadge tipo={it.tipo} />}
          </p>
          <p className="truncate font-mono text-[11px] text-faint">
            {it.sku}
            {it.packagingNome ? <span className="font-sans"> · {it.packagingNome}</span> : null}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div className="w-16 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Pedido</p>
          <p className="tabular-nums text-muted">
            {fmtQtd(restante)}
            {parcial && it.qtdRecebida > 0 && <span className="block text-[10px] text-ok">já {fmtQtd(it.qtdRecebida)}</span>}
          </p>
        </div>
        <div className="w-24">
          <p className="text-right text-[10px] font-semibold uppercase tracking-wide text-faint">Recebendo</p>
          <input
            type="number"
            min={0}
            step={1}
            value={agora}
            onChange={(e) => onChange(Number(e.target.value))}
            className={cn(
              "w-full rounded-lg border bg-surface px-2 py-1.5 text-right text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
              dif < 0 ? "border-danger text-danger" : dif > 0 ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand",
            )}
          />
        </div>
        <div className="w-16 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Difer.</p>
          <p className={cn("font-semibold tabular-nums", dif < 0 ? "text-danger" : dif > 0 ? "text-warn" : "text-faint")}>
            {dif === 0 ? "—" : `${dif > 0 ? "+" : ""}${fmtQtd(dif)}`}
          </p>
        </div>
      </div>
    </li>
  );
}

// ── Conferência de transferência (CD → loja) ──────────────────

export function TransferReceber({ transfer, onDone }: { transfer: Transfer; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contagem, setContagem] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.items.map((it) => [it.productId, it.qtdExpedida])),
  );

  const setQtd = (productId: string, qtd: number) => setContagem((p) => ({ ...p, [productId]: Math.max(0, qtd) }));

  const temDivergencia = transfer.items.some((it) => (contagem[it.productId] ?? it.qtdExpedida) !== it.qtdExpedida);

  function receber() {
    setError(null);
    const items = transfer.items.map((it) => ({ productId: it.productId, qtdRecebida: contagem[it.productId] ?? it.qtdExpedida }));
    startTransition(async () => {
      try {
        await receberTransferenciaAction({ transferId: transfer.id, items });
        onDone();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {transfer.observacao && <p className="text-xs text-faint">{transfer.observacao}</p>}

      <div className="flex flex-col gap-2">
        {transfer.items.map((it) => {
          const recebida = contagem[it.productId] ?? it.qtdExpedida;
          const divergente = recebida !== it.qtdExpedida;
          return (
            <div key={it.productId} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
              <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{it.nome}</p>
                <p className="font-mono text-[11px] text-faint">{it.sku} · expedido {fmtQtd(it.qtdExpedida)}</p>
              </div>
              <div className="flex w-28 flex-col gap-1">
                <label className="text-[10px] font-semibold text-faint">Recebido</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={recebida}
                  onChange={(e) => setQtd(it.productId, Number(e.target.value))}
                  className={cn(
                    "rounded-lg border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    divergente ? "border-danger text-danger" : "border-line text-ink focus-visible:border-brand",
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {temDivergencia && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Divergência detectada — a diferença será registrada como perda de trânsito.
        </p>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={receber}
          disabled={pending}
          className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          Confirmar recebimento
        </button>
      </div>
    </div>
  );
}
