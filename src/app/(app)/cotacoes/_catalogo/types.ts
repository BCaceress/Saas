import type {
  SupplierImportStatus,
  SupplierIntegrationKind,
  SupplierIntegrationStatus,
  SupplierMatchOrigem,
  SupplierMatchStatus,
} from "@/generated/prisma";

// Formas serializáveis (Decimal/Date já convertidos) que atravessam
// Server Component → Client Component neste módulo.

export type FornecedorCard = {
  id: string;
  nome: string;
  logoUrl: string | null;
  tipoIntegracao: SupplierIntegrationKind | null;
  situacaoIntegracao: SupplierIntegrationStatus;
  possuiIntegracao: boolean;
  aceitaImportacaoManual: boolean;
  aceitaImportacaoAutomatica: boolean;
  ultimaSincronizacao: string | null;
  totalProdutos: number;
  emPromocao: number;
  pendentes: number;
  pedidoMinimo: number | null;
  ativo: boolean;
};

export type ItemCatalogo = {
  id: string;
  descricao: string;
  codigoFornecedor: string | null;
  ean: string | null;
  marca: string | null;
  categoria: string | null;
  imagemUrl: string | null;
  unidade: string | null;
  preco: number;
  precoPromocional: number | null;
  precoEfetivo: number;
  emPromocao: boolean;
  quantidadeMinima: number | null;
  estoqueDisponivel: number | null;
  validadeOferta: string | null;
  ultimaAtualizacao: string;
  productId: string | null;
  produtoNome: string | null;
  produtoSku: string | null;
  matchStatus: SupplierMatchStatus;
  matchOrigem: SupplierMatchOrigem | null;
  ativo: boolean;
  /** Menor preço do mesmo produto entre todos os fornecedores. */
  melhorPrecoMercado: number | null;
  melhorFornecedor: string | null;
};

export type ImportacaoRow = {
  id: string;
  supplierId: string;
  supplierNome: string;
  tipo: SupplierIntegrationKind;
  origem: string;
  arquivoNome: string | null;
  arquivoTamanho: number | null;
  status: SupplierImportStatus;
  totalLinhas: number;
  itensLidos: number;
  itensNovos: number;
  itensAtualizados: number;
  itensSemVinculo: number;
  mensagem: string | null;
  erros: string[];
  usuario: string | null;
  createdAt: string;
  concluidoEm: string | null;
};

export type ItemCarrinho = {
  id: string;
  supplierId: string;
  supplierNome: string;
  catalogItemId: string | null;
  productId: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  precoUnitario: number;
  /** Menor preço do mesmo produto hoje — mostra quando dá para trocar. */
  melhorPreco: number | null;
  melhorFornecedorId: string | null;
  melhorFornecedorNome: string | null;
};

export type CarrinhoPorFornecedor = {
  supplierId: string;
  supplierNome: string;
  pedidoMinimo: number | null;
  itens: ItemCarrinho[];
  total: number;
};

export type PontoPreco = {
  data: string;
  preco: number;
  precoPromocional: number | null;
  precoEfetivo: number;
  emPromocao: boolean;
};

export type LinhaHistorico = {
  itemId: string;
  descricao: string;
  supplierId: string;
  supplierNome: string;
  produtoNome: string | null;
  precoAtual: number;
  precoAnterior: number | null;
  variacao: number | null;
  emPromocao: boolean;
  data: string;
};

export type ResumoEconomia = {
  economiaMes: number;
  fornecedorMaisBarato: { id: string; nome: string; vitorias: number } | null;
  fornecedorMaisUsado: { id: string; nome: string; pedidos: number } | null;
  maiorPromocao: { descricao: string; supplierNome: string; desconto: number; percentual: number } | null;
  pedidosMes: number;
  valorCompradoMes: number;
};
