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

/**
 * Árvore canônica de categorias (2 níveis). skuPrefix lidera o SKU
 * (BEB-CER-####) e é IMUTÁVEL depois de criado — ver `Category.skuPrefix`.
 *
 * É também o alvo de `scripts/ajustar-categorias.ts`, que sincroniza um tenant
 * já existente com esta lista. Por isso o prefixo é a CHAVE de identidade aqui:
 * trocar o `nome` de uma linha mantendo o prefixo = renomear a subcategoria em
 * quem já existe; trocar o prefixo = criar outra e marcar a antiga como extra.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  {
    nome: "Bebidas",
    skuPrefix: "BEB",
    subcategories: [
      { nome: "Águas", skuPrefix: "AGU", storage: "AMBIENTE", fiscalKey: "agua" },
      { nome: "Refrigerantes e Tônicas", skuPrefix: "REF", storage: "REFRIGERADO", fiscalKey: "refrigerante" },
      { nome: "Aperitivos e Conhaques", skuPrefix: "APE", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Cachaças", skuPrefix: "CAC", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Cervejas", skuPrefix: "CER", storage: "REFRIGERADO", fiscalKey: "cerveja" },
      { nome: "Ice e Beats", skuPrefix: "ICE", storage: "REFRIGERADO" },
      { nome: "Sucos e Chás", skuPrefix: "SUC", storage: "REFRIGERADO", fiscalKey: "suco" },
      { nome: "Copões e Doses", skuPrefix: "COP", storage: "REFRIGERADO" },
      { nome: "Coquetéis", skuPrefix: "COQ", storage: "REFRIGERADO" },
      { nome: "Energéticos", skuPrefix: "ENE", storage: "REFRIGERADO", fiscalKey: "energetico" },
      { nome: "Vinhos e Espumantes", skuPrefix: "VIN", storage: "AMBIENTE", fiscalKey: "vinho" },
      { nome: "Gins", skuPrefix: "GIN", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Licores", skuPrefix: "LIC", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Runs e Tequilas", skuPrefix: "RUN", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Vodkas", skuPrefix: "VOD", storage: "AMBIENTE", fiscalKey: "destilado" },
      { nome: "Whiskies", skuPrefix: "WHI", storage: "AMBIENTE", fiscalKey: "destilado" },
    ],
  },
  {
    nome: "Bomboniere",
    skuPrefix: "BOM",
    subcategories: [
      { nome: "Balas e Chicletes", skuPrefix: "BAL", storage: "AMBIENTE" },
      { nome: "Biscoitos", skuPrefix: "BIS", storage: "AMBIENTE" },
      { nome: "Chocolates e Bombons", skuPrefix: "CHO", storage: "AMBIENTE" },
      { nome: "Doces", skuPrefix: "DOC", storage: "AMBIENTE" },
      { nome: "Salgadinhos", skuPrefix: "SAL", storage: "AMBIENTE" },
    ],
  },
  {
    nome: "Mercearia",
    skuPrefix: "MER",
    subcategories: [
      { nome: "Alimentos", skuPrefix: "ALI", storage: "AMBIENTE" },
      { nome: "Higiene Pessoal", skuPrefix: "HIG", storage: "AMBIENTE" },
      { nome: "Limpeza", skuPrefix: "LIM", storage: "AMBIENTE" },
    ],
  },
  {
    nome: "Congelados",
    skuPrefix: "CON",
    subcategories: [
      { nome: "Sorvetes e Picolés", skuPrefix: "SOR", storage: "CONGELADO" },
      { nome: "Gelos", skuPrefix: "GEL", storage: "CONGELADO" },
    ],
  },
  {
    nome: "Tabacaria",
    skuPrefix: "TAB",
    subcategories: [
      { nome: "Narguilé", skuPrefix: "NAR", storage: "AMBIENTE" },
      { nome: "Cigarros", skuPrefix: "CIG", storage: "AMBIENTE" },
      { nome: "Dichavadores e Compartimentos", skuPrefix: "DIC", storage: "AMBIENTE" },
      { nome: "Fumos, Sedas e Piteiras", skuPrefix: "FUM", storage: "AMBIENTE" },
      { nome: "Isqueiros", skuPrefix: "ISQ", storage: "AMBIENTE" },
    ],
  },
  {
    nome: "Utilidades",
    skuPrefix: "UTI",
    subcategories: [
      { nome: "Acessórios Gerais", skuPrefix: "ACG", storage: "AMBIENTE" },
      { nome: "Acessórios Eletrônicos", skuPrefix: "ACE", storage: "AMBIENTE" },
      { nome: "Churrasco", skuPrefix: "CHU", storage: "AMBIENTE" },
      { nome: "Descartáveis", skuPrefix: "DES", storage: "AMBIENTE" },
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
