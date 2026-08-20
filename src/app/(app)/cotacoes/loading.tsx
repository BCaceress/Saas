import { cn } from "@/lib/utils";
import { Sk, SkPageHeader } from "@/components/app/skeletons";

/**
 * Esqueleto do planejamento de cotações.
 *
 * Espelha o que vem depois, peça por peça — cabeçalho com as duas ações,
 * a régua de filtros, o par de botões de formato e a grade de cartões (o
 * formato padrão). Um bloco genérico faria a tela "pular" quando os dados
 * chegassem; assim ela só ganha conteúdo no lugar onde já estava.
 */
export default function CotacoesLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando as cotações"
    >
      <SkPageHeader actions={2} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {["w-16", "w-22", "w-38", "w-30", "w-16"].map((w, i) => (
            <Sk key={i} className={cn("h-7 rounded-full", w)} />
          ))}
        </div>
        <div className="flex gap-0.5 rounded-full border border-line p-0.5">
          <Sk className="h-8 w-8 rounded-full" />
          <Sk className="h-8 w-8 rounded-full" />
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4"
          >
            {/* Número da cotação · etiqueta de status */}
            <div className="flex items-center justify-between gap-2">
              <Sk className="h-3 w-20" />
              <Sk className="h-4 w-24 rounded-full" />
            </div>

            {/* Título */}
            <Sk className="h-4 w-4/5" />

            {/* Itens · fornecedores · prazo */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 pr-9">
              <Sk className="h-3 w-14" />
              <Sk className="h-3 w-28" />
              <Sk className="h-3 w-24" />
            </div>

            {/* Melhor proposta, atrás da divisória */}
            <div className="mt-1 border-t border-line pt-2">
              <Sk className="h-4.5 w-32" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
