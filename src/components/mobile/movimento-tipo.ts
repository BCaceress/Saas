import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BottleWine,
  Martini,
  PackageMinus,
  Pencil,
  ShoppingCart,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Tom } from "@/components/mobile/ui";

/**
 * Rótulo, ícone e tom de cada tipo de `StockMovement` — fonte única do resumo
 * da home (`_ultimas`), do extrato do celular (`/m/movimentacoes`) E da tela de
 * `/estoque/movimentacoes` do computador. Sem import de banco, então serve
 * server e client component.
 *
 * Uma entrada tem de ter a MESMA cor e o MESMO desenho nas duas superfícies:
 * quem confere no balcão pelo celular e depois audita no computador está lendo
 * o mesmo extrato — dois desenhos para "produção" viram dois conceitos na
 * cabeça de quem lê.
 */

export type RotuloMovimento = { label: string; icone: LucideIcon; tom: Tom };

export const MOV_TIPO: Record<string, RotuloMovimento> = {
  ENTRADA: { label: "Entrada", icone: ArrowDownLeft, tom: "ok" },
  SAIDA: { label: "Saída", icone: ArrowUpRight, tom: "danger" },
  AJUSTE: { label: "Ajuste", icone: Pencil, tom: "info" },
  TRANSFERENCIA: { label: "Transferência", icone: ArrowLeftRight, tom: "brand" },
  ABERTURA: { label: "Abertura", icone: BottleWine, tom: "neutro" },
  PRODUCAO: { label: "Produção", icone: Martini, tom: "violeta" },
  PERDA: { label: "Perda", icone: PackageMinus, tom: "danger" },
  DEVOLUCAO_CLIENTE: { label: "Devolução", icone: Undo2, tom: "ok" },
  DEVOLUCAO_FORNECEDOR: { label: "Devolução", icone: Undo2, tom: "danger" },
};

export const MOV_PADRAO: RotuloMovimento = {
  label: "Movimentação",
  icone: Pencil,
  tom: "neutro",
};

/** Selo de venda — saída que veio de `Sale`, e não da mão de alguém. */
export const MOV_VENDA: RotuloMovimento = {
  label: "Venda",
  icone: ShoppingCart,
  tom: "accent",
};

/**
 * O rótulo que o operador reconhece, não o do banco.
 *
 * A venda é uma SAIDA como outra qualquer no schema; quem a distingue é o
 * vínculo com `Sale`. Sem esta correção a tela diria "saída" o dia inteiro para
 * o que a loja chama de venda.
 */
export function rotuloMovimento(m: {
  tipo: string;
  venda?: boolean;
  compra?: boolean;
  transferencia?: boolean;
}): RotuloMovimento {
  const base = MOV_TIPO[m.tipo] ?? MOV_PADRAO;
  if (m.venda) return MOV_VENDA;
  if (m.compra && m.tipo === "ENTRADA") return { ...base, label: "Entrada de compra" };
  if (m.transferencia) return MOV_TIPO.TRANSFERENCIA!;
  return base;
}
