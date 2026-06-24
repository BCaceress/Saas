"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toast leve, sem dependência externa. Emissor global em nível de módulo —
 * chame `toast.error("…")` de qualquer client component. Monte <Toaster/> uma
 * vez no shell. Tokens do design ("vitrine refrigerada"), pt-BR, acessível
 * (role/aria-live) e respeita prefers-reduced-motion (via globals.css).
 */

type ToastTone = "success" | "error" | "info";

type ToastItem = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  const snap = [...items];
  for (const l of listeners) l(snap);
}

function subscribe(cb: () => void): () => void {
  const listener: Listener = () => cb();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return items;
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(tone: ToastTone, title: string, description?: string) {
  const id = ++seq;
  items = [...items, { id, tone, title, description }];
  emit();
  // some sozinho — erro fica mais tempo na tela
  const ttl = tone === "error" ? 6000 : 4000;
  setTimeout(() => dismiss(id), ttl);
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  error: (title: string, description?: string) => push("error", title, description),
  info: (title: string, description?: string) => push("info", title, description),
  dismiss,
};

const ICON: Record<ToastTone, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONE: Record<ToastTone, string> = {
  success: "border-ok/30 bg-ok-soft text-ok",
  error: "border-danger/30 bg-danger-soft text-danger",
  info: "border-brand/30 bg-brand-soft text-brand-strong",
};

export function Toaster() {
  const list = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
    >
      {list.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius)] border bg-surface px-4 py-3 shadow-[var(--shadow-2)]",
              "border-line"
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border",
                TONE[t.tone]
              )}
            >
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs text-muted">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fechar"
              className="-mr-1 -mt-0.5 shrink-0 rounded-[var(--radius-sm)] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
