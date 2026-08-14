import { SkBarra } from "../_skeleton";

/**
 * Esqueleto do cadastro de produto — vale para "novo" e para "editar".
 *
 * Mesma regra da listagem: o CHROME aparece inteiro na hora (cabeçalho,
 * breadcrumb, cartões de seção, rodapé de ações) e só o conteúdo dos campos
 * fica em placeholder. Sem isso, quem clica em "Editar" continua olhando o
 * esqueleto da LISTAGEM — o `loading.tsx` de /produtos era a fronteira mais
 * próxima — e a tela parece travada em vez de estar carregando.
 *
 * Este arquivo também é o que torna o cadastro PREFETCHÁVEL: rota dinâmica sem
 * `loading` não é pré-buscada pelo Next, então o JS do formulário só começava a
 * baixar depois do clique.
 */
export function CadastroProdutoSkeleton({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {/* ── Cabeçalho: desenho real do PageHeader, sem os handlers ── */}
      <header className="border-b border-line bg-surface">
        <div className="flex flex-col gap-1 px-4 py-3 sm:px-8">
          <nav className="flex items-center gap-1.5 text-xs text-muted" aria-hidden>
            <span>Produtos</span>
            <span className="text-faint">/</span>
            <span className="text-ink-2">{titulo}</span>
          </nav>
          <div className="flex items-center gap-2.5">
            <SkBarra className="h-8 w-8 rounded-[var(--radius-sm)]" />
            <h1 className="font-display text-lg font-semibold text-ink">{titulo}</h1>
            <SkBarra className="h-5 w-24 rounded-[var(--radius-sm)]" />
          </div>
        </div>
      </header>

      <div className="px-4 pb-28 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_324px]">
          {/* Coluna principal */}
          <div className="flex flex-col gap-4">
            <Secao titulo="Identificação">
              <div className="flex items-end gap-3">
                <SkBarra className="h-16 w-16 shrink-0 rounded-[var(--radius)]" />
                <Campo className="flex-1" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Campo />
                <Campo />
              </div>
            </Secao>

            <Secao titulo="Preço e custo">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Campo />
                <Campo />
                <Campo />
              </div>
            </Secao>

            <Secao titulo="Estoque">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Campo />
                <Campo />
              </div>
            </Secao>
          </div>

          {/* Coluna lateral */}
          <div className="flex flex-col gap-4">
            <Secao titulo="Classificação">
              <Campo />
              <Campo />
            </Secao>
            <Secao titulo="Fornecimento">
              <Campo />
            </Secao>
          </div>
        </div>
      </div>

      {/* Rodapé sticky de ações — o formulário real põe Salvar/Cancelar aqui */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-2)] backdrop-blur sm:mx-8 sm:px-6">
        <SkBarra className="h-9 w-24 rounded-full" />
        <SkBarra className="h-9 w-32 rounded-full" />
      </div>

      <span className="sr-only" role="status">Carregando cadastro…</span>
    </div>
  );
}

/** Cartão de seção — mesmo desenho do `SectionBlock` do formulário. */
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-1)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-2">
          {titulo}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}

/** Rótulo + caixa de campo, na altura exata do `Input` real (h-9). */
function Campo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <SkBarra className="h-2.5 w-20" />
      <div className="mt-1.5 h-9 rounded-[var(--radius-sm)] border border-line bg-surface-2" aria-hidden />
    </div>
  );
}
