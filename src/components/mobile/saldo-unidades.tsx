import { BottleWine } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Saldo como o operador conta na prateleira: UNIDADES fechadas, mais o aviso de
 * que existe uma embalagem aberta.
 *
 * Por que não usar `unidadeBase`: para uma garrafa de 1000 ml, `unidadeBase` é
 * ML — mas `estoqueFechado` conta GARRAFAS, não mililitros. Escrever "12 ml"
 * embaixo de doze garrafas foi o defeito que este componente elimina. O ml/g só
 * descreve `estoqueAberto`, a sobra da que está em uso, e como só existe uma
 * aberta por vez o número não interessa: interessa que ela existe — mesma
 * leitura da lista de produtos do computador.
 */

export function SaldoUn({
  fechado,
  aberto = 0,
  className,
  tom,
}: {
  fechado: number;
  aberto?: number;
  className?: string;
  /** Classe de cor do número (o chamador decide o que é pouco). */
  tom?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn("font-medium tabular-nums", tom)}>
        {fechado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
      </span>
      <span className="text-muted">un</span>
      {aberto > 0 && <AbertaBadge />}
    </span>
  );
}

/** "+ 1 aberta" — mesmo sinal e mesmo ícone da tela de produtos do computador. */
export function AbertaBadge({ size = 13 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-warn">
      <span className="text-[12px] leading-none font-bold">+</span>
      <span className="inline-flex items-center rounded-full bg-warn/10 p-0.5">
        <BottleWine size={size} className="shrink-0" aria-label="Tem uma aberta" />
      </span>
      <span className="text-[11px] font-medium">1 aberta</span>
    </span>
  );
}
