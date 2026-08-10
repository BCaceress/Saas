import type {
  ProductType,
  BaseUnit,
  StorageType,
  SalesChannel,
  IndicadorIE,
} from "@/generated/prisma";

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
  categoryId: string;
  precoVenda: number | null;
  custo: number | null;
  ativo: boolean;
  restricaoIdade: boolean;
  unidadeBase: BaseUnit;
  /** Vende a unidade fechada no PDV. Convive com `fracionavel`. */
  vendaUnidade: boolean;
  /** Pode ser consumido parcialmente em drinks/receitas. */
  fracionavel: boolean;
  conteudoPorUnidade: number | null;
  /** Dose sugerida ao entrar numa receita (na unidadeBase). */
  dosePadrao: number | null;
  vendeOnline: boolean;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  descricaoOnline: string | null;
  fiscalProfileId: string | null;
  /** Fiscal por item — só preenchido quando a unidade tributável difere da de venda. */
  gtinTributavel: string | null;
  unidadeTributavel: string | null;
  fatorConversaoTrib: number | null;
  codigoAnp: string | null;
  estoque: {
    fechado: number;
    aberto: number;
    minimo: number;
    ideal: number;
    locationId: string | null;
    /** false = INSUMO fora do controle de estoque (não entra em /estoque). */
    controlado: boolean;
  };
  fornecedorPrincipalId: string | null;
  custoFornecedor: number | null;
  /** COMBO/receita: disponibilidade derivada dos componentes (null = usa estoque próprio). */
  disponibilidadeDerivada: number | null;
  salesChannels: SalesChannelItem[];
  packagings: ProductPackagingItem[];
  fornecedores: { id: string; nome: string; isPrincipal: boolean }[];
  /** Saldo por loja/local de armazenagem (§3: cada Stock é um site × produto). */
  locais: ProductLocationStock[];
};

export type ProductLocationStock = {
  siteId: string;
  siteNome: string;
  siteAtivo: boolean;
  locationNome: string | null;
  locationTipo: StorageType | null;
  /** null = estoque a nível de loja (sem local); false = local arquivado. */
  locationAtivo: boolean | null;
  fechado: number;
  aberto: number;
};

/** Embalagem de compra de um produto (ex.: fardo de 6 unidades com EAN próprio). */
export type ProductPackagingItem = {
  id?: string;
  nome: string;
  ean: string | null;
  fatorConversao: number;
};

// ── Listagem de /produtos (consulta no servidor) ─────────────────────────────

/** Valor sentinela do filtro de marca: produtos sem marca cadastrada. */
export const SEM_MARCA = "__sem";
/** Idem para etiquetas: produtos que não receberam nenhuma. */
export const SEM_TAG = "__sem";

export type ProdutoSortField =
  | "nome" | "marca" | "tipo" | "categoria" | "preco"
  | "margem" | "estoque" | "fornecedor" | "vendas" | "parado";
export type ProdutoSortDir = "asc" | "desc";

/** Filtros booleanos de higiene/negócio da listagem. */
export type ProdutoFlags = {
  semPreco: boolean;
  semImagem: boolean;
  semEan: boolean;
  semFiscal: boolean;
  online: boolean;
  maiorIdade: boolean;
};

export type ProdutoFiltro = {
  q: string;
  tipo: string;
  /** `cat:<id>` = categoria inteira; senão é subcategoryId. */
  sub: string;
  /** brandId, `""` = toda marca, `SEM_MARCA` = sem marca. */
  marca: string;
  fornecedorId: string;
  /** Loja (Site) onde o produto tem posição de estoque. */
  siteId: string;
  /** tagId, `""` = todas, `SEM_TAG` = produtos sem nenhuma etiqueta. */
  tag: string;
  /** "ativos" | "inativos" */
  status: string;
  flags: ProdutoFlags;
};

export type ProdutoConsulta = ProdutoFiltro & {
  sort: ProdutoSortField;
  dir: ProdutoSortDir;
  pagina: number;
  porPagina: number;
};

/** Giro de um produto — alimenta as colunas "Vendas 30d" e "Parado há". */
export type ProdutoGiro = { vendas30d: number; diasSemVenda: number | null };

export type ProdutosPagina = {
  rows: ProductRow[];
  giro: Record<string, ProdutoGiro>;
  /** Quantos produtos batem com o filtro (a página é uma fatia disto). */
  total: number;
  /** Quantos produtos o tenant tem no total, sem filtro nenhum. */
  totalGeral: number;
};

/** Visão salva da listagem (filtro + colunas + ordenação). */
export type ProdutoVisao = {
  id: string;
  nome: string;
  params: string;
  /** false = visão da loja inteira (criada sem dono). */
  minha: boolean;
};

export type TagOpt = { id: string; nome: string };
export type SiteOpt = { id: string; nome: string };

export type BrandOpt = { id: string; nome: string };
export type CategoryOpt = { id: string; nome: string };
/** Opção enxuta pro filtro de categoria da listagem. */
export type CategoryFilterOpt = { id: string; nome: string };
/** Opção enxuta pro filtro de subcategoria da listagem (não carrega skuPrefix/defaults do form). */
export type SubcategoryFilterOpt = { id: string; nome: string; categoriaNome: string; categoryId: string };
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
  logoUrl?: string | null;
  pedidoMinimo?: number | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  /** IBGE (7 dígitos) — chega preenchido quando o fornecedor vem de um XML. */
  codigoMunicipio: string | null;
  uf: string | null;
  ie: string | null;
  indicadorIE: IndicadorIE | null;
  ativo: boolean;
  createdAt?: string; // ISO
  totalProdutos?: number;
  proximaEntrega?: string | null; // ISO
  ultimaSolicitacao?: { numero: string; status: string; data: string } | null; // data ISO
  ultimosPedidos?: Array<{ id: string; numero: string; status: string; data: string; valorTotal: number }>;
  totalComprado30d?: number;
};
/** Opção enxuta pro picker de fornecedor no cadastro de produto (não carrega endereço/IE/contato). */
export type SupplierPickerOpt = {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
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
  /** Dose sugerida cadastrada no produto — vira a quantidade inicial na receita. */
  dosePadrao: number | null;
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
