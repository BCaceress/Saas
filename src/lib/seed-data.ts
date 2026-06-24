import type { StorageType } from "@/generated/prisma";

/**
 * Dados de seed por tenant (PRD §3.5). Inseridos com o tenantId do novo tenant
 * numa transação após criar a linha Tenant. Tudo editável depois.
 */

export type SeedFiscalProfile = {
  key: string; // referência interna p/ ligar à subcategoria
  nome: string;
  ncm: string;
  cest?: string;
  temSt?: boolean;
};

export type SeedSubcategory = {
  nome: string;
  skuPrefix: string;
  storage?: StorageType;
  fiscalKey?: string; // perfil fiscal sugerido (default)
};

export type SeedCategory = {
  nome: string;
  skuPrefix: string;
  subcategories: SeedSubcategory[];
};

// Perfis fiscais TEMPLATE — nascem com precisaRevisao=true.
// Valores aproximados; NUNCA verdade sem revisão do contador (PRD §8.9).
export const SEED_FISCAL_PROFILES: SeedFiscalProfile[] = [
  { key: "cerveja", nome: "Cerveja (ST) — revisar", ncm: "22030000", cest: "0302100", temSt: true },
  { key: "refrigerante", nome: "Refrigerante (ST) — revisar", ncm: "22021000", cest: "0301400", temSt: true },
  { key: "agua", nome: "Água mineral — revisar", ncm: "22011000", cest: "0301000", temSt: true },
  { key: "energetico", nome: "Energético — revisar", ncm: "22029900", cest: "0301600", temSt: true },
  { key: "suco", nome: "Suco / néctar — revisar", ncm: "22029900" },
  { key: "destilado", nome: "Destilado — revisar", ncm: "22085000" },
  { key: "vinho", nome: "Vinho — revisar", ncm: "22042100" },
  { key: "isotonico", nome: "Isotônico — revisar", ncm: "22029900", cest: "0301600" },
];

// Árvore de bebida (2 níveis). skuPrefix lidera o SKU (BEB-CER-####).
export const SEED_CATEGORIES: SeedCategory[] = [
  {
    nome: "Bebidas",
    skuPrefix: "BEB",
    subcategories: [
      { nome: "Cervejas", skuPrefix: "CER", storage: "REFRIGERADO", fiscalKey: "cerveja" },
      { nome: "Refrigerantes", skuPrefix: "REF", storage: "REFRIGERADO", fiscalKey: "refrigerante" },
      { nome: "Águas", skuPrefix: "AGU", storage: "AMBIENTE", fiscalKey: "agua" },
      { nome: "Energéticos", skuPrefix: "ENE", storage: "REFRIGERADO", fiscalKey: "energetico" },
      { nome: "Sucos", skuPrefix: "SUC", storage: "REFRIGERADO", fiscalKey: "suco" },
      { nome: "Isotônicos", skuPrefix: "ISO", storage: "REFRIGERADO", fiscalKey: "isotonico" },
      { nome: "Destilados", skuPrefix: "DES", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Vinhos e espumantes", skuPrefix: "VIN", storage: "AMBIENTE", fiscalKey: "vinho" },
      { nome: "Gelo", skuPrefix: "GEL", storage: "CONGELADO" },
    ],
  },
];

// Marcas nacionais grandes como ponto de partida (PRD §3.5).
export const SEED_BRANDS: string[] = [
  "Ambev",
  "Heineken",
  "Coca-Cola",
  "Brahma",
  "Skol",
  "Antarctica",
  "Itaipava",
  "Bohemia",
  "Original",
  "Spaten",
  "Stella Artois",
  "Budweiser",
  "Corona",
  "Amstel",
  "Red Bull",
  "Monster",
  "Schweppes",
  "Guaraná Antarctica",
  "Del Valle",
  "Pepsi",
];

// Locais de armazenagem iniciais (cadastro rápido — PRD §8.2).
export const SEED_STORAGE_LOCATIONS: { nome: string; tipo: StorageType }[] = [
  { nome: "Geladeira 1", tipo: "REFRIGERADO" },
  { nome: "Estoque seco", tipo: "AMBIENTE" },
  { nome: "Freezer", tipo: "CONGELADO" },
];
