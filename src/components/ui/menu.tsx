"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Menu suspenso leve. O dropdown é renderizado em portal (document.body) com
 * posição fixa calculada a partir do gatilho — assim escapa de qualquer
 * container com overflow/clip e aparece acima de tudo. Passe um <button> real
 * como `trigger`; recebe o onClick de abrir.
 */
const MenuCtx = React.createContext<() => void>(() => {});

export function Menu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: React.ReactElement;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number; right: number } | null>(null);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  // Se o dropdown estourar a base da viewport, vira para cima do gatilho.
  // Mede depois de montar e ajusta o style direto (sem re-render).
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) {
      const trig = (triggerRef.current?.firstElementChild ?? triggerRef.current)?.getBoundingClientRect();
      const top = Math.max(8, (trig ? trig.top : r.top) - 4 - r.height);
      el.style.top = `${top}px`;
    }
  }, [open, coords]);

  const place = React.useCallback(() => {
    const el = triggerRef.current?.firstElementChild ?? triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.left, right: window.innerWidth - r.right });
  }, []);

  function toggle() {
    if (!open) place();
    setOpen((v) => !v);
  }

  React.useEffect(() => {
    if (!open) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  const trig = React.cloneElement(trigger as React.ReactElement<{ onClick?: () => void }>, {
    onClick: toggle,
  });

  return (
    <span ref={triggerRef} className="inline-flex">
      {trig}
      {open && coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[100]" aria-hidden onClick={close} />
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", top: coords.top, ...(align === "end" ? { right: coords.right } : { left: coords.left }) }}
              className={cn(
                "z-[101] min-w-48 overflow-hidden rounded-[var(--radius)] border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]",
                className
              )}
            >
              <MenuCtx.Provider value={close}>{children}</MenuCtx.Provider>
            </div>
          </>,
          document.body
        )}
    </span>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  icon,
  trailing,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const close = React.useContext(MenuCtx);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        close();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors",
        "hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
        danger ? "text-danger" : "text-ink"
      )}
    >
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className="flex-1">{children}</span>
      {trailing}
    </button>
  );
}
