import { Sk, SkKpis, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton da conferência de recebimento. Existe porque a rota mora dentro de
 * /pedidos e herdaria o `loading.tsx` da LISTA — piscar um esqueleto de tabela
 * de pedidos antes de abrir a conferência de uma nota é a tela prometendo a
 * coisa errada. Espelha RecebimentoClient: voltar + identificação da nota,
 * resumo (pedido × NF × recebido) e as linhas da conferência.
 */
export default function RecebimentoLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando a conferência do recebimento"
    >
      <div className="flex items-start gap-3">
        <Sk className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Sk className="h-5 w-56" />
          <Sk className="h-3.5 w-72" />
        </div>
        <Sk className="h-9 w-36 shrink-0 rounded-full" />
      </div>

      <SkKpis count={4} />
      <SkTable rows={8} thumb />
    </div>
  );
}
