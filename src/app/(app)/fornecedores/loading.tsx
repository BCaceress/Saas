import { SkPageHeader, SkToolbar, SkTable } from "@/components/app/skeletons";

/** Skeleton de fornecedores: cabeçalho + busca + lista. */
export default function FornecedoresLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando fornecedores">
      <SkPageHeader actions={1} />
      <SkToolbar pills={2} />
      <SkTable rows={8} thumb={false} />
    </div>
  );
}
