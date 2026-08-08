import { Sk } from "@/components/app/skeletons";
import { cn } from "@/lib/utils";

/**
 * Esqueletos do `/m`.
 *
 * Existem porque cada tela do celular espera o servidor resolver tenant, loja e
 * consulta antes de pintar UM pixel — e sem `loading.tsx` o Next segura a
 * navegação inteira nesse tempo: a pessoa toca na aba e nada acontece, o que no
 * celular se lê como app travado, não como app carregando.
 *
 * O desenho não é decorativo: cada bloco tem a ALTURA do conteúdo que vai
 * substituí-lo, para a tela não pular quando os dados chegam. Por isso não há
 * um esqueleto genérico só — as telas de lista, ficha e câmera têm formas
 * diferentes demais para um placeholder servir para as três.
 */

/** Cabeçalho de tela: título e, opcionalmente, a linha de descrição. */
export function SkCabecalho({ descricao = true }: { descricao?: boolean }) {
  return (
    <div className="mb-3">
      <Sk className="h-6 w-40 rounded-md" />
      {descricao && <Sk className="mt-1.5 h-4 w-56 rounded-md" />}
    </div>
  );
}

/** Cartão de lista: título, subtítulo e um valor à direita. */
export function SkCartaoLista({ acoes = false }: { acoes?: boolean }) {
  return (
    <li className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Sk className="h-4 w-3/5 rounded-md" />
          <Sk className="h-3 w-20 rounded-md" />
        </div>
        <Sk className="h-6 w-12 shrink-0 rounded-md" />
      </div>
      {acoes && (
        <div className="flex divide-x divide-line border-t border-line">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex-1 p-3">
              <Sk className="mx-auto h-4 w-14 rounded-md" />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function SkLista({
  itens = 6,
  acoes = false,
  className,
}: {
  itens?: number;
  acoes?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2", className)}>
      {Array.from({ length: itens }).map((_, i) => (
        <SkCartaoLista key={i} acoes={acoes} />
      ))}
    </ul>
  );
}

/** Fila de chips roláveis (filtros). */
export function SkChips({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <Sk key={i} className="h-9 w-24 shrink-0 rounded-full" />
      ))}
    </div>
  );
}

export function SkBusca() {
  return <Sk className="h-11 w-full rounded-full" />;
}

/**
 * Casca de tela do `/m`.
 *
 * `aria-busy` + rótulo: para quem usa leitor de tela, um esqueleto sem isso é
 * silêncio — a tela some e nada é anunciado até os dados chegarem.
 */
export function SkTela({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label={rotulo}>
      {children}
    </div>
  );
}
