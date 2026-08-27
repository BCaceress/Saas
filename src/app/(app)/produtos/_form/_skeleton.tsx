import { ChevronRight, ArrowLeft, ImagePlus } from "lucide-react";
import { SkBarra } from "../_skeleton";

/**
 * Esqueleto do cadastro de produto — vale para "novo" e para "editar".
 *
 * Mesma regra da listagem: o CHROME aparece inteiro na hora (cabeçalho,
 * breadcrumb, faixas do cartão, rodapé de ações) e só o conteúdo dos campos
 * fica em placeholder. Sem isso, quem clica em "Editar" continua olhando o
 * esqueleto da LISTAGEM — o `loading.tsx` de /produtos era a fronteira mais
 * próxima — e a tela parece travada em vez de estar carregando.
 *
 * O desenho espelha o `SimpleProductForm` MEDIDA A MEDIDA: um cartão só de
 * largura cheia, três faixas (Identificação / Classificação e preço / Estoque)
 * mais a gaveta de códigos de compra. Campo é `h-11` porque o `Input` real é
 * `h-11` — a versão antiga desenhava duas colunas, cartões soltos e caixas
 * `h-9`, e a tela inteira pulava no instante da troca.
 *
 * Este arquivo também é o que torna o cadastro PREFETCHÁVEL: rota dinâmica sem
 * `loading` não é pré-buscada pelo Next, então o JS do formulário só começava a
 * baixar depois do clique.
 */
export function CadastroProdutoSkeleton({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {/* ── Cabeçalho: desenho real do PageHeader, sem os handlers ── */}
      <header className="border-b border-line pb-4">
        <div className="mx-auto w-full max-w-none sm:px-8">
          <nav className="mb-1.5" aria-hidden>
            <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
              <li className="flex items-center gap-1">
                <span className="px-0.5">Produtos</span>
                <ChevronRight size={14} className="text-faint" />
              </li>
              <li className="px-0.5 font-medium text-ink-2">{titulo}</li>
            </ol>
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-faint"
              >
                <ArrowLeft size={17} />
              </span>
              <h1 className="truncate font-display text-[21px] font-semibold leading-tight tracking-tight text-ink">
                {titulo}
              </h1>
              <SkBarra className="h-5 w-24" />
            </div>
          </div>
        </div>
      </header>

      {/* pb-6 e não pb-28: o rodapé é `sticky`, ele mesmo ocupa o fim do fluxo. */}
      <div className="px-4 pb-6 sm:px-8">
        <div className="flex w-full flex-col gap-4">
          <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-1)]">
            {/* ── Faixa 1 · Identificação ── */}
            <div className="flex flex-col gap-4 p-5 sm:p-6">
              <Rotulo className="text-brand-strong">Identificação</Rotulo>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex shrink-0 flex-col items-center gap-1.5">
                  <div
                    aria-hidden
                    className="grid h-[92px] w-[92px] place-items-center rounded-[var(--radius-lg)] border border-line-strong bg-surface-2"
                  >
                    <ImagePlus size={22} className="text-faint" />
                  </div>
                  <SkBarra className="h-3 w-16" />
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                  <Campo className="xl:col-span-3" />
                  <Campo className="min-w-0 xl:col-span-9" />
                </div>
              </div>
            </div>

            {/* ── Faixa 2 · Classificação e preço ── */}
            <div className="flex flex-col gap-4 border-t border-line bg-surface-2/30 p-5 sm:p-6">
              <Rotulo>Classificação e preço</Rotulo>

              <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                <Campo className="xl:col-span-3" />
                <Campo className="xl:col-span-3" />
                <Campo className="xl:col-span-2" />
                <Campo className="xl:col-span-2" />
              </div>

              {/* Caixa do +18 e a linha de atalhos ("Personalizar SKU") */}
              <SkBarra className="h-4 w-64" />
              <SkBarra className="h-3 w-36" />
            </div>

            {/* ── Faixa 3 · Estoque ── */}
            <div className="flex flex-col gap-4 border-t border-line p-5 sm:p-6">
              <Rotulo>Estoque</Rotulo>

              <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                <Campo className="xl:col-span-3" hint />
                <Campo className="xl:col-span-2" />
                <Campo className="xl:col-span-2" />
                <Campo className="xl:col-span-3" hint />
              </div>

              <SkBarra className="h-3 w-28" />
            </div>

            {/* ── Gaveta dos códigos de compra (fechada) ── */}
            <div className="flex items-center gap-2 border-t border-line px-5 py-4 sm:px-6">
              <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden />
              <span className="text-sm text-muted">Códigos de barras de compra</span>
            </div>
          </section>
        </div>
      </div>

      {/* Rodapé sticky de ações — o formulário real põe Salvar/Cancelar aqui */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-2)] backdrop-blur sm:mx-8 sm:px-6">
        <SkBarra className="mr-auto hidden h-4 w-32 sm:block" />
        <SkBarra className="h-11 w-24 rounded-full" />
        <SkBarra className="h-11 w-32 rounded-full" />
      </div>

      <span className="sr-only" role="status">Carregando cadastro…</span>
    </div>
  );
}

/** Eyebrow de faixa — mesmo desenho do `Eyebrow as="h2"` do formulário. */
function Rotulo({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h2 className={`font-mono text-[11px] uppercase tracking-[0.18em] text-muted ${className ?? ""}`}>
      {children}
    </h2>
  );
}

/**
 * Rótulo + caixa de campo, na altura exata do `Input` real (h-11) e com o
 * mesmo `gap-1.5` do `Field`. `hint` reserva a linha de apoio dos campos que
 * têm uma — sem ela, a grade encolhe quando o formulário real chega.
 */
function Campo({ className, hint = false }: { className?: string; hint?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <SkBarra className="h-3 w-24" />
      <div
        className="h-11 rounded-[var(--radius)] border border-line-strong bg-surface-2"
        aria-hidden
      />
      {hint && <SkBarra className="h-2.5 w-32" />}
    </div>
  );
}
