"use client";

// Histórico recente do PDV — reimprimir cupom e estornar vendas do balcão.
// Espelha a lista de concluídas do totem, mas para as vendas do operador.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Printer, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { pollVendasPdvAction, cancelarVendaAction, type VendaPdvRecente } from "./actions";
import { imprimirCupom } from "./_nota-fiscal";
import { brl } from "./_shared";

const METODO_LABEL: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO_CREDITO: "Crédito",
  CARTAO_DEBITO: "Débito",
  OUTRO: "Outro",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function HistoricoVendasModal({
  siteId,
  onClose,
  onEstornado,
}: {
  siteId: string;
  onClose: () => void;
  /** Avisa o PDV para atualizar a fila/contadores após um estorno. */
  onEstornado?: () => void;
}) {
  const [vendas, setVendas] = useState<VendaPdvRecente[] | null>(null);
  const [estornando, setEstornando] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const carregar = useCallback(async () => {
    try {
      setVendas(await pollVendasPdvAction(siteId));
    } catch {
      // rede instável — mantém o que já tinha
    }
  }, [siteId]);

  useEffect(() => {
    // via timeout: o efeito só agenda, sem setState síncrono (cascading render).
    const t = window.setTimeout(carregar, 0);
    return () => window.clearTimeout(t);
  }, [carregar]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose, pending]);

  async function estornar(id: string) {
    setPending(true);
    try {
      const r = await cancelarVendaAction(id);
      setEstornando(null);
      const pend = r?.pendenciasEstorno ?? [];
      if (pend.length > 0) {
        toast.error(
          "Venda estornada, mas há devolução pendente",
          `${pend.join(" · ")} Resolva no painel do provedor.`,
        );
      } else {
        toast.success("Venda estornada", "Estoque e pagamento devolvidos.");
      }
      onEstornado?.();
      await carregar();
    } catch (e) {
      toast.error("Erro ao estornar", e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Últimas vendas"
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
    >
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)] sm:w-[36rem]">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Balcão
            </p>
            <h2 className="font-display text-lg font-bold text-ink">Últimas vendas</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-3">
          {vendas === null ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : vendas.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">
              Nenhuma venda de balcão na última meia hora.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {vendas.map((v) =>
                estornando === v.id ? (
                  <div key={v.id} className="flex items-center gap-2 py-2.5">
                    <span className="flex-1 text-sm text-danger">
                      Estornar {v.numero} · {brl(v.total)}? Devolve estoque e dinheiro.
                    </span>
                    <button
                      type="button"
                      onClick={() => estornar(v.id)}
                      disabled={pending}
                      className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-danger px-3 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
                    >
                      {pending ? <Loader2 size={12} className="animate-spin" /> : null}
                      Estornar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEstornando(null)}
                      disabled={pending}
                      className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <div key={v.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        <span className="font-mono">{v.numero}</span>
                        {v.status === "CANCELADA" && (
                          <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                            Estornada
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {v.metodo ? (METODO_LABEL[v.metodo] ?? v.metodo) : "—"} · {hora(v.pagaEm)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm font-semibold tabular-nums",
                        v.status === "CANCELADA" ? "text-faint line-through" : "text-ink",
                      )}
                    >
                      {brl(v.total)}
                    </span>
                    {v.temCupom && (
                      <button
                        type="button"
                        onClick={() => imprimirCupom(v.id, iframeRef.current)}
                        aria-label="Reimprimir cupom"
                        title="Reimprimir cupom"
                        className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-brand"
                      >
                        <Printer size={16} />
                      </button>
                    )}
                    {v.status === "PAGA" && (
                      <button
                        type="button"
                        onClick={() => setEstornando(v.id)}
                        aria-label="Estornar venda"
                        title="Estornar venda"
                        className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-danger"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
      {/* iframe oculto para impressão direta do cupom */}
      <iframe ref={iframeRef} title="Cupom fiscal" className="hidden" aria-hidden />
    </div>
  );
}
