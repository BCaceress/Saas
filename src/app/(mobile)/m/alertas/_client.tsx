"use client";

import * as React from "react";
import { CheckCheck, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";
import { AlertaCard } from "@/components/mobile/alerta-card";
import { Card } from "@/components/ui/misc";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type AlertCategory,
} from "@/lib/alerts-types";

/**
 * Feed de alertas do celular.
 *
 * Consome o `AlertsProvider` — a mesma lista do sino do desktop, já ordenada,
 * já filtrada por permissão e pelas categorias que o tenant desligou em
 * `/configuracoes/notificacoes`. Resolver aqui apaga lá também: a chave de
 * ocultos é a mesma (`nohub:alerts:dismissed`).
 */
export function AlertasClient() {
  const { alerts, loaded, loading, refresh, ocultar, ocultarTodos } = useAlerts();
  const [filtro, setFiltro] = React.useState<AlertCategory | null>(null);

  const categorias = React.useMemo(() => {
    const presentes = new Set(alerts.map((a) => a.category));
    return CATEGORY_ORDER.filter((c) => presentes.has(c));
  }, [alerts]);

  // Um filtro que ficou sem itens (a pessoa resolveu o último) vale como
  // "Tudo": derivado no render, não sincronizado por efeito — assim a tela
  // nunca chega a pintar vazia antes de se corrigir.
  const filtroEfetivo = filtro && categorias.includes(filtro) ? filtro : null;

  const visiveis = filtroEfetivo
    ? alerts.filter((a) => a.category === filtroEfetivo)
    : alerts;

  if (!loaded) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-24 animate-pulse bg-surface-2" />
        ))}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <p className="font-display text-base font-semibold text-ink">Nada pendente</p>
        <p className="text-sm text-ink-2">
          Estoque, compras e prazos estão em dia. Volte depois de movimentar a loja.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="mt-2 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-medium text-ink disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="h-4 w-4" aria-hidden />
          )}
          Atualizar
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {categorias.length > 1 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          <Chip ativo={filtroEfetivo === null} onClick={() => setFiltro(null)}>
            Tudo {alerts.length}
          </Chip>
          {categorias.map((c) => (
            <Chip key={c} ativo={filtroEfetivo === c} onClick={() => setFiltro(c)}>
              {CATEGORY_LABEL[c]} {alerts.filter((a) => a.category === c).length}
            </Chip>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {visiveis.map((a) => (
          <AlertaCard key={a.id} alerta={a} onResolver={ocultar} />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-button bg-surface text-sm font-medium text-ink disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="h-4 w-4" aria-hidden />
          )}
          Atualizar
        </button>

        <button
          type="button"
          onClick={ocultarTodos}
          className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
        >
          <CheckCheck className="h-4 w-4" aria-hidden />
          Resolver todos
        </button>
      </div>
    </div>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2 hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
