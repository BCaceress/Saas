"use client";

import { useState, useTransition } from "react";
import { Store, ChevronDown } from "lucide-react";
import { setSiteAction } from "@/app/(app)/estoque/actions";
import { cn } from "@/lib/utils";

type SiteRow = { id: string; nome: string; tipo: string };

export function SiteSelector({
  sites,
  activeSiteId,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  // Só faz sentido com múltiplos sites.
  if (sites.length <= 1 || !activeSite) return null;

  function changeSite(id: string) {
    setOpen(false);
    startTransition(async () => {
      await setSiteAction(id);
      window.location.reload();
    });
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        disabled={pending}
      >
        <Store size={14} className="text-muted" />
        <span className="max-w-30 truncate">{activeSite.nome}</span>
        <ChevronDown size={13} className="text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
          {sites.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => changeSite(s.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                s.id === activeSiteId ? "font-semibold text-brand" : "text-ink",
              )}
            >
              <Store size={13} className="shrink-0 text-muted" />
              <span className="truncate">{s.nome}</span>
              <span className="ml-auto text-[10px] text-faint">
                {s.tipo === "CD" ? "CD" : "Loja"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
