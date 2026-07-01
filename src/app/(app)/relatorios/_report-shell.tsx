"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, RefreshCw, Download, Printer } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 d" },
  { id: "30d", label: "30 d" },
  { id: "mes", label: "Mês" },
  { id: "custom", label: "Período" },
];

interface RelatorioShellProps {
  titulo: string;
  exportTipo?: string;
  children?: React.ReactNode;
}

export function RelatorioShell({ titulo, exportTipo, children }: RelatorioShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [periodo, setPeriodo] = useState(params.get("periodo") ?? "30d");
  const [de, setDe] = useState(params.get("de") ?? "");
  const [ate, setAte] = useState(params.get("ate") ?? "");

  function atualizar() {
    const next = new URLSearchParams();
    next.set("periodo", periodo);
    if (periodo === "custom") {
      if (de) next.set("de", de);
      if (ate) next.set("ate", ate);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  const exportHref = exportTipo
    ? `/relatorios/${exportTipo}/export?${params.toString()}`
    : null;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm" aria-label="Navegação">
        <Link
          href="/relatorios/lista"
          className="flex items-center gap-1 text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft size={14} aria-hidden />
          Relatórios
        </Link>
        <span className="text-faint" aria-hidden>
          /
        </span>
        <span className="font-medium text-ink" aria-current="page">
          {titulo}
        </span>
      </nav>

      {/* Filter bar */}
      <div className="rounded-lg border border-line bg-surface shadow-(--shadow-1)">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          {/* Period pills */}
          <div className="flex items-center gap-1 rounded-full border border-line bg-canvas p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodo(p.id)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition-all",
                  periodo === p.id
                    ? "bg-brand text-on-brand shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={atualizar}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition-colors hover:bg-brand-strong"
          >
            <RefreshCw size={13} aria-hidden />
            Atualizar
          </button>
        </div>

        {/* Custom date range */}
        {periodo === "custom" && (
          <div className="border-t border-line px-4 pb-4 pt-3">
            <div className="grid max-w-xs grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">De</label>
                <input
                  type="date"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                  className="h-10 w-full rounded-(--radius) border border-line bg-transparent px-3 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Até</label>
                <input
                  type="date"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                  className="h-10 w-full rounded-(--radius) border border-line bg-transparent px-3 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Report content */}
      <div className="space-y-6">
        {children}

        {/* Export — sempre no rodapé */}
        {exportHref && (
          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <span className="mr-1 text-xs font-medium text-muted">Exportar:</span>
            <a
              href={exportHref}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <Download size={12} aria-hidden />
              CSV
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <Printer size={12} aria-hidden />
              PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
