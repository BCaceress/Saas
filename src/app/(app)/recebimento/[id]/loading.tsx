import { Sk, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton de um recebimento. Espelha o que as duas etapas têm em comum —
 * voltar + identificação — e a lista de itens logo abaixo: o esqueleto promete
 * a tela que vai abrir, não uma genérica.
 */
export default function RecebimentoLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando o recebimento"
    >
      <div className="flex items-start gap-3">
        <Sk className="mt-1 h-9 w-9 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Sk className="h-3 w-20" />
          <Sk className="h-5 w-56" />
          <Sk className="h-3.5 w-44" />
        </div>
        <Sk className="mt-1 h-9 w-9 shrink-0 rounded-full" />
      </div>

      <SkTable rows={8} thumb />
    </div>
  );
}
