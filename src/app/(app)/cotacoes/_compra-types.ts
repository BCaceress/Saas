// DTOs das Compras (evolução do Quotation/RFQ) — tudo serializável
// (Decimal/Date já viram number/string no loader), porque atravessa a
// fronteira RSC → client.
//
// O nome é o mesmo dentro e fora: cotação. O rótulo de ANDAMENTO que o
// operador lê é derivado da contagem de convites (ver `_status.ts`), não uma
// coluna nova.

import type { Faixa, LimitesEscala } from "@/lib/compras/escalas";

export type CotacaoStatus = "RASCUNHO" | "ABERTA" | "ENCERRADA" | "DECIDIDA" | "CANCELADA";
export type ConviteStatus = "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";

/** Linha da lista de cotações. */
export type CotacaoRow = {
  id: string;
  numero: string;
  titulo: string;
  status: CotacaoStatus;
  siteNome: string;
  prazoResposta: string | null;
  criadaEm: string;
  totalItens: number;
  totalConvidados: number;
  totalRespondidos: number;
  /** Convites que responderam "não vou cotar" — não são resposta nem espera. */
  totalRecusados: number;
  /** Menor soma entre os fornecedores que responderam tudo — null se ninguém fechou. */
  melhorTotal: number | null;
};

/** Cards do topo da lista de cotações. */
export type ResumoCompras = {
  /** Cotações em RASCUNHO — ainda montando a lista. */
  planejamento: number;
  /** Cotações em ABERTA — pergunta feita, resposta pendente. */
  cotando: number;
  /** Σ quantidade × melhor preço conhecido por item, nas cotações ainda ativas
   *  (RASCUNHO/ABERTA/ENCERRADA) — calculado na leitura, sem coluna nova. */
  valorPrevisto: number;
};

export type ItemCotacao = {
  id: string;
  productId: string | null;
  packagingId: string | null;
  descricao: string;
  quantidade: number;
  observacao: string | null;
  ordem: number;
  /** Do produto vinculado — some quando o item é texto livre. */
  sku: string | null;
  imagemUrl: string | null;
  embalagemNome: string | null;
  /** Estoque na loja de destino da cotação — null quando o item não tem produto vinculado. */
  estoqueAtual: number | null;
  estoqueMinimo: number | null;
  /**
   * Unidades base dentro de uma embalagem pedida (caixa de 12 → 12). É o que
   * converte "3 caixas a mais" em "36 unidades na prateleira" — sem ele a
   * cobertura da compra por escala sairia doze vezes menor.
   */
  fatorEmbalagem: number;
  /**
   * Custo por unidade BASE do produto (médio, ou o de cadastro quando não há
   * média). É o que sustenta o "previsto" do rodapé antes de existir resposta:
   * quantidade × fatorEmbalagem × custo. null = produto sem custo conhecido, e
   * aí a previsão diz que está incompleta em vez de chutar zero.
   */
  custoUnitario: number | null;
  /** Média diária de saída na loja de destino, em unidades. null = sem histórico. */
  consumoDiarioUnidades: number | null;
  /**
   * Validade típica observada nos lotes anteriores, em dias — mediana de
   * (validade − entrada). null = nunca teve lote com data, e aí a trava de
   * validade não opina em vez de chutar.
   */
  validadeTipicaDias: number | null;
};

export type RespostaItem = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: number;
  quantidadeOfertada: number | null;
  marca: string | null;
  observacao: string | null;
  /** Promoção por volume informada pelo fornecedor. Vazio no caso comum. */
  faixas: Faixa[];
};

/** Pessoa do fornecedor que pode receber a cotação. */
export type ContatoConvite = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

/** Uma linha do histórico de envio: para quem foi, por onde e quando. */
export type EnvioConvite = {
  id: string;
  canal: "WHATSAPP" | "EMAIL";
  /** Contato que recebeu. É por ele que a fila sabe quem já foi. */
  contactId: string | null;
  contatoNome: string | null;
  destino: string | null;
  /** Quem entrou em cópia (só e-mail), já formatado para leitura. */
  copias: string | null;
  reenvio: boolean;
  sucesso: boolean;
  erro: string | null;
  enviadoEm: string;
};

export type ConviteCotacao = {
  id: string;
  supplierId: string;
  supplierNome: string;
  supplierLogoUrl: string | null;
  /** "Porto Alegre — RS". null quando o cadastro não tem endereço. */
  supplierPraca: string | null;
  /**
   * Valor mínimo de pedido exigido pelo fornecedor. Cotação abaixo disso nasce
   * morta — e dá para avisar enquanto a lista está sendo montada, não depois
   * de a resposta chegar.
   */
  supplierPedidoMinimo: number | null;
  /** Prazo de pagamento: o negociado do cadastro, ou o praticado nas notas. */
  supplierPrazoPagamentoDias: number | null;
  telefone: string | null;
  email: string | null;
  status: ConviteStatus;
  /** Contato escolhido para este convite — null cai no telefone da empresa. */
  contatoId: string | null;
  /** Todos os contatos do fornecedor: é a lista do "Trocar" no envio. */
  contatos: ContatoConvite[];
  /** Quem já recebeu, por qual canal e quando — mais novo primeiro. */
  envios: EnvioConvite[];
  enviadaEm: string | null;
  respondidaEm: string | null;
  /** Quando o fornecedor ABRIU o link. Separa "ignorou" de "está pensando". */
  abertoEm: string | null;
  /**
   * De onde vieram os preços. `"link"` = o próprio fornecedor preencheu na
   * tela pública; `"manual"` = o comprador digitou aqui, a partir de um áudio,
   * uma foto ou um telefonema. Null enquanto não há resposta.
   *
   * Não é detalhe: proposta digitada por terceiro carrega erro de transcrição
   * e não tem o fornecedor por trás dela se o preço for contestado.
   */
  origemResposta: "link" | "manual" | null;
  prazoEntregaDias: number | null;
  condicaoPagamento: string | null;
  frete: number | null;
  observacao: string | null;
  purchaseOrderId: string | null;
  respostas: RespostaItem[];
  /** Σ preço × quantidade pedida dos itens disponíveis + frete. */
  total: number;
  /** Quantos itens da cotação este fornecedor consegue atender. */
  itensAtendidos: number;
};

export type CotacaoDetalhe = {
  id: string;
  numero: string;
  titulo: string;
  status: CotacaoStatus;
  siteId: string;
  siteNome: string;
  /** Data do documento, declarada pelo comprador. Cai no `criadaEm` enquanto ninguém mexeu. */
  dataCotacao: string;
  prazoResposta: string | null;
  observacao: string | null;
  criadaEm: string;
  enviadaEm: string | null;
  /** A cotação pediu promoção por volume — liga a lente "Melhor oportunidade". */
  pedeEscala: boolean;
  /** Travas do comprador, do cadastro do tenant. A tela deixa afrouxar na hora. */
  limitesEscala: LimitesEscala;
  itens: ItemCotacao[];
  convites: ConviteCotacao[];
};

/** Produto disponível para entrar na lista de itens. */
export type ProdutoOpcao = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagings: { id: string; nome: string; isCompraDefault: boolean }[];
};

export type FornecedorOpcao = {
  id: string;
  nome: string;
  logoUrl: string | null;
  telefone: string | null;
  email: string | null;
  /** Contatos cadastrados — o principal já entra selecionado no envio. */
  contatos: ContatoConvite[];
  /**
   * Quantos itens DESTA cotação o fornecedor já entregou em NF-e, segundo o
   * histórico montado pelo XML. Zero quando a lista não foi informada.
   */
  jaForneceu: number;
  /** Última nota dele com algum item da lista. */
  ultimaCompraEm: string | null;
};

/**
 * A cotação anterior que serve de molde. Compra de mercado se repete: a lista
 * de cerveja da semana passada é quase a desta semana, e digitar tudo de novo
 * é o trabalho que o sistema existe para não cobrar.
 */
export type CotacaoAnterior = {
  id: string;
  numero: string;
  titulo: string;
  totalItens: number;
  criadaEm: string;
};

export type OpcoesCotacao = {
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
  sites: { id: string; nome: string }[];
};
