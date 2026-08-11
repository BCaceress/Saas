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

/**
 * "+ 1 aberta" — só texto.
 *
 * Sem ícone de garrafa: o catálogo não é só bebida (o mesmo sinal aparece em
 * saco de café e em galão de detergente), e num cartão de lista o desenho
 * competia com o número, que é o que se lê.
 */
export function AbertaBadge() {
  return (
    <span className="text-[11px] font-medium whitespace-nowrap text-warn">+ 1 aberta</span>
  );
}
