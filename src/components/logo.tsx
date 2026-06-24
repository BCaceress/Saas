import { cn } from "@/lib/utils";

/** Marca NoHub: chip "refrigerado" com faixa de barras + wordmark. */
export function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative grid h-8 w-8 place-items-center rounded-[8px] bg-brand text-on-brand shadow-[var(--shadow-1)]">
        <span className="barcode-strip h-4 w-4 rounded-[2px] opacity-90 invert" />
      </span>
      {!compact && (
        <span className="font-display text-[17px] font-bold leading-none tracking-tight text-ink">
          NoHub<span className="text-brand">.</span>
          <span className="font-medium text-muted">Market</span>
        </span>
      )}
    </span>
  );
}
