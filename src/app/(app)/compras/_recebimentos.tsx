"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarClock,
  CheckCheck,
  FileText,
  Loader2,
  PackageCheck,
  Truck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { receberTransferenciaAction, receberPedidoCompraAction } from "../estoque/actions";
import { fmtMoney, fmtQtd, previsaoLabel, Thumb } from "./_ui";

// ── Tipos ─────────────────────────────────────────────────────

type PedidoItem = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
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

type TransferItem = { productId: string; nome: string; sku: string; imagemUrl: string | null; qtdExpedida: number };
type Transfer = {
  id: string;
  origemNome: string;
  destinoNome: string;
  expedidoEm: string | null;
  observacao: string | null;
  items: TransferItem[];
};

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
// Conferência item a item: pedido × recebendo agora, diferença em
// destaque, resumo (completo/faltando, valor recebido/pendente) e o
// botão único "Gerar entrada".

function PedidoCard({ pedido }: { pedido: Pedido }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [numeroNota, setNumeroNota] = useState("");
  const [gerarFinanceiro, setGerarFinanceiro] = useState(false);
  // productId -> recebido agora (default: restante do pedido)
  const [recebido, setRecebido] = useState<Record<string, number>>(() =>
    Object.fromEntries(pedido.items.map((it) => [it.productId, Math.max(0, it.qtdPedida - it.qtdRecebida)])),
  );

  const setQtd = (productId: string, v: number) => setRecebido((p) => ({ ...p, [productId]: Math.max(0, v) }));

  const resumo = useMemo(() => {
    let completos = 0;
    let faltantes = 0;
    let valorRecebido = 0;
    let valorPendente = 0;
    for (const it of pedido.items) {
      const restante = Math.max(0, it.qtdPedida - it.qtdRecebida);
      const agora = recebido[it.productId] ?? 0;
      if (agora >= restante && restante > 0) completos += 1;
      else if (agora < restante) faltantes += 1;
      valorRecebido += agora * it.custoUnitario;
      valorPendente += Math.max(0, restante - agora) * it.custoUnitario;
    }
    return { completos, faltantes, valorRecebido, valorPendente };
  }, [pedido.items, recebido]);

  const algumItem = pedido.items.some((it) => (recebido[it.productId] ?? 0) > 0);
  const parcial = pedido.status === "RECEBIDO_PARCIAL";

  function receberTudo() {
    setRecebido(Object.fromEntries(pedido.items.map((it) => [it.productId, Math.max(0, it.qtdPedida - it.qtdRecebida)])));
  }

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

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/50 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Building2 size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-ink">{pedido.supplierNome}</p>
            <p className="flex items-center gap-2 font-mono text-[11px] text-faint">
              {pedido.numero}
              {parcial && <span className="rounded-full bg-brand-soft px-1.5 py-px font-sans text-[10px] font-semibold text-brand">parcial</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarClock size={13} /> {previsaoLabel(pedido.previsaoEntrega)} · {pedido.siteNome}
          </span>
          <button
            type="button"
            onClick={receberTudo}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <CheckCheck size={13} className="text-ok" /> Chegou tudo
          </button>
        </div>
      </div>

      {/* Itens */}
      <ul className="divide-y divide-line">
        {pedido.items.map((it) => {
          const restante = Math.max(0, it.qtdPedida - it.qtdRecebida);
          const agora = recebido[it.productId] ?? 0;
          const dif = agora - restante;
          return (
            <li key={it.productId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
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
                    onChange={(e) => setQtd(it.productId, Number(e.target.value))}
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
        })}
      </ul>

      {/* Nota + financeiro */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
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

      {error && <p className="mx-4 mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger sm:mx-5">{error}</p>}

      {/* Resumo + gerar entrada */}
      <div className="flex flex-col gap-3 border-t border-line bg-surface-2/50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-(--shadow-1)">
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
