"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  Loader2,
  Send,
  Pencil,
  CircleX,
  Clock3,
  Truck,
  PackageCheck,
  ShoppingCart,
  CalendarClock,
  Building2,
  Store,
  ArrowDownRight,
  ArrowUpRight,
  FilePenLine,
} from "lucide-react";
import { cn, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import {
  criarPedidoCompraAction,
  atualizarPedidoCompraAction,
  enviarPedidoCompraAction,
  marcarAguardandoPedidoAction,
  cancelarPedidoCompraAction,
  excluirPedidoCompraAction,
} from "../estoque/actions";
import { SolicitarSheet, type GrupoEnvio } from "./_solicitar";
import { ReenviarSheet } from "./_reenviar";
import { estadoEntrega, fmtMoney, fmtQtd, previsaoLabel, relDiaHora, Stepper, Thumb, StatusBadge } from "./_ui";

// ── Tipos ─────────────────────────────────────────────────────

type ItemView = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagingNome: string | null;
  qtdPedida: number;
  qtdRecebida: number;
  custoUnitario: number;
};

export type PedidoView = {
  id: string;
  numero: string;
  status: string;
  supplierId: string;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  siteId: string;
  siteNome: string;
  previsaoEntrega: string | null;
  valorTotal: number;
  observacao: string | null;
  financeiroGerado: boolean;
  createdAt: string;
  enviadoEm: string | null;
  recebidoEm: string | null;
  canceladoEm: string | null;
  operador: string | null;
  totalItems: number;
  items: ItemView[];
};

type Packaging = { id: string; nome: string; fatorConversao: number; isCompraDefault: boolean };
type Product = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  custoMedio: number | null;
  supplierIds: string[];
  packagings: Packaging[];
};
type Supplier = { id: string; razaoSocial: string; nomeFantasia: string | null; telefone: string | null; email: string | null };
type Site = { id: string; nome: string; tipo: string };
export type FormOptions = { suppliers: Supplier[]; sites: Site[]; products: Product[] };

const supplierLabel = (s: Supplier) => s.nomeFantasia ?? s.razaoSocial;

// ── Drawer de detalhe ─────────────────────────────────────────
// Edição de rascunho e recebimento são delegados a quem hospeda o
// drawer (inbox) via `onEditar`/`onReceber`.

export function PedidoDrawer({
  pedido,
  empresa,
  onClose,
  onEditar,
  onReceber,
}: {
  pedido: PedidoView | null;
  empresa: string;
  onClose: () => void;
  onEditar?: (p: PedidoView) => void;
  onReceber?: (p: PedidoView) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviar, setReenviar] = useState(false);
  const p = pedido;
  const aberto = p ? ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status) : false;
  const prazo = p && aberto ? estadoEntrega(p.previsaoEntrega) : null;

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
      width="2xl"
    >
      {p && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={p.status} />
            {prazo ? (
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", prazo.cls)}>
                <prazo.icon size={13} /> {prazo.label}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <CalendarClock size={14} /> Previsão: <span className="font-medium text-ink">{previsaoLabel(p.previsaoEntrega)}</span>
              </span>
            )}
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2/60 p-4 sm:grid-cols-4">
            <MiniStat rotulo="Produtos" valor={String(p.totalItems)} />
            <MiniStat rotulo="Unidades" valor={fmtQtd(p.items.reduce((a, it) => a + it.qtdPedida, 0))} />
            <MiniStat rotulo="Criado em" valor={relDiaHora(p.createdAt)} />
            <MiniStat rotulo="Operador" valor={p.operador ?? "—"} />
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
                      <div className="flex items-center gap-2.5">
                        <Thumb url={it.imagemUrl} nome={it.nome} size={32} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{it.nome}</p>
                          <p className="font-mono text-[11px] text-faint">
                            {it.sku}{it.packagingNome ? ` · ${it.packagingNome}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {fmtQtd(it.qtdPedida)}
                      {it.qtdRecebida > 0 && (
                        <span className="block text-[11px] text-ok">recebido {fmtQtd(it.qtdRecebida)}</span>
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
              <span>Quando o caminhão chegar, use <strong>Receber mercadoria</strong> para conferir e gerar a entrada no estoque.</span>
            </div>
          )}

          {/* Ações por status */}
          <div className="flex flex-wrap gap-2">
            {(p.status === "ENVIADO" || p.status === "AGUARDANDO" || p.status === "RECEBIDO_PARCIAL") && onReceber && (
              <button type="button" onClick={() => onReceber(p)} className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong">
                <PackageCheck size={14} /> Receber mercadoria
              </button>
            )}
            {p.status === "RASCUNHO" && (
              <>
                {onEditar && (
                  <button type="button" onClick={() => onEditar(p)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2">
                    <Pencil size={14} className="text-muted" /> Editar
                  </button>
                )}
                <button type="button" disabled={pending !== null} onClick={() => run("enviar", () => enviarPedidoCompraAction(p.id))} className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50">
                  {pending === "enviar" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar pedido
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    if (window.confirm(`Excluir o pedido ${p.numero}? Essa ação não pode ser desfeita.`)) {
                      run("excluir", () => excluirPedidoCompraAction(p.id));
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-surface px-3.5 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  {pending === "excluir" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Excluir
                </button>
              </>
            )}
            {p.status === "ENVIADO" && (
              <>
                <button type="button" disabled={pending !== null} onClick={() => run("aguardando", () => marcarAguardandoPedidoAction(p.id))} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
                  {pending === "aguardando" ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} className="text-muted" />} Marcar como confirmado
                </button>
                <button type="button" onClick={() => setReenviar(true)} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2">
                  <Send size={14} className="text-muted" /> Reenviar / compartilhar
                </button>
              </>
            )}
            {p.status !== "RECEBIDO" && p.status !== "CANCELADO" && (
              <button type="button" disabled={pending !== null} onClick={() => run("cancelar", () => cancelarPedidoCompraAction(p.id))} className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-surface px-3.5 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
                {pending === "cancelar" ? <Loader2 size={14} className="animate-spin" /> : <CircleX size={14} />} Cancelar pedido
              </button>
            )}
            {p.status === "RECEBIDO" && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-ok"><PackageCheck size={15} /> Pedido recebido e lançado no estoque.</span>
            )}
          </div>

          {/* Histórico do pedido — timeline completa fica só no detalhe */}
          <div className="flex flex-col gap-1 border-t border-line pt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Histórico do pedido</p>
            <TimelineEvento icon={FilePenLine} titulo="Pedido criado" quando={p.createdAt} />
            {p.enviadoEm && <TimelineEvento icon={Send} titulo="Pedido enviado" quando={p.enviadoEm} />}
            {p.recebidoEm && <TimelineEvento icon={PackageCheck} titulo="Pedido recebido" quando={p.recebidoEm} />}
            {p.canceladoEm && <TimelineEvento icon={CircleX} titulo="Pedido cancelado" quando={p.canceladoEm} tom="danger" />}
          </div>
        </div>
      )}

      {p && reenviar && (
        <ReenviarSheet
          pedido={{
            numero: p.numero,
            supplierId: p.supplierId,
            supplierNome: p.supplierNome,
            supplierTelefone: p.supplierTelefone,
            supplierEmail: p.supplierEmail,
            previsaoEntrega: p.previsaoEntrega,
            observacao: p.observacao,
            items: p.items.map((it) => ({
              productId: it.productId,
              nome: it.nome,
              packagingNome: it.packagingNome,
              qtdPedida: it.qtdPedida,
              custoUnitario: it.custoUnitario,
            })),
          }}
          empresa={empresa}
          onClose={() => setReenviar(false)}
        />
      )}
    </Sheet>
  );
}

// ── Sheet de novo/editar pedido — fluxo de seleção ────────────
// Sem formulário grande: busca instantânea, toque para adicionar,
// stepper de quantidade e custo pré-preenchido pelo histórico. O
// próprio Sheet hospeda o form: topo (fornecedor/destino/busca) fica
// fixo, só a lista de itens rola, e o rodapé (observação/total/ações)
// fica sempre visível. "Enviar pedido" abre a escolha de canal — a
// criação do pedido só acontece depois de confirmado o canal.

type CartItem = {
  productId: string;
  packagingId: string | null;
  qtd: number;
  custo: string; // editável — mantém como string p/ digitação com vírgula
};

export function PedidoFormSheet({
  open,
  onClose,
  mode,
  pedido,
  formOptions,
  empresa,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  mode: "novo" | "editar";
  pedido?: PedidoView;
  formOptions: FormOptions;
  /** Nome do tenant — assina a mensagem ao fornecedor na escolha de canal. */
  empresa: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const { suppliers, sites, products } = formOptions;
  const buscaRef = useRef<HTMLInputElement>(null);

  const [supplierId, setSupplierId] = useState(pedido?.supplierId ?? "");
  const [siteId, setSiteId] = useState(pedido?.siteId ?? sites[0]?.id ?? "");
  const [previsao, setPrevisao] = useState(pedido?.previsaoEntrega ? pedido.previsaoEntrega.slice(0, 10) : "");
  const [observacao, setObservacao] = useState(pedido?.observacao ?? "");
  const [busca, setBusca] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [cart, setCart] = useState<CartItem[]>(
    pedido
      ? pedido.items.map((it) => {
          const prod = products.find((p) => p.id === it.productId);
          const pkg = prod?.packagings.find((pk) => pk.nome === it.packagingNome);
          return { productId: it.productId, packagingId: pkg?.id ?? null, qtd: it.qtdPedida, custo: moneyToMask(it.custoUnitario) };
        })
      : [],
  );
  const [pending, setPending] = useState<"rascunho" | "enviar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Escolha de canal (WhatsApp/e-mail/PDF/salvar) antes de criar+enviar o pedido novo.
  const [solicitar, setSolicitar] = useState<GrupoEnvio[] | null>(null);
  const [concluido, setConcluido] = useState(false);

  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const noCart = useMemo(() => new Set(cart.map((c) => c.productId)), [cart]);

  // Busca instantânea — produtos do fornecedor selecionado primeiro.
  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    const acha = products.filter((p) => `${p.nome} ${p.sku}`.toLowerCase().includes(termo));
    if (!supplierId) return acha.slice(0, 8);
    return [
      ...acha.filter((p) => p.supplierIds.includes(supplierId)),
      ...acha.filter((p) => !p.supplierIds.includes(supplierId)),
    ].slice(0, 8);
  }, [busca, products, supplierId]);

  function custoSugerido(prod: Product, pkg: Packaging | null): string {
    if (prod.custoMedio == null) return "";
    const v = pkg ? prod.custoMedio * pkg.fatorConversao : prod.custoMedio;
    return moneyToMask(v);
  }

  function addProduto(prod: Product | undefined) {
    if (!prod) return;
    if (noCart.has(prod.id)) {
      setBusca("");
      setHighlighted(0);
      return;
    }
    const pkg = prod.packagings.find((pk) => pk.isCompraDefault) ?? prod.packagings[0] ?? null;
    setCart((c) => [...c, { productId: prod.id, packagingId: pkg?.id ?? null, qtd: 1, custo: custoSugerido(prod, pkg) }]);
    // Auto-seleciona o fornecedor quando o primeiro produto só tem um.
    if (!supplierId && prod.supplierIds.length === 1) setSupplierId(prod.supplierIds[0]);
    setBusca("");
    setHighlighted(0);
    buscaRef.current?.focus();
  }

  function setItem(productId: string, patch: Partial<CartItem>) {
    setCart((c) => c.map((it) => (it.productId === productId ? { ...it, ...patch } : it)));
  }

  function removeItem(productId: string) {
    setCart((c) => c.filter((it) => it.productId !== productId));
  }

  const num = (s: string) => parseMoney(s) ?? 0;
  const total = cart.reduce((acc, it) => acc + it.qtd * num(it.custo), 0);
  const valido = supplierId && siteId && cart.some((it) => it.qtd > 0);

  async function salvarRascunho() {
    if (!valido) return;
    setPending("rascunho");
    setErro(null);
    const items = cart
      .filter((it) => it.qtd > 0)
      .map((it) => ({ productId: it.productId, packagingId: it.packagingId, qtdPedida: it.qtd, custoUnitario: num(it.custo) }));
    const payload = { siteId, supplierId, previsaoEntrega: previsao || null, observacao: observacao || null, items };
    try {
      if (mode === "editar" && pedido) {
        await atualizarPedidoCompraAction(pedido.id, payload);
      } else {
        await criarPedidoCompraAction(payload, false);
      }
      onDone();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o pedido.");
      setPending(null);
    }
  }

  // "Enviar pedido" não cria nada direto: monta o grupo (1 fornecedor)
  // e abre a mesma escolha de canal da Reposição — a criação acontece
  // só depois de confirmado o canal (ou "salvar para depois").
  function abrirEnvio() {
    if (!valido) return;
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) return;
    const itens = cart
      .filter((it) => it.qtd > 0)
      .map((it) => {
        const prod = prodMap.get(it.productId);
        const pkg = prod?.packagings.find((pk) => pk.id === it.packagingId) ?? null;
        return {
          productId: it.productId,
          packagingId: it.packagingId,
          nome: prod?.nome ?? "",
          qtd: it.qtd,
          packagingNome: pkg?.nome ?? null,
          fatorConversao: pkg ? pkg.fatorConversao : 1,
          custoUnitCompra: num(it.custo),
        };
      });
    if (itens.length === 0) return;
    setErro(null);
    setSolicitar([
      {
        supplierId: supplier.id,
        supplierNome: supplierLabel(supplier),
        telefone: supplier.telefone,
        email: supplier.email,
        leadTimeDias: null,
        previsaoEntrega: previsao || null,
        observacao: observacao || null,
        itens,
      },
    ]);
  }

  function fecharSolicitar() {
    setSolicitar(null);
    if (concluido) {
      onDone();
      router.refresh();
    }
  }

  const selectCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "editar" ? `Editar ${pedido?.numero}` : "Novo pedido de compra"}
      description="Busque, toque para adicionar e ajuste a quantidade. A entrada no estoque acontece no recebimento."
      width="2xl"
      footer={
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Observação
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={1} placeholder="Condições, prazo de pagamento, etc." className={cn(selectCls, "resize-none")} />
          </label>

          {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              Total do pedido: <span className="font-display text-lg font-semibold text-ink tabular-nums">{fmtMoney(total)}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!valido || pending !== null}
                onClick={salvarRascunho}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {pending === "rascunho" ? <Loader2 size={15} className="animate-spin" /> : <Pencil size={15} className="text-muted" />}
                {mode === "editar" ? "Salvar" : "Salvar rascunho"}
              </button>
              {mode === "novo" && (
                <button
                  type="button"
                  disabled={!valido || pending !== null}
                  onClick={abrirEnvio}
                  className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
                >
                  <Send size={15} />
                  Enviar pedido
                </button>
              )}
            </div>
          </div>
        </div>
      }
    >
      {/* Cabeçalho do pedido + busca — fixo no topo da área de rolagem */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex flex-col gap-3 border-b border-line bg-surface px-5 pt-4 pb-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

        {/* Busca instantânea — setas navegam, Enter escolhe o item destacado */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-3 text-faint" />
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (resultados.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, resultados.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                addProduto(resultados[highlighted] ?? resultados[0]);
              }
            }}
            placeholder="Buscar produto por nome ou SKU… (setas + Enter escolhem)"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
          {resultados.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
              {resultados.map((p, i) => {
                const ja = noCart.has(p.id);
                const doFornecedor = supplierId && p.supplierIds.includes(supplierId);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduto(p)}
                      onMouseEnter={() => setHighlighted(i)}
                      disabled={ja}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50",
                        i === highlighted && !ja && "bg-brand-soft/50",
                      )}
                    >
                      <Thumb url={p.imagemUrl} nome={p.nome} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
                        <p className="font-mono text-[11px] text-faint">{p.sku}</p>
                      </div>
                      {ja ? (
                        <span className="shrink-0 text-[11px] font-medium text-ok">no pedido</span>
                      ) : doFornecedor ? (
                        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">deste fornecedor</span>
                      ) : (
                        <Plus size={15} className="shrink-0 text-faint" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Itens do pedido — única área que rola */}
      <div className="pt-3">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
            <ShoppingCart size={24} className="text-faint" />
            <p className="text-sm text-muted">Busque um produto acima para começar o pedido.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {cart.map((it) => {
              const prod = prodMap.get(it.productId);
              if (!prod) return null;
              const pkg = prod.packagings.find((pk) => pk.id === it.packagingId) ?? null;
              const custoAtual = prod.custoMedio != null ? (pkg ? prod.custoMedio * pkg.fatorConversao : prod.custoMedio) : null;
              const custoNum = num(it.custo);
              const difPct = custoAtual && custoAtual > 0 && custoNum > 0 ? ((custoNum - custoAtual) / custoAtual) * 100 : null;
              return (
                <li key={it.productId} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2/40 p-3">
                  <div className="flex items-center gap-3">
                    <Thumb url={prod.imagemUrl} nome={prod.nome} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{prod.nome}</p>
                      <p className="font-mono text-[11px] text-faint">{prod.sku}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(it.productId)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-faint hover:bg-danger-soft hover:text-danger"
                      aria-label={`Remover ${prod.nome}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {prod.packagings.length > 0 && (
                      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
                        Embalagem
                        <select
                          value={it.packagingId ?? ""}
                          onChange={(e) => {
                            const novoPkg = prod.packagings.find((pk) => pk.id === e.target.value) ?? null;
                            setItem(it.productId, { packagingId: e.target.value || null, custo: custoSugerido(prod, novoPkg) });
                          }}
                          className={cn(selectCls, "w-36 py-1.5")}
                        >
                          <option value="">Unidade</option>
                          {prod.packagings.map((pk) => (
                            <option key={pk.id} value={pk.id}>{pk.nome} ×{fmtQtd(pk.fatorConversao)}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="flex flex-col gap-1 text-[11px] font-medium text-muted">
                      Quantidade
                      <Stepper value={it.qtd} onChange={(v) => setItem(it.productId, { qtd: v })} min={0} />
                    </div>
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
                      Custo un.
                      <input
                        inputMode="numeric"
                        value={it.custo}
                        onChange={(e) => setItem(it.productId, { custo: maskMoney(e.target.value) })}
                        placeholder="0,00"
                        className={cn(selectCls, "w-24 py-1.5 tabular-nums")}
                      />
                    </label>
                    <div className="ml-auto flex flex-col items-end gap-0.5 text-right">
                      {custoAtual != null && difPct != null && Math.abs(difPct) >= 0.5 && (
                        <span className={cn("flex items-center gap-0.5 text-[11px] font-medium tabular-nums", difPct > 0 ? "text-danger" : "text-ok")}>
                          {difPct > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                          {difPct > 0 ? "+" : ""}{difPct.toFixed(0)}% vs custo atual ({fmtMoney(custoAtual)})
                        </span>
                      )}
                      <span className="text-sm font-semibold tabular-nums text-ink">{fmtMoney(it.qtd * custoNum)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Escolha de canal — só ao "Enviar pedido" (mode novo) */}
      {solicitar && (
        <SolicitarSheet
          grupos={solicitar}
          empresa={empresa}
          siteId={siteId}
          onClose={fecharSolicitar}
          onConcluido={() => setConcluido(true)}
        />
      )}
    </Sheet>
  );
}

function MiniStat({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{rotulo}</p>
      <p className="truncate text-sm font-semibold text-ink">{valor}</p>
    </div>
  );
}

function TimelineEvento({
  icon: Icon,
  titulo,
  quando,
  tom,
}: {
  icon: React.ElementType;
  titulo: string;
  quando: string;
  tom?: "danger";
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-sm">
      <Icon size={14} className={cn("shrink-0", tom === "danger" ? "text-danger" : "text-muted")} />
      <span className="text-ink-2">{titulo}</span>
      <span className="text-faint">· {relDiaHora(quando)}</span>
    </div>
  );
}
