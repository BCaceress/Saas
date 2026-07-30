import { Sk, SkKpis, SkCardGrid } from "@/components/app/skeletons";

/**
 * Painel de compras. Cabeçalho e abas vivem no layout (já renderizados),
 * então o esqueleto começa na faixa de métricas.
 */
export default function ComprasLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando compras"
    >
      <SkKpis count={6} />
      <div className="flex flex-wrap gap-2">
        <Sk className="h-10 w-56 rounded-full" />
        <Sk className="h-10 w-40 rounded-full" />
      </div>
      <SkCardGrid count={6} />
    </div>
  );
}
