"use client";

import Link from "next/link";
import { Check, ChevronRight, Square, SquareCheckBig } from "lucide-react";
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
 * cursor. Marcar como lido e abrir são dois botões separados, nunca o mesmo
 * toque.
 *
 * No modo de seleção o cartão inteiro vira alvo: o ícone de prioridade dá lugar
 * à caixa de marcação e o toque em qualquer lugar alterna a escolha — ninguém
 * acerta uma caixinha de 20px em pé na frente da gôndola.
 */
export function AlertaCard({
  alerta,
  onResolver,
  selecionavel = false,
  selecionado = false,
  onSelecionar,
}: {
  alerta: AlertItem;
  /** Sem isto, o botão de marcar como lido não aparece (home mostra só leitura). */
  onResolver?: (id: string) => void;
  /** Modo de seleção ligado: o cartão vira alvo único, sem ações internas. */
  selecionavel?: boolean;
  selecionado?: boolean;
  onSelecionar?: (id: string) => void;
}) {
  const style = PRIORITY_STYLE[alerta.priority];
  const Icone = ALERT_ICON[alerta.icon];
  const destino = alerta.href ? hrefMobile(alerta.href) : null;

  const corpo = (
    <>
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          selecionavel
            ? selecionado
              ? "bg-brand text-on-brand"
              : "bg-surface-2 text-muted"
            : cn(style.soft, style.text),
        )}
        aria-hidden
      >
        {selecionavel ? (
          selecionado ? (
            <SquareCheckBig size={20} />
          ) : (
            <Square size={20} />
          )
        ) : (
          <Icone size={20} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} aria-hidden />
          <p className="truncate text-base leading-tight font-semibold text-ink">{alerta.titulo}</p>
        </div>

        <p className="mt-1 text-[13px] leading-snug text-ink-2">{alerta.descricao}</p>

        <div className="mt-2 flex items-center gap-2">
          {!selecionavel && destino && (
            <Link
              href={destino}
              className="tap inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink hover:bg-brand-soft hover:text-brand-strong active:bg-brand-soft focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              {alerta.acaoLabel ?? "Abrir"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          )}

          {/* Ler fica na PONTA direita, e a hora recua para antes dele: a ação
              que se repete cartão a cartão precisa cair sempre no mesmo ponto
              do polegar, e não flutuar com o tamanho do rótulo de "abrir". */}
          {alerta.at && (
            <span className="ml-auto shrink-0 text-[11px] text-faint">
              {tempoRelativo(alerta.at)}
            </span>
          )}

          {!selecionavel && onResolver && (
            <button
              type="button"
              onClick={() => onResolver(alerta.id)}
              className={cn(
                "tap inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full px-4 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                !alerta.at && "ml-auto",
              )}
            >
              <Check className="h-4 w-4" aria-hidden />
              Lido
            </button>
          )}
        </div>
      </div>
    </>
  );

  const classe = cn(
    "flex w-full items-start gap-4 rounded-[var(--radius-m)] border bg-surface p-4 text-left shadow-[var(--shadow-m)]",
    selecionavel && selecionado ? "border-brand" : "border-line",
  );

  if (selecionavel) {
    return (
      <button
        type="button"
        onClick={() => onSelecionar?.(alerta.id)}
        aria-pressed={selecionado}
        className={cn(classe, "cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none")}
      >
        {corpo}
      </button>
    );
  }

  return <div className={classe}>{corpo}</div>;
}
