import { SkPageHeader, SkToolbar, SkTable } from "@/components/app/skeletons";

/** Skeleton de clientes: cabeçalho + busca/filtros + lista. */
export default function ClientesLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando clientes">
      <SkPageHeader actions={1} />
      <SkToolbar pills={3} />
      <SkTable rows={8} />
    </div>
  );
}
