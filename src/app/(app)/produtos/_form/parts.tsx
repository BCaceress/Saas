import { PackageOpen, Wine } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cartão de seção do formulário — cabeçalho mono + corpo em coluna. */
export function SectionCard({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-1)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-muted">
          {title}
        </span>
        {badge}
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}

/** Linha rótulo/valor do painel de resumo derivado. */
export function Linha({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          strong ? "text-sm font-semibold" : "text-[13px]",
          tone === "ok" && "text-ok",
          tone === "danger" && "text-danger",
          !tone && "text-ink-2",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Miniatura quadrada de produto (imagem ou ícone por tipo). */
export function Thumb({
  url,
  tipo,
  size = 10,
}: {
  url: string | null;
  tipo: string;
  size?: 9 | 10;
}) {
  const dim = size === 9 ? "h-9 w-9" : "h-10 w-10";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={cn(dim, "shrink-0 rounded-[var(--radius-sm)] border border-line object-cover")} />;
  }
  return (
    <span
      className={cn(
        dim,
        "grid shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint",
      )}
    >
      {tipo === "INSUMO" ? <PackageOpen size={15} /> : <Wine size={15} />}
    </span>
  );
}
