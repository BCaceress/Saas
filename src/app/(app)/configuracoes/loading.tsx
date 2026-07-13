import { SkPageHeader, SkCardGrid } from "@/components/app/skeletons";

/** Skeleton das configurações: cabeçalho + grade de cards de seção. */
export default function ConfiguracoesLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando configurações">
      <SkPageHeader actions={0} />
      <SkCardGrid count={9} cols="sm:grid-cols-2 lg:grid-cols-3" />
    </div>
  );
}
