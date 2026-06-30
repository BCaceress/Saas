"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { registrarAjusteAction, registrarPerdaAction } from "../actions";
import { cn } from "@/lib/utils";

type Site = { id: string; nome: string; tipo: string; ativo: boolean };
type Product = { id: string; nome: string; sku: string; unidadeBase: string; fracionavel: boolean };

export function AjustesForm({
  sites,
  defaultSiteId,
  products,
  onDone,
}: {
  sites: Site[];
  defaultSiteId: string | null;
  products: Product[];
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [modo, setModo] = useState<"AJUSTE" | "PERDA">("AJUSTE");
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [deltaFechado, setDeltaFechado] = useState(0);
  const [deltaAberto, setDeltaAberto] = useState(0);
  const [observacao, setObservacao] = useState("");

  const prod = products.find((p) => p.id === productId);

  function submit() {
    setError(null);
    setSuccess(null);
    if (!productId) { setError("Selecione o produto."); return; }
    if (!observacao.trim()) { setError("Informe o motivo."); return; }
    if (deltaFechado === 0 && deltaAberto === 0) { setError("Informe ao menos um delta diferente de zero."); return; }

    startTransition(async () => {
      try {
        if (modo === "AJUSTE") {
          await registrarAjusteAction({ siteId, productId, deltaFechado, deltaAberto, observacao });
        } else {
          await registrarPerdaAction({ siteId, productId, deltaFechado: Math.abs(deltaFechado), deltaAberto: Math.abs(deltaAberto), observacao });
        }
        setSuccess("Lançamento registrado com sucesso.");
        setProductId("");
        setDeltaFechado(0);
        setDeltaAberto(0);
        setObservacao("");
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao registrar.");
      }
    });
  }

  return (
    <div className="flex max-w-lg flex-col gap-5 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      {/* Modo */}
      <div className="flex gap-2">
        {(["AJUSTE", "PERDA"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={cn(
              "flex-1 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
              modo === m
                ? m === "AJUSTE" ? "border-brand bg-brand-soft text-brand" : "border-danger bg-danger-soft text-danger"
                : "border-line text-muted hover:bg-surface-2"
            )}
          >
            {m === "AJUSTE" ? "Ajuste de inventário" : "Perda / Quebra"}
          </button>
        ))}
      </div>

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
        <label className="text-xs font-semibold uppercase tracking-wide text-faint">Produto</label>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="">Selecione...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.sku})</option>)}
        </select>
      </div>

      {/* Deltas */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">
            {modo === "AJUSTE" ? "Delta fechado" : "Fechado"}
          </label>
          <input
            type="number"
            step={0.001}
            value={deltaFechado}
            onChange={(e) => setDeltaFechado(Number(e.target.value))}
            placeholder={modo === "AJUSTE" ? "Ex: -2 ou +5" : "Ex: 2"}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        {prod?.fracionavel && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              {modo === "AJUSTE" ? "Delta aberto" : "Aberto"} ({prod.unidadeBase.toLowerCase()})
            </label>
            <input
              type="number"
              step={0.001}
              value={deltaAberto}
              onChange={(e) => setDeltaAberto(Number(e.target.value))}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        )}
      </div>

      {/* Motivo */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-faint">
          Motivo {modo === "AJUSTE" ? "(contagem física, etc.)" : "(quebra, vencimento, etc.)"}
        </label>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder={modo === "AJUSTE" ? "Contagem física revelou diferença" : "Produto vencido"}
          className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>

      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
      {success && <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-2.5 text-sm text-ok">{success}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={cn(
          "flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60",
          modo === "AJUSTE" ? "bg-brand hover:bg-brand-strong" : "bg-danger hover:bg-red-700"
        )}
      >
        {pending && <Loader2 size={14} className="animate-spin" />}
        {modo === "AJUSTE" ? "Salvar ajuste" : "Registrar perda"}
      </button>
    </div>
  );
}
