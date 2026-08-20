/**
 * Esqueleto da cotação.
 *
 * Existe para a navegação parecer imediata: sem ele, o clique na lista fica
 * parado até o servidor terminar de montar a tela inteira, e o operador clica
 * de novo achando que não pegou.
 */
export default function CotacaoLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando a cotação">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-2" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 rounded bg-surface-2" />
          <div className="h-5 w-64 rounded bg-surface-2" />
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-32 rounded-full bg-surface-2" />
        ))}
      </div>

      <div className="h-24 rounded-[var(--radius-lg)] border border-line bg-surface-2/50" />

      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-[var(--radius-lg)] border border-line bg-surface-2/50" />
        ))}
      </div>
    </div>
  );
}
