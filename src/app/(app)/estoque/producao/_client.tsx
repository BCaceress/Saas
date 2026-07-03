"use client";

import { useState, useTransition } from "react";
import { Loader2, Beaker } from "lucide-react";
import { registrarProducaoAction } from "../actions";
import { cn } from "@/lib/utils";

type Variant = { id: string; nome: string; fatorEscala: unknown; volumeMl: unknown };
type Component = { component: { nome: string; unidadeBase: string }; quantidade: unknown };
type Personalizado = {
  id: string;
  nome: string;
  sku: string;
  variants: Variant[];
  components: Component[];
};
type Site = { id: string; nome: string; tipo: string; ativo: boolean };

export function ProducaoForm({
  sites,
  defaultSiteId,
  personalizados,
  onDone,
}: {
  sites: Site[];
  defaultSiteId: string | null;
  personalizados: Personalizado[];
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [observacao, setObservacao] = useState("");

  const prod = personalizados.find((p) => p.id === productId);

  function submit() {
    setError(null);
    setSuccess(null);
    if (!productId) { setError("Selecione o produto."); return; }
    if (quantidade < 1) { setError("Quantidade deve ser ao menos 1."); return; }

    startTransition(async () => {
      try {
        await registrarProducaoAction({
          siteId,
          productId,
          variantId: variantId || null,
          quantidade,
          observacao: observacao || null,
        });
        setSuccess("Produção registrada. Insumos baixados do estoque.");
        setProductId("");
        setVariantId("");
        setQuantidade(1);
        setObservacao("");
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao registrar.");
      }
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="flex max-w-lg flex-col gap-5 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        {/* Site */}
        {sites.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Site</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {sites.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        )}

        {/* Produto */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Produto personalizado</label>
          {personalizados.length === 0 ? (
            <p className="text-sm text-muted">Nenhum produto personalizado cadastrado.</p>
          ) : (
            <select
              value={productId}
              onChange={(e) => { setProductId(e.target.value); setVariantId(""); }}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <option value="">Selecione...</option>
              {personalizados.map((p) => (
                <option key={p.id} value={p.id}>{p.nome} ({p.sku})</option>
              ))}
            </select>
          )}
        </div>

        {/* Tamanho */}
        {prod && prod.variants.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Tamanho</label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <option value="">Padrão (sem escala)</option>
              {prod.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome} {v.volumeMl ? `(${Number(v.volumeMl)} ml)` : ""} — ×{Number(v.fatorEscala).toFixed(2)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quantidade */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Quantidade produzida</label>
          <input
            type="number"
            min={1}
            step={1}
            value={quantidade}
            onChange={(e) => setQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>

        {/* Observação */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Observação (opcional)</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex: Pré-preparo do evento"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>

        {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
        {success && <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-2.5 text-sm text-ok">{success}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !productId}
          className="flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Beaker size={14} />}
          Registrar produção
        </button>
      </div>

      {/* Ficha técnica preview */}
      {prod && (
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Ficha técnica</p>
          {prod.components.length === 0 ? (
            <p className="text-sm text-muted">Sem componentes cadastrados.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {prod.components.map((c, i) => {
                const fator = variantId ? Number(prod.variants.find((v) => v.id === variantId)?.fatorEscala ?? 1) : 1;
                const dose = Number(c.quantidade) * fator * quantidade;
                return (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <span className="text-ink">{c.component.nome}</span>
                    <span className="font-mono font-semibold text-brand">
                      {dose.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {c.component.unidadeBase.toLowerCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
