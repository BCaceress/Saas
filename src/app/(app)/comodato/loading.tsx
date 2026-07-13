import { SkPageHeader, SkTabs, SkTable } from "@/components/app/skeletons";

/** Skeleton de comodato: cabeçalho + abas + tabela de ativos/vasilhames. */
export default function ComodatoLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando comodato">
      <SkPageHeader actions={2} />
      <SkTabs count={3} />
      <SkTable rows={7} thumb={false} />
    </div>
  );
}
