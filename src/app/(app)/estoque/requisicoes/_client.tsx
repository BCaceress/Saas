"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2, Send, PackagePlus, X, Clock, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  criarRequisicaoAction,
  expedirRequisicaoAction,
  cancelarRequisicaoAction,
} from "../actions";
import { cn } from "@/lib/utils";

type Site = { id: string; nome: string; tipo: string };
type Product = { id: string; nome: string; sku: string };
type ReqItem = {
  productId: string;
  nome: string;
  sku: string;
  qtdSolicitada: number;
  qtdAtendida: number | null;
  saldoCd: number;
};
type Requisicao = {
  id: string;
  status: string;
  origemSiteId: string;
  origemNome: string;
  destinoSiteId: string;
  destinoNome: string;
  observacao: string | null;
  createdAt: string | Date;
  items: ReqItem[];
};
type NovoItem = { productId: string; qtdSolicitada: number };

export function RequisicoesClient({
  requisicoes,
  sites,
  products,
  activeSiteId,
}: {
  requisicoes: Requisicao[];
  sites: Site[];
  products: Product[];
  activeSiteId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const destinoId = activeSiteId ?? sites[0]?.id ?? "";
  const destinoNome = sites.find((s) => s.id === destinoId)?.nome ?? "";
  const origens = sites.filter((s) => s.id !== destinoId);

  // ── Nova requisição ──
  const [showForm, setShowForm] = useState(false);
  const [origemId, setOrigemId] = useState(origens[0]?.id ?? "");
  const [items, setItems] = useState<NovoItem[]>([{ productId: "", qtdSolicitada: 1 }]);
  const [observacao, setObservacao] = useState("");

  // ── Expedição (CD) — reqId -> { productId -> qtdExpedida } ──
  const [expedicao, setExpedicao] = useState<Record<string, Record<string, number>>>({});

  const aAtender = requisicoes.filter((r) => r.origemSiteId === destinoId && r.status === "ABERTA");
  const minhas = requisicoes.filter((r) => r.destinoSiteId === destinoId);

  function addItem() {
    setItems((p) => [...p, { productId: "", qtdSolicitada: 1 }]);
  }
  function removeItem(idx: number) {
    setItems((p) => p.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, patch: Partial<NovoItem>) {
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function submitNova() {
    setError(null);
    const valid = items.filter((i) => i.productId && i.qtdSolicitada > 0);
    if (!origemId) { setError("Selecione o CD de origem."); return; }
    if (valid.length === 0) { setError("Adicione ao menos um item."); return; }

    startTransition(async () => {
      try {
        await criarRequisicaoAction({
          origemSiteId: origemId,
          destinoSiteId: destinoId,
          observacao: observacao || null,
          items: valid,
        });
        setItems([{ productId: "", qtdSolicitada: 1 }]);
        setObservacao("");
        setShowForm(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao criar requisição.");
      }
    });
  }

  function setExp(reqId: string, productId: string, qtd: number) {
    setExpedicao((p) => ({ ...p, [reqId]: { ...(p[reqId] ?? {}), [productId]: qtd } }));
  }

  function expedir(r: Requisicao) {
    setError(null);
    const mapa = expedicao[r.id] ?? {};
    const itensExpedidos = r.items.map((it) => ({
      productId: it.productId,
      qtdExpedida: mapa[it.productId] ?? it.qtdSolicitada,
    }));
    if (itensExpedidos.every((i) => i.qtdExpedida <= 0)) {
      setError("Informe ao menos uma quantidade a expedir.");
      return;
    }
    startTransition(async () => {
      try {
        await expedirRequisicaoAction({ requisicaoId: r.id, items: itensExpedidos });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao expedir.");
      }
    });
  }

  function cancelar(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await cancelarRequisicaoAction(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cabeçalho + nova */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Requisições</h2>
          <p className="text-sm text-muted">
            {destinoNome ? `Site ativo: ${destinoNome}` : "Selecione um site"} — peça ao CD e
            atenda as requisições recebidas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? "Fechar" : "Nova requisição"}
        </button>
      </div>

      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}

      {/* Form nova requisição */}
      {showForm && (
        <div className="flex max-w-2xl flex-col gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Pedir ao CD</label>
            <select
              value={origemId}
              onChange={(e) => setOrigemId(e.target.value)}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {origens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} ({s.tipo === "CD" ? "CD" : "Loja"})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">Itens</p>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[11px] font-semibold text-faint">Produto</label>
                  <select
                    value={item.productId}
                    onChange={(e) => updateItem(idx, { productId: e.target.value })}
                    className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="">Selecione...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome} ({p.sku})</option>
                    ))}
                  </select>
                </div>
                <div className="flex w-28 flex-col gap-1">
                  <label className="text-[11px] font-semibold text-faint">Qtd (un)</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={item.qtdSolicitada}
                    onChange={(e) => updateItem(idx, { qtdSolicitada: Number(e.target.value) })}
                    className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="mb-0.5 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-danger transition-colors hover:bg-danger-soft disabled:opacity-30"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addItem}
              className="flex cursor-pointer items-center gap-2 self-start rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
            >
              <Plus size={15} /> Adicionar item
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Observação (opcional)</label>
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Reposição semanal"
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitNova}
              disabled={pending}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Enviar requisição
            </button>
          </div>
        </div>
      )}

      {/* A atender (perspectiva do CD ativo) */}
      {aAtender.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <PackagePlus size={16} className="text-brand" />
            A atender ({aAtender.length})
          </h3>
          {aAtender.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink">
                  Para <span className="text-brand">{r.destinoNome}</span>
                </p>
                <button
                  type="button"
                  onClick={() => cancelar(r.id)}
                  disabled={pending}
                  className="cursor-pointer text-xs font-medium text-muted underline hover:text-danger"
                >
                  Cancelar
                </button>
              </div>
              {r.observacao && <p className="text-xs text-faint">{r.observacao}</p>}
              <div className="flex flex-col gap-2">
                {r.items.map((it) => {
                  const atual = expedicao[r.id]?.[it.productId] ?? it.qtdSolicitada;
                  const semSaldo = it.saldoCd < atual;
                  return (
                    <div key={it.productId} className="flex items-center gap-3 rounded-[var(--radius)] bg-surface-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{it.nome}</p>
                        <p className="font-mono text-[11px] text-faint">
                          {it.sku} · pedido {it.qtdSolicitada} · CD tem {it.saldoCd}
                        </p>
                      </div>
                      <div className="flex w-28 flex-col gap-1">
                        <label className="text-[10px] font-semibold text-faint">Expedir</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={atual}
                          onChange={(e) => setExp(r.id, it.productId, Number(e.target.value))}
                          className={cn(
                            "rounded-[var(--radius)] border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                            semSaldo ? "border-danger text-danger" : "border-line text-ink focus-visible:border-brand"
                          )}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => expedir(r)}
                  disabled={pending}
                  className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
                >
                  {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Separar e expedir
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Minhas requisições (perspectiva da loja ativa) */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">Minhas requisições</h3>
        {minhas.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">
            Nenhuma requisição feita por este site ainda.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {minhas.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-5 py-4">
                <StatusBadge status={r.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    Pedido ao <span className="font-medium">{r.origemNome}</span> ·{" "}
                    {r.items.length} {r.items.length === 1 ? "item" : "itens"}
                  </p>
                  <p className="font-mono text-[11px] text-faint">
                    {r.items.map((i) => `${i.nome} ${i.qtdAtendida ?? i.qtdSolicitada}`).join(" · ")}
                  </p>
                </div>
                {r.status === "ABERTA" && (
                  <button
                    type="button"
                    onClick={() => cancelar(r.id)}
                    disabled={pending}
                    className="cursor-pointer text-xs font-medium text-muted underline hover:text-danger"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ATENDIDA") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-semibold text-ok">
        <CheckCircle2 size={12} /> Atendida
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
      <Clock size={12} /> Aberta
    </span>
  );
}
