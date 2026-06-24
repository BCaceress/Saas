"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { setSiteAction } from "./actions";
import { cn } from "@/lib/utils";

type SiteRow = { id: string; nome: string; tipo: string; ativo: boolean };

const TABS = [
  { href: "/estoque/saldos", label: "Saldos" },
  { href: "/estoque/entradas", label: "Entradas" },
  { href: "/estoque/ajustes", label: "Ajustes" },
  { href: "/estoque/movimentacoes", label: "Razão" },
  { href: "/estoque/reposicao", label: "Reposição" },
];

const MULTI_TABS = [
  { href: "/estoque/transferencias", label: "Transferências" },
  { href: "/estoque/producao", label: "Produção" },
];

export function EstoqueHeader({
  sites,
  activeSiteId,
  multiSite,
  topologia,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
  topologia: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  const allTabs = [
    ...TABS,
    ...(topologia !== "LOCAL" || multiSite ? MULTI_TABS : [
      { href: "/estoque/producao", label: "Produção" },
    ]),
  ];

  function changeSite(id: string) {
    setOpen(false);
    startTransition(async () => {
      await setSiteAction(id);
      window.location.reload();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Title + site selector */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Estoque</h1>

        {multiSite && activeSite && (
          <div className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              disabled={pending}
            >
              <Store size={14} className="text-muted" />
              <span>{activeSite.nome}</span>
              <ChevronDown size={13} className="text-muted" />
            </button>
            {open && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-2)]">
                {sites.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => changeSite(s.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                      s.id === activeSiteId ? "font-semibold text-brand" : "text-ink"
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
      </div>

      {/* Tab bar */}
      <nav className="flex gap-1 overflow-x-auto border-b border-line pb-0">
        {allTabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-b-2 border-brand text-brand"
                  : "text-muted hover:text-ink"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
