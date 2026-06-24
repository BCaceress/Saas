import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[13px] font-medium text-ink-2", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({
  className,
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-float)]",
        hover && "card-hover",
        className
      )}
      {...props}
    />
  );
}

type Tone = "neutral" | "brand" | "accent" | "ok" | "warn" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  brand: "bg-brand-soft text-brand-strong border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

/** Eyebrow/label tipográfico — mono, tracking, caixa alta. */
export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.18em] text-muted",
        className
      )}
      {...props}
    />
  );
}
