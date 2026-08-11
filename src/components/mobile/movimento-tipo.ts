import {
  ArrowLeftRight,
  Boxes,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Tom } from "@/components/mobile/ui";

/**
 * Rótulo, ícone e tom de cada tipo de `StockMovement` — fonte única do resumo
 * da home (`_ultimas`) e do extrato (`/m/movimentacoes`). Sem import de banco,
 * então serve server e client component.
 */

export type RotuloMovimento = { label: string; icone: LucideIcon; tom: Tom };

export const MOV_TIPO: Record<string, RotuloMovimento> = {
  ENTRADA: { label: "Entrada", icone: PackagePlus, tom: "ok" },
  SAIDA: { label: "Saída", icone: PackageMinus, tom: "info" },
  AJUSTE: { label: "Ajuste", icone: SlidersHorizontal, tom: "warn" },
  TRANSFERENCIA: { label: "Transferência", icone: ArrowLeftRight, tom: "brand" },
  ABERTURA: { label: "Abertura de unidade", icone: Boxes, tom: "accent" },
  PRODUCAO: { label: "Produção", icone: Boxes, tom: "violeta" },
  PERDA: { label: "Perda", icone: TriangleAlert, tom: "danger" },
  DEVOLUCAO_CLIENTE: { label: "Devolução do cliente", icone: Undo2, tom: "ok" },
  DEVOLUCAO_FORNECEDOR: { label: "Devolução ao fornecedor", icone: Undo2, tom: "warn" },
};

export const MOV_PADRAO: RotuloMovimento = {
  label: "Movimentação",
  icone: Boxes,
  tom: "neutro",
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
  if (m.venda) return { label: "Venda", icone: ShoppingCart, tom: "accent" };
  if (m.compra && m.tipo === "ENTRADA") return { ...base, label: "Entrada de compra" };
  if (m.transferencia) return { label: "Transferência", icone: ArrowLeftRight, tom: "brand" };
  return base;
}
