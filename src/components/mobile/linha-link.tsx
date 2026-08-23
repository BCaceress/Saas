"use client";

import Link, { useLinkStatus } from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";

/**
 * Linha de lista que navega — a forma padrão do "Menu".
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
  contarAlertas = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Mostra quantos alertas esperam neste destino.
   *
   * O menu era mudo: descobrir se havia cotação respondida ou pedido atrasado
   * custava entrar em cada tela. O provedor de alertas já faz UMA viagem por
   * carregamento (é o mesmo que alimenta o sino e a barra), então o número aqui
   * não custa consulta nenhuma.
   */
  contarAlertas?: boolean;
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
      {contarAlertas && <Contador href={href} />}
      <Indicador />
    </Link>
  );
}

/** Número de alertas do destino. Não renderiza nada quando não há. */
function Contador({ href }: { href: string }) {
  const { contar, prioridadeDe } = useAlerts();
  const total = contar(href);
  if (total === 0) return null;

  // Cor pela pior prioridade da rota — o mesmo critério do sino, para "3" em
  // vermelho e "3" em âmbar significarem aqui o que significam lá.
  const pior = prioridadeDe(href);
  const critico = pior === "critico" || pior === "alto";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        critico ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
      )}
    >
      {total}
    </span>
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
