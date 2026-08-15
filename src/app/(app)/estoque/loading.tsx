import { CorpoEstoqueSkeleton } from "./_skeleton";

/**
 * Primeira abertura de /estoque (e das sub-rotas que reaproveitam o corpo).
 *
 * O cabeçalho vem do layout e já está na tela; aqui entra o corpo com o chrome
 * real — busca, filtros, cabeçalho das colunas e rodapé — e só as linhas em
 * esqueleto, no mesmo espaço que vão ocupar depois.
 */
export default function EstoqueLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <CorpoEstoqueSkeleton linhas={8} />
    </div>
  );
}
