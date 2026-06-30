"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Store, ChevronDown, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { setReportSiteAction } from "@/app/(app)/relatorios/actions";

type SiteRow = { id: string; nome: string; tipo: string };

const PRESETS: { id: string; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
];

/**
 * Filtros globais dos relatórios (PRD §6): período + site. Período vive na URL
 * (?periodo / ?de / ?ate) → server re-renderiza. Site vive em cookie. Export
 * respeita os filtros aplicados.
 */
export function ReportFilters({
  sites,
  activeSiteId,
  multiSite,
  exportTipo,
  hideExport = false,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
  exportTipo?: string;
  /** Esconde os botões CSV/PDF de tela (abas que não são dashboards de dados). */
  hideExport?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [siteOpen, setSiteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const periodo = params.get("periodo") ?? "7d";
  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null) next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  function changeSite(id: string) {
    setSiteOpen(false);
    startTransition(async () => {
      await setReportSiteAction(id);
      window.location.reload();
    });
  }

  const exportHref = exportTipo
    ? `/relatorios/${exportTipo}/export?${params.toString()}`
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Período */}
      <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setParam("periodo", p.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              periodo === p.id ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Site */}
      {multiSite && activeSite && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setSiteOpen((v) => !v)}
            disabled={pending}
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Store size={14} className="text-muted" />
            <span className="max-w-32 truncate">{activeSite.nome}</span>
            <ChevronDown size={13} className="text-muted" />
          </button>
          {siteOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
              {sites.map((s) => (
                <button
                  key={s.id}
                  onClick={() => changeSite(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                    s.id === activeSiteId ? "font-semibold text-brand" : "text-ink",
                  )}
                >
                  <Store size={13} className="shrink-0 text-muted" />
                  <span className="truncate">{s.nome}</span>
                  <span className="ml-auto text-[10px] text-faint">{s.tipo === "CD" ? "CD" : "Loja"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exportar — separado dos filtros por divisória */}
      {!hideExport && (
      <div className="flex items-center gap-2 sm:border-l sm:border-line sm:pl-2">
        {exportHref && (
          <a
            href={exportHref}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Download size={14} className="text-muted" />
            <span className="hidden sm:inline">CSV</span>
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <Printer size={14} className="text-muted" />
          <span className="hidden sm:inline">PDF</span>
        </button>
      </div>
      )}
    </div>
  );
}
