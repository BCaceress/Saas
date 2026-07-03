"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  PackageCheck,
  Truck,
  Building2,
  CalendarClock,
  FileText,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { receberTransferenciaAction, receberPedidoCompraAction } from "../actions";

// ── Tipos ─────────────────────────────────────────────────────

type PedidoItem = {
  productId: string;
  nome: string;
  sku: string;
  packagingNome: string | null;
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

type TransferItem = { productId: string; nome: string; sku: string; qtdExpedida: number };
type Transfer = {
  id: string;
  origemNome: string;
  destinoNome: string;
  expedidoEm: string | null;
  observacao: string | null;
  items: TransferItem[];
};

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function previsaoLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(d) - dia(hoje);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ── Componente principal ──────────────────────────────────────

export function RecebimentosClient({
  pedidos,
  transferencias,
}: {
  pedidos: Pedido[];
  transferencias: Transfer[];
}) {
  const [aba, setAba] = useState<"fornecedor" | "transferencia">(
    pedidos.length === 0 && transferencias.length > 0 ? "transferencia" : "fornecedor",
  );

  const vazio = pedidos.length === 0 && transferencias.length === 0;

  if (vazio) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <PackageCheck size={28} className="text-faint" />
        <p className="text-sm font-medium text-muted">Nada para receber agora.</p>
        <p className="text-xs text-faint">Pedidos de fornecedor e transferências em trânsito aparecem aqui.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Abas: origem */}
      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {(
          [
            { key: "fornecedor" as const, label: "Fornecedores", icon: Building2, count: pedidos.length },
            { key: "transferencia" as const, label: "Transferências", icon: Truck, count: transferencias.length },
          ]
        ).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setAba(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              aba === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon size={15} />
            {label}
            <span className={cn("rounded-full px-1.5 py-px text-[10px] tabular-nums", aba === key ? "bg-brand/10 text-brand" : "bg-surface text-faint")}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {aba === "fornecedor" ? (
        pedidos.length === 0 ? (
          <SectionEmpty icon={Building2} text="Nenhum pedido de fornecedor para conferir." />
        ) : (
          <div className="flex flex-col gap-3">
            {pedidos.map((p) => <PedidoCard key={p.id} pedido={p} />)}
          </div>
        )
      ) : transferencias.length === 0 ? (
        <SectionEmpty icon={Truck} text="Nenhuma transferência em trânsito." />
      ) : (
        <div className="flex flex-col gap-3">
          {transferencias.map((t) => <TransferCard key={t.id} transfer={t} />)}
        </div>
      )}
    </div>
  );
}

function SectionEmpty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface py-12 text-center">
      <Icon size={26} className="text-faint" />
      <p className="text-sm font-medium text-muted">{text}</p>
    </div>
  );
}

// ── Card de pedido de fornecedor ──────────────────────────────

function PedidoCard({ pedido }: { pedido: Pedido }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [numeroNota, setNumeroNota] = useState("");
  const [gerarFinanceiro, setGerarFinanceiro] = useState(false);
  // productId -> recebido agora (default: restante)
  const [recebido, setRecebido] = useState<Record<string, number>>(() =>
    Object.fromEntries(pedido.items.map((it) => [it.productId, Math.max(0, it.qtdPedida - it.qtdRecebida)])),
  );

  const setQtd = (productId: string, v: number) => setRecebido((p) => ({ ...p, [productId]: Math.max(0, v) }));

  const totalRecebendo = useMemo(
    () => pedido.items.reduce((acc, it) => acc + (recebido[it.productId] ?? 0) * it.custoUnitario, 0),
    [pedido.items, recebido],
  );
  const algumItem = pedido.items.some((it) => (recebido[it.productId] ?? 0) > 0);

  function receber() {
    setError(null);
    const items = pedido.items.map((it) => ({ productId: it.productId, qtdRecebida: recebido[it.productId] ?? 0 }));
    startTransition(async () => {
      try {
        await receberPedidoCompraAction({ pedidoId: pedido.id, numeroNota: numeroNota || null, gerarFinanceiro, items });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  const parcial = pedido.status === "RECEBIDO_PARCIAL";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-brand" />
          <span className="font-mono text-sm font-semibold text-ink">{pedido.numero}</span>
          <span className="text-sm text-muted">· {pedido.supplierNome}</span>
          {parcial && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">parcial</span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock size={13} /> {previsaoLabel(pedido.previsaoEntrega)} · {pedido.siteNome}
        </span>
      </div>

      {/* Itens: pedido × recebido */}
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Pedido</th>
              {parcial && <th className="px-3 py-2 text-right">Já recebido</th>}
              <th className="px-3 py-2 text-right">Recebendo agora</th>
              <th className="px-3 py-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pedido.items.map((it) => {
              const restante = Math.max(0, it.qtdPedida - it.qtdRecebida);
              const ag = recebido[it.productId] ?? 0;
              const dif = ag - restante;
              return (
                <tr key={it.productId}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink">{it.nome}</p>
                    <p className="font-mono text-[11px] text-faint">{it.sku}{it.packagingNome ? ` · ${it.packagingNome}` : ""}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{fmt(it.qtdPedida)}</td>
                  {parcial && <td className="px-3 py-2 text-right tabular-nums text-ok">{fmt(it.qtdRecebida)}</td>}
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={ag}
                      onChange={(e) => setQtd(it.productId, Number(e.target.value))}
                      className={cn(
                        "w-20 rounded-lg border bg-surface px-2 py-1 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                        dif !== 0 ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand",
                      )}
                    />
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", dif > 0 ? "text-ok" : dif < 0 ? "text-warn" : "text-faint")}>
                    {dif > 0 ? "+" : ""}{dif !== 0 ? fmt(dif) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-muted">
          Entrada: <span className="font-semibold text-ink tabular-nums">{fmtMoney(totalRecebendo)}</span>
        </span>
        <button
          type="button"
          onClick={receber}
          disabled={pending || !algumItem}
          className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          Gerar entrada
        </button>
      </div>
    </div>
  );
}

// ── Card de transferência (CD → loja) ─────────────────────────

function TransferCard({ transfer }: { transfer: Transfer }) {
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
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Truck size={16} className="text-brand" />
        <p className="text-sm font-medium text-ink">
          De <span className="text-brand">{transfer.origemNome}</span> · em trânsito
        </p>
      </div>
      {transfer.observacao && <p className="text-xs text-faint">{transfer.observacao}</p>}

      <div className="flex flex-col gap-2">
        {transfer.items.map((it) => {
          const recebida = contagem[it.productId] ?? it.qtdExpedida;
          const divergente = recebida !== it.qtdExpedida;
          return (
            <div key={it.productId} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{it.nome}</p>
                <p className="font-mono text-[11px] text-faint">{it.sku} · expedido {fmt(it.qtdExpedida)}</p>
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
                    divergente ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand",
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {temDivergencia && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
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
