import { Sk, SkPageHeader, SkKpis, SkChart } from "@/components/app/skeletons";

const FADE = "animate-[stagger-in_400ms_ease-out_both]";

/**
 * Skeleton do Centro de Operações. Espelha `page.tsx` na estrutura que causa
 * salto se divergir: mesmo `space-y-4 pb-6`, mesmo painel do assistente e a
 * mesma grade de 2 colunas dos widgets — antes eram 3 colunas + uma tabela que
 * a tela real não tem, e o conteúdo pulava na troca.
 *
 * A contagem de cards é o padrão (6 widgets de meia largura); quem oculta
 * widgets vê um bloco a menos aparecer, nunca um a mais desaparecer.
 */
export default function InicioLoading() {
  return (
    <div className="animate-pulse space-y-4 pb-6" aria-busy="true" aria-label="Carregando dashboard">
      <SkPageHeader actions={3} />

      <div
        className={`${FADE} flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5`}
        style={{ animationDelay: "0ms" }}
      >
        {/* 72px = RobotAvatar do painel real. */}
        <Sk className="h-18 w-18 shrink-0 rounded-2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
          <Sk className="h-3.5 w-44" />
          <Sk className="h-3.5 w-full max-w-md" />
          <Sk className="h-3.5 w-2/3 max-w-sm" />
          <div className="mt-2 flex gap-2">
            <Sk className="h-8 w-32 rounded-full" />
            <Sk className="h-8 w-28 rounded-full" />
          </div>
        </div>
      </div>

      <div className={FADE} style={{ animationDelay: "40ms" }}>
        <SkKpis count={4} />
      </div>

      <div className={`${FADE} grid grid-cols-1 gap-4 lg:grid-cols-2`} style={{ animationDelay: "80ms" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkChart key={i} />
        ))}
      </div>

      <style>{`
        @keyframes stagger-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[stagger-in_400ms_ease-out_both\\] { animation: none !important }
        }
      `}</style>
    </div>
  );
}
