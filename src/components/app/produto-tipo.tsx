import { Box, FlaskConical, Layers2, Martini, type LucideIcon } from "lucide-react";

/**
 * Tipo de produto — rótulo e ícone, fonte ÚNICA para as duas superfícies.
 *
 * Antes cada tela desenhava o seu: a lista usava garrafa para tudo que não
 * fosse insumo, o menu de "novo" usava outra tríade, e a ficha do celular uma
 * terceira. Quem cadastra um combo via três desenhos diferentes da mesma coisa.
 *
 * A escolha dos quatro é semântica, não decorativa:
 * - SIMPLES        caixa fechada — item de prateleira, vendido como veio
 * - INSUMO         dose — matéria-prima medida, entra em outra coisa
 * - COMBO          camadas — itens empilhados e vendidos como um só
 * - PERSONALIZADO  taça — receita montada na hora (o drink do balcão)
 *
 * Nenhum deles repete ícone de outra função da tela: o de código de barras é do
 * EAN, o de etiqueta é de preço. Tipo de produto tem família própria.
 *
 * Sem `"use client"`: são só constantes e um componente de forma, então serve
 * server component e client component sem duplicar o mapa.
 */

export const TIPO_LABEL: Record<string, string> = {
  SIMPLES: "Simples",
  INSUMO: "Insumo",
  COMBO: "Combo",
  PERSONALIZADO: "Receita",
};

export const TIPO_ICONE: Record<string, LucideIcon> = {
  SIMPLES: Box,
  INSUMO: FlaskConical,
  COMBO: Layers2,
  PERSONALIZADO: Martini,
};

/** O componente de ícone do tipo; cai em `Box` para tipo desconhecido. */
export function iconeTipo(tipo: string): LucideIcon {
  return TIPO_ICONE[tipo] ?? Box;
}

/** Ícone já renderizado — para quando o chamador só quer pôr no meio do texto. */
export function TipoIcone({
  tipo,
  size = 13,
  className,
}: {
  tipo: string;
  size?: number;
  className?: string;
}) {
  // Índice direto no mapa, e não `iconeTipo(tipo)`: uma CHAMADA que devolve
  // componente durante o render é lida pelo compilador do React como
  // "componente criado no render" (e remontaria a cada passada).
  const Icone = TIPO_ICONE[tipo] ?? Box;
  return <Icone size={size} className={className} aria-hidden />;
}

/**
 * Mapa pronto no tamanho do rótulo (13px), que é como a lista de produtos e a
 * paleta de comandos consomem. Telas com outra régua usam `iconeTipo`.
 */
export const TIPO_ICON: Record<string, React.ReactNode> = Object.fromEntries(
  Object.keys(TIPO_ICONE).map((t) => [t, <TipoIcone key={t} tipo={t} />]),
);
