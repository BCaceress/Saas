import { cn } from "@/lib/utils";

/**
 * Primitivas de skeleton para os `loading.tsx` de cada seção.
 * Cada página compõe seu esqueleto espelhando o layout real — o usuário
 * reconhece a tela de destino antes de os dados chegarem.
 * O wrapper da página aplica `animate-pulse` uma única vez.
 */

export function Sk({ className }: { className?: string }) {
  return <div className={cn("rounded-md bg-surface-2", className)} aria-hidden />;
}

/**
 * Cabeçalho de página — espelha o PageHeader real: banda com border-b,
 * tile de ícone brand-soft, título + descrição, ações em pill à direita.
 */
export function SkPageHeader({ actions = 2 }: { actions?: number }) {
  return (
    <header className="border-b border-line pb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Sk className="h-10 w-10 shrink-0 rounded-xl bg-brand-soft" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Sk className="h-5.25 w-40" />
            <Sk className="h-3.5 w-64 max-w-[50vw]" />
          </div>
        </div>
        {actions > 0 && (
          <div className="hidden shrink-0 items-center justify-end gap-2 sm:flex">
            {Array.from({ length: actions }).map((_, i) => (
              <Sk key={i} className="h-9 w-28 rounded-full" />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/** Fileira de cards de indicador (KPI). */
export function SkKpis({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <Sk className="h-8 w-8 rounded-xl" />
            <Sk className="h-3 w-20" />
          </div>
          <Sk className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Barra de busca + pills de filtro. */
export function SkToolbar({ pills = 4 }: { pills?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Sk className="h-9 w-full max-w-lg rounded-lg" />
      {Array.from({ length: pills }).map((_, i) => (
        <Sk key={i} className="hidden h-9 w-24 rounded-lg sm:block" />
      ))}
    </div>
  );
}

/** Pills de sub-navegação (abas). */
export function SkTabs({ count = 3 }: { count?: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Sk key={i} className="h-9 w-32 rounded-full" />
      ))}
    </div>
  );
}

/** Tabela/lista: linhas com miniatura + textos + colunas à direita. */
export function SkTable({ rows = 8, thumb = true }: { rows?: number; thumb?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line bg-surface-2/60 px-4 py-3">
        <Sk className="h-3 w-1/3" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
          {thumb && <Sk className="h-9 w-9 shrink-0 rounded-lg" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Sk className="h-3.5 w-1/3" />
            <Sk className="h-3 w-1/4" />
          </div>
          <Sk className="hidden h-3.5 w-28 md:block" />
          <Sk className="hidden h-3.5 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Card de gráfico: título + área de plotagem. */
export function SkChart({ className, height = "h-56" }: { className?: string; height?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-4", className)}>
      <div className="flex flex-col gap-1.5">
        <Sk className="h-4 w-36" />
        <Sk className="h-3 w-24" />
      </div>
      <Sk className={cn("w-full", height)} />
    </div>
  );
}

/** Grade de cards de navegação/conteúdo (configurações, hub de relatórios). */
export function SkCardGrid({ count = 6, cols = "sm:grid-cols-2 lg:grid-cols-3" }: { count?: number; cols?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3", cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <Sk className="h-9 w-9 rounded-xl" />
          <Sk className="h-4 w-32" />
          <Sk className="h-3 w-full" />
          <Sk className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
