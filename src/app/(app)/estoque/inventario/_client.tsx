"use client";

import { useState, useTransition } from "react";
import { Loader2, ClipboardList, CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  criarInventarioAction,
  fecharInventarioAction,
  cancelarInventarioAction,
} from "../actions";
import { cn } from "@/lib/utils";

type Site = { id: string; nome: string; tipo: string };
type InvItem = {
  productId: string;
  nome: string;
  sku: string;
  qtdSistema: number;
  qtdContada: number | null;
};
type Inventario = {
  id: string;
  status: string;
  siteId: string;
  siteNome: string;
  observacao: string | null;
  createdAt: string | Date;
  fechadoEm: string | Date | null;
  items: InvItem[];
};

export function InventarioClient({
  inventarios,
  sites,
  activeSiteId,
}: {
  inventarios: Inventario[];
  sites: Site[];
  activeSiteId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // inventoryId -> { productId -> qtdContada }
  const [contagem, setContagem] = useState<Record<string, Record<string, number>>>({});

  const siteId = activeSiteId ?? sites[0]?.id ?? "";
  const siteNome = sites.find((s) => s.id === siteId)?.nome ?? "";
  const aberto = inventarios.find((i) => i.status === "ABERTO");
  const fechados = inventarios.filter((i) => i.status !== "ABERTO");

  function novoInventario() {
    setError(null);
    startTransition(async () => {
      try {
        await criarInventarioAction({ siteId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao abrir inventário.");
      }
    });
  }

  function setConta(invId: string, productId: string, qtd: number) {
    setContagem((p) => ({ ...p, [invId]: { ...(p[invId] ?? {}), [productId]: qtd } }));
  }

  function fechar(inv: Inventario) {
    setError(null);
    const mapa = contagem[inv.id] ?? {};
    const items = inv.items.map((it) => ({
      productId: it.productId,
      qtdContada: mapa[it.productId] ?? it.qtdSistema,
    }));
    startTransition(async () => {
      try {
        await fecharInventarioAction({ inventoryId: inv.id, items });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar inventário.");
      }
    });
  }

  function cancelar(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await cancelarInventarioAction(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}

      {/* Inventário aberto ou botão para abrir */}
      {!aberto ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-line bg-surface py-12 text-center">
          <ClipboardList size={28} className="text-faint" />
          <p className="text-sm text-muted">
            Nenhuma contagem em andamento{siteNome ? ` em ${siteNome}` : ""}.
          </p>
          <button
            type="button"
            onClick={novoInventario}
            disabled={pending || !siteId}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            Iniciar inventário
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-brand/40 bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ClipboardList size={16} className="text-brand" />
              Contagem em {aberto.siteNome}
            </h3>
            <button
              type="button"
              onClick={() => cancelar(aberto.id)}
              disabled={pending}
              className="cursor-pointer text-xs font-medium text-muted underline hover:text-danger"
            >
              Cancelar
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {aberto.items.map((it) => {
              const contada = contagem[aberto.id]?.[it.productId] ?? it.qtdSistema;
              const diverge = contada !== it.qtdSistema;
              return (
                <div key={it.productId} className="flex items-center gap-3 rounded-[var(--radius)] bg-surface-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{it.nome}</p>
                    <p className="font-mono text-[11px] text-faint">{it.sku} · sistema {it.qtdSistema}</p>
                  </div>
                  {diverge && (
                    <span className="font-mono text-[11px] text-warn tabular-nums">
                      {contada - it.qtdSistema > 0 ? "+" : ""}
                      {(contada - it.qtdSistema).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                    </span>
                  )}
                  <div className="flex w-28 flex-col gap-1">
                    <label className="text-[10px] font-semibold text-faint">Contado</label>
                    <input
                      type="number"
                      min={0}
                      step={0.001}
                      value={contada}
                      onChange={(e) => setConta(aberto.id, it.productId, Number(e.target.value))}
                      className={cn(
                        "rounded-[var(--radius)] border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                        diverge ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand"
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end border-t border-line pt-3">
            <button
              type="button"
              onClick={() => fechar(aberto)}
              disabled={pending}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Fechar e ajustar
            </button>
          </div>
        </div>
      )}

      {/* Histórico */}
      {fechados.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Histórico</h3>
          <div className="flex flex-col gap-2">
            {fechados.map((inv) => {
              const divergentes = inv.items.filter(
                (it) => it.qtdContada != null && it.qtdContada !== it.qtdSistema
              ).length;
              const cancelado = inv.status === "CANCELADO";
              return (
                <div key={inv.id} className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-5 py-4">
                  {cancelado ? (
                    <X size={16} className="shrink-0 text-muted" />
                  ) : (
                    <CheckCircle2 size={16} className="shrink-0 text-ok" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {inv.siteNome} ·{" "}
                      {cancelado ? "Cancelado" : `${inv.items.length} itens contados`}
                    </p>
                    <p className="text-[11px] text-faint">
                      {new Date(inv.fechadoEm ?? inv.createdAt).toLocaleString("pt-BR")}
                      {!cancelado && divergentes > 0 && ` · ${divergentes} divergência(s) ajustada(s)`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
