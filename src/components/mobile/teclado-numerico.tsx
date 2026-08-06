"use client";

import * as React from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Teclado numérico grande, para digitar quantidade de pé.
 *
 * Existe em vez do teclado do sistema porque nas telas de contagem e ajuste a
 * pessoa está com o celular numa mão e o produto na outra: teclas de 56px de
 * altura erram muito menos que as do teclado nativo, e o layout não pula
 * quando o teclado do sistema abre e fecha a cada item.
 *
 * O mesmo desenho de `grid-cols-3` do PIN do totem (`totem/_kiosk.tsx`).
 */
export function TecladoNumerico({
  valor,
  onChange,
  decimais = 3,
  className,
}: {
  valor: string;
  onChange: (v: string) => void;
  /** 0 desliga a vírgula — contagem de unidade inteira não aceita fração. */
  decimais?: number;
  className?: string;
}) {
  const digitar = React.useCallback(
    (t: string) => {
      if (t === "apagar") {
        onChange(valor.slice(0, -1));
        return;
      }
      if (t === ",") {
        if (decimais === 0 || valor.includes(",")) return;
        onChange(valor === "" ? "0," : `${valor},`);
        return;
      }
      // Limita as casas decimais na digitação, não na validação: é menos
      // frustrante do que deixar digitar e recusar depois.
      const [, frac] = valor.split(",");
      if (frac != null && frac.length >= decimais) return;
      if (valor === "0") {
        onChange(t);
        return;
      }
      onChange(valor + t);
    },
    [valor, onChange, decimais],
  );

  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimais > 0 ? "," : "", "0", "apagar"];

  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {teclas.map((t, i) =>
        t === "" ? (
          <span key={`vazio-${i}`} aria-hidden />
        ) : (
          <button
            key={t}
            type="button"
            onClick={() => digitar(t)}
            aria-label={t === "apagar" ? "Apagar" : t}
            className={cn(
              "grid min-h-14 cursor-pointer place-items-center rounded-xl border border-line-button bg-surface",
              "font-display text-xl font-semibold text-ink transition-colors",
              "active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
              t === "apagar" && "text-muted",
            )}
          >
            {t === "apagar" ? <Delete className="h-5 w-5" /> : t}
          </button>
        ),
      )}
    </div>
  );
}

/** Converte o texto do teclado em número. Vírgula é o separador em pt-BR. */
export function paraNumero(valor: string): number {
  const n = Number(valor.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Visor grande do valor digitado. */
export function VisorQuantidade({
  valor,
  unidade,
  atual,
}: {
  valor: string;
  unidade?: string;
  /** Saldo atual, para comparação — some quando não faz sentido. */
  atual?: number;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
      <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
        {valor === "" ? "0" : valor}
        {unidade && <span className="ml-1 text-base font-normal text-muted">{unidade}</span>}
      </p>
      {atual != null && (
        <p className="mt-1 text-xs text-muted">
          hoje: {atual.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
        </p>
      )}
    </div>
  );
}
