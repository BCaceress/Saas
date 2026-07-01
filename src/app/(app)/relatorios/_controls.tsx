"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useTransition } from "react";
import { BarChart2, FileText, Sparkles, Store, ChevronDown, Check } from "lucide-react";
import { setReportSiteAction } from "./actions";

const SECOES = [
  { id: "relatorios", label: "Relatórios", href: "/relatorios/lista", icon: BarChart2 },
  { id: "documentos", label: "Documentos", href: "/relatorios/documentos", icon: FileText },
  { id: "ia", label: "Assistente IA", href: "/relatorios/ia", icon: Sparkles },
] as const;

const RELATORIO_PREFIXES = [
  "/relatorios/vendas",
  "/relatorios/margem",
  "/relatorios/estoque",
  "/relatorios/perdas",
  "/relatorios/compras",
  "/relatorios/producao",
  "/relatorios/pagamentos",
  "/relatorios/abc",
  "/relatorios/fiscal",
  "/relatorios/lista",
];

function resolveSecao(pathname: string): string {
  if (pathname.startsWith("/relatorios/documentos")) return "documentos";
  if (pathname.startsWith("/relatorios/ia")) return "ia";
  if (RELATORIO_PREFIXES.some((p) => pathname.startsWith(p))) return "relatorios";
  return "relatorios";
}

export function AnalyticsNav() {
  const pathname = usePathname();
  const ativa = resolveSecao(pathname);

  return (
    <nav className="flex items-center gap-1" aria-label="Análises">
      {SECOES.map((s) => {
        const Icon = s.icon;
        const active = ativa === s.id;
        return (
          <Link
            key={s.id}
            href={s.href}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand/10 text-brand"
                : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon size={15} aria-hidden />
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

type SiteRow = { id: string; nome: string; tipo: string };

export function AnalyticsSiteSelector({
  sites,
  activeSiteId,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  function changeSite(id: string) {
    setOpen(false);
    start(async () => {
      await setReportSiteAction(id);
      window.location.reload();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        <Store size={14} className="shrink-0 text-muted" aria-hidden />
        <span className="max-w-32 truncate">{activeSite?.nome ?? "Todos"}</span>
        <ChevronDown size={13} className="shrink-0 text-faint" aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
          <div className="border-b border-line px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Ponto de venda
            </p>
          </div>
          <div className="py-1">
            {sites.map((s) => (
              <button
                key={s.id}
                onClick={() => changeSite(s.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2"
              >
                <Store size={13} className="shrink-0 text-muted" aria-hidden />
                <span
                  className={cn(
                    "flex-1 truncate",
                    s.id === activeSiteId ? "font-semibold text-brand" : "text-ink",
                  )}
                >
                  {s.nome}
                </span>
                <span className="text-[10px] text-faint">{s.tipo === "CD" ? "CD" : "Loja"}</span>
                {s.id === activeSiteId && (
                  <Check size={13} className="shrink-0 text-brand" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
