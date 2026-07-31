import { Sk, SkKpis, SkTable } from "@/components/app/skeletons";

/**
 * Painel de compras. Cabeçalho e abas vivem no layout (já renderizados),
 * então o esqueleto começa na faixa de métricas e segue a ordem da tela:
 * indicadores → alertas → sugestão inteligente de compra.
 */
export default function ComprasLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando compras"
    >
      <SkKpis count={6} />
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Sk key={i} className="h-20 rounded-[var(--radius-lg)]" />
        ))}
      </div>
      <SkTable rows={6} thumb={false} />
    </div>
  );
}
