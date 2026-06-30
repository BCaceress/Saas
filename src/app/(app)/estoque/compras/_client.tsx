"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  Loader2,
  Send,
  Pencil,
  Ban,
  Truck,
  PackageCheck,
  ShoppingCart,
  ChevronRight,
  CalendarClock,
  Building2,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import {
  criarPedidoCompraAction,
  atualizarPedidoCompraAction,
  enviarPedidoCompraAction,
  marcarAguardandoPedidoAction,
  cancelarPedidoCompraAction,
} from "../actions";

// ── Tipos ─────────────────────────────────────────────────────

type ItemView = {
  productId: string;
  nome: string;
  sku: string;
  packagingNome: string | null;
  qtdPedida: number;
  qtdRecebida: number;
  custoUnitario: number;
};

type PedidoView = {
  id: string;
  numero: string;
  status: string;
  supplierId: string;
  supplierNome: string;
  siteId: string;
  siteNome: string;
  previsaoEntrega: string | null;
  valorTotal: number;
  observacao: string | null;
  financeiroGerado: boolean;
  createdAt: string;
  enviadoEm: string | null;
  totalItems: number;
  items: ItemView[];
};

type Packaging = { id: string; nome: string; fatorConversao: number; isCompraDefault: boolean };
type Product = { id: string; nome: string; sku: string; custoMedio: number | null; supplierIds: string[]; packagings: Packaging[] };
type Supplier = { id: string; razaoSocial: string; nomeFantasia: string | null };
type Site = { id: string; nome: string; tipo: string };
type FormOptions = { suppliers: Supplier[]; sites: Site[]; products: Product[] };

// ── Helpers ───────────────────────────────────────────────────

const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

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

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  RASCUNHO:         { label: "Em elaboração",       cls: "bg-surface-2 text-muted",  dot: "bg-faint" },
  ENVIADO:          { label: "Enviado",             cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  AGUARDANDO:       { label: "Aguardando entrega",  cls: "bg-warn-soft text-warn",   dot: "bg-warn" },
  RECEBIDO_PARCIAL: { label: "Recebido parcial",    cls: "bg-brand-soft text-brand", dot: "bg-brand" },
  RECEBIDO:         { label: "Recebido",            cls: "bg-ok-soft text-ok",       dot: "bg-ok" },
  CANCELADO:        { label: "Cancelado",           cls: "bg-danger-soft text-danger", dot: "bg-danger" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS[status] ?? { label: status, cls: "bg-surface-2 text-muted", dot: "bg-faint" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

const supplierLabel = (s: Supplier) => s.nomeFantasia ?? s.razaoSocial;

// ── Componente principal ──────────────────────────────────────

export function ComprasClient({ pedidos, formOptions }: { pedidos: PedidoView[]; formOptions: FormOptions }) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<string>("todos");
  const [form, setForm] = useState<{ mode: "novo" | "editar"; pedido?: PedidoView } | null>(null);
  const [detalhe, setDetalhe] = useState<PedidoView | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: pedidos.length };
    for (const p of pedidos) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [pedidos]);

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filtro !== "todos" && p.status !== filtro) return false;
      if (termo) {
        const alvo = `${p.numero} ${p.supplierNome} ${p.siteNome}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [pedidos, q, filtro]);

  const pills: { key: string; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "RASCUNHO", label: "Em elaboração" },
    { key: "ENVIADO", label: "Enviados" },
    { key: "AGUARDANDO", label: "Aguardando" },
    { key: "RECEBIDO_PARCIAL", label: "Parciais" },
    { key: "RECEBIDO", label: "Recebidos" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map((p) => {
            const n = p.key === "todos" ? counts.todos : (counts[p.key] ?? 0);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setFiltro(p.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  filtro === p.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                )}
              >
                {p.label}
                <span className={cn("rounded-full px-1.5 py-px text-[10px] tabular-nums", filtro === p.key ? "bg-brand/15 text-brand" : "bg-surface-2 text-faint")}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56 sm:flex-none">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar pedido ou fornecedor"
              className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </div>
          <button
            type="button"
            onClick={() => setForm({ mode: "novo" })}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Novo pedido</span>
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
          <ShoppingCart size={32} className="text-faint" />
          <p className="text-sm font-medium text-muted">
            {q || filtro !== "todos" ? "Nenhum pedido para este filtro." : "Nenhum pedido de compra ainda."}
          </p>
          {!q && filtro === "todos" && (
            <button
              type="button"
              onClick={() => setForm({ mode: "novo" })}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <Plus size={15} /> Criar primeiro pedido
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Tabela (desktop) */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5">Pedido</th>
                  <th className="px-4 py-2.5">Fornecedor</th>
                  <th className="px-4 py-2.5">Destino</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Itens</th>
                  <th className="px-4 py-2.5 text-right">Valor</th>
                  <th className="px-4 py-2.5">Previsão</th>
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtrados.map((p) => (
                  <tr key={p.id} onClick={() => setDetalhe(p)} className="group cursor-pointer transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-mono font-semibold text-ink">{p.numero}</td>
                    <td className="px-4 py-2.5 text-ink">{p.supplierNome}</td>
                    <td className="px-4 py-2.5 text-muted">{p.siteNome}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{p.totalItems}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</td>
                    <td className="px-4 py-2.5 text-muted">{previsaoLabel(p.previsaoEntrega)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <ChevronRight size={16} className="ml-auto text-faint transition-colors group-hover:text-ink" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards (mobile) */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {filtrados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetalhe(p)}
                className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{p.numero}</span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="text-sm text-ink">{p.supplierNome}</p>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{p.totalItems} itens · {p.siteNome}</span>
                  <span className="font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Drawer detalhe */}
      <PedidoDrawer
        pedido={detalhe}
        onClose={() => setDetalhe(null)}
        onEditar={(p) => { setDetalhe(null); setForm({ mode: "editar", pedido: p }); }}
      />

      {/* Form novo/editar */}
      <Sheet
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.mode === "editar" ? `Editar ${form.pedido?.numero}` : "Novo pedido de compra"}
        description="Monte o pedido ao fornecedor. A entrada no estoque só acontece no recebimento."
        width="xl"
      >
        {form && (
          <PedidoForm
            mode={form.mode}
            pedido={form.pedido}
            formOptions={formOptions}
            onDone={() => setForm(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

// ── Drawer de detalhe ─────────────────────────────────────────

function PedidoDrawer({
  pedido,
  onClose,
  onEditar,
}: {
  pedido: PedidoView | null;
  onClose: () => void;
  onEditar: (p: PedidoView) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const p = pedido;

  async function run(label: string, fn: () => Promise<unknown>) {
    setPending(label);
    setErro(null);
    try {
      await fn();
      onClose();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na operação.");
      setPending(null);
    }
  }

  return (
    <Sheet
      open={p !== null}
      onClose={onClose}
      title={p?.numero ?? ""}
      description={p ? `${p.supplierNome} · ${p.siteNome}` : ""}
      width="lg"
    >
      {p && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={p.status} />
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <CalendarClock size={14} /> Previsão: <span className="font-medium text-ink">{previsaoLabel(p.previsaoEntrega)}</span>
            </span>
          </div>

          {/* Itens */}
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Pedido</th>
                  <th className="px-3 py-2 text-right">Custo un.</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.items.map((it) => (
                  <tr key={it.productId}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">{it.nome}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {it.sku}{it.packagingNome ? ` · ${it.packagingNome}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {fmt(it.qtdPedida)}
                      {it.qtdRecebida > 0 && (
                        <span className="block text-[11px] text-ok">recebido {fmt(it.qtdRecebida)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtMoney(it.custoUnitario)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{fmtMoney(it.qtdPedida * it.custoUnitario)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2 font-semibold text-ink">
                  <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-faint" colSpan={3}>Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(p.valorTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {p.observacao && (
            <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-muted">{p.observacao}</p>
          )}

          {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}

          {/* Recebimento hint */}
          {(p.status === "ENVIADO" || p.status === "AGUARDANDO" || p.status === "RECEBIDO_PARCIAL") && (
            <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand-soft/60 px-3 py-2.5 text-xs text-brand">
              <Truck size={14} className="mt-px shrink-0" />
              <span>Quando o caminhão chegar, confira a mercadoria na aba <strong>Recebimentos</strong> para gerar a entrada no estoque.</span>
            </div>
          )}

          {/* Ações por status */}
          <div className="flex flex-wrap gap-2">
            {p.status === "RASCUNHO" && (
              <>
                <button type="button" onClick={() => onEditar(p)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2">
                  <Pencil size={14} className="text-muted" /> Editar
                </button>
                <button type="button" disabled={pending !== null} onClick={() => run("enviar", () => enviarPedidoCompraAction(p.id))} className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50">
                  {pending === "enviar" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar pedido
                </button>
              </>
            )}
            {p.status === "ENVIADO" && (
              <button type="button" disabled={pending !== null} onClick={() => run("aguardando", () => marcarAguardandoPedidoAction(p.id))} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
                {pending === "aguardando" ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} className="text-muted" />} Aguardando entrega
              </button>
            )}
            {p.status !== "RECEBIDO" && p.status !== "CANCELADO" && (
              <button type="button" disabled={pending !== null} onClick={() => run("cancelar", () => cancelarPedidoCompraAction(p.id))} className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-surface px-3.5 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
                {pending === "cancelar" ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Cancelar pedido
              </button>
            )}
            {p.status === "RECEBIDO" && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-ok"><PackageCheck size={15} /> Pedido recebido e lançado no estoque.</span>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ── Form novo/editar pedido ───────────────────────────────────

type Row = { productId: string; packagingId: string | null; qtd: string; custo: string };

function PedidoForm({
  mode,
  pedido,
  formOptions,
  onDone,
}: {
  mode: "novo" | "editar";
  pedido?: PedidoView;
  formOptions: FormOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const { suppliers, sites, products } = formOptions;

  const [supplierId, setSupplierId] = useState(pedido?.supplierId ?? "");
  const [siteId, setSiteId] = useState(pedido?.siteId ?? sites[0]?.id ?? "");
  const [previsao, setPrevisao] = useState(pedido?.previsaoEntrega ? pedido.previsaoEntrega.slice(0, 10) : "");
  const [observacao, setObservacao] = useState(pedido?.observacao ?? "");
  const [rows, setRows] = useState<Row[]>(
    pedido
      ? pedido.items.map((it) => {
          const prod = products.find((p) => p.id === it.productId);
          const pkg = prod?.packagings.find((pk) => pk.nome === it.packagingNome);
          return { productId: it.productId, packagingId: pkg?.id ?? null, qtd: String(it.qtdPedida), custo: String(it.custoUnitario) };
        })
      : [{ productId: "", packagingId: null, qtd: "1", custo: "" }],
  );
  const [pending, setPending] = useState<"rascunho" | "enviar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function onProduto(i: number, productId: string) {
    const prod = products.find((p) => p.id === productId);
    const padrao = prod?.packagings.find((pk) => pk.isCompraDefault) ?? prod?.packagings[0];
    const custoUn = prod?.custoMedio != null && padrao ? prod.custoMedio * padrao.fatorConversao : prod?.custoMedio ?? null;
    setRow(i, {
      productId,
      packagingId: padrao?.id ?? null,
      custo: custoUn != null ? String(Number(custoUn.toFixed(2))) : "",
    });
  }

  function addRow() {
    setRows((rs) => [...rs, { productId: "", packagingId: null, qtd: "1", custo: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  const num = (s: string) => Number(s.replace(",", ".")) || 0;
  const total = rows.reduce((acc, r) => acc + num(r.qtd) * num(r.custo), 0);
  const valido = supplierId && siteId && rows.some((r) => r.productId && num(r.qtd) > 0);

  async function salvar(enviar: boolean) {
    if (!valido) return;
    setPending(enviar ? "enviar" : "rascunho");
    setErro(null);
    const items = rows
      .filter((r) => r.productId && num(r.qtd) > 0)
      .map((r) => ({ productId: r.productId, packagingId: r.packagingId, qtdPedida: num(r.qtd), custoUnitario: num(r.custo) }));
    const payload = { siteId, supplierId, previsaoEntrega: previsao || null, observacao: observacao || null, items };
    try {
      if (mode === "editar" && pedido) {
        await atualizarPedidoCompraAction(pedido.id, payload);
      } else {
        await criarPedidoCompraAction(payload, enviar);
      }
      onDone();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o pedido.");
      setPending(null);
    }
  }

  const selectCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho do pedido */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <span className="flex items-center gap-1"><Building2 size={12} /> Fornecedor</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={selectCls}>
            <option value="">Selecione…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{supplierLabel(s)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <span className="flex items-center gap-1"><Store size={12} /> Destino</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={selectCls}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}{s.tipo === "CD" ? " (CD)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          <span className="flex items-center gap-1"><CalendarClock size={12} /> Previsão de entrega</span>
          <input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={selectCls} />
        </label>
      </div>

      {/* Itens */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Itens do pedido</p>
          <button type="button" onClick={addRow} className="flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-strong">
            <Plus size={14} /> Adicionar
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const prod = products.find((p) => p.id === r.productId);
            return (
              <div key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/40 p-3 sm:flex-row sm:items-end">
                <label className="flex flex-1 flex-col gap-1 text-[11px] font-medium text-muted">
                  Produto
                  <select value={r.productId} onChange={(e) => onProduto(i, e.target.value)} className={selectCls}>
                    <option value="">Selecione…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="flex w-full flex-col gap-1 text-[11px] font-medium text-muted sm:w-32">
                  Embalagem
                  <select
                    value={r.packagingId ?? ""}
                    onChange={(e) => setRow(i, { packagingId: e.target.value || null })}
                    disabled={!prod || prod.packagings.length === 0}
                    className={selectCls}
                  >
                    <option value="">Unidade</option>
                    {prod?.packagings.map((pk) => (
                      <option key={pk.id} value={pk.id}>{pk.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="flex w-full flex-col gap-1 text-[11px] font-medium text-muted sm:w-20">
                  Qtd
                  <input inputMode="decimal" value={r.qtd} onChange={(e) => setRow(i, { qtd: e.target.value })} className={cn(selectCls, "tabular-nums")} />
                </label>
                <label className="flex w-full flex-col gap-1 text-[11px] font-medium text-muted sm:w-28">
                  Custo un.
                  <input inputMode="decimal" value={r.custo} onChange={(e) => setRow(i, { custo: e.target.value })} placeholder="0,00" className={cn(selectCls, "tabular-nums")} />
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  className="grid h-9 w-9 shrink-0 place-items-center self-end rounded-lg border border-line text-faint hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                  aria-label="Remover item"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Observação
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Condições, prazo de pagamento, etc." className={cn(selectCls, "resize-none")} />
      </label>

      {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}

      {/* Footer */}
      <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          Total do pedido: <span className="font-display text-lg font-semibold text-ink tabular-nums">{fmtMoney(total)}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!valido || pending !== null}
            onClick={() => salvar(false)}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {pending === "rascunho" ? <Loader2 size={15} className="animate-spin" /> : <Pencil size={15} className="text-muted" />}
            {mode === "editar" ? "Salvar" : "Salvar rascunho"}
          </button>
          {mode === "novo" && (
            <button
              type="button"
              disabled={!valido || pending !== null}
              onClick={() => salvar(true)}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
            >
              {pending === "enviar" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Enviar pedido
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
