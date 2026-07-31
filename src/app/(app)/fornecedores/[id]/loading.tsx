import { Sk, SkTabs } from "@/components/app/skeletons";

/**
 * Centro de Gestão do Fornecedor. O cabeçalho com identidade e abas é a
 * primeira coisa que aparece — só o conteúdo da aba fica em espera.
 */
export default function FornecedorLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando fornecedor"
    >
      <div className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-line bg-surface px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Sk className="h-9 w-9 rounded-full" />
          <Sk className="h-12 w-12 rounded-[var(--radius)]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Sk className="h-5 w-56" />
            <Sk className="h-3 w-72" />
          </div>
        </div>
        <SkTabs count={7} />
      </div>
      <Sk className="h-40 rounded-[var(--radius-lg)]" />
      <Sk className="h-64 rounded-[var(--radius-lg)]" />
    </div>
  );
}
