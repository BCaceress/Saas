"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type ViewMode = "lista" | "cards";

export function useViewMode(storageKey: string, initial: ViewMode = "lista") {
  const [view, setView] = useState<ViewMode>(initial);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "lista" || saved === "cards") setView(saved);
  }, [storageKey]);

  const update = (v: ViewMode) => {
    setView(v);
    window.localStorage.setItem(storageKey, v);
  };

  return [view, update] as const;
}

const OPTIONS: { value: ViewMode; label: string; icon: React.ElementType }[] = [
  { value: "lista", label: "Lista", icon: Rows3 },
  { value: "cards", label: "Cards", icon: LayoutGrid },
];

export function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const index = OPTIONS.findIndex((o) => o.value === view);

  return (
    <div
      role="tablist"
      aria-label="Modo de visualização"
      className="relative inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface-2 p-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-8 rounded-full bg-surface shadow-(--shadow-1) transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${index * 2}rem)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={view === o.value}
          title={`Ver em ${o.label.toLowerCase()}`}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors",
            view === o.value ? "text-brand" : "text-faint hover:text-ink",
          )}
        >
          <o.icon size={15} strokeWidth={2.25} />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
