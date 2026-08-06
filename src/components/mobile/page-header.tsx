import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de tela do `/m`. Fica no fluxo (não gruda): o cabeçalho do shell já
 * é sticky, e dois elementos grudados no topo comem metade de uma tela de 390px.
 *
 * O botão de voltar é explícito e opcional em vez de automático: o gesto do
 * sistema já resolve o "voltar" trivial, e um botão que às vezes aparece e às
 * vezes não desloca o título de tela em tela.
 */
export function MobilePageHeader({
  titulo,
  descricao,
  voltar,
  acao,
  className,
}: {
  titulo: string;
  /** ReactNode e não string: número de pedido e SKU vão em mono. */
  descricao?: React.ReactNode;
  /** Href do destino de volta. Sem isto, não há botão. */
  voltar?: string;
  /** Ação à direita do título (um botão, um filtro). */
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-start gap-2", className)}>
      {voltar && (
        <Link
          href={voltar}
          aria-label="Voltar"
          className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="font-display text-xl leading-tight font-semibold text-ink">
          {titulo}
        </h1>
        {descricao && <div className="mt-0.5 text-sm text-ink-2">{descricao}</div>}
      </div>

      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}
