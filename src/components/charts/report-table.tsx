"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Coluna<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Conteúdo da célula. */
  cell: (row: T) => React.ReactNode;
  /** Valor para ordenação (número ou string). Sem isto a coluna não ordena. */
  sort?: (row: T) => number | string;
  className?: string;
};

/**
 * Tabela densa ordenável (PRD §10: posição → tabela densa ordenável). Clica no
 * cabeçalho para ordenar. Client-side: recebe linhas já carregadas no servidor.
 */
export function ReportTable<T>({
  colunas,
  linhas,
  ordemInicial,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  ordemInicial?: { key: string; dir: "asc" | "desc" };
}) {
  const [ordem, setOrdem] = useState(ordemInicial ?? null);

  const col = ordem ? colunas.find((c) => c.key === ordem.key) : null;
  const ordenadas =
    col?.sort && ordem
      ? [...linhas].sort((a, b) => {
          const va = col.sort!(a);
          const vb = col.sort!(b);
          const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
          return ordem.dir === "asc" ? cmp : -cmp;
        })
      : linhas;

  function toggle(key: string) {
    setOrdem((o) => (o?.key === key ? { key, dir: o.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {colunas.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-muted",
                  c.align === "right" && "text-right",
                )}
              >
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-ink",
                      c.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {c.header}
                    {ordem?.key === c.key &&
                      (ordem.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((row, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
              {colunas.map((c) => (
                <td
                  key={c.key}
                  className={cn("py-2.5 pr-4 text-ink-2", c.align === "right" && "text-right tabular-nums", c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
