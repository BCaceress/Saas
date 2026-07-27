import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Faixa de cobrança no topo do app.
//
// Aparece só quando há algo a fazer (teste acabando, conta suspensa) — banner
// permanente vira papel de parede e ninguém lê. O texto diz o prazo e o botão
// leva direto ao pagamento: aviso sem saída é só ansiedade.
// ============================================================

const TOM = {
  info: {
    caixa: "border-brand/30 bg-brand-soft text-brand-strong",
    Icone: Clock,
  },
  alerta: {
    caixa: "border-warn/40 bg-warn-soft text-warn",
    Icone: AlertTriangle,
  },
  bloqueio: {
    caixa: "border-danger/40 bg-danger-soft text-danger",
    Icone: Lock,
  },
} as const;

export function FaixaAssinatura({
  tom,
  texto,
  podeAssinar,
}: {
  tom: keyof typeof TOM;
  texto: string;
  /** Só administrador resolve cobrança — para os demais, o link só frustra. */
  podeAssinar: boolean;
}) {
  const { caixa, Icone } = TOM[tom];

  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border px-4 py-3 text-sm",
        caixa,
      )}
    >
      <Icone size={16} className="shrink-0" aria-hidden />
      <span className="font-medium">{texto}</span>
      {podeAssinar ? (
        <Link
          href="/configuracoes/plano"
          className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Ver plano
          <ArrowRight size={14} aria-hidden />
        </Link>
      ) : (
        <span className="ml-auto text-xs opacity-80">Fale com o administrador da conta.</span>
      )}
    </div>
  );
}
