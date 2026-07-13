import { SkPageHeader, SkTabs, SkTable } from "@/components/app/skeletons";

/** Skeleton de compras: cabeçalho + sub-abas (pedidos/receber/histórico) + tabela. */
export default function ComprasLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando compras">
      <SkPageHeader actions={2} />
      <SkTabs count={3} />
      <SkTable rows={7} thumb={false} />
    </div>
  );
}
