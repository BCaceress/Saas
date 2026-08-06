"use client";

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALERT_ICON } from "@/components/app/alert-icons";
import { hrefMobile } from "@/components/mobile/nav";
import { PRIORITY_STYLE, tempoRelativo, type AlertItem } from "@/lib/alerts-types";

/**
 * Um alerta em formato de cartão de celular. Usado na home (os três mais
 * graves) e no feed `/m/alertas` — é o mesmo objeto vindo de `getAlerts()`,
 * então tem de ter a mesma cara nos dois lugares.
 *
 * Mais alto que a linha do sino de propósito: aqui o alvo é polegar, não
 * cursor. Resolver e abrir são dois botões separados, nunca o mesmo toque.
 */
export function AlertaCard({
  alerta,
  onResolver,
}: {
  alerta: AlertItem;
  /** Sem isto, o botão de resolver não aparece (home mostra só leitura). */
  onResolver?: (id: string) => void;
}) {
  const style = PRIORITY_STYLE[alerta.priority];
  const Icone = ALERT_ICON[alerta.icon];
  const destino = alerta.href ? hrefMobile(alerta.href) : null;

  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-3">
      <span
        className={cn(
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full",
          style.soft,
          style.text,
        )}
        aria-hidden
      >
        <Icone size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} aria-hidden />
          <p className="truncate text-sm font-semibold text-ink">{alerta.titulo}</p>
        </div>

        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{alerta.descricao}</p>

        <div className="mt-2 flex items-center gap-2">
          {destino && (
            <Link
              href={destino}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-ink transition-colors hover:bg-brand-soft hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              {alerta.acaoLabel ?? "Abrir"}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}

          {onResolver && (
            <button
              type="button"
              onClick={() => onResolver(alerta.id)}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Resolver
            </button>
          )}

          {alerta.at && (
            <span className="ml-auto shrink-0 text-[11px] text-faint">
              {tempoRelativo(alerta.at)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
