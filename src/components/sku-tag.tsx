import { cn } from "@/lib/utils";

/**
 * Assinatura visual: o SKU como etiqueta de prateleira — mono + faixa de
 * "código de barras". Pequeno, denso, reconhecível no balcão.
 */
export function SkuTag({
  sku,
  className,
  showBarcode = true,
}: {
  sku: string;
  className?: string;
  showBarcode?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line bg-surface-2 px-1.5 py-0.5 align-middle",
        className
      )}
      title={`SKU ${sku}`}
    >
      {showBarcode && (
        <span
          aria-hidden
          className="barcode-strip h-3.5 w-4 rounded-[2px] opacity-70"
        />
      )}
      <span className="font-mono text-[12px] font-medium tracking-tight text-ink-2 tnum">
        {sku}
      </span>
    </span>
  );
}
