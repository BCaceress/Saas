import { SkKpis, SkToolbar, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton das sub-rotas de estoque. O cabeçalho (layout) persiste;
 * aqui: KPIs + busca/filtros + tabela de saldos.
 */
export default function EstoqueLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Carregando estoque">
      <SkKpis count={4} />
      <SkToolbar pills={4} />
      <SkTable rows={8} />
    </div>
  );
}
