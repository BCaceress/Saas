import { cn } from "@/lib/utils";

/** Moldura padrão de um gráfico/seção de relatório. */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[var(--radius-lg)] border border-line bg-surface p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Estado vazio honesto (PRD §10): diz que não há dado e sugere ampliar período. */
export function ChartEmpty({ mensagem = "Sem dados no período." }: { mensagem?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium text-muted">{mensagem}</p>
      <p className="text-xs text-faint">Tente ampliar o intervalo ou trocar o site.</p>
    </div>
  );
}
