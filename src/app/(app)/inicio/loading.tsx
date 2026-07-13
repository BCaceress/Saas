import { SkPageHeader, SkKpis, SkChart } from "@/components/app/skeletons";

/** Skeleton do dashboard: KPIs + tendência + composição + rankings. */
export default function InicioLoading() {
  return (
    <div className="animate-pulse space-y-6 pb-10" aria-busy="true" aria-label="Carregando dashboard">
      <SkPageHeader actions={1} />
      <SkKpis count={4} />
      <div className="grid gap-4 lg:grid-cols-3">
        <SkChart className="lg:col-span-2" />
        <SkChart />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkChart height="h-44" />
        <SkChart height="h-44" />
      </div>
    </div>
  );
}
