import { Sk, SkKpis } from "@/components/app/skeletons";

/** Cabeçalho próprio já renderiza no server; aqui só métricas + lista de compras. */
export default function ComprasLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando compras"
    >
      <SkKpis count={4} />
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Sk key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Sk key={i} className="h-[74px] rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </div>
  );
}
