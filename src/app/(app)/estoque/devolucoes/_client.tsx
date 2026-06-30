"use client";

import { useState, useTransition } from "react";
import { Loader2, Undo2, UserCheck, Building2 } from "lucide-react";
import { registrarDevolucaoAction } from "../actions";
import { cn } from "@/lib/utils";

type Site = { id: string; nome: string; tipo: string; ativo: boolean };
type Product = { id: string; nome: string; sku: string; unidadeBase: string; fracionavel: boolean };

export function DevolucaoForm({
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

  const [tipo, setTipo] = useState<"CLIENTE" | "FORNECEDOR">("CLIENTE");
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [qtdFechado, setQtdFechado] = useState(0);
  const [qtdAberto, setQtdAberto] = useState(0);
  const [observacao, setObservacao] = useState("");

  const prod = products.find((p) => p.id === productId);
  const entra = tipo === "CLIENTE";

  function submit() {
    setError(null);
    setSuccess(null);
    if (!productId) { setError("Selecione o produto."); return; }
    if (!observacao.trim()) { setError("Informe o motivo da devolução."); return; }
    if (qtdFechado <= 0 && qtdAberto <= 0) { setError("Informe ao menos uma quantidade."); return; }

    startTransition(async () => {
      try {
        await registrarDevolucaoAction({
          siteId,
          productId,
          tipo,
          deltaFechado: Math.abs(qtdFechado),
          deltaAberto: Math.abs(qtdAberto),
          observacao,
        });
        setSuccess(entra ? "Devolução registrada — estoque aumentado." : "Devolução registrada — estoque reduzido.");
        setProductId("");
        setQtdFechado(0);
        setQtdAberto(0);
        setObservacao("");
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao registrar devolução.");
      }
    });
  }

  const inputCls = "rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

  return (
    <div className="flex flex-col gap-5">
      {/* Tipo de devolução */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { key: "CLIENTE" as const, label: "De cliente", sub: "entra no estoque", icon: UserCheck },
            { key: "FORNECEDOR" as const, label: "Ao fornecedor", sub: "sai do estoque", icon: Building2 },
          ]
        ).map(({ key, label, sub, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTipo(key)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
              tipo === key
                ? key === "CLIENTE" ? "border-ok bg-ok-soft" : "border-danger bg-danger-soft"
                : "border-line hover:bg-surface-2",
            )}
          >
            <span className={cn("flex items-center gap-1.5 text-sm font-semibold", tipo === key ? (key === "CLIENTE" ? "text-ok" : "text-danger") : "text-ink")}>
              <Icon size={14} /> {label}
            </span>
            <span className="text-[11px] text-muted">{sub}</span>
          </button>
        ))}
      </div>

      {/* Site */}
      {sites.length > 1 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputCls}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </label>
      )}

      {/* Produto */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">Produto</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
          <option value="">Selecione...</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.sku})</option>)}
        </select>
      </label>

      {/* Quantidades */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">Qtd fechada</span>
          <input
            type="number"
            min={0}
            step={1}
            value={qtdFechado}
            onChange={(e) => setQtdFechado(Number(e.target.value))}
            className={cn(inputCls, "tabular-nums")}
          />
        </label>
        {prod?.fracionavel && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              Qtd aberta ({prod.unidadeBase.toLowerCase()})
            </span>
            <input
              type="number"
              min={0}
              step={0.001}
              value={qtdAberto}
              onChange={(e) => setQtdAberto(Number(e.target.value))}
              className={cn(inputCls, "tabular-nums")}
            />
          </label>
        )}
      </div>

      {/* Motivo */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">Motivo</span>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder={entra ? "Ex.: cliente desistiu, produto íntegro" : "Ex.: avaria, vencido, troca com fornecedor"}
          className={cn(inputCls, "placeholder:text-faint")}
        />
      </label>

      {error && <p className="rounded-lg bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
      {success && <p className="rounded-lg bg-ok-soft px-4 py-2.5 text-sm text-ok">{success}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={cn(
          "flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors disabled:opacity-60",
          entra ? "bg-ok hover:opacity-90" : "bg-danger hover:opacity-90",
        )}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
        Registrar devolução
      </button>
    </div>
  );
}
