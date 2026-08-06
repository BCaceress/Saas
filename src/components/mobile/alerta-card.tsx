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
    <div className="flex items-start gap-4 rounded-[var(--radius-m)] border border-line bg-surface p-4 shadow-[var(--shadow-m)]">
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          style.soft,
          style.text,
        )}
        aria-hidden
      >
        <Icone size={20} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} aria-hidden />
          <p className="truncate text-base leading-tight font-semibold text-ink">{alerta.titulo}</p>
        </div>

        <p className="mt-1 text-[13px] leading-snug text-ink-2">{alerta.descricao}</p>

        <div className="mt-2 flex items-center gap-2">
          {destino && (
            <Link
              href={destino}
              className="tap inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink hover:bg-brand-soft hover:text-brand-strong active:bg-brand-soft focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              {alerta.acaoLabel ?? "Abrir"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          )}

          {onResolver && (
            <button
              type="button"
              onClick={() => onResolver(alerta.id)}
              className="tap inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-4 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Check className="h-4 w-4" aria-hidden />
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
