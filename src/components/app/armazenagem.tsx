import { Box, Refrigerator, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StorageType } from "@/generated/prisma";

// ============================================================
// Como um local de armazenagem se apresenta: nome, ícone e cor.
//
// Isto vivia copiado em meia dúzia de telas (listagem, saldos, contagem no
// celular, ficha do produto, sites…) e as cópias já tinham começado a
// divergir. Congelado azul numa tela e cinza noutra faz o operador achar que
// são coisas diferentes — e ele confere o freezer duas vezes por causa disso.
// ============================================================

export const STORAGE_LABEL: Record<StorageType, string> = {
  AMBIENTE: "Ambiente",
  REFRIGERADO: "Refrigerado",
  CONGELADO: "Congelado",
};

export const STORAGE_COLOR: Record<StorageType, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

/** Só o componente do ícone — para quem precisa renderizar com props próprias. */
export const STORAGE_COMPONENTE: Record<StorageType, React.ElementType> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};

/** Ícone do tipo, já na cor dele. `className` só acrescenta (posição, opacidade). */
export function StorageIcon({
  tipo,
  size = 14,
  className,
}: {
  tipo: StorageType;
  size?: number;
  className?: string;
}) {
  const Icone = STORAGE_COMPONENTE[tipo];
  return (
    <Icone
      size={size}
      aria-hidden
      className={cn(STORAGE_COLOR[tipo], className)}
    />
  );
}
