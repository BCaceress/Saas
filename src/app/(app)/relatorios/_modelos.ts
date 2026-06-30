/**
 * Catálogo de relatórios em PDF (Fase 7 §11). Metadados puros — sem DB, sem
 * server-only — para serem importados tanto pelo catálogo (client) quanto pela
 * rota de documento (server). A geração de dados vive em `_documento-data.ts`;
 * aqui só descrevemos o que existe e como parametrizar.
 */

export type GrupoId = "operacao" | "financeiro" | "estoque" | "compras";

export type ModeloId =
  | "vendas-resumo"
  | "margem-produto"
  | "abc"
  | "caixa"
  | "estoque-posicao"
  | "estoque-ruptura"
  | "perdas"
  | "compras";

export type Modelo = {
  id: ModeloId;
  nome: string;
  descricao: string;
  grupo: GrupoId;
  /** Nome do ícone lucide (resolvido no client via mapa). */
  icon: string;
  /** Usa filtro de período? Estoque ao vivo (posição/ruptura) não usa. */
  usaPeriodo: boolean;
};

export const GRUPOS: { id: GrupoId; nome: string; descricao: string }[] = [
  { id: "operacao", nome: "Operação", descricao: "Dia a dia da loja — vendas, perdas e caixa." },
  { id: "financeiro", nome: "Financeiro", descricao: "Margem, rentabilidade e concentração de receita." },
  { id: "estoque", nome: "Estoque", descricao: "Posição atual, valor parado e ruptura." },
  { id: "compras", nome: "Compras", descricao: "Entradas por produto e por fornecedor." },
];

export const MODELOS: Modelo[] = [
  {
    id: "vendas-resumo",
    nome: "Resumo de vendas",
    descricao: "Faturamento, ticket, CMV e margem do período, com mix de pagamento e top produtos.",
    grupo: "operacao",
    icon: "ReceiptText",
    usaPeriodo: true,
  },
  {
    id: "perdas",
    nome: "Perdas e quebras",
    descricao: "Produtos baixados como perda no período, com custo total.",
    grupo: "operacao",
    icon: "TriangleAlert",
    usaPeriodo: true,
  },
  {
    id: "caixa",
    nome: "Fechamentos de caixa",
    descricao: "Sessões fechadas no período: esperado × contado e quebra por caixa.",
    grupo: "operacao",
    icon: "Wallet",
    usaPeriodo: true,
  },
  {
    id: "margem-produto",
    nome: "Margem por produto",
    descricao: "Receita, CMV e margem de cada produto vendido no período.",
    grupo: "financeiro",
    icon: "Percent",
    usaPeriodo: true,
  },
  {
    id: "abc",
    nome: "Curva ABC",
    descricao: "Classificação A/B/C dos produtos por participação no faturamento.",
    grupo: "financeiro",
    icon: "ChartColumnBig",
    usaPeriodo: true,
  },
  {
    id: "estoque-posicao",
    nome: "Posição de estoque",
    descricao: "Saldo atual por produto e site, com valor parado em estoque.",
    grupo: "estoque",
    icon: "Boxes",
    usaPeriodo: false,
  },
  {
    id: "estoque-ruptura",
    nome: "Ruptura e reposição",
    descricao: "Produtos abaixo do mínimo e quanto comprar para chegar ao ideal.",
    grupo: "estoque",
    icon: "PackageX",
    usaPeriodo: false,
  },
  {
    id: "compras",
    nome: "Compras do período",
    descricao: "Entradas por produto e total por fornecedor no período.",
    grupo: "compras",
    icon: "Truck",
    usaPeriodo: true,
  },
];

export function getModelo(id: string): Modelo | undefined {
  return MODELOS.find((m) => m.id === id);
}
