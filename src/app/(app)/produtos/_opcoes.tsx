"use client";

import { createContext, useContext } from "react";
import type {
  BrandOpt, CategoryFilterOpt, SiteOpt, SubcategoryFilterOpt, TagOpt,
} from "./_types";

/**
 * Opções dos filtros (categorias, marcas, lojas, etiquetas) vindas do layout.
 *
 * Ficam aqui, e não nas props da página, porque o layout não re-renderiza
 * quando só a query string muda: trocar de filtro deixou de custar quatro
 * consultas que devolvem sempre a mesma lista.
 */
export type OpcoesFiltro = {
  categoryOpts: CategoryFilterOpt[];
  subOpts: SubcategoryFilterOpt[];
  brandOpts: BrandOpt[];
  siteOpts: SiteOpt[];
  tagOpts: TagOpt[];
};

const VAZIO: OpcoesFiltro = {
  categoryOpts: [],
  subOpts: [],
  brandOpts: [],
  siteOpts: [],
  tagOpts: [],
};

const Ctx = createContext<OpcoesFiltro>(VAZIO);

export function OpcoesProvider({
  valor,
  children,
}: {
  valor: OpcoesFiltro;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useOpcoes(): OpcoesFiltro {
  return useContext(Ctx);
}
