import { Sk, SkCardGrid } from "@/components/app/skeletons";

/**
 * Skeleton dos relatórios. O cabeçalho vem do layout da seção (persiste);
 * aqui só o hub: busca + grade de cards de relatório.
 */
export default function RelatoriosLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Carregando relatórios">
      <Sk className="h-11 w-full max-w-xl rounded-xl" />
      <SkCardGrid count={9} cols="sm:grid-cols-2 lg:grid-cols-3" />
    </div>
  );
}
