"use client";

import Link, { useLinkStatus } from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Linha de lista que navega — a forma padrão do "Mais".
 *
 * Existe como componente de cliente por um motivo só: a seta da direita vira
 * rodinha enquanto a rota de destino não chega (`useLinkStatus`). No celular,
 * um toque sem retorno visível se lê como app travado, e destinos como o
 * quiosque resolvem sessão, loja e catálogo antes de pintar o primeiro pixel.
 *
 * O ícone e o rótulo continuam vindo do servidor como `children`: componente
 * não atravessa a fronteira RSC, ReactNode atravessa.
 */
export function LinhaLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        className,
      )}
    >
      {children}
      <Indicador />
    </Link>
  );
}

/** Seta em repouso, rodinha em trânsito — mesmo tamanho, sem pulo de layout. */
function Indicador() {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden />
  ) : (
    <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
  );
}
