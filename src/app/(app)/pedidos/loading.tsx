import { Sk, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton dos pedidos de compra: ações + resumo (6 indicadores num bloco só)
 * + toolbar (visão lista/kanban + filtros) + tabela. Espelha
 * PurchaseOrderSummary + PurchaseOrdersClient — se o skeleton não tiver a mesma
 * forma do conteúdo, a tela salta no momento em que ele é trocado.
 * Cabeçalho e abas vêm do layout do módulo, e a reposição vive em
 * /cotacoes/reposicao-inteligente, fora desta tela.
 */
export default function ComprasPedidosLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando pedidos de compra">
      {/* Ações da aba, alinhadas à direita */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Sk className="h-9 w-36 rounded-full" />
        <Sk className="hidden h-9 w-44 rounded-full sm:block" />
        <Sk className="h-9 w-32 rounded-full" />
      </div>

      {/* Resumo: um bloco com divisores, 6 células */}
      <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1.5 px-4 py-3.5">
            <Sk className="h-2.5 w-24" />
            <Sk className="h-5 w-16" />
            <Sk className="h-2.5 w-20" />
          </div>
        ))}
      </div>

      {/* Toolbar: alternador lista/kanban + filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Sk className="hidden h-9 w-24 rounded-sm md:block" />
        <Sk className="h-9 w-52 rounded-sm" />
        <Sk className="hidden h-9 w-32 rounded-sm sm:block" />
        <Sk className="hidden h-9 w-32 rounded-sm sm:block" />
        <Sk className="hidden h-9 w-32 rounded-sm lg:block" />
      </div>

      <SkTable rows={8} />
    </div>
  );
}
