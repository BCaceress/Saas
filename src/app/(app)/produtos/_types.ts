import type { ProductType, BaseUnit, StorageType, SalesChannel } from "@/generated/prisma";

/** Configuração de um produto num canal de venda online (§7). */
export type SalesChannelItem = {
  canal: SalesChannel;
  ativo: boolean;
  precoCanal: number | null;
  descricaoCanal: string | null;
};

export type ProductRow = {
  id: string;
  tipo: ProductType;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  marca: string | null;
  brandId: string | null;
  subcategoriaNome: string;
  subcategoryId: string;
  categoriaNome: string;
  precoVenda: number | null;
  custo: number | null;
  ativo: boolean;
  restricaoIdade: boolean;
  unidadeBase: BaseUnit;
  fracionavel: boolean;
  conteudoPorUnidade: number | null;
  vendeOnline: boolean;
  fiscalProfileId: string | null;
  estoque: {
    fechado: number;
    aberto: number;
    minimo: number;
    ideal: number;
    locationId: string | null;
  };
  fornecedorPrincipalId: string | null;
  custoFornecedor: number | null;
  /** COMBO/receita: disponibilidade derivada dos componentes (null = usa estoque próprio). */
  disponibilidadeDerivada: number | null;
  salesChannels: SalesChannelItem[];
  packagings: ProductPackagingItem[];
  fornecedores: { id: string; nome: string; isPrincipal: boolean }[];
  totalVendido: number;
};

/** Embalagem de compra de um produto (ex.: fardo de 6 unidades com EAN próprio). */
export type ProductPackagingItem = {
  id?: string;
  nome: string;
  ean: string | null;
  fatorConversao: number;
};

export type BrandOpt = { id: string; nome: string };
export type CategoryOpt = { id: string; nome: string };
export type SubcategoryOpt = {
  id: string;
  nome: string;
  categoriaNome: string;
  skuPrefix: string;
  categorySkuPrefix: string;
  defaultStorageType: StorageType | null;
  defaultFiscalProfileId: string | null;
};
export type CategoryNode = {
  id: string;
  nome: string;
  skuPrefix: string;
  subcategorias: { id: string; nome: string; skuPrefix: string; ativo: boolean }[];
};
export type StorageOpt = {
  id: string;
  nome: string;
  tipo: StorageType;
  ativo: boolean;
  siteId: string | null;
  siteNome: string | null;
};
export type SupplierRow = {
  id: string;
  cnpj: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  email: string | null;
  telefone: string | null;
  nomeContatoPrincipal: string | null;
  website: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  ativo: boolean;
};
export type FiscalOpt = {
  id: string;
  nome: string;
  ncm: string;
  precisaRevisao: boolean;
};

/** Produto candidato a item de combo/receita (alimenta o picker + derivação ao vivo). */
export type ComponentCandidate = {
  id: string;
  nome: string;
  sku: string;
  tipo: ProductType;
  imagemUrl: string | null;
  marca: string | null;
  precoVenda: number | null;
  custo: number | null;
  unidadeBase: BaseUnit;
  fracionavel: boolean;
  conteudoPorUnidade: number | null;
  restricaoIdade: boolean;
  estoqueFechado: number;
  estoqueAberto: number;
};

export type ComboComponentItem = { componentProductId: string; quantidade: number };

export type RecipeType = "DRINK" | "PRATO" | "OUTRO";
export type SelectionType = "UNICA" | "MULTIPLA";

export type ReceitaComponentItem = {
  componentProductId: string;
  quantidade: number;
  unidade: BaseUnit;
};

export type ReceitaGroupItem = {
  componentProductId: string;
  quantidade: number;
  unidade: BaseUnit;
  isDefault: boolean;
  acrescenta: boolean;
  acrescimoPreco?: number | null;
};

export type ReceitaComponentGroup = {
  id?: string;
  nome: string;
  obrigatoria: boolean;
  tipoSelecao: SelectionType;
  maxSelecoes: number | null;
  ordem: number;
  items: ReceitaGroupItem[];
};

/** Variação de tamanho de uma receita (P/M/G) — fator de escala sobre a ficha base (§5). */
export type ReceitaVariantItem = {
  id?: string;
  nome: string;
  volumeMl: number | null;
  fatorEscala: number;
  precoVenda: number | null;
  isDefault: boolean;
};

/** Receita/personalizado carregado para edição (cabeçalho + ficha técnica). */
export type ReceitaData = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  marca: string | null;
  brandId: string | null;
  subcategoryId: string;
  imagemUrl: string | null;
  precoVenda: number | null;
  fiscalProfileId: string | null;
  restricaoIdade: boolean;
  ativo: boolean;
  tipoReceita: RecipeType;
  copoMl: number | null;
  modoPreparo: string | null;
  vendeOnline: boolean;
  pesoGramas: number | null;
  descricaoOnline: string | null;
  components: ReceitaComponentItem[];
  groups: ReceitaComponentGroup[];
  variants: ReceitaVariantItem[];
  salesChannels: SalesChannelItem[];
};

/** Combo carregado para edição (cabeçalho + itens). */
export type ComboData = {
  id: string;
  nome: string;
  sku: string;
  marca: string | null;
  brandId: string | null;
  subcategoryId: string | null;
  imagemUrl: string | null;
  precoVenda: number | null;
  fiscalProfileId: string | null;
  restricaoIdade: boolean;
  ativo: boolean;
  vendeOnline: boolean;
  pesoGramas: number | null;
  descricaoOnline: string | null;
  components: ComboComponentItem[];
  salesChannels: SalesChannelItem[];
};
