import { z } from "zod";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import { codificarConsulta, consultaSchema, type Consulta } from "@/lib/analises/schema";
import type { ModeloId } from "@/app/(app)/relatorios/_modelos";

/**
 * Catálogo da Central de Relatórios — a prateleira inteira do sistema em um
 * lugar só.
 *
 * Aqui não mora consulta nem SQL: mora o *cartão de visita* de cada relatório
 * (nome, categoria, permissão) e o **endereço** de onde ele é executado. Três
 * endereços possíveis:
 *
 *  - `consulta`  → o motor de análises (`/relatorios/consulta`), com o DSL já
 *                  montado. É o caminho preferido: filtro, export e PDF vêm de
 *                  graça e o número sai do mesmo lugar da tela.
 *  - `pagina`    → uma tela dedicada que já existe (posição de estoque, curva
 *                  ABC, pedidos de compra…). A Central indexa, não duplica.
 *  - `indisponivel` → relatório que o negócio pede mas o sistema ainda não tem
 *                  dado para responder. Aparece cinza, com o motivo. Prometer
 *                  um relatório vazio é pior do que dizer que ele não existe.
 *
 * Módulo puro (sem `server-only`, sem DB): o mesmo arquivo alimenta a página
 * RSC, a paleta de comandos e o client da Central.
 */

// ── Categorias ──────────────────────────────────────────────

export const CATEGORIA_IDS = [
  "estoque",
  "compras",
  "vendas",
  "clientes",
  "financeiro",
  "indicadores",
] as const;

export type CategoriaId = (typeof CATEGORIA_IDS)[number];

export type CategoriaDef = {
  id: CategoriaId;
  nome: string;
  descricao: string;
  /** Nome do ícone lucide — resolvido no client (o catálogo é serializável). */
  icon: string;
};

export const CATEGORIAS: CategoriaDef[] = [
  {
    id: "estoque",
    nome: "Estoque",
    descricao: "Posição, ruptura, validade e valor parado.",
    icon: "Boxes",
  },
  {
    id: "compras",
    nome: "Compras",
    descricao: "Pedidos, fornecedores e preço pago.",
    icon: "ShoppingCart",
  },
  {
    id: "vendas",
    nome: "Vendas",
    descricao: "Faturamento, mix de produtos e ritmo da loja.",
    icon: "TrendingUp",
  },
  {
    id: "clientes",
    nome: "Clientes",
    descricao: "Quem compra, quem sumiu e quem faz aniversário.",
    icon: "Users",
  },
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao: "Caixa, margem e resultado.",
    icon: "Landmark",
  },
  {
    id: "indicadores",
    nome: "Indicadores",
    descricao: "Painéis e leituras de desempenho.",
    icon: "ChartColumnBig",
  },
];

// ── Definição ───────────────────────────────────────────────

/** Campos que a tela de execução oferece para este relatório. */
export type FiltroId = "periodo" | "site" | "categoria" | "fornecedor" | "produto" | "cliente";

export type Exportacao = "csv" | "xlsx" | "pdf" | "imprimir";

export type Destino =
  | { tipo: "consulta"; consulta: Consulta }
  | { tipo: "pagina"; href: string }
  | { tipo: "indisponivel"; motivo: string };

export type RelatorioDef = {
  /** Slug estável — é a chave de favorito, histórico e agendamento. */
  id: string;
  nome: string;
  descricao: string;
  categoria: CategoriaId;
  icon: string;
  /** Sem ela, o relatório nem aparece na Central. */
  permissao: Permissao;
  destino: Destino;
  filtros: FiltroId[];
  exportacoes: Exportacao[];
  /** Rota de CSV pronta em `/relatorios/[tipo]/export`, quando existir. */
  exportTipo?: string;
  /** Modelo imprimível em `/documento/[modelo]`, quando existir. */
  documento?: ModeloId;
  /** Estimativa honesta de quanto demora — o card avisa antes do clique. */
  tempoMedioSeg: number;
  keywords: string[];
};

/** Monta um DSL completo a partir do essencial. Valida no import: catálogo quebrado falha cedo. */
function consulta(parcial: {
  fato: Consulta["fato"];
  dimensoes?: string[];
  metricas: string[];
  filtros?: Consulta["filtros"];
  periodo?: Consulta["periodo"];
  granularidade?: Consulta["granularidade"];
  ordenar?: Consulta["ordenar"];
  limite?: number;
  comparar?: boolean;
}): Destino {
  return { tipo: "consulta", consulta: consultaSchema.parse(parcial) };
}

/** Relatório do motor: CSV, Excel e PDF saem do mesmo resultado. */
const EXPORT_CONSULTA: Exportacao[] = ["csv", "xlsx", "pdf", "imprimir"];
/** Tela dedicada com rota de export e documento imprimível. */
const EXPORT_TABELA: Exportacao[] = ["csv", "xlsx", "pdf", "imprimir"];
/** Tela dedicada com export, mas sem modelo de PDF pronto. */
const EXPORT_TABELA_SIMPLES: Exportacao[] = ["csv", "xlsx", "imprimir"];
/** Tela que ainda não tem export server-side — só a impressão do navegador. */
const EXPORT_TELA: Exportacao[] = ["imprimir"];

// ── Estoque ─────────────────────────────────────────────────

const ESTOQUE: RelatorioDef[] = [
  {
    id: "estoque-inventario",
    nome: "Inventário",
    descricao: "Posição atual de cada produto por loja, com custo médio e valor parado.",
    categoria: "estoque",
    icon: "Boxes",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/relatorios/estoque" },
    filtros: ["site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "estoque",
    documento: "estoque-posicao",
    tempoMedioSeg: 4,
    keywords: ["inventario", "posicao", "saldo", "estoque atual"],
  },
  {
    id: "estoque-movimentacoes",
    nome: "Movimentações",
    descricao: "Entradas, saídas, ajustes e transferências com responsável e motivo.",
    categoria: "estoque",
    icon: "ArrowLeftRight",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/estoque/movimentacoes" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 3,
    keywords: ["movimentacao", "extrato", "entrada", "saida", "ajuste", "kardex"],
  },
  {
    id: "estoque-sem-estoque",
    nome: "Produtos sem estoque",
    descricao: "O que está zerado agora — a ruptura que já está custando venda.",
    categoria: "estoque",
    icon: "PackageX",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/estoque?filtro=sem" },
    filtros: ["site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["zerado", "sem estoque", "ruptura", "faltando", "acabou"],
  },
  {
    id: "estoque-abaixo-minimo",
    nome: "Produtos abaixo do estoque mínimo",
    descricao: "Saldo abaixo do mínimo configurado, com a sugestão de quanto repor.",
    categoria: "estoque",
    icon: "TriangleAlert",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/estoque?filtro=baixoMinimo" },
    filtros: ["site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["minimo", "abaixo", "repor", "reposicao", "comprar"],
  },
  {
    id: "estoque-cobertura",
    nome: "Produtos abaixo da cobertura",
    descricao: "Quem não tem estoque para os próximos dias no ritmo de venda atual.",
    categoria: "estoque",
    icon: "CalendarClock",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/estoque?filtro=baixaCobertura" },
    filtros: ["site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 3,
    keywords: ["cobertura", "dias de estoque", "giro", "rotatividade"],
  },
  {
    id: "estoque-parados",
    nome: "Produtos parados",
    descricao: "Itens com saldo e sem saída no período — dinheiro dormindo na prateleira.",
    categoria: "estoque",
    icon: "CirclePause",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/relatorios/estoque" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA_SIMPLES,
    exportTipo: "estoque",
    tempoMedioSeg: 4,
    keywords: ["parado", "encalhado", "sem giro", "sem venda", "obsoleto"],
  },
  {
    id: "estoque-validade",
    nome: "Produtos vencendo",
    descricao: "Lotes vencidos ou perto do vencimento, na ordem de quem vence primeiro.",
    categoria: "estoque",
    icon: "CalendarX",
    permissao: "estoque.ver",
    destino: { tipo: "pagina", href: "/estoque/validade" },
    filtros: ["site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["validade", "vencimento", "vencendo", "lote", "fefo", "vencido"],
  },
  {
    id: "estoque-valor",
    nome: "Valor do estoque",
    descricao: "Quanto capital está parado, somado por produto e por loja.",
    categoria: "estoque",
    icon: "Wallet",
    permissao: "relatorio.financeiro",
    destino: { tipo: "pagina", href: "/relatorios/estoque" },
    filtros: ["site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "estoque",
    documento: "estoque-posicao",
    tempoMedioSeg: 4,
    keywords: ["valor", "capital", "custo", "imobilizado", "quanto tenho"],
  },
  {
    id: "estoque-abc",
    nome: "Curva ABC de estoque",
    descricao: "Classificação A/B/C dos produtos por participação no faturamento.",
    categoria: "estoque",
    icon: "ChartColumnBig",
    permissao: "relatorio.ver",
    destino: { tipo: "pagina", href: "/relatorios/abc" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "abc",
    documento: "abc",
    tempoMedioSeg: 5,
    keywords: ["abc", "curva", "pareto", "classificacao", "80/20"],
  },
];

// ── Compras ─────────────────────────────────────────────────

const COMPRAS: RelatorioDef[] = [
  {
    id: "compras-pedidos",
    nome: "Pedidos de compra",
    descricao: "Pedidos abertos, enviados e recebidos, com valor e prazo de cada um.",
    categoria: "compras",
    icon: "ClipboardList",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/compras/pedidos" },
    filtros: ["periodo", "fornecedor"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 3,
    keywords: ["pedido", "ordem de compra", "po", "aberto", "pendente"],
  },
  {
    id: "compras-por-fornecedor",
    nome: "Compras por fornecedor",
    descricao: "Quanto foi comprado de cada fornecedor no período, com número de notas.",
    categoria: "compras",
    icon: "Truck",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/relatorios/compras" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "compras",
    documento: "compras",
    tempoMedioSeg: 4,
    keywords: ["fornecedor", "compra", "entrada", "nota", "quanto comprei"],
  },
  {
    id: "compras-produtos",
    nome: "Produtos comprados",
    descricao: "Entradas por produto no período, com custo unitário médio e total.",
    categoria: "compras",
    icon: "PackagePlus",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/relatorios/compras" },
    filtros: ["periodo", "site", "produto"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "compras",
    documento: "compras",
    tempoMedioSeg: 4,
    keywords: ["produto comprado", "entrada", "custo unitario", "reposicao"],
  },
  {
    id: "compras-comparativo",
    nome: "Comparativo de preços",
    descricao: "Mesma cesta em vários fornecedores — quem está mais barato hoje.",
    categoria: "compras",
    icon: "Scale",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/compras/comparador" },
    filtros: ["fornecedor"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 6,
    keywords: ["comparar", "preco", "cotacao", "mais barato", "cesta"],
  },
  {
    id: "compras-economia",
    nome: "Economia obtida",
    descricao: "Diferença entre o preço pago e o melhor preço disponível na cotação.",
    categoria: "compras",
    icon: "PiggyBank",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/compras/historico" },
    filtros: ["periodo", "fornecedor"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 5,
    keywords: ["economia", "poupou", "desconto", "melhor preco", "saving"],
  },
  {
    id: "compras-historico",
    nome: "Histórico de compras",
    descricao: "Como o preço de cada item variou compra a compra.",
    categoria: "compras",
    icon: "History",
    permissao: "compras.ver",
    destino: { tipo: "pagina", href: "/compras/historico" },
    filtros: ["periodo", "produto", "fornecedor"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 4,
    keywords: ["historico", "variacao", "preco pago", "inflacao", "aumento"],
  },
];

// ── Vendas ──────────────────────────────────────────────────

const VENDAS: RelatorioDef[] = [
  {
    id: "vendas-periodo",
    nome: "Vendas por período",
    descricao: "Faturamento dia a dia, com número de vendas e ticket médio.",
    categoria: "vendas",
    icon: "CalendarRange",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["tempo"],
      metricas: ["receita", "numVendas", "ticket"],
      granularidade: "dia",
      ordenar: { por: "tempo", ordem: "asc" },
      limite: 90,
      comparar: true,
    }),
    filtros: ["periodo", "site", "categoria"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["faturamento", "dia a dia", "evolucao", "quanto vendi", "periodo"],
  },
  {
    id: "vendas-produto",
    nome: "Vendas por produto",
    descricao: "Lista os produtos vendidos no período, com quantidade e receita.",
    categoria: "vendas",
    icon: "Wine",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["produto"],
      metricas: ["quantidade", "receita", "precoMedio"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 100,
    }),
    filtros: ["periodo", "site", "categoria", "produto"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["produto", "item", "sku", "vendas por produto"],
  },
  {
    id: "vendas-categoria",
    nome: "Vendas por categoria",
    descricao: "Participação de cada categoria no faturamento do período.",
    categoria: "vendas",
    icon: "LayoutGrid",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["categoria"],
      metricas: ["receita", "quantidade", "numVendas"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 50,
    }),
    filtros: ["periodo", "site", "categoria"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["categoria", "secao", "familia", "mix"],
  },
  {
    id: "vendas-cliente",
    nome: "Vendas por cliente",
    descricao: "Quanto cada cliente identificado comprou no período.",
    categoria: "vendas",
    icon: "UserRound",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["cliente"],
      metricas: ["receita", "numVendas", "ticket"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 100,
    }),
    filtros: ["periodo", "site", "cliente"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 4,
    keywords: ["cliente", "comprador", "fidelidade", "por cliente"],
  },
  {
    id: "vendas-mais-vendidos",
    nome: "Produtos mais vendidos",
    descricao: "Ranking por quantidade — o que sai da prateleira mais rápido.",
    categoria: "vendas",
    icon: "TrendingUp",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["produto"],
      metricas: ["quantidade", "receita"],
      ordenar: { por: "quantidade", ordem: "desc" },
      limite: 30,
    }),
    filtros: ["periodo", "site", "categoria"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["mais vendidos", "top", "campeao", "ranking", "best seller"],
  },
  {
    id: "vendas-menos-vendidos",
    nome: "Produtos menos vendidos",
    descricao: "Ranking invertido — o que quase não saiu e ocupa espaço.",
    categoria: "vendas",
    icon: "TrendingDown",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["produto"],
      metricas: ["quantidade", "receita"],
      ordenar: { por: "quantidade", ordem: "asc" },
      limite: 30,
    }),
    filtros: ["periodo", "site", "categoria"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["menos vendidos", "encalhado", "pior", "fundo de loja"],
  },
  {
    id: "vendas-ticket-medio",
    nome: "Ticket médio",
    descricao: "Ticket e número de vendas por dia, para ver se a cesta cresceu.",
    categoria: "vendas",
    icon: "Receipt",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["tempo"],
      metricas: ["ticket", "numVendas", "receita"],
      granularidade: "dia",
      ordenar: { por: "tempo", ordem: "asc" },
      limite: 90,
      comparar: true,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["ticket", "cesta", "media por venda", "valor medio"],
  },
  {
    id: "vendas-horarios",
    nome: "Horários de maior venda",
    descricao: "Faturamento por hora do dia — onde escalar gente e reposição.",
    categoria: "vendas",
    icon: "Clock",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["tempo"],
      metricas: ["receita", "numVendas"],
      granularidade: "hora",
      ordenar: { por: "tempo", ordem: "asc" },
      limite: 200,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 4,
    keywords: ["hora", "horario", "pico", "movimento", "turno"],
  },
  {
    id: "vendas-dia-semana",
    nome: "Vendas por dia da semana",
    descricao: "Qual dia sustenta o mês e qual só paga a conta de luz.",
    categoria: "vendas",
    icon: "CalendarDays",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["diaSemana"],
      metricas: ["receita", "numVendas", "ticket"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 7,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["dia da semana", "segunda", "sabado", "fim de semana"],
  },
];

// ── Clientes ────────────────────────────────────────────────

const CLIENTES: RelatorioDef[] = [
  {
    id: "clientes-ativos",
    nome: "Clientes ativos",
    descricao: "Quem comprou dentro da janela de atividade da loja.",
    categoria: "clientes",
    icon: "UserCheck",
    permissao: "cliente.ver",
    destino: { tipo: "pagina", href: "/clientes" },
    filtros: ["periodo"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["ativo", "comprando", "recorrente", "base"],
  },
  {
    id: "clientes-inativos",
    nome: "Clientes inativos",
    descricao: "Quem sumiu — a lista de quem vale chamar de volta.",
    categoria: "clientes",
    icon: "UserX",
    permissao: "cliente.ver",
    destino: { tipo: "pagina", href: "/clientes" },
    filtros: ["periodo"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["inativo", "sumiu", "risco", "churn", "recuperar"],
  },
  {
    id: "clientes-mais-compram",
    nome: "Clientes que mais compram",
    descricao: "Ranking por valor comprado no período, com ticket de cada um.",
    categoria: "clientes",
    icon: "Crown",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["cliente"],
      metricas: ["receita", "numVendas", "ticket"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 50,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 4,
    keywords: ["melhores clientes", "vip", "top clientes", "quem mais compra"],
  },
  {
    id: "clientes-novos",
    nome: "Novos clientes",
    descricao: "Cadastros criados no período — o tamanho da base que entrou.",
    categoria: "clientes",
    icon: "UserPlus",
    permissao: "cliente.ver",
    destino: { tipo: "pagina", href: "/clientes" },
    filtros: ["periodo"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["novo", "cadastro", "captacao", "entrou"],
  },
  {
    id: "clientes-aniversariantes",
    nome: "Aniversariantes",
    descricao: "Quem faz aniversário no período, pronto para virar cupom.",
    categoria: "clientes",
    icon: "Cake",
    permissao: "cliente.ver",
    destino: { tipo: "pagina", href: "/clientes" },
    filtros: ["periodo"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 2,
    keywords: ["aniversario", "niver", "cupom", "parabens"],
  },
];

// ── Financeiro ──────────────────────────────────────────────

const FINANCEIRO: RelatorioDef[] = [
  {
    id: "financeiro-fluxo-caixa",
    nome: "Fluxo de caixa",
    descricao: "Fechamentos do período: esperado × contado, quebra e sangrias.",
    categoria: "financeiro",
    icon: "Wallet",
    permissao: "relatorio.financeiro",
    destino: { tipo: "pagina", href: "/relatorios/pagamentos" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "pagamentos",
    documento: "caixa",
    tempoMedioSeg: 4,
    keywords: ["caixa", "fechamento", "sangria", "quebra", "conferencia"],
  },
  {
    id: "financeiro-formas-pagamento",
    nome: "Recebimentos por forma de pagamento",
    descricao: "Quanto entrou em pix, cartão e dinheiro no período.",
    categoria: "financeiro",
    icon: "CreditCard",
    permissao: "relatorio.financeiro",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["pagamento"],
      metricas: ["receita", "numVendas", "ticket"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 20,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["pix", "cartao", "dinheiro", "recebimento", "mix de pagamento"],
  },
  {
    id: "financeiro-lucro",
    nome: "Lucro",
    descricao: "Receita, CMV e margem em reais, dia a dia.",
    categoria: "financeiro",
    icon: "Coins",
    permissao: "relatorio.financeiro",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["tempo"],
      metricas: ["receita", "cmv", "margem", "margemPct"],
      granularidade: "dia",
      ordenar: { por: "tempo", ordem: "asc" },
      limite: 90,
      comparar: true,
    }),
    filtros: ["periodo", "site", "categoria"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 5,
    keywords: ["lucro", "resultado", "cmv", "ganho", "sobra"],
  },
  {
    id: "financeiro-margem",
    nome: "Margem por produto",
    descricao: "Receita, custo e margem de cada produto vendido no período.",
    categoria: "financeiro",
    icon: "Percent",
    permissao: "relatorio.financeiro",
    destino: { tipo: "pagina", href: "/relatorios/margem" },
    filtros: ["periodo", "site", "categoria", "produto"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "margem",
    documento: "margem-produto",
    tempoMedioSeg: 5,
    keywords: ["margem", "rentabilidade", "markup", "cmv", "lucro por produto"],
  },
  {
    id: "financeiro-receitas",
    nome: "Receitas",
    descricao: "Tudo que entrou por venda no período, por loja e canal.",
    categoria: "financeiro",
    icon: "ArrowDownToLine",
    permissao: "relatorio.financeiro",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["site", "origem"],
      metricas: ["receita", "numVendas", "desconto"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 50,
      comparar: true,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["receita", "entrada", "faturamento", "canal", "loja"],
  },
  {
    id: "financeiro-perdas",
    nome: "Perdas e quebras",
    descricao: "O que foi baixado como perda no período e quanto custou.",
    categoria: "financeiro",
    icon: "TriangleAlert",
    permissao: "relatorio.financeiro",
    destino: { tipo: "pagina", href: "/relatorios/perdas" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "perdas",
    documento: "perdas",
    tempoMedioSeg: 3,
    keywords: ["perda", "quebra", "avaria", "vencido", "prejuizo"],
  },
  {
    id: "financeiro-contas-pagar",
    nome: "Contas a pagar",
    descricao: "Compromissos com fornecedores, por vencimento.",
    categoria: "financeiro",
    icon: "ArrowUpFromLine",
    permissao: "relatorio.financeiro",
    destino: {
      tipo: "indisponivel",
      motivo: "Depende do módulo Financeiro (contas a pagar), que ainda não existe no sistema.",
    },
    filtros: ["periodo"],
    exportacoes: [],
    tempoMedioSeg: 0,
    keywords: ["conta a pagar", "vencimento", "boleto", "duplicata"],
  },
  {
    id: "financeiro-contas-receber",
    nome: "Contas a receber",
    descricao: "Vendas a prazo e recebíveis em aberto.",
    categoria: "financeiro",
    icon: "ArrowDownFromLine",
    permissao: "relatorio.financeiro",
    destino: {
      tipo: "indisponivel",
      motivo: "Depende do módulo Financeiro (contas a receber), que ainda não existe no sistema.",
    },
    filtros: ["periodo"],
    exportacoes: [],
    tempoMedioSeg: 0,
    keywords: ["conta a receber", "fiado", "prazo", "recebivel"],
  },
  {
    id: "financeiro-despesas",
    nome: "Despesas",
    descricao: "Custos operacionais lançados no período.",
    categoria: "financeiro",
    icon: "Receipt",
    permissao: "relatorio.financeiro",
    destino: {
      tipo: "indisponivel",
      motivo: "Depende do módulo Financeiro (lançamento de despesas), que ainda não existe no sistema.",
    },
    filtros: ["periodo"],
    exportacoes: [],
    tempoMedioSeg: 0,
    keywords: ["despesa", "custo fixo", "gasto", "saida"],
  },
];

// ── Indicadores ─────────────────────────────────────────────

const INDICADORES: RelatorioDef[] = [
  {
    id: "indicadores-painel",
    nome: "Painel do negócio",
    descricao: "Os números do período em uma tela: receita, margem, giro e alertas.",
    categoria: "indicadores",
    icon: "LayoutDashboard",
    permissao: "relatorio.ver",
    destino: { tipo: "pagina", href: "/relatorios/dashboard" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 6,
    keywords: ["painel", "dashboard", "kpi", "visao geral", "indicadores"],
  },
  {
    id: "indicadores-vendas-resumo",
    nome: "Resumo de vendas",
    descricao: "Faturamento, ticket, CMV e margem do período em um documento só.",
    categoria: "indicadores",
    icon: "ReceiptText",
    permissao: "relatorio.ver",
    destino: { tipo: "pagina", href: "/relatorios/vendas" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA,
    exportTipo: "vendas",
    documento: "vendas-resumo",
    tempoMedioSeg: 4,
    keywords: ["resumo", "consolidado", "fechamento do mes", "visao geral"],
  },
  {
    id: "indicadores-producao",
    nome: "Produção e drinks",
    descricao: "Rentabilidade das bebidas produzidas e consumo de insumos.",
    categoria: "indicadores",
    icon: "FlaskConical",
    permissao: "relatorio.ver",
    destino: { tipo: "pagina", href: "/relatorios/producao" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TABELA_SIMPLES,
    exportTipo: "producao",
    tempoMedioSeg: 4,
    keywords: ["producao", "drink", "insumo", "ficha tecnica", "receita"],
  },
  {
    id: "indicadores-operadores",
    nome: "Desempenho por operador",
    descricao: "Quanto cada pessoa registrou no PDV, com ticket e desconto concedido.",
    categoria: "indicadores",
    icon: "Users",
    permissao: "relatorio.ver",
    destino: consulta({
      fato: "venda-item",
      dimensoes: ["operador"],
      metricas: ["receita", "numVendas", "ticket", "desconto"],
      ordenar: { por: "receita", ordem: "desc" },
      limite: 50,
    }),
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_CONSULTA,
    tempoMedioSeg: 3,
    keywords: ["operador", "caixa", "equipe", "vendedor", "produtividade"],
  },
  {
    id: "indicadores-fiscal",
    nome: "Documentos fiscais",
    descricao: "Notas emitidas, canceladas e recebidas no período.",
    categoria: "indicadores",
    icon: "FileText",
    permissao: "fiscal.ver",
    destino: { tipo: "pagina", href: "/relatorios/fiscal" },
    filtros: ["periodo", "site"],
    exportacoes: EXPORT_TELA,
    tempoMedioSeg: 4,
    keywords: ["nfe", "nfce", "nota fiscal", "sefaz", "fiscal"],
  },
];

export const RELATORIOS: RelatorioDef[] = [
  ...ESTOQUE,
  ...COMPRAS,
  ...VENDAS,
  ...CLIENTES,
  ...FINANCEIRO,
  ...INDICADORES,
];

// ── Consultas ao catálogo ───────────────────────────────────

export function getRelatorio(id: string): RelatorioDef | undefined {
  return RELATORIOS.find((r) => r.id === id);
}

export function getCategoria(id: string): CategoriaDef | undefined {
  return CATEGORIAS.find((c) => c.id === id);
}

/**
 * O que este operador pode ver. A permissão é do relatório, não da tela: o
 * caixa não enxerga financeiro nem no card, e o guard da tela de destino
 * continua valendo — esconder aqui é cortesia, não segurança.
 */
export function relatoriosVisiveis(acessos: Acesso[]): RelatorioDef[] {
  return RELATORIOS.filter((r) => podeEmAlguma(acessos, r.permissao));
}

export function podeExportar(acessos: Acesso[]): boolean {
  return podeEmAlguma(acessos, "relatorio.exportar");
}

// ── Parâmetros de execução ──────────────────────────────────

/**
 * O que o operador escolhe antes de gerar. Vira query string na tela de
 * destino, corpo do histórico e (um dia) parâmetro do agendamento — por isso
 * é um schema só, validado nas duas pontas.
 */
export const parametrosSchema = z.object({
  periodo: z.enum(["hoje", "7d", "30d", "mes", "custom"]).default("30d"),
  de: z.string().max(10).optional(),
  ate: z.string().max(10).optional(),
  /** Filtros de dimensão: { categoria: "Cervejas" }. Só valem no motor. */
  filtros: z.record(z.string().max(40), z.string().max(120)).default({}),
});

export type Parametros = z.infer<typeof parametrosSchema>;

export const PARAMETROS_PADRAO: Parametros = { periodo: "30d", filtros: {} };

/** Rótulo curto de um filtro, para os seletores e para o resumo da execução. */
export const FILTRO_LABEL: Record<FiltroId, string> = {
  periodo: "Período",
  site: "Loja",
  categoria: "Categoria",
  fornecedor: "Fornecedor",
  produto: "Produto",
  cliente: "Cliente",
};

/** Filtros de dimensão que o motor sabe aplicar (loja e período têm caminho próprio). */
const FILTRO_DIMENSAO: Record<string, string> = {
  categoria: "categoria",
  fornecedor: "fornecedor",
  produto: "produto",
  cliente: "cliente",
};

function queryPeriodo(p: Parametros): URLSearchParams {
  const qs = new URLSearchParams({ periodo: p.periodo });
  if (p.periodo === "custom") {
    if (p.de) qs.set("de", p.de);
    if (p.ate) qs.set("ate", p.ate);
  }
  return qs;
}

/**
 * Endereço de execução do relatório com os parâmetros aplicados.
 *
 * Para o motor, os filtros entram no DSL (e viajam codificados em `?q=`); para
 * uma tela dedicada, só o período viaja — a tela tem os próprios controles e
 * inventar parâmetro que ela ignora seria mentir para o operador.
 */
export function hrefExecucao(rel: RelatorioDef, params: Parametros): string | null {
  if (rel.destino.tipo === "indisponivel") return null;

  if (rel.destino.tipo === "pagina") {
    const href = rel.destino.href;
    if (!rel.filtros.includes("periodo")) return href;
    const [base, existente] = href.split("?");
    const qs = queryPeriodo(params);
    for (const [k, v] of new URLSearchParams(existente ?? "")) qs.set(k, v);
    return `${base}?${qs.toString()}`;
  }

  return `/relatorios/consulta?q=${codificarConsulta(aplicarParametros(rel.destino.consulta, params))}`;
}

/** DSL do relatório com período e filtros do operador aplicados. */
export function aplicarParametros(base: Consulta, params: Parametros): Consulta {
  const extras = Object.entries(params.filtros).flatMap(([chave, valor]) => {
    const campo = FILTRO_DIMENSAO[chave];
    if (!campo || !valor.trim()) return [];
    return [{ campo, op: "contem" as const, valor: valor.trim() }];
  });

  return consultaSchema.parse({
    ...base,
    periodo: { preset: params.periodo, de: params.de, ate: params.ate },
    // Filtro do catálogo vem primeiro: o do operador soma, nunca substitui.
    filtros: [...base.filtros, ...extras].slice(0, 8),
  });
}

/** Link de download. `null` quando o formato não existe para este relatório. */
export function hrefExport(
  rel: RelatorioDef,
  params: Parametros,
  formato: Exportacao,
): string | null {
  if (!rel.exportacoes.includes(formato)) return null;

  if (rel.destino.tipo === "consulta") {
    const q = codificarConsulta(aplicarParametros(rel.destino.consulta, params));
    // Consulta do motor imprime pela mesma folha A4 dos modelos fixos.
    if (formato === "pdf" || formato === "imprimir") return `/documento/consulta?q=${q}`;
    return `/relatorios/consulta/export?q=${q}&formato=${formato}`;
  }

  if (formato === "pdf") {
    if (!rel.documento) return null;
    return `/documento/${rel.documento}?${queryPeriodo(params).toString()}`;
  }

  if (formato === "imprimir") return hrefExecucao(rel, params);

  if (rel.exportTipo) {
    const qs = queryPeriodo(params);
    if (formato === "xlsx") qs.set("formato", "xlsx");
    return `/relatorios/${rel.exportTipo}/export?${qs.toString()}`;
  }

  return null;
}
