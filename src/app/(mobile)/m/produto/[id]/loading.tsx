import { Sk } from "@/components/app/skeletons";
import { SkCabecalho, SkTela } from "@/components/mobile/esqueleto";

/**
 * Ficha do produto: identificação, preço/custo lado a lado, saldo, e a grade
 * de seis ações. A grade tem a altura certa porque é ela que o polegar procura
 * — se aparecesse depois, o toque cairia no lugar errado.
 */
export default function ProdutoLoading() {
  return (
    <SkTela rotulo="Carregando o produto">
      <SkCabecalho descricao={false} />

      <div className="space-y-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <Sk className="h-5 w-2/3 rounded-md" />
        <Sk className="h-3 w-24 rounded-md" />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Sk className="h-14 rounded-xl" />
          <Sk className="h-14 rounded-xl" />
        </div>
        <Sk className="h-16 rounded-xl" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Sk key={i} className="h-16 rounded-xl" />
        ))}
      </div>

      <Sk className="h-12 w-full rounded-full" />
    </SkTela>
  );
}
