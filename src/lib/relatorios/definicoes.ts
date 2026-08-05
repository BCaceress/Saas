import "server-only";
import { consultaSchema, type Consulta } from "@/lib/analises/schema";
import { getDimensao, getFato, type Formato, type MetricaDef } from "@/lib/analises/catalogo";
import { executarConsulta } from "@/lib/analises/motor";
import { getRelatorio, type Exportacao, type FiltroId, type RelatorioDef } from "./catalogo";
import type {
  AgrupamentoDef,
  ColunaDef,
  FiltroDef,
  FonteCtx,
  IndicadorDef,
  Linha,
  ReportDefinition,
  TipoValor,
} from "./definicao";
import { numero } from "./valores";
import {
  carregarCaixa,
  carregarClientes,
  carregarClientesAniversariantes,
  carregarClientesNovos,
  carregarComprasFornecedor,
  carregarComprasHistorico,
  carregarComprasProduto,
  carregarCurvaABC,
  carregarEconomiaCompras,
  carregarFiscal,
  carregarInventario,
  carregarMovimentacoes,
  carregarOfertasFornecedor,
  carregarPainelDiario,
  carregarPedidosCompra,
  carregarPerdas,
  carregarProducao,
  carregarProdutosVendidos,
  carregarValidade,
} from "./fontes";

/**
 * Registro de definições — o que cada relatório oferece.
 *
 * Duas origens, um formato só:
 *
 *  1. **Declaradas** aqui: os relatórios tabulares (inventário, margem, perdas,
 *     compras, caixa…). Cada um lista suas colunas, filtros, ordenações,
 *     agrupamentos e indicadores. Nenhum deles tem tela, rota ou PDF próprio.
 *  2. **Derivadas** do catálogo: todo relatório cujo destino é o motor de
 *     análises vira definição automaticamente (`definicaoDeConsulta`) — as
 *     dimensões da consulta viram colunas obrigatórias e TODAS as métricas do
 *     fato viram colunas opcionais. Relatório novo no catálogo já nasce
 *     configurável, sem passar por aqui.
 *
 * Relatório que aponta para uma tela do app (produtos, clientes, comparador de
 * compras) continua apontando: a Central indexa, não duplica. Ele simplesmente
 * não tem definição, e o card leva à tela como sempre levou.
 */

// ── Atalhos de montagem ─────────────────────────────────────

const P_FINANCEIRO = "relatorio.financeiro" as const;

/** Cartão de visita vem do catálogo — nome e permissão têm um dono só. */
function doCatalogo(id: string) {
  const rel = getRelatorio(id);
  if (!rel) throw new Error(`Relatório "${id}" não existe no catálogo.`);
  return {
    id: rel.id,
    nome: rel.nome,
    descricao: rel.descricao,
    categoria: rel.categoria,
    icon: rel.icon,
    permissao: rel.permissao,
    exportacoes: rel.exportacoes.length > 0 ? rel.exportacoes : EXPORT_TUDO,
  };
}

/** Todo relatório do motor genérico sai nos quatro formatos. */
const EXPORT_TUDO: Exportacao[] = ["csv", "xlsx", "pdf", "imprimir"];

const FILTRO_PERIODO: FiltroDef = { id: "periodo", label: "Período", tipo: "periodo" };
const FILTRO_SITE: FiltroDef = { id: "site", label: "Loja", tipo: "site" };

function texto(id: string, label: string, coluna = id, ajuda?: string): FiltroDef {
  return { id, label, tipo: "texto", coluna, modo: "contem", placeholder: "Todos", ajuda };
}

function ordena(coluna: string, label: string): { id: string; label: string; coluna: string } {
  return { id: coluna, label, coluna };
}

function agrupa(coluna: string, label: string): AgrupamentoDef {
  return { id: coluna, label, coluna };
}

const somaDe = (coluna: string) => (linhas: Linha[]) =>
  linhas.reduce((s, l) => s + numero(l[coluna]), 0);

const contarSe = (coluna: string) => (linhas: Linha[]) => linhas.filter((l) => !!l[coluna]).length;

// ── Estoque ─────────────────────────────────────────────────

const COLUNAS_INVENTARIO: ColunaDef[] = [
  { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
  { id: "sku", label: "SKU", tipo: "codigo" },
  { id: "ean", label: "Código de barras", tipo: "codigo", padrao: false },
  { id: "categoria", label: "Categoria", tipo: "texto" },
  { id: "subcategoria", label: "Subcategoria", tipo: "texto", padrao: false },
  { id: "marca", label: "Marca", tipo: "texto", padrao: false },
  { id: "fornecedor", label: "Fornecedor", tipo: "texto", padrao: false },
  { id: "site", label: "Loja", tipo: "texto" },
  { id: "localizacao", label: "Localização", tipo: "texto", padrao: false },
  { id: "estoqueFechado", label: "Quantidade", tipo: "numero", totalizar: "soma" },
  { id: "estoqueAberto", label: "Aberto", tipo: "numero", padrao: false, totalizar: "soma" },
  {
    id: "estoqueDisponivel",
    label: "Estoque disponível",
    tipo: "numero",
    padrao: false,
    totalizar: "soma",
  },
  { id: "estoqueMinimo", label: "Mínimo", tipo: "numero", padrao: false },
  { id: "estoqueIdeal", label: "Ideal", tipo: "numero", padrao: false },
  { id: "custoMedio", label: "Custo médio", tipo: "moeda" },
  { id: "precoVenda", label: "Preço de venda", tipo: "moeda", padrao: false },
  { id: "valorEstoque", label: "Valor em estoque", tipo: "moeda", totalizar: "soma" },
  { id: "mediaDiaria", label: "Média diária", tipo: "numero", padrao: false },
  { id: "diasCobertura", label: "Cobertura (dias)", tipo: "numero", padrao: false },
  { id: "ultimaCompra", label: "Última compra", tipo: "data", padrao: false },
  { id: "ultimaVenda", label: "Última venda", tipo: "data", padrao: false },
  { id: "abaixoMinimo", label: "Abaixo do mínimo", tipo: "booleano", padrao: false },
  { id: "zerado", label: "Zerado", tipo: "booleano", padrao: false },
  { id: "ativo", label: "Ativo", tipo: "booleano", padrao: false },
];

const FILTROS_INVENTARIO: FiltroDef[] = [
  FILTRO_SITE,
  texto("produto", "Produto"),
  { id: "categoria", label: "Categoria", tipo: "opcoes", coluna: "categoria", fonteOpcoes: "categorias", multiplo: true },
  { id: "marca", label: "Marca", tipo: "opcoes", coluna: "marca", fonteOpcoes: "marcas", multiplo: true },
  { id: "fornecedor", label: "Fornecedor", tipo: "opcoes", coluna: "fornecedor", fonteOpcoes: "fornecedores", multiplo: true },
  { id: "ativos", label: "Somente produtos ativos", tipo: "booleano", coluna: "ativo", padrao: true },
  { id: "zerados", label: "Somente produtos zerados", tipo: "booleano", coluna: "zerado" },
  { id: "abaixoMinimo", label: "Somente abaixo do mínimo", tipo: "booleano", coluna: "abaixoMinimo" },
  {
    id: "coberturaAte",
    label: "Cobertura até (dias)",
    tipo: "numero",
    coluna: "diasCobertura",
    modo: "menor",
    sufixo: "dias",
    ajuda: "Traz o que acaba antes desse prazo, pelo giro dos últimos dias.",
  },
];

const INDICADORES_INVENTARIO: IndicadorDef[] = [
  { id: "valorTotal", label: "Valor em estoque", tipo: "moeda", calcular: somaDe("valorEstoque") },
  { id: "unidades", label: "Unidades", tipo: "numero", calcular: somaDe("estoqueFechado") },
  { id: "zerados", label: "Zerados", tipo: "inteiro", calcular: contarSe("zerado") },
  {
    id: "emRuptura",
    label: "Abaixo do mínimo",
    tipo: "inteiro",
    calcular: contarSe("abaixoMinimo"),
  },
];

function inventario(
  id: string,
  ajustes: { filtrosPadrao?: Record<string, boolean>; ordenar?: { coluna: string; ordem: "asc" | "desc" } } = {},
): ReportDefinition {
  return {
    ...doCatalogo(id),
    filtros: FILTROS_INVENTARIO.map((f) =>
      ajustes.filtrosPadrao && f.id in ajustes.filtrosPadrao
        ? { ...f, padrao: ajustes.filtrosPadrao[f.id] }
        : f,
    ),
    colunas: COLUNAS_INVENTARIO,
    ordenacoes: [
      ordena("produto", "Produto"),
      ordena("categoria", "Categoria"),
      ordena("marca", "Marca"),
      ordena("fornecedor", "Fornecedor"),
      ordena("valorEstoque", "Valor em estoque"),
      ordena("estoqueFechado", "Quantidade"),
      ordena("diasCobertura", "Cobertura"),
      ordena("ultimaVenda", "Última venda"),
    ],
    agrupamentos: [
      agrupa("categoria", "Categoria"),
      agrupa("marca", "Marca"),
      agrupa("fornecedor", "Fornecedor"),
      agrupa("site", "Loja"),
      agrupa("localizacao", "Localização"),
    ],
    indicadores: INDICADORES_INVENTARIO,
    ordenacaoPadrao: ajustes.ordenar ?? { coluna: "valorEstoque", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarInventario,
  };
}

// ── Clientes ────────────────────────────────────────────────

const COLUNAS_CLIENTES: ColunaDef[] = [
  { id: "cliente", label: "Cliente", tipo: "texto", obrigatoria: true },
  { id: "whatsapp", label: "WhatsApp", tipo: "codigo" },
  { id: "cpf", label: "CPF", tipo: "codigo", padrao: false },
  { id: "email", label: "E-mail", tipo: "texto", padrao: false },
  { id: "aniversario", label: "Aniversário", tipo: "data", padrao: false },
  { id: "aniversarioDia", label: "Dia do ano", tipo: "inteiro", padrao: false },
  { id: "cadastradoEm", label: "Cadastrado em", tipo: "data", padrao: false },
  { id: "compras", label: "Compras", tipo: "inteiro" },
  { id: "totalGasto", label: "Total gasto", tipo: "moeda", totalizar: "soma" },
  { id: "ticketMedio", label: "Ticket médio", tipo: "moeda", padrao: false },
  { id: "ultimaCompra", label: "Última compra", tipo: "data" },
  { id: "diasSemComprar", label: "Dias sem comprar", tipo: "inteiro" },
  { id: "pontos", label: "Pontos", tipo: "inteiro", padrao: false },
  { id: "ativo", label: "Ativo", tipo: "booleano", padrao: false },
  { id: "nuncaComprou", label: "Nunca comprou", tipo: "booleano", padrao: false },
];

/**
 * Os quatro relatórios de cliente saem da mesma base — muda o recorte.
 *
 * Ativos e inativos são a MESMA pergunta com o sinal trocado ("comprou nos
 * últimos N" × "sumiu há mais de N"), então viram filtro de janela sobre a
 * coluna `diasSemComprar`. Novos e aniversariantes precisam do período e trocam
 * o carregador, porque o recorte é por data de cadastro / de nascimento.
 */
function clientes(
  id: string,
  ajustes: {
    periodo?: boolean;
    filtroJanela?: {
      id: string;
      label: string;
      modo: "maior" | "menor";
      padrao: number;
      ajuda: string;
    };
    ordenar: { coluna: string; ordem: "asc" | "desc" };
    carregar?: typeof carregarClientes;
  },
): ReportDefinition {
  const janela = ajustes.filtroJanela;
  return {
    ...doCatalogo(id),
    filtros: [
      ...(ajustes.periodo ? [FILTRO_PERIODO] : []),
      FILTRO_SITE,
      texto("cliente", "Cliente"),
      ...(janela
        ? [
            {
              id: janela.id,
              label: janela.label,
              tipo: "numero" as const,
              coluna: "diasSemComprar",
              modo: janela.modo,
              sufixo: "dias",
              padrao: janela.padrao,
              ajuda: janela.ajuda,
            },
          ]
        : []),
      { id: "comCompra", label: "Somente quem já comprou", tipo: "booleano", coluna: "nuncaComprou", modo: "falso" },
      { id: "comWhatsapp", label: "Somente com WhatsApp", tipo: "booleano", coluna: "whatsapp" },
    ],
    colunas: COLUNAS_CLIENTES,
    ordenacoes: [
      ordena("cliente", "Nome"),
      ordena("totalGasto", "Total gasto"),
      ordena("ultimaCompra", "Última compra"),
      ordena("diasSemComprar", "Dias sem comprar"),
      ordena("cadastradoEm", "Cadastro"),
    ],
    agrupamentos: [],
    indicadores: [
      { id: "clientes", label: "Clientes", tipo: "inteiro", calcular: (l) => l.length },
      { id: "gasto", label: "Total gasto", tipo: "moeda", calcular: somaDe("totalGasto") },
      { id: "semCompra", label: "Nunca compraram", tipo: "inteiro", calcular: contarSe("nuncaComprou") },
    ],
    ordenacaoPadrao: ajustes.ordenar,
    limitePadrao: 5000,
    carregar: ajustes.carregar ?? carregarClientes,
  };
}

// ── Declaradas ──────────────────────────────────────────────

const DECLARADAS: ReportDefinition[] = [
  inventario("estoque-inventario"),
  inventario("estoque-sem-estoque", {
    filtrosPadrao: { zerados: true, ativos: true },
    ordenar: { coluna: "produto", ordem: "asc" },
  }),
  inventario("estoque-abaixo-minimo", {
    filtrosPadrao: { abaixoMinimo: true, ativos: true },
    ordenar: { coluna: "produto", ordem: "asc" },
  }),
  inventario("estoque-valor", { ordenar: { coluna: "valorEstoque", ordem: "desc" } }),
  inventario("estoque-parados", { ordenar: { coluna: "ultimaVenda", ordem: "asc" } }),

  // ── Movimentações ─────────────────────────────────────────
  {
    ...doCatalogo("estoque-movimentacoes"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      texto("produto", "Produto"),
      {
        id: "tipo",
        label: "Tipo de movimento",
        tipo: "opcoes",
        coluna: "tipo",
        multiplo: true,
        opcoes: [
          { valor: "Entrada", label: "Entrada" },
          { valor: "Saída", label: "Saída" },
          { valor: "Ajuste", label: "Ajuste" },
          { valor: "Transferência", label: "Transferência" },
          { valor: "Abertura", label: "Abertura" },
          { valor: "Produção", label: "Produção" },
          { valor: "Perda", label: "Perda" },
          { valor: "Devolução do cliente", label: "Devolução do cliente" },
          { valor: "Devolução ao fornecedor", label: "Devolução ao fornecedor" },
        ],
      },
    ],
    colunas: [
      { id: "data", label: "Data", tipo: "datahora", obrigatoria: true },
      { id: "tipo", label: "Tipo", tipo: "texto" },
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo", padrao: false },
      { id: "site", label: "Loja", tipo: "texto" },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoUnitario", label: "Custo unitário", tipo: "moeda", padrao: false },
      { id: "custoTotal", label: "Custo total", tipo: "moeda", totalizar: "soma" },
      { id: "observacao", label: "Observações", tipo: "texto", padrao: false },
    ],
    ordenacoes: [
      ordena("data", "Data"),
      ordena("produto", "Produto"),
      ordena("tipo", "Tipo"),
      ordena("custoTotal", "Custo total"),
    ],
    agrupamentos: [agrupa("tipo", "Tipo"), agrupa("site", "Loja"), agrupa("produto", "Produto")],
    indicadores: [
      { id: "custo", label: "Custo movimentado", tipo: "moeda", calcular: somaDe("custoTotal") },
    ],
    ordenacaoPadrao: { coluna: "data", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarMovimentacoes,
  },

  // ── Curva ABC ─────────────────────────────────────────────
  {
    ...doCatalogo("estoque-abc"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      texto("produto", "Produto"),
      texto("categoria", "Categoria"),
      {
        id: "classe",
        label: "Classe",
        tipo: "opcoes",
        coluna: "classe",
        multiplo: true,
        opcoes: [
          { valor: "A", label: "A — 80% do faturamento" },
          { valor: "B", label: "B — próximos 15%" },
          { valor: "C", label: "C — cauda longa" },
        ],
      },
    ],
    colunas: [
      { id: "classe", label: "Classe", tipo: "texto", obrigatoria: true },
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "categoria", label: "Categoria", tipo: "texto", padrao: false },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "receita", label: "Faturamento", tipo: "moeda", totalizar: "soma" },
      { id: "margem", label: "Margem", tipo: "moeda", padrao: false, totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margemPct", label: "Margem %", tipo: "percentual", padrao: false, permissao: P_FINANCEIRO },
      { id: "acumuladoPct", label: "% acumulado", tipo: "percentual" },
    ],
    ordenacoes: [ordena("receita", "Faturamento"), ordena("produto", "Produto"), ordena("quantidade", "Quantidade")],
    agrupamentos: [agrupa("classe", "Classe"), agrupa("categoria", "Categoria")],
    indicadores: [
      { id: "faturamento", label: "Faturamento", tipo: "moeda", calcular: somaDe("receita") },
      { id: "unidades", label: "Unidades", tipo: "numero", calcular: somaDe("quantidade") },
    ],
    ordenacaoPadrao: { coluna: "receita", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarCurvaABC,
  },

  // ── Produtos vendidos ─────────────────────────────────────
  {
    ...doCatalogo("indicadores-vendas-resumo"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto"), texto("categoria", "Categoria")],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "receita", label: "Faturamento", tipo: "moeda", totalizar: "soma" },
      { id: "precoMedio", label: "Preço médio", tipo: "moeda", padrao: false },
      { id: "custo", label: "CMV", tipo: "moeda", padrao: false, totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margem", label: "Margem", tipo: "moeda", padrao: false, totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margemPct", label: "Margem %", tipo: "percentual", padrao: false, permissao: P_FINANCEIRO },
    ],
    ordenacoes: [
      ordena("receita", "Faturamento"),
      ordena("quantidade", "Quantidade"),
      ordena("produto", "Produto"),
      ordena("margem", "Margem"),
    ],
    agrupamentos: [agrupa("categoria", "Categoria")],
    indicadores: [
      { id: "faturamento", label: "Total vendido", tipo: "moeda", calcular: somaDe("receita") },
      { id: "unidades", label: "Unidades", tipo: "numero", calcular: somaDe("quantidade") },
      { id: "lucro", label: "Margem", tipo: "moeda", permissao: P_FINANCEIRO, calcular: somaDe("margem") },
    ],
    ordenacaoPadrao: { coluna: "receita", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarProdutosVendidos,
  },

  // ── Margem por produto ────────────────────────────────────
  {
    ...doCatalogo("financeiro-margem"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto"), texto("categoria", "Categoria")],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "categoria", label: "Categoria", tipo: "texto", padrao: false },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "receita", label: "Receita", tipo: "moeda", totalizar: "soma" },
      { id: "custo", label: "CMV", tipo: "moeda", totalizar: "soma" },
      { id: "margem", label: "Margem", tipo: "moeda", totalizar: "soma" },
      { id: "margemPct", label: "Margem %", tipo: "percentual" },
      { id: "precoMedio", label: "Preço médio", tipo: "moeda", padrao: false },
    ],
    ordenacoes: [ordena("margem", "Margem"), ordena("margemPct", "Margem %"), ordena("receita", "Receita"), ordena("produto", "Produto")],
    agrupamentos: [agrupa("categoria", "Categoria")],
    indicadores: [
      { id: "receita", label: "Receita", tipo: "moeda", calcular: somaDe("receita") },
      { id: "cmv", label: "CMV", tipo: "moeda", calcular: somaDe("custo") },
      { id: "lucro", label: "Margem", tipo: "moeda", calcular: somaDe("margem") },
      {
        id: "margemPct",
        label: "Margem %",
        tipo: "percentual",
        hint: "sobre a receita do período",
        // Margem do período, não média das margens: somar razões dá número errado.
        calcular: (linhas) => {
          const receita = somaDe("receita")(linhas);
          return receita > 0 ? (somaDe("margem")(linhas) / receita) * 100 : 0;
        },
      },
    ],
    ordenacaoPadrao: { coluna: "margem", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarProdutosVendidos,
  },

  // ── Perdas ────────────────────────────────────────────────
  {
    ...doCatalogo("financeiro-perdas"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto")],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoUnitario", label: "Custo unitário", tipo: "moeda", padrao: false },
      { id: "custo", label: "Custo da perda", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [ordena("custo", "Custo da perda"), ordena("quantidade", "Quantidade"), ordena("produto", "Produto")],
    agrupamentos: [],
    indicadores: [
      { id: "total", label: "Perda total", tipo: "moeda", calcular: somaDe("custo") },
      { id: "unidades", label: "Unidades perdidas", tipo: "numero", calcular: somaDe("quantidade") },
    ],
    ordenacaoPadrao: { coluna: "custo", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarPerdas,
  },

  // ── Compras por produto ───────────────────────────────────
  {
    ...doCatalogo("compras-produtos"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto")],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoMedioCompra", label: "Custo unitário médio", tipo: "moeda" },
      { id: "total", label: "Total", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [ordena("total", "Total"), ordena("quantidade", "Quantidade"), ordena("produto", "Produto")],
    agrupamentos: [],
    indicadores: [
      { id: "total", label: "Total comprado", tipo: "moeda", calcular: somaDe("total") },
      { id: "unidades", label: "Unidades", tipo: "numero", calcular: somaDe("quantidade") },
    ],
    ordenacaoPadrao: { coluna: "total", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarComprasProduto,
  },

  // ── Compras por fornecedor ────────────────────────────────
  {
    ...doCatalogo("compras-por-fornecedor"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("fornecedor", "Fornecedor")],
    colunas: [
      { id: "fornecedor", label: "Fornecedor", tipo: "texto", obrigatoria: true },
      { id: "numNotas", label: "Notas", tipo: "inteiro", totalizar: "soma" },
      { id: "total", label: "Total", tipo: "moeda", totalizar: "soma" },
      { id: "ticketNota", label: "Ticket por nota", tipo: "moeda", padrao: false },
    ],
    ordenacoes: [ordena("total", "Total"), ordena("fornecedor", "Fornecedor"), ordena("numNotas", "Notas")],
    agrupamentos: [],
    indicadores: [
      { id: "total", label: "Total comprado", tipo: "moeda", calcular: somaDe("total") },
      { id: "notas", label: "Notas", tipo: "inteiro", calcular: somaDe("numNotas") },
    ],
    ordenacaoPadrao: { coluna: "total", ordem: "desc" },
    limitePadrao: 1000,
    carregar: carregarComprasFornecedor,
  },

  // ── Fechamentos de caixa ──────────────────────────────────
  {
    ...doCatalogo("financeiro-fluxo-caixa"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      { id: "conferidos", label: "Somente caixas conferidos", tipo: "booleano", coluna: "conferido" },
    ],
    colunas: [
      { id: "fechadaEm", label: "Fechado em", tipo: "datahora", obrigatoria: true },
      { id: "site", label: "Loja", tipo: "texto" },
      { id: "abertaEm", label: "Aberto em", tipo: "datahora", padrao: false },
      { id: "valorAbertura", label: "Abertura", tipo: "moeda", totalizar: "soma" },
      { id: "vendasDinheiro", label: "Vendas em dinheiro", tipo: "moeda", totalizar: "soma" },
      { id: "esperado", label: "Esperado", tipo: "moeda", totalizar: "soma" },
      { id: "contado", label: "Contado", tipo: "moeda", totalizar: "soma" },
      { id: "quebra", label: "Quebra", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [ordena("fechadaEm", "Data"), ordena("quebra", "Quebra"), ordena("esperado", "Esperado")],
    agrupamentos: [agrupa("site", "Loja")],
    indicadores: [
      { id: "esperado", label: "Esperado", tipo: "moeda", calcular: somaDe("esperado") },
      { id: "contado", label: "Contado", tipo: "moeda", calcular: somaDe("contado") },
      { id: "quebra", label: "Quebra acumulada", tipo: "moeda", calcular: somaDe("quebra") },
    ],
    ordenacaoPadrao: { coluna: "fechadaEm", ordem: "desc" },
    limitePadrao: 2000,
    carregar: carregarCaixa,
  },

  // ── Produção / drinks ─────────────────────────────────────
  {
    ...doCatalogo("indicadores-producao"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto")],
    colunas: [
      { id: "produto", label: "Drink", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo", padrao: false },
      { id: "quantidade", label: "Vendidos", tipo: "numero", totalizar: "soma" },
      { id: "receita", label: "Receita", tipo: "moeda", totalizar: "soma" },
      { id: "custo", label: "Custo dos insumos", tipo: "moeda", totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margem", label: "Margem", tipo: "moeda", totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margemPct", label: "Margem %", tipo: "percentual", permissao: P_FINANCEIRO },
    ],
    ordenacoes: [ordena("receita", "Receita"), ordena("margem", "Margem"), ordena("quantidade", "Vendidos"), ordena("produto", "Drink")],
    agrupamentos: [],
    indicadores: [
      { id: "receita", label: "Receita", tipo: "moeda", calcular: somaDe("receita") },
      { id: "vendidos", label: "Vendidos", tipo: "numero", calcular: somaDe("quantidade") },
      { id: "lucro", label: "Margem", tipo: "moeda", permissao: P_FINANCEIRO, calcular: somaDe("margem") },
    ],
    ordenacaoPadrao: { coluna: "receita", ordem: "desc" },
    limitePadrao: 2000,
    carregar: carregarProducao,
  },

  // ── Cobertura ─────────────────────────────────────────────
  // Mesmas colunas do inventário; o que muda é por onde se entra: quem abre
  // "abaixo da cobertura" quer ver primeiro o que acaba antes.
  inventario("estoque-cobertura", {
    filtrosPadrao: { ativos: true },
    ordenar: { coluna: "diasCobertura", ordem: "asc" },
  }),

  // ── Validade ──────────────────────────────────────────────
  {
    ...doCatalogo("estoque-validade"),
    filtros: [
      FILTRO_SITE,
      texto("produto", "Produto"),
      texto("lote", "Lote"),
      {
        id: "venceEmAte",
        label: "Vence em até (dias)",
        tipo: "numero",
        coluna: "diasParaVencer",
        modo: "menor",
        sufixo: "dias",
        padrao: 30,
        ajuda: "Vencidos entram sempre — dias negativos passam por qualquer teto.",
      },
      { id: "somenteVencidos", label: "Somente vencidos", tipo: "booleano", coluna: "vencido" },
    ],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo" },
      { id: "categoria", label: "Categoria", tipo: "texto", padrao: false },
      { id: "site", label: "Loja", tipo: "texto" },
      { id: "lote", label: "Lote", tipo: "codigo" },
      { id: "validade", label: "Validade", tipo: "data" },
      { id: "diasParaVencer", label: "Dias", tipo: "inteiro" },
      { id: "situacao", label: "Situação", tipo: "texto", padrao: false },
      { id: "vencido", label: "Vencido", tipo: "booleano", padrao: false },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoUnitario", label: "Custo unitário", tipo: "moeda", padrao: false },
      { id: "valorEmRisco", label: "Valor em risco", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [
      ordena("validade", "Validade"),
      ordena("valorEmRisco", "Valor em risco"),
      ordena("produto", "Produto"),
    ],
    agrupamentos: [agrupa("site", "Loja"), agrupa("categoria", "Categoria")],
    indicadores: [
      { id: "lotes", label: "Lotes", tipo: "inteiro", calcular: (l) => l.length },
      { id: "risco", label: "Valor em risco", tipo: "moeda", calcular: somaDe("valorEmRisco") },
      { id: "vencidos", label: "Já vencidos", tipo: "inteiro", calcular: contarSe("vencido") },
    ],
    ordenacaoPadrao: { coluna: "validade", ordem: "asc" },
    limitePadrao: 5000,
    carregar: carregarValidade,
  },

  // ── Pedidos de compra ─────────────────────────────────────
  {
    ...doCatalogo("compras-pedidos"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      texto("fornecedor", "Fornecedor"),
      {
        id: "status",
        label: "Situação",
        tipo: "opcoes",
        coluna: "status",
        multiplo: true,
        opcoes: [
          { valor: "Rascunho", label: "Rascunho" },
          { valor: "Enviado", label: "Enviado" },
          { valor: "Aguardando entrega", label: "Aguardando entrega" },
          { valor: "Em trânsito", label: "Em trânsito" },
          { valor: "Recebido parcial", label: "Recebido parcial" },
          { valor: "Recebido", label: "Recebido" },
          { valor: "Cancelado", label: "Cancelado" },
        ],
      },
      { id: "abertos", label: "Somente em aberto", tipo: "booleano", coluna: "emAberto" },
    ],
    colunas: [
      { id: "numero", label: "Pedido", tipo: "codigo", obrigatoria: true },
      { id: "status", label: "Situação", tipo: "texto" },
      { id: "fornecedor", label: "Fornecedor", tipo: "texto" },
      { id: "site", label: "Loja", tipo: "texto", padrao: false },
      { id: "criadoEm", label: "Criado em", tipo: "data" },
      { id: "previsaoEntrega", label: "Previsão", tipo: "data" },
      { id: "diasAtraso", label: "Atraso (dias)", tipo: "inteiro", padrao: false },
      { id: "recebidoEm", label: "Recebido em", tipo: "data", padrao: false },
      { id: "itens", label: "Itens", tipo: "inteiro", padrao: false },
      { id: "qtdPedida", label: "Qtd. pedida", tipo: "numero", padrao: false, totalizar: "soma" },
      { id: "qtdRecebida", label: "Qtd. recebida", tipo: "numero", padrao: false, totalizar: "soma" },
      { id: "valorTotal", label: "Valor", tipo: "moeda", totalizar: "soma" },
      { id: "emAberto", label: "Em aberto", tipo: "booleano", padrao: false },
      { id: "observacao", label: "Observação", tipo: "texto", padrao: false },
    ],
    ordenacoes: [
      ordena("criadoEm", "Data"),
      ordena("valorTotal", "Valor"),
      ordena("previsaoEntrega", "Previsão"),
      ordena("fornecedor", "Fornecedor"),
    ],
    agrupamentos: [agrupa("status", "Situação"), agrupa("fornecedor", "Fornecedor"), agrupa("site", "Loja")],
    indicadores: [
      { id: "pedidos", label: "Pedidos", tipo: "inteiro", calcular: (l) => l.length },
      { id: "valor", label: "Valor total", tipo: "moeda", calcular: somaDe("valorTotal") },
      { id: "abertos", label: "Em aberto", tipo: "inteiro", calcular: contarSe("emAberto") },
    ],
    ordenacaoPadrao: { coluna: "criadoEm", ordem: "desc" },
    limitePadrao: 3000,
    carregar: carregarPedidosCompra,
  },

  // ── Histórico de compras ──────────────────────────────────
  {
    ...doCatalogo("compras-historico"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      texto("produto", "Produto"),
      texto("fornecedor", "Fornecedor"),
    ],
    colunas: [
      { id: "data", label: "Data", tipo: "data", obrigatoria: true },
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo", padrao: false },
      { id: "fornecedor", label: "Fornecedor", tipo: "texto" },
      { id: "nota", label: "Nota", tipo: "codigo", padrao: false },
      { id: "site", label: "Loja", tipo: "texto", padrao: false },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoUnitario", label: "Custo unitário", tipo: "moeda" },
      { id: "custoTotal", label: "Custo total", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [
      ordena("data", "Data"),
      ordena("produto", "Produto"),
      ordena("custoUnitario", "Custo unitário"),
      ordena("custoTotal", "Custo total"),
    ],
    agrupamentos: [agrupa("produto", "Produto"), agrupa("fornecedor", "Fornecedor")],
    indicadores: [
      { id: "comprado", label: "Total comprado", tipo: "moeda", calcular: somaDe("custoTotal") },
      { id: "itens", label: "Itens", tipo: "inteiro", calcular: (l) => l.length },
      { id: "unidades", label: "Unidades", tipo: "numero", calcular: somaDe("quantidade") },
    ],
    ordenacaoPadrao: { coluna: "data", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarComprasHistorico,
  },

  // ── Economia obtida ───────────────────────────────────────
  {
    ...doCatalogo("compras-economia"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE, texto("produto", "Produto")],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo", padrao: false },
      { id: "compras", label: "Compras", tipo: "inteiro", padrao: false },
      { id: "quantidade", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      { id: "custoMedio", label: "Custo médio pago", tipo: "moeda" },
      { id: "melhorUnitario", label: "Melhor preço", tipo: "moeda" },
      { id: "melhorFornecedor", label: "Com quem", tipo: "texto" },
      { id: "diferencaUnitaria", label: "Diferença", tipo: "moeda", padrao: false },
      { id: "diferencaPct", label: "Diferença %", tipo: "percentual" },
      { id: "custoTotal", label: "Total pago", tipo: "moeda", padrao: false, totalizar: "soma" },
      { id: "economiaPossivel", label: "Economia possível", tipo: "moeda", totalizar: "soma" },
    ],
    ordenacoes: [
      ordena("economiaPossivel", "Economia possível"),
      ordena("diferencaPct", "Diferença %"),
      ordena("produto", "Produto"),
    ],
    agrupamentos: [],
    indicadores: [
      { id: "economia", label: "Economia possível", tipo: "moeda", calcular: somaDe("economiaPossivel") },
      { id: "pago", label: "Total pago", tipo: "moeda", calcular: somaDe("custoTotal") },
      { id: "produtos", label: "Produtos", tipo: "inteiro", calcular: (l) => l.length },
    ],
    ordenacaoPadrao: { coluna: "economiaPossivel", ordem: "desc" },
    limitePadrao: 2000,
    carregar: carregarEconomiaCompras,
  },

  // ── Comparativo de preços ─────────────────────────────────
  // Retrato do que os fornecedores anunciam HOJE: sem período, porque preço de
  // tabela não tem histórico aqui — tem validade.
  {
    ...doCatalogo("compras-comparativo"),
    filtros: [
      texto("produto", "Produto"),
      texto("fornecedor", "Fornecedor"),
      { id: "somenteMelhor", label: "Só o melhor preço de cada item", tipo: "booleano", coluna: "melhorPreco" },
      { id: "promocao", label: "Somente em promoção", tipo: "booleano", coluna: "emPromocao" },
    ],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "sku", label: "SKU", tipo: "codigo", padrao: false },
      { id: "ean", label: "Código de barras", tipo: "codigo", padrao: false },
      { id: "fornecedor", label: "Fornecedor", tipo: "texto" },
      { id: "codigoFornecedor", label: "Código no fornecedor", tipo: "codigo", padrao: false },
      { id: "preco", label: "Preço", tipo: "moeda" },
      { id: "precoTabela", label: "Preço de tabela", tipo: "moeda", padrao: false },
      { id: "emPromocao", label: "Promoção", tipo: "booleano", padrao: false },
      { id: "melhorPreco", label: "Melhor preço", tipo: "booleano" },
      { id: "quantidadeMinima", label: "Mínimo", tipo: "numero", padrao: false },
      { id: "atualizadoEm", label: "Atualizado em", tipo: "data" },
    ],
    ordenacoes: [ordena("produto", "Produto"), ordena("preco", "Preço"), ordena("fornecedor", "Fornecedor")],
    agrupamentos: [agrupa("produto", "Produto"), agrupa("fornecedor", "Fornecedor")],
    indicadores: [
      { id: "ofertas", label: "Ofertas", tipo: "inteiro", calcular: (l) => l.length },
      { id: "promocoes", label: "Em promoção", tipo: "inteiro", calcular: contarSe("emPromocao") },
    ],
    ordenacaoPadrao: { coluna: "produto", ordem: "asc" },
    limitePadrao: 5000,
    carregar: carregarOfertasFornecedor,
  },

  // ── Clientes ──────────────────────────────────────────────
  clientes("clientes-ativos", {
    filtroJanela: {
      id: "compraramNosUltimos",
      label: "Compraram nos últimos (dias)",
      modo: "menor",
      padrao: 90,
      ajuda: "Quem comprou dentro dessa janela conta como ativo.",
    },
    ordenar: { coluna: "ultimaCompra", ordem: "desc" },
  }),
  clientes("clientes-inativos", {
    filtroJanela: {
      id: "semComprarHa",
      label: "Sem comprar há mais de (dias)",
      modo: "maior",
      padrao: 60,
      ajuda: "Quem passou desse tempo é candidato a campanha de retorno.",
    },
    ordenar: { coluna: "diasSemComprar", ordem: "desc" },
  }),
  clientes("clientes-novos", {
    periodo: true,
    ordenar: { coluna: "cadastradoEm", ordem: "desc" },
    carregar: carregarClientesNovos,
  }),
  clientes("clientes-aniversariantes", {
    periodo: true,
    ordenar: { coluna: "aniversarioDia", ordem: "asc" },
    carregar: carregarClientesAniversariantes,
  }),

  // ── Painel do negócio ─────────────────────────────────────
  {
    ...doCatalogo("indicadores-painel"),
    filtros: [FILTRO_PERIODO, FILTRO_SITE],
    colunas: [
      { id: "data", label: "Dia", tipo: "texto", obrigatoria: true },
      { id: "receita", label: "Receita", tipo: "moeda", totalizar: "soma" },
      { id: "numVendas", label: "Vendas", tipo: "inteiro", totalizar: "soma" },
      { id: "ticketMedio", label: "Ticket médio", tipo: "moeda" },
      { id: "custo", label: "CMV", tipo: "moeda", totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margem", label: "Margem", tipo: "moeda", totalizar: "soma", permissao: P_FINANCEIRO },
      { id: "margemPct", label: "Margem %", tipo: "percentual", permissao: P_FINANCEIRO },
    ],
    ordenacoes: [ordena("data", "Dia"), ordena("receita", "Receita"), ordena("margem", "Margem")],
    agrupamentos: [],
    indicadores: [
      { id: "receita", label: "Receita", tipo: "moeda", calcular: somaDe("receita") },
      { id: "vendas", label: "Vendas", tipo: "inteiro", calcular: somaDe("numVendas") },
      { id: "margem", label: "Margem", tipo: "moeda", permissao: P_FINANCEIRO, calcular: somaDe("margem") },
    ],
    ordenacaoPadrao: { coluna: "data", ordem: "asc" },
    limitePadrao: 1000,
    carregar: carregarPainelDiario,
  },

  // ── Documentos fiscais ────────────────────────────────────
  {
    ...doCatalogo("indicadores-fiscal"),
    filtros: [
      FILTRO_PERIODO,
      FILTRO_SITE,
      texto("destinatario", "Destinatário"),
      {
        id: "status",
        label: "Situação",
        tipo: "opcoes",
        coluna: "status",
        multiplo: true,
        opcoes: [
          { valor: "Autorizada", label: "Autorizada" },
          { valor: "Rejeitada", label: "Rejeitada" },
          { valor: "Cancelada", label: "Cancelada" },
          { valor: "Pendente", label: "Pendente" },
          { valor: "Denegada", label: "Denegada" },
          { valor: "Contingência", label: "Contingência" },
          { valor: "Inutilizada", label: "Inutilizada" },
        ],
      },
      {
        id: "modelo",
        label: "Modelo",
        tipo: "opcoes",
        coluna: "modelo",
        multiplo: true,
        opcoes: [
          { valor: "NF-e", label: "NF-e" },
          { valor: "NFC-e", label: "NFC-e" },
        ],
      },
    ],
    colunas: [
      { id: "data", label: "Emissão", tipo: "datahora", obrigatoria: true },
      { id: "modelo", label: "Modelo", tipo: "texto" },
      { id: "numero", label: "Número", tipo: "codigo" },
      { id: "serie", label: "Série", tipo: "inteiro", padrao: false },
      { id: "direcao", label: "Direção", tipo: "texto", padrao: false },
      { id: "status", label: "Situação", tipo: "texto" },
      { id: "destinatario", label: "Destinatário", tipo: "texto" },
      { id: "documento", label: "CPF/CNPJ", tipo: "codigo", padrao: false },
      { id: "site", label: "Loja", tipo: "texto", padrao: false },
      { id: "valorTotal", label: "Valor", tipo: "moeda", totalizar: "soma" },
      { id: "autorizadaEm", label: "Autorizada em", tipo: "datahora", padrao: false },
      { id: "chave", label: "Chave", tipo: "codigo", padrao: false },
      { id: "motivoRejeicao", label: "Motivo da rejeição", tipo: "texto", padrao: false },
    ],
    ordenacoes: [ordena("data", "Emissão"), ordena("valorTotal", "Valor"), ordena("numero", "Número")],
    agrupamentos: [agrupa("status", "Situação"), agrupa("modelo", "Modelo"), agrupa("site", "Loja")],
    indicadores: [
      { id: "documentos", label: "Documentos", tipo: "inteiro", calcular: (l) => l.length },
      { id: "valor", label: "Valor total", tipo: "moeda", calcular: somaDe("valorTotal") },
    ],
    ordenacaoPadrao: { coluna: "data", ordem: "desc" },
    limitePadrao: 5000,
    carregar: carregarFiscal,
  },
];

const POR_ID = new Map(DECLARADAS.map((d) => [d.id, d]));

// ── Derivadas do motor de análises ──────────────────────────

const FORMATO_TIPO: Record<Formato, TipoValor> = {
  moeda: "moeda",
  numero: "numero",
  inteiro: "inteiro",
  percentual: "percentual",
  texto: "texto",
};

/** Dimensão do fato que cada filtro do catálogo empurra para o motor. */
const FILTRO_DIMENSAO: Partial<Record<FiltroId, string>> = {
  categoria: "categoria",
  fornecedor: "fornecedor",
  produto: "produto",
  cliente: "cliente",
};

/**
 * Definição derivada de uma consulta do catálogo.
 *
 * As dimensões da consulta são o GRÃO do relatório e viram colunas
 * obrigatórias — desmarcar "produto" em "vendas por produto" não daria menos
 * colunas, daria outro relatório. Já as métricas viram colunas opcionais, e
 * TODAS as do fato entram na lista: quem abre "mais vendidos" pode acrescentar
 * margem sem que ninguém precise programar isso.
 */
export function definicaoDeConsulta(rel: RelatorioDef): ReportDefinition | null {
  if (rel.destino.tipo !== "consulta") return null;
  const base = rel.destino.consulta;
  const fato = getFato(base.fato);
  if (!fato) return null;

  const dimensoes: ColunaDef[] = base.dimensoes.map((id) => ({
    id,
    label: getDimensao(fato, id)?.label ?? id,
    tipo: "texto",
    obrigatoria: true,
  }));

  const metricas: ColunaDef[] = fato.metricas.map((m) => ({
    id: m.id,
    label: m.label,
    tipo: FORMATO_TIPO[m.formato] ?? "numero",
    padrao: base.metricas.includes(m.id),
    // Só soma o que É somável: contagem distinta e razão (ticket, margem %)
    // não se somam linha a linha, e um rodapé errado é pior que rodapé nenhum.
    totalizar: m.tipo === "soma" ? "soma" : undefined,
    permissao: m.permissao,
  }));

  const filtros: FiltroDef[] = rel.filtros.flatMap((f): FiltroDef[] => {
    if (f === "periodo") return fato.usaPeriodo ? [FILTRO_PERIODO] : [];
    if (f === "site") return [FILTRO_SITE];
    const dim = FILTRO_DIMENSAO[f];
    if (!dim || !getDimensao(fato, dim)) return [];
    return [
      {
        id: f,
        label: getDimensao(fato, dim)!.label,
        tipo: "texto",
        coluna: dim,
        modo: "contem",
        placeholder: "Todos",
        // Vai no DSL, não na peneira: a dimensão filtrada pode nem estar entre
        // as colunas do resultado (filtrar categoria numa lista por produto).
        aplicaNaFonte: true,
      },
    ];
  });

  const somaveis = fato.metricas.filter((m) => m.tipo === "soma");

  return {
    id: rel.id,
    nome: rel.nome,
    descricao: rel.descricao,
    categoria: rel.categoria,
    icon: rel.icon,
    permissao: rel.permissao,
    filtros,
    colunas: [...dimensoes, ...metricas],
    ordenacoes: [...dimensoes, ...metricas].map((c) => ordena(c.id, c.label)),
    // Agrupar por uma dimensão quando ela é a única quebra deixaria um grupo
    // por linha. Só faz sentido quando a consulta cruza duas ou mais.
    agrupamentos:
      base.dimensoes.length > 1 ? dimensoes.map((d) => agrupa(d.id, d.label)) : [],
    indicadores: somaveis.map(
      (m): IndicadorDef => ({
        id: m.id,
        label: m.label,
        tipo: FORMATO_TIPO[m.formato] ?? "numero",
        permissao: m.permissao,
        calcular: somaDe(m.id),
      }),
    ),
    exportacoes: rel.exportacoes.length > 0 ? [...rel.exportacoes] : [...EXPORT_TUDO],
    ordenacaoPadrao: base.ordenar
      ? { coluna: base.ordenar.por, ordem: base.ordenar.ordem }
      : { coluna: base.metricas[0] ?? dimensoes[0]?.id ?? "", ordem: "desc" },
    limitePadrao: 500,
    carregar: (ctx) => carregarConsulta(rel, base, fato.metricas, ctx),
  };
}

async function carregarConsulta(
  rel: RelatorioDef,
  base: Consulta,
  disponiveis: MetricaDef[],
  ctx: FonteCtx,
): Promise<Linha[]> {
  const idsMetricas = new Set(disponiveis.map((m) => m.id));
  // O motor precisa de pelo menos uma métrica; se o operador só deixou colunas
  // de dimensão, roda com as da consulta original.
  const escolhidas = ctx.colunas.filter((c) => idsMetricas.has(c));
  const metricas = escolhidas.length > 0 ? escolhidas.slice(0, 6) : base.metricas;

  const extras = Object.entries(ctx.filtros).flatMap(([id, valor]) => {
    const filtro = rel.filtros.find((f) => f === id);
    const campo = filtro ? FILTRO_DIMENSAO[filtro] : undefined;
    const busca = typeof valor === "string" ? valor.trim() : "";
    if (!campo || !busca) return [];
    return [{ campo, op: "contem" as const, valor: busca }];
  });

  const consulta = consultaSchema.parse({
    ...base,
    metricas,
    // O período já veio resolvido pelo motor genérico; entregá-lo como
    // intervalo explícito garante que os dois falem do MESMO recorte, sem
    // depender de os dois resolverem "últimos 30 dias" na mesma hora.
    periodo: ctx.periodo
      ? { preset: "custom" as const, de: diaIso(ctx.periodo.inicio), ate: diaIso(ultimoDia(ctx.periodo.fim)) }
      : base.periodo,
    // Filtro do catálogo primeiro: o do operador soma, nunca substitui.
    filtros: [...base.filtros, ...extras].slice(0, 8),
    limite: 500,
  });

  const resultado = await executarConsulta({
    consulta,
    acessos: ctx.acessos,
    siteId: ctx.siteId,
    policy: ctx.policy,
  });

  return resultado.brutas as Linha[];
}

/** `YYYY-MM-DD` em horário local — é o dialeto que `resolvePeriodo` entende. */
function diaIso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** O período do motor tem fim EXCLUSIVO; o DSL pede o último dia incluído. */
function ultimoDia(fimExclusivo: Date): Date {
  return new Date(fimExclusivo.getTime() - 864e5);
}

// ── Consultas ao registro ───────────────────────────────────

/**
 * Definição de um relatório, declarada ou derivada. `null` quando o relatório
 * aponta para uma tela do app — esses continuam abrindo a tela.
 */
export function getDefinicao(id: string): ReportDefinition | null {
  const declarada = POR_ID.get(id);
  if (declarada) return declarada;

  const rel = getRelatorio(id);
  if (!rel) return null;
  return definicaoDeConsulta(rel);
}

export function temDefinicao(id: string): boolean {
  return getDefinicao(id) !== null;
}
