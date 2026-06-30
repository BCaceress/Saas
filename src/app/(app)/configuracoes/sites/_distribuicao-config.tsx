"use client";

import { useState, useTransition } from "react";
import { Loader2, Store, Warehouse, ToggleLeft, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { updateTopologiaAction, updateRecebimentoConfigAction } from "../../estoque/actions";
import { cn } from "@/lib/utils";

type Topologia = "LOCAL" | "CD_ABASTECE" | "MISTO";

const OPCOES: { v: Topologia; titulo: string; desc: string; icon: typeof Store }[] = [
  {
    v: "LOCAL",
    titulo: "Estoque local",
    desc: "Cada loja cuida do próprio estoque. Sem transferência entre unidades.",
    icon: Store,
  },
  {
    v: "CD_ABASTECE",
    titulo: "CD abastece",
    desc: "Um centro de distribuição abastece as lojas via requisição.",
    icon: Warehouse,
  },
];

export function DistribuicaoConfig({
  topologiaInicial,
  recebimentoInicial,
}: {
  topologiaInicial: string;
  recebimentoInicial: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [topologia, setTopologia] = useState<Topologia>((topologiaInicial as Topologia) ?? "LOCAL");
  const [recebimento, setRecebimento] = useState(recebimentoInicial);
  const [error, setError] = useState<string | null>(null);

  function escolher(v: Topologia) {
    if (v === topologia || pending) return;
    const anterior = topologia;
    setTopologia(v);
    setError(null);
    startTransition(async () => {
      try {
        await updateTopologiaAction(v);
        router.refresh();
      } catch (e) {
        setTopologia(anterior);
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  function toggleRecebimento() {
    const novo = !recebimento;
    setRecebimento(novo);
    setError(null);
    startTransition(async () => {
      try {
        await updateRecebimentoConfigAction(novo);
        router.refresh();
      } catch (e) {
        setRecebimento(!novo);
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div>
        <p className="font-medium text-ink">Modelo de distribuição</p>
        <p className="text-sm text-muted">Como o estoque circula entre suas unidades.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {OPCOES.map((o) => {
          const Icon = o.icon;
          const ativo = topologia === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => escolher(o.v)}
              disabled={pending}
              className={cn(
                "flex cursor-pointer flex-col gap-1.5 rounded-[var(--radius)] border p-3 text-left transition-colors disabled:opacity-60",
                ativo ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"
              )}
            >
              <Icon size={16} className={ativo ? "text-brand" : "text-muted"} />
              <span className={cn("text-sm font-semibold", ativo ? "text-brand" : "text-ink")}>{o.titulo}</span>
              <span className="text-xs text-muted">{o.desc}</span>
            </button>
          );
        })}
      </div>

      {topologia !== "LOCAL" && (
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Conferência no recebimento</p>
            <p className="text-sm text-muted">
              Ligada: transferências ficam <strong>em trânsito</strong> até a loja contar e confirmar.
              Desligada: a expedição já dá entrada na loja.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleRecebimento}
            disabled={pending}
            className={cn(
              "grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors disabled:opacity-60",
              recebimento ? "text-ok hover:bg-ok-soft" : "text-muted hover:bg-surface-2"
            )}
            title={recebimento ? "Exige contagem (ligado)" : "Auto-confirma (desligado)"}
          >
            {pending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : recebimento ? (
              <ToggleRight size={20} />
            ) : (
              <ToggleLeft size={20} />
            )}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
