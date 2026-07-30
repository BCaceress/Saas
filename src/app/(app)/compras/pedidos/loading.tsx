import { Sk, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton dos pedidos de compra: ações + resumo (4 indicadores) + toolbar
 * (visão lista/kanban + filtros) + tabela. Espelha PurchaseOrderSummary +
 * PurchaseOrdersClient. Cabeçalho e abas vêm do layout do módulo, e a
 * reposição vive em /compras/reposicao-inteligente, fora desta tela.
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

      {/* Resumo: 4 indicadores horizontais */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
            <Sk className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Sk className="h-2.5 w-20" />
              <Sk className="h-4 w-12" />
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar: alternador lista/kanban + filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Sk className="hidden h-9 w-24 rounded-lg md:block" />
        <Sk className="h-9 w-52 rounded-lg" />
        <Sk className="hidden h-9 w-32 rounded-lg sm:block" />
        <Sk className="hidden h-9 w-32 rounded-lg sm:block" />
        <Sk className="hidden h-9 w-32 rounded-lg lg:block" />
      </div>

      <SkTable rows={8} />
    </div>
  );
}
