import { Sk } from "@/components/app/skeletons";
import { SkTela } from "@/components/mobile/esqueleto";

/**
 * Esqueleto da HOME e o padrão de qualquer tela do `/m` que não trouxer o seu.
 *
 * Um `loading.tsx` cobre a rota e todas as filhas, então uma tela nova nasce
 * com resposta imediata ao toque sem ninguém precisar lembrar de criar o
 * arquivo. As telas de lista, ficha e câmera sobrescrevem com a sua forma.
 *
 * Vale para a home mesmo ela já ter `<Suspense>` nos blocos pesados: aqueles
 * cobrem os KPIs e a operação, mas a página ainda resolve tenant e loja antes
 * de devolver qualquer JSX — e é esse intervalo que aparece como toque sem
 * resposta.
 *
 * O cabeçalho do shell e a barra de polegar NÃO entram aqui: vivem no layout e
 * continuam na tela durante a troca — é o que faz a navegação parecer instantânea.
 */
export default function MobileLoading() {
  return (
    <SkTela rotulo="Carregando">
      <div className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0 flex-1 space-y-2">
          <Sk className="h-7 w-48 rounded-md" />
          <Sk className="h-4 w-32 rounded-md" />
        </div>
        <Sk className="h-10 w-10 shrink-0 rounded-full" />
      </div>

      <Sk className="h-28 w-full rounded-[var(--radius-lg)]" />

      <div className="space-y-2 pt-3">
        <Sk className="h-4 w-24 rounded-md" />
        <Sk className="h-20 w-full rounded-[var(--radius-lg)]" />
        <Sk className="h-20 w-full rounded-[var(--radius-lg)]" />
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Sk key={i} className="h-20 rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </SkTela>
  );
}
