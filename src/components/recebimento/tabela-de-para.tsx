"use client";

import {
  Fragment,
  useEffect,
  useState,
  useTransition,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  CircleCheck,
  Clock3,
  Gift,
  Info,
  Loader2,
  MoreVertical,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import {
  RelacionarProduto,
  type ItemDeNota,
} from "@/components/recebimento/relacionar-produto";
import { fatorDaNota } from "@/lib/fiscal/fator";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";
import {
  fatorDaUnidade,
  frasesDeConversao,
  rotuloDaUnidade,
  unidadeComercial,
  unidadesDaLinha,
} from "@/lib/fiscal/unidades";
import { origemDoFator, type OrigemFator } from "@/lib/fiscal/vinculo";
import {
  bloqueia,
  divergenciasDoItem,
  severidadeMaxima,
  type Severidade,
} from "@/lib/fiscal/divergencias";
import {
  TabelaComparacao,
  type LinhaComparacao,
} from "@/components/recebimento/comparacao-xml";
import { cfopDeEntrada } from "@/lib/fiscal/cfop";
import { fmtMoney, fmtQtd } from "@/app/(app)/cotacoes/_ui";
import {
  desrelacionarItemAction,
  relacionarEmLoteAction,
  relacionarItemAction,
  sugestoesDaNotaAction,
  type SubcategoriaCadastro,
} from "@/app/(app)/recebimento/actions";
import type { SugestaoDePara } from "@/lib/compras/sugestao-de-para";
import { CONFIANCA } from "@/lib/compras/sugestao-pelo-pedido-regras";

// ============================================================
// Etapa 1 do recebimento: o que chegou × o que isso é no NoHub.
//
// A pergunta que o operador faz olhando uma nota de quarenta linhas nunca é
// "qual o CFOP desta?" — é "esse aí virou qual produto meu, e quantas unidades
// entram?". Todo o resto (NCM, CEST, GTIN tributável, código do fornecedor)
// continua aqui, mas atrás de "Ver detalhes": dado fiscal disputando espaço
// com a decisão é o que fazia a tela parecer um formulário de conferência.
//
// A tabela segue a ordem da nota, numerada, com a situação e o próximo passo
// de cada linha na ponta direita. Quem quer só o que falta usa o filtro
// "Pendentes"; o que serve para várias linhas de uma vez mora em "Ações em
// lote".
// ============================================================

/** Uma linha do XML com tudo que a decisão de de-para precisa. */
export type ItemDePara = {
  id: string;
  ordem: number;
  codigoFornecedor: string;
  gtin: string | null;
  descricao: string;
  /** Classificação fiscal como o fornecedor declarou. */
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  /** vUnCom — preço na unidade do fornecedor (a caixa, não a garrafa). */
  valorUnitario: number;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorFcpSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
  productId: string | null;
  productNome: string | null;
  productSku: string | null;
  /** Marca do produto relacionado — só para a busca da tabela achar por ela. */
  productMarca?: string | null;
  /**
   * Unidade de MEDIDA do produto (UN, ML, G). NÃO é o que entra numa compra:
   * a entrada soma `estoqueFechado`, que conta unidades fechadas — 12 garrafas
   * entram como 12, mesmo num suco medido em ml. O ml só aparece no saldo
   * ABERTO, quando alguém abre uma garrafa para usar em receita.
   */
  productUnidade: string | null;
  /** Conteúdo de uma unidade fechada, na unidadeBase (1000 ml na garrafa). */
  productConteudo: number | null;
  productImagemUrl: string | null;
  /** Código de barras do produto — para saber se o da nota é novo. */
  productEan: string | null;
  /** Os outros códigos que já bipam neste produto (outras marcas). */
  productCodigos: { codigo: string }[];
  /** NCM que vale hoje no cadastro (perfil do produto ou da subcategoria). */
  productNcm: string | null;
  /** Dono atual do GTIN da linha, quando não é o produto relacionado. */
  donoDoGtin: { productId: string; nome: string; sku: string; onde: string } | null;
  /** Custo médio atual — base do alerta de custo fora da curva. */
  productCustoMedio: number | null;
  /**
   * Embalagens de compra do produto relacionado. Ficam aqui para a quantidade
   * por embalagem ser corrigida NA LINHA: antes, mudar "12 por caixa" para 24
   * exigia desfazer o de-para, buscar o produto de novo e relacionar de novo.
   */
  productEmbalagens: { id: string; nome: string; ean: string | null; fator: number }[];
  packagingId: string | null;
  fatorConversao: number;
};

type Sugestao = SugestaoDePara;

/**
 * Quantidade por embalagem salva × a que a nota declara. Diferença é erro de
 * estoque esperando acontecer: ou o fornecedor mudou o fardo, ou o de-para
 * nasceu errado. Quem decide é o operador — a tela só não deixa passar calado.
 */
export function fatorDivergente(i: ItemDePara): number | null {
  const daNota = fatorDaNota(i);
  return daNota != null && daNota !== i.fatorConversao ? daNota : null;
}

/**
 * Em que pé está o de-para desta linha. Três estados, porque são três
 * trabalhos diferentes: nada a fazer, escolher o produto, ou conferir um
 * palpite que não fecha com o que a nota declara.
 */
export type EstadoItem = "OK" | "PENDENTE" | "REVISAR";

export function estadoDoItem(i: ItemDePara): EstadoItem {
  if (!i.productId) return "PENDENTE";
  return bloqueia(divergenciasDaLinha(i)) ? "REVISAR" : "OK";
}

/**
 * O que ESTA linha ainda pede da pessoa — em ordem de quem trava mais.
 *
 * Mais fino que `estadoDoItem` porque as duas pendências que sobram numa nota
 * real são trabalhos diferentes: "não sei que produto é" manda para a busca;
 * "não sei quantas vêm na caixa" é um número digitado na própria linha. Contar
 * as duas juntas como "8 pendências" escondia qual delas viria pela frente.
 */
export type Pendencia = "SEM_PRODUTO" | "SEM_EMBALAGEM" | "CONFERIR" | "PRONTO";

export function pendenciaDoItem(i: ItemDePara): Pendencia {
  if (!i.productId) return "SEM_PRODUTO";
  const ds = divergenciasDaLinha(i);
  if (ds.some((d) => d.tipo === "FATOR_CHUTADO")) return "SEM_EMBALAGEM";
  return bloqueia(ds) ? "CONFERIR" : "PRONTO";
}

/**
 * A linha da tabela na forma que a régua de divergência entende.
 *
 * A régua vive em `lib/fiscal/divergencias` — pura, para que o servidor e a
 * tela nunca discordem sobre o que interrompe o operador. Aqui só traduzimos
 * a view desta tabela para o formato dela.
 */
export function divergenciasDaLinha(i: ItemDePara) {
  return divergenciasDoItem(
    {
      gtin: i.gtin,
      ncm: i.ncm,
      unidade: i.unidade,
      quantidade: i.quantidade,
      unidadeTributavel: i.unidadeTributavel,
      quantidadeTributavel: i.quantidadeTributavel,
      fatorConversao: i.fatorConversao,
      packagingId: i.packagingId,
      bonificacao: i.bonificacao,
      custoLinha: custoItem(i),
    },
    i.productId
      ? {
          id: i.productId,
          nome: i.productNome ?? "este produto",
          ean: i.productEan,
          codigos: i.productCodigos,
          ncm: i.productNcm,
          custoMedio: i.productCustoMedio ?? 0,
          packagings: i.productEmbalagens.map((e) => ({
            id: e.id,
            nome: e.nome,
            ean: e.ean,
            fatorConversao: e.fator,
          })),
        }
      : null,
    i.donoDoGtin,
  );
}

/** Onde o código de barras da nota encaixa no cadastro do produto escolhido. */
function ondeEncaixaOGtin(i: ItemDePara): string {
  if (!i.gtin) return "—";
  if (i.donoDoGtin && i.donoDoGtin.productId !== i.productId) {
    return `${i.donoDoGtin.onde} de ${i.donoDoGtin.nome}`;
  }
  if (i.productEan && i.productEan === i.gtin) return "código do produto";
  // Apelido já cadastrado: o açúcar da Caravelas num produto que nasceu com o
  // código da União. É "código do produto" igual — não é novidade nenhuma.
  if (i.productCodigos.some((c) => c.codigo === i.gtin)) return "código do produto";
  const emb = i.productEmbalagens.find((e) => e.ean === i.gtin);
  if (emb) return `embalagem “${emb.nome}”`;
  return "ainda não está no cadastro";
}

/**
 * As duas colunas lado a lado para uma linha já relacionada. Aqui "NoHub" é o
 * que JÁ está gravado — diferente do cadastro a partir da nota, onde é o que
 * ainda vai ser salvo.
 */
export function linhasDeRevisao(i: ItemDePara): LinhaComparacao[] {
  const uCom = i.unidade.trim().toUpperCase() || UNIDADE_ENTRADA;
  const daNota = fatorDaNota(i);
  const emb = i.productEmbalagens.find((e) => e.id === i.packagingId) ?? null;
  const unidades = i.quantidade * i.fatorConversao;
  const custoUn = unidades > 0 ? custoItem(i) / unidades : 0;
  const gtinFora =
    Boolean(i.gtin) &&
    (Boolean(i.donoDoGtin && i.donoDoGtin.productId !== i.productId) ||
      ondeEncaixaOGtin(i) === "ainda não está no cadastro");
  const ncmDiverge =
    Boolean(i.ncm) &&
    Boolean(i.productNcm) &&
    i.ncm!.replace(/\D/g, "") !== i.productNcm!.replace(/\D/g, "");

  return [
    { rotulo: "Descrição", xml: i.descricao, nohub: i.productNome ?? "—" },
    {
      rotulo: "Código do fornecedor",
      xml: i.codigoFornecedor,
      nohub: "de-para deste fornecedor",
    },
    {
      rotulo: "Código de barras",
      xml: i.gtin,
      nohub: ondeEncaixaOGtin(i),
      diverge: gtinFora,
    },
    {
      // Unidade COMERCIAL do fornecedor × unidade em que o estoque conta. São
      // coisas diferentes e a tela precisa dizer isso com todas as letras: o
      // fornecedor fatura milheiro, a prateleira conta maço.
      rotulo: "Unidade",
      xml: rotuloDaUnidade(i.unidade),
      nohub: emb ? `${emb.nome} → ${UNIDADE_ENTRADA}` : `${UNIDADE_ENTRADA} (estoque e venda)`,
    },
    {
      rotulo: "Quantidade",
      xml: `${fmtQtd(i.quantidade)} ${uCom}`,
      nohub: `${fmtQtd(unidades)} ${UNIDADE_ENTRADA}`,
    },
    {
      rotulo: "Conversão aplicada",
      xml: daNota != null ? frasesDeConversao(uCom, daNota) : null,
      nohub: `${frasesDeConversao(uCom, i.fatorConversao)} · ${ORIGEM_FATOR[origemDoFator(i)]}`,
      diverge: daNota != null && daNota !== i.fatorConversao,
    },
    {
      rotulo: "Custo unitário",
      xml: custoUn > 0 ? `${fmtMoney(custoUn)} / ${UNIDADE_ENTRADA}` : null,
      nohub: i.productCustoMedio
        ? `${fmtMoney(i.productCustoMedio)} de custo médio`
        : "sem histórico",
      diverge: desvioDeCusto(i) != null,
    },
    {
      rotulo: "NCM",
      xml: i.ncm,
      nohub: i.productNcm ?? "sem perfil fiscal",
      diverge: ncmDiverge,
    },
    { rotulo: "CEST", xml: i.cest, nohub: "perfil fiscal do produto" },
    {
      rotulo: "CFOP",
      // O da nota é a saída do fornecedor; do nosso lado a mesma operação é
      // entrada. Mostrar os dois evita a pergunta "por que mudou?".
      xml: i.cfop,
      nohub: cfopDeEntrada(i.cfop) ? `${cfopDeEntrada(i.cfop)} (entrada)` : "—",
    },
    {
      rotulo: "Unidade tributável",
      xml: i.unidadeTributavel,
      nohub: i.unidadeTributavel ?? "—",
    },
  ];
}

/** Custo real do item: mercadoria + ST + IPI + frete − desconto. */
export function custoItem(i: ItemDePara): number {
  if (i.bonificacao) return 0;
  return Math.max(
    0,
    i.valorTotal -
      i.valorDesconto +
      i.valorIcmsSt +
      i.valorFcpSt +
      i.valorIpi +
      i.valorFrete,
  );
}

/**
 * Quanto o custo desta linha destoa do custo médio do produto. Acima de 30%
 * quase sempre é a quantidade por embalagem errada — a caixa entrando como
 * unidade. Depois de receber, isso vira preço de venda errado e margem que
 * ninguém explica; aqui é uma linha vermelha antes de receber.
 */
export function desvioDeCusto(i: ItemDePara): number | null {
  if (!i.productId || i.bonificacao) return null;
  const base = i.productCustoMedio ?? 0;
  const unidades = i.quantidade * i.fatorConversao;
  if (base <= 0 || unidades <= 0) return null;
  const desvio = (custoItem(i) / unidades - base) / base;
  return Math.abs(desvio) >= 0.3 ? desvio : null;
}

/** Item da nota → o que o painel de relacionar precisa saber dele. */
export function paraRelacionar(i: ItemDePara): ItemDeNota {
  return {
    inboundItemId: i.id,
    descricao: i.descricao,
    gtin: i.gtin,
    codigoFornecedor: i.codigoFornecedor,
    ncm: i.ncm,
    cest: i.cest,
    cfop: i.cfop,
    unidade: i.unidade,
    quantidade: i.quantidade,
    unidadeTributavel: i.unidadeTributavel,
    quantidadeTributavel: i.quantidadeTributavel,
    valorUnitario: i.valorUnitario,
    fatorConversao: i.fatorConversao,
    custoLinha: custoItem(i),
    productId: i.productId,
  };
}

/** De onde saiu o número de unidades por embalagem — dito como o operador diria. */
const ORIGEM_FATOR: Record<OrigemFator, string> = {
  CADASTRO: "do cadastro do produto",
  NOTA: "declarado pelo fornecedor",
  UNIDADE: "conversão padrão da unidade",
  MANUAL: "informado por você",
  SEM_CONVERSAO: "ninguém informou",
};

/** Verde pronto, laranja confirma, vermelho erro, cinza secundário — e só. */
const SEVERIDADE_UI: Record<Severidade, { chip: string; ponto: string }> = {
  CRITICA: { chip: "bg-danger-soft text-danger hover:bg-danger/15", ponto: "bg-danger" },
  ATENCAO: { chip: "bg-warn-soft text-warn hover:bg-warn/15", ponto: "bg-warn" },
  INFORMATIVA: { chip: "bg-surface-2 text-muted hover:text-ink", ponto: "bg-faint" },
};

/**
 * Compra entra em UNIDADE FECHADA — sempre.
 *
 * `registrarEntrada` soma `estoqueFechado`, que conta garrafas, latas e caixas
 * inteiras. A `unidadeBase` do produto (ML, G) mede outra coisa: o saldo
 * ABERTO, o que sobra dentro da garrafa que alguém abriu para uma receita.
 * Rotular a entrada com a unidadeBase dizia "entra 12 ML" onde entram 12
 * garrafas — e mandava o operador caçar no cadastro um erro que não existia.
 */
const UNIDADE_ENTRADA = "UN";

/** "1000 ml" — o conteúdo de cada unidade fechada, quando o produto é medido. */
function medidaDoProduto(item: ItemDePara): string | null {
  const u = item.productUnidade;
  if (!u || u.toUpperCase() === UNIDADE_ENTRADA) return null;
  if (!item.productConteudo || item.productConteudo <= 0) return u.toLowerCase();
  return `${fmtQtd(item.productConteudo)} ${u.toLowerCase()}`;
}

/** "caixa", "fardo" — a palavra que o operador usa para a embalagem da nota. */
function palavraDaEmbalagem(item: ItemDePara): string {
  return nomeDaEmbalagem(item.unidade).toLowerCase();
}

// ── Situação da linha ───────────────────────────────────────

/**
 * As três situações que a tela mostra.
 *
 * `pendenciaDoItem` distingue quatro trabalhos (escolher o produto, dizer a
 * conversão, conferir uma diferença, nada). Para quem olha a nota inteira os
 * dois primeiros são a mesma coisa — "ainda falta eu fazer algo" — e a coluna
 * de quantidade convertida diz qual dos dois é.
 */
export type SituacaoItem = "PENDENTE" | "RELACIONADO" | "DIVERGENCIA";

export function situacaoDoItem(i: ItemDePara): SituacaoItem {
  const p = pendenciaDoItem(i);
  if (p === "PRONTO") return "RELACIONADO";
  return p === "CONFERIR" ? "DIVERGENCIA" : "PENDENTE";
}

/** Quantos itens em cada situação — a mesma conta nos filtros e no andamento. */
export function contarSituacoes(itens: ItemDePara[]): Record<SituacaoItem, number> {
  const n: Record<SituacaoItem, number> = { PENDENTE: 0, RELACIONADO: 0, DIVERGENCIA: 0 };
  for (const i of itens) n[situacaoDoItem(i)]++;
  return n;
}

type Lente = "TODOS" | SituacaoItem;

const SITUACAO_UI: Record<
  SituacaoItem,
  { rotulo: string; filtro: string; selo: string; Icone: typeof CircleCheck }
> = {
  PENDENTE: {
    rotulo: "Pendente",
    filtro: "Pendentes",
    selo: "bg-brand-softer text-accent",
    Icone: Clock3,
  },
  RELACIONADO: {
    rotulo: "Relacionado",
    filtro: "Relacionados",
    selo: "bg-ok-soft text-ok",
    Icone: CircleCheck,
  },
  DIVERGENCIA: {
    rotulo: "Divergência",
    filtro: "Com divergência",
    selo: "bg-danger-soft text-danger",
    Icone: TriangleAlert,
  },
};

/**
 * De onde veio a sugestão, em duas palavras. "Confiança baixa" assustava mais
 * do que informava; o porquê inteiro continua no hover, e a cor ainda separa o
 * que é prova (código de barras) do que é palpite.
 */
const ORIGEM_SUGESTAO: Record<SugestaoDePara["motivo"], string> = {
  EAN: "Pelo código de barras",
  PEDIDO: "Sugestão automática",
  NOME: "Sugestão automática",
};

/** "125,42" — o cabeçalho da coluna já diz que é em reais. */
const fmtValor = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TabelaDePara({
  inboundId,
  itens,
  sugestoesIniciais,
  editavel,
  podeCriarProduto,
  supplierId,
  siteId,
  subcategorias,
  purchaseOrderId = null,
  pedidoDasSugestoes = null,
  mostrarSku = true,
}: {
  inboundId: string;
  itens: ItemDePara[];
  /** Palpites já calculados no servidor — a tabela nasce com eles. */
  sugestoesIniciais: Sugestao[];
  /** Nota ainda mexível E a pessoa pode mexer. Falso = tabela só de leitura. */
  editavel: boolean;
  podeCriarProduto: boolean;
  /** Fornecedor da nota — dá contexto de histórico à busca do painel. */
  supplierId?: string | null;
  /** Loja da entrada — o saldo mostrado é o de lá. */
  siteId?: string | null;
  /** Quem já carregou no servidor passa; quem não passou, busca sob demanda. */
  subcategorias?: SubcategoriaCadastro[];
  /**
   * Pedido que a nota fatura, quando o operador já disse qual é. Os produtos
   * dele entram na disputa dos palpites.
   */
  purchaseOrderId?: string | null;
  /** Com qual pedido o servidor calculou `sugestoesIniciais`. */
  pedidoDasSugestoes?: string | null;
  /** SKU ligado nas configurações de produto. Desligado, a coluna não o mostra. */
  mostrarSku?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [relacionando, setRelacionando] = useState<ItemDePara | null>(null);
  /**
   * Palpites. Começam prontos do servidor e são REFEITOS depois de cada
   * de-para — relacionar uma linha pode criar embalagem/EAN que muda o palpite
   * das outras. Null = recalculando.
   */
  const [palpites, setPalpites] = useState<Sugestao[] | null>(sugestoesIniciais);
  // Props novas do servidor (refresh depois de gravar) mandam. Ajuste durante o
  // render, não efeito: assim a tabela nunca pinta com o palpite velho.
  /** Linha gravando agora — o giro fica nela, não numa barra global. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ultimoServidor, setUltimoServidor] = useState(sugestoesIniciais);
  if (ultimoServidor !== sugestoesIniciais) {
    setUltimoServidor(sugestoesIniciais);
    setPalpites(sugestoesIniciais);
    // Chegou dado novo do servidor: o giro da linha cumpriu o que tinha a
    // dizer. Sem isto, o de-para feito no painel lateral gravava, o painel
    // fechava e a linha só mudava quando o refresh caía — em silêncio.
    setConfirmando(null);
  }
  /** Gravando o lote inteiro. */
  const [emLote, setEmLote] = useState(false);
  const [busca, setBusca] = useState("");
  const [lente, setLente] = useState<Lente>("TODOS");
  const faltam = itens.filter((i) => !i.productId).length;
  // Derivado, não sincronizado: nota já resolvida não tem palpite a mostrar.
  const sugestoes = editavel && faltam > 0 ? palpites : [];

  /**
   * Palpites por código de barras — os que dá para gravar em lote sem olhar.
   * EAN batendo é prova; palpite por nome é decisão do operador, e só entra em
   * lote quando ele marca a linha.
   */
  const porCodigo = (sugestoes ?? []).filter((s) => s.motivo === "EAN");

  const sugestaoDe = (itemId: string) => sugestoes?.find((s) => s.itemId === itemId) ?? null;

  // A tabela segue a ordem da nota, com o número da linha à vista: é como o
  // operador confere contra o papel. Quem quer só o que falta usa o filtro.
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);
  const numeroDe = new Map(ordenados.map((i, idx) => [i.id, idx + 1]));
  const contagens = contarSituacoes(itens);

  // Filtro que esvaziou — o operador resolveu a última pendência dele — deixaria
  // a tela em branco sem explicação. Derivado, não corrigido por efeito: a
  // lista volta a ser todos no mesmo render.
  const lenteAtiva: Lente = lente !== "TODOS" && contagens[lente] === 0 ? "TODOS" : lente;

  const q = busca.trim().toLowerCase();
  const visiveis = ordenados.filter((i) => {
    if (lenteAtiva !== "TODOS" && situacaoDoItem(i) !== lenteAtiva) return false;
    if (!q) return true;
    const s = sugestaoDe(i.id);
    // Os dois lados da linha: como o fornecedor escreveu e o que isso é (ou
    // parece ser) no catálogo — produto, SKU, marca e o palpite ainda aberto.
    return [
      i.descricao,
      i.codigoFornecedor,
      i.gtin,
      i.productNome,
      i.productSku,
      i.productMarca,
      s?.nome,
      s?.sku,
    ]
      .filter(Boolean)
      .some((c) => String(c).toLowerCase().includes(q));
  });

  /** Refaz os palpites depois de mexer no de-para. */
  function recalcularPalpites() {
    setPalpites(null);
    sugestoesDaNotaAction(inboundId, purchaseOrderId)
      .then(setPalpites)
      .catch(() => setPalpites([]));
  }

  // O operador trocou de pedido sem ir ao servidor: os palpites que vieram
  // prontos foram calculados com outro pedido (ou sem nenhum). Busca os certos
  // — e o próximo refresh já traz os dois iguais.
  useEffect(() => {
    if (purchaseOrderId === pedidoDasSugestoes) return;
    let vivo = true;
    sugestoesDaNotaAction(inboundId, purchaseOrderId)
      .then((lista) => {
        if (vivo) setPalpites(lista);
      })
      // Palpite é atalho: sem ele a linha segue com a busca no catálogo.
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [inboundId, purchaseOrderId, pedidoDasSugestoes]);

  /**
   * Grava de uma vez tudo que o código de barras já provou. Trinta linhas com
   * o EAN do fornecedor batendo são trinta cliques para dizer "sim" trinta
   * vezes. Palpite por nome não entra: ali a decisão é do operador.
   */
  function relacionarPorCodigo() {
    const lista = porCodigo;
    if (lista.length === 0) return;
    setEmLote(true);
    start(async () => {
      try {
        const r = await relacionarEmLoteAction(
          lista.map((s) => ({
            itemId: s.itemId,
            productId: s.productId,
            packagingId: s.packagingId,
            fatorConversao: s.fatorConversao,
          })),
        );
        toast.success(
          `${r.relacionados} ${r.relacionados === 1 ? "item relacionado" : "itens relacionados"}.`,
          r.falhas > 0
            ? `${r.falhas} linha(s) não deram certo — continuam na lista.`
            : "Todos pelo código de barras do fornecedor.",
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao relacionar em lote.");
      } finally {
        setEmLote(false);
      }
    });
  }

  /** Grava o palpite como o servidor propôs. Um clique, sem formulário. */
  function confirmarSugestao(s: Sugestao) {
    // Qual linha está gravando. Em nota de 40 itens o operador confirma em
    // sequência: sem o giro NA LINHA que ele clicou, o clique parece não ter
    // pegado e ele clica de novo — e a segunda gravação briga com a primeira.
    setConfirmando(s.itemId);
    start(async () => {
      try {
        const r = await relacionarItemAction({
          itemId: s.itemId,
          productId: s.productId,
          packagingId: s.packagingId,
          fatorConversao: s.fatorConversao,
        });
        toast.success(
          `${s.nome} relacionado.`,
          r.irmaos > 0
            ? `Mais ${r.irmaos} linha(s) com o mesmo código entraram junto.`
            : "Nas próximas notas deste fornecedor ele entra sozinho.",
          // O operador confirma em sequência e só percebe o engano na linha
          // seguinte. Sem isto, desfazer é achar a linha de novo na tabela.
          {
            rotulo: "Desfazer",
            onClick: () => desrelacionar({ id: s.itemId }),
          },
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao relacionar.");
      } finally {
        setConfirmando(null);
      }
    });
  }

  /**
   * Muda só quantas unidades vêm na embalagem, mantendo o produto.
   *
   * Antes, corrigir "12 por caixa" para 24 obrigava a desfazer o de-para,
   * buscar o produto de novo no painel e relacionar outra vez — três passos
   * para mexer num número que já estava na tela. Reaproveita a mesma ação de
   * relacionar, então o cadastro do produto e o mapa do fornecedor aprendem o
   * número novo junto: a próxima nota deste fornecedor já vem certa.
   */
  function definirEmbalagem(item: ItemDePara, fator: number, packagingId: string | null) {
    if (!item.productId) return;
    setConfirmando(item.id);
    const emb = palavraDaEmbalagem(item);
    start(async () => {
      try {
        await relacionarItemAction({
          itemId: item.id,
          productId: item.productId!,
          packagingId,
          fatorConversao: fator,
        });
        toast.success(
          `1 ${emb} = ${fmtQtd(fator)} ${UNIDADE_ENTRADA}.`,
          fator > 1
            ? `Salvo no cadastro de ${item.productNome ?? "produto"} — as próximas compras já vêm assim.`
            : "Esta linha entra como unidade avulsa.",
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Falha ao salvar a quantidade por embalagem.",
        );
      } finally {
        setConfirmando(null);
      }
    });
  }

  function desrelacionar(item: Pick<ItemDePara, "id">) {
    setConfirmando(item.id);
    start(async () => {
      try {
        await desrelacionarItemAction(item.id);
        toast.success(
          "Relação desfeita.",
          "O de-para salvo para este código do fornecedor também foi apagado.",
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao desfazer.");
      } finally {
        setConfirmando(null);
      }
    });
  }

  const colunas = 9;

  return (
    <>
      <div className="@container overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        {/* ── Filtros e busca ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar itens da nota">
            <Filtro
              rotulo="Todos"
              total={itens.length}
              ativo={lenteAtiva === "TODOS"}
              conta="bg-surface-2 text-muted"
              onClick={() => setLente("TODOS")}
            />
            {(["PENDENTE", "RELACIONADO", "DIVERGENCIA"] as const).map((s) => (
              <Filtro
                key={s}
                rotulo={SITUACAO_UI[s].filtro}
                total={contagens[s]}
                ativo={lenteAtiva === s}
                conta={SITUACAO_UI[s].selo}
                onClick={() => setLente(s)}
              />
            ))}
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto lg:flex-nowrap">
            <div className="relative min-w-48 flex-1 lg:w-64 lg:flex-none">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto na nota…"
                aria-label="Buscar produto na nota por descrição, código, EAN, SKU ou marca"
                className="h-9 w-full rounded-full border border-line-strong bg-surface pr-3 pl-8 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>

            {/* Só aparece quando há o que gravar sem perguntar: o EAN da nota é
                o de um produto do catálogo. */}
            {editavel && porCodigo.length > 0 && (
              <Button
                size="sm"
                onClick={relacionarPorCodigo}
                disabled={emLote || pending}
                className="shrink-0"
              >
                {emLote ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <CheckCheck size={14} aria-hidden />
                )}
                {emLote ? "Relacionando…" : `Relacionar ${porCodigo.length} pelo código de barras`}
              </Button>
            )}
          </div>
        </div>

        {/* As colunas acompanham a largura do cartão: com espaço, o EAN tem
            coluna própria; sem ele, desce para baixo do código do fornecedor.
            Abaixo disso a tabela rola de lado — e a coluna de ação fica presa
            à direita, porque é ela que o operador veio procurar. */}
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[49rem] border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2">
                <Th className="w-10 pl-3 sm:pl-4">#</Th>
                <Th sub="Código do fornecedor">Produto na nota</Th>
                <Th className="hidden @[60rem]:table-cell">EAN</Th>
                <Th sub="(embalagem)">Qtd. nota</Th>
                <Th sub="(unidade de estoque)">Produto no NoHub</Th>
                <Th
                  sub="(estoque)"
                  dica="Quantidade da nota × unidades por embalagem. É o que vira saldo; a quantidade do XML não muda."
                >
                  Qtd. convertida
                </Th>
                <Th sub="(unitário)" className="text-right">
                  Custo (R$)
                </Th>
                <Th className="text-center">Status</Th>
                <Th className={cn(CELULA_FIXA, "pr-4 text-right")}>Ação</Th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <LinhaItem
                  key={i.id}
                  item={i}
                  numero={numeroDe.get(i.id) ?? 0}
                  colunas={colunas}
                  editavel={editavel && !pending}
                  salvando={confirmando === i.id}
                  mostrarSku={mostrarSku}
                  sugestao={sugestaoDe(i.id)}
                  buscandoSugestao={sugestoes === null}
                  onConfirmar={confirmarSugestao}
                  onRelacionar={() => setRelacionando(i)}
                  onDefinirEmbalagem={(fator, packagingId) => definirEmbalagem(i, fator, packagingId)}
                  onDesrelacionar={() => desrelacionar(i)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {visiveis.length === 0 && (
          <p className="border-t border-line px-4 py-8 text-center text-[13px] text-muted">
            {itens.length === 0
              ? "Esta nota não tem itens de mercadoria."
              : q
                ? `Nenhum item da nota com “${busca.trim()}”. `
                : "Nenhum item neste filtro. "}
            {itens.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setLente("TODOS");
                }}
                className="cursor-pointer font-medium text-brand-strong underline"
              >
                Ver os {itens.length} itens
              </button>
            )}
          </p>
        )}
      </div>

      {relacionando && (
        <RelacionarProduto
          // Instância nova por item: ao avançar na fila, busca e formulário
          // nascem limpos, sem efeito espelhando prop em state.
          key={relacionando.id}
          item={paraRelacionar(relacionando)}
          restantes={Math.max(0, faltam - 1)}
          podeCriarProduto={podeCriarProduto}
          supplierId={supplierId}
          siteId={siteId}
          subcategorias={subcategorias}
          mostrarSku={mostrarSku}
          onFechar={() => setRelacionando(null)}
          onPular={() => {
            // Item duvidoso não pode travar a fila: pula para o próximo
            // pendente e deixa este para o fim, em vez de o operador fechar o
            // painel inteiro e perder o embalo.
            const proximo = ordenados.find((i) => !i.productId && i.id !== relacionando.id);
            setRelacionando(proximo ?? null);
          }}
          onRelacionado={(itemId) => {
            // Fila: emenda no próximo pendente em vez de fechar e obrigar o
            // operador a caçar a próxima linha pendente na tabela.
            const proximo = ordenados.find((i) => !i.productId && i.id !== itemId);
            setRelacionando(proximo ?? null);
            // O giro fica na linha que acabou de ser relacionada até o
            // servidor devolver a tabela nova — o painel fecha na hora, a
            // linha ainda não mudou, e sem sinal isso parece não ter gravado.
            if (itemId) setConfirmando(itemId);
            recalcularPalpites();
            start(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

/**
 * Um filtro da tabela, com a contagem dentro. Zero aparece, mas não clica.
 * A conferência usa o mesmo — as duas tabelas do recebimento se leem igual.
 */
export function Filtro({
  rotulo,
  total,
  ativo,
  conta,
  onClick,
}: {
  rotulo: string;
  total: number;
  ativo: boolean;
  /** Cor da contagem quando o filtro não é o ativo. */
  conta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      // Filtro vazio continua à vista — a posição dos quatro não muda enquanto
      // o operador trabalha — mas não leva a uma lista em branco.
      disabled={total === 0 && !ativo}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border pr-1.5 pl-3 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-default disabled:opacity-60",
        ativo
          ? "border-brand bg-brand text-on-brand"
          : "border-line-strong bg-surface text-ink-2 enabled:hover:bg-surface-2",
      )}
    >
      {rotulo}
      <span
        className={cn(
          "min-w-5 rounded-full px-1.5 py-0.5 text-center font-mono text-[11px] leading-none font-semibold",
          ativo ? "bg-on-brand/25 text-on-brand" : conta,
        )}
      >
        {total}
      </span>
    </button>
  );
}

/** Cabeçalho de coluna em duas linhas: o que é, e em que unidade se lê. */
export function Th({
  children,
  sub,
  dica,
  className,
}: {
  children: ReactNode;
  sub?: string;
  /** Explicação curta, num "i" ao lado do título. */
  dica?: string;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-2 py-2 text-left align-top font-medium", className)}>
      <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-ink-2">
        {children}
        {dica && (
          <span title={dica} className="text-faint">
            <Info size={12} aria-hidden />
            <span className="sr-only">{dica}</span>
          </span>
        )}
      </span>
      {sub && <span className="block text-[10px] font-normal whitespace-nowrap text-faint">{sub}</span>}
    </th>
  );
}

/**
 * A coluna de ação fica presa à direita quando a tabela rola de lado. O fundo
 * vem da linha (`bg-inherit`), e o fio à esquerda só aparece quando há rolagem
 * — com a tabela inteira à vista, seria uma divisória a mais.
 */
const CELULA_FIXA =
  "sticky right-0 z-[1] bg-inherit @max-[49rem]:border-l @max-[49rem]:border-line";

const BOTAO_LINHA = {
  cheio: "border-brand bg-brand text-on-brand hover:bg-brand-strong",
  marca: "border-brand/60 bg-surface text-accent hover:bg-brand-soft",
  neutro: "border-line-strong bg-surface text-ink hover:bg-surface-2",
} as const;

/** O botão da coluna Ação: um por linha, e ele diz o próximo passo dela. */
function BotaoLinha({
  tom,
  className,
  ...props
}: { tom: keyof typeof BOTAO_LINHA } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 min-w-[5.75rem] cursor-pointer items-center justify-center gap-1 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        BOTAO_LINHA[tom],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Uma linha da nota, lida da esquerda para a direita: o que chegou (como o
 * fornecedor escreveu), o que isso é no NoHub, quanto vira estoque e quanto
 * custou — e, na ponta, em que pé está e qual é o próximo passo dela.
 *
 * O que é fiscal (NCM, CEST, CFOP, GTIN tributável) e a comparação campo a
 * campo ficam atrás de "Ver detalhes": continuam aqui, só não disputam a
 * atenção com a decisão.
 */
function LinhaItem({
  item,
  numero,
  colunas,
  editavel,
  salvando,
  mostrarSku,
  sugestao,
  buscandoSugestao,
  onConfirmar,
  onRelacionar,
  onDefinirEmbalagem,
  onDesrelacionar,
}: {
    item: ItemDePara;
    /** Número da linha na nota — o mesmo com ou sem filtro. */
    numero: number;
    /** Quantas colunas a tabela tem — para as sublinhas ocuparem a largura toda. */
    colunas: number;
    editavel: boolean;
    /** Esta linha está gravando agora. */
    salvando: boolean;
    mostrarSku: boolean;
    sugestao: Sugestao | null;
    buscandoSugestao: boolean;
    onConfirmar: (s: Sugestao) => void;
    onRelacionar: () => void;
    /** Só quantas unidades vêm na embalagem muda — o produto continua o mesmo. */
    onDefinirEmbalagem: (fator: number, packagingId: string | null) => void;
    onDesrelacionar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const divergencias = divergenciasDaLinha(item);
  const pendencia = pendenciaDoItem(item);
  const situacao = SITUACAO_UI[situacaoDoItem(item)];
  /** O que o ícone de status quer dizer, dito por inteiro. */
  const explicacaoDoStatus =
    pendencia === "SEM_PRODUTO"
      ? "Pendente: falta relacionar o produto"
      : pendencia === "SEM_EMBALAGEM"
        ? "Pendente: falta dizer quantas unidades vêm na embalagem"
        : pendencia === "CONFERIR"
          ? "Divergência: revise antes de receber"
          : "Relacionado";
  const severidade = severidadeMaxima(divergencias);
  const divergente = fatorDivergente(item);
  // O que entra na compra é SEMPRE unidade fechada. Rotular com a unidadeBase
  // fazia a tela dizer "entra 12 ML" numa caixa de 12 garrafas de suco — e o
  // operador ia procurar no cadastro do produto um erro que não existia.
  const medida = medidaDoProduto(item);
  const entra = item.quantidade * item.fatorConversao;
  const custo = custoItem(item);
  const desvio = desvioDeCusto(item);
  const origem = origemDoFator(item);
  const uCom = item.unidade.trim().toUpperCase() || UNIDADE_ENTRADA;
  const emb = palavraDaEmbalagem(item);
  const rotuloUnidade = rotuloDaUnidade(item.unidade);
  /** A linha entra no estoque num número diferente do que a nota escreveu. */
  const convertido = item.fatorConversao !== 1;
  const explicacaoConversao =
    `A nota fatura em ${rotuloUnidade}. ${frasesDeConversao(uCom, item.fatorConversao)} — ${ORIGEM_FATOR[origem]}. ` +
    `${fmtQtd(item.quantidade)} ${uCom} × ${fmtQtd(item.fatorConversao)} = ${fmtQtd(entra)} ${UNIDADE_ENTRADA} no estoque. ` +
    `A quantidade e a unidade do XML não mudam.` +
    // Produto medido em ml/g: dizer o conteúdo evita a leitura errada de que o
    // saldo passou a ser contado em mililitro.
    (medida ? ` Cada unidade tem ${medida}.` : "");
  const definindo = editavel && Boolean(item.productId) && editando;

  function fecharEditor() {
    setEditando(false);
  }

  return (
    <Fragment>
      <tr
        className={cn(
          // Fundos opacos de propósito: a célula de ação fica presa à direita
          // e herda o fundo da linha — com transparência, o que rola por baixo
          // apareceria através dela.
          "border-t border-line bg-surface align-middle transition-colors first:border-t-0 hover:bg-surface-2",
          // Gravando: a linha inteira se marca. Em nota de 40 itens o operador
          // confirma em sequência e o olho já saiu daqui — o giro no selo
          // sozinho não alcança quem está lendo a linha de baixo.
          salvando && "bg-brand-soft hover:bg-brand-soft",
        )}
      >
        <td
          className={cn(
            "py-2 pr-2 pl-3 font-semibold text-ink tabular-nums sm:pl-4",
          )}
        >
          {numero}
        </td>

        {/* ── O que chegou ─────────────────────────────────── */}
        <td className="max-w-[13rem] px-2 py-2">
          <p className="leading-snug font-medium text-ink">{item.descricao}</p>
          {/* O código do fornecedor não decide nada — mas é o que a pessoa
              confere contra o papel quando desconfia. */}
          <p className="font-mono text-[10px] text-faint">
            {item.codigoFornecedor}
            {item.gtin && <span className="@[60rem]:hidden"> · {item.gtin}</span>}
          </p>
          {item.bonificacao && (
            <span className="mt-1 inline-block">
              <Badge tone="accent">
                <Gift size={11} /> bonificação
              </Badge>
            </span>
          )}
        </td>

        <td className="hidden px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted @[60rem]:table-cell">
          {item.gtin || <span className="text-faint">—</span>}
        </td>

        {/* A sigla sozinha é o que engana: "0,6 MI" lido como "0,6" faz o
            operador achar que chegou menos de um maço. O nome por extenso fica
            a um hover — na linha, só a sigla, que é o que está no papel. */}
        <td className="px-2 py-2 font-medium whitespace-nowrap text-ink" title={rotuloUnidade}>
          {fmtQtd(item.quantidade)} {uCom}
        </td>

        {/* ── O que isso é no NoHub ─────────────────────────── */}
        <td className="max-w-[13rem] px-2 py-2">
          {item.productId ? (
            <div className="flex items-center gap-2">
              <ProdutoThumb url={item.productImagemUrl} nome={item.productNome} size="xs" />
              <div className="min-w-0">
                <p className="leading-snug font-medium text-ink">{item.productNome}</p>
                {mostrarSku && (
                  <p className="font-mono text-[10px] text-faint">{item.productSku}</p>
                )}
                {/* Chip só existe quando algo destoa — o caminho limpo segue
                    sem ruído, e a comparação abre logo abaixo da linha. */}
                {divergencias.length > 0 && severidade && (
                  <button
                    type="button"
                    onClick={() => setDetalhes((v) => !v)}
                    aria-expanded={detalhes}
                    className={cn(
                      "mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-left text-[10px] font-medium transition-colors",
                      SEVERIDADE_UI[severidade].chip,
                    )}
                  >
                    <TriangleAlert size={10} aria-hidden className="shrink-0" />
                    {divergencias.length === 1
                      ? divergencias[0].titulo
                      : `${divergencias.length} diferenças encontradas`}
                  </button>
                )}
              </div>
            </div>
          ) : sugestao ? (
            // Palpite do servidor: um clique na coluna Ação resolve. O motivo
            // aparece porque "mesmo código de barras" é prova e "nome parecido"
            // é chute — e o operador confia diferente em cada um.
            <div className="flex items-center gap-2">
              <ProdutoThumb url={sugestao.imagemUrl} nome={sugestao.nome} size="xs" />
              <div className="min-w-0">
                <p
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-medium",
                    CONFIANCA[sugestao.motivo].nivel === "alta"
                      ? "text-ok"
                      : CONFIANCA[sugestao.motivo].nivel === "media"
                        ? "text-info"
                        : "text-warn",
                  )}
                  title={CONFIANCA[sugestao.motivo].justificativa}
                >
                  <Sparkles size={10} aria-hidden className="shrink-0" />
                  {ORIGEM_SUGESTAO[sugestao.motivo]}
                </p>
                <p className="leading-snug text-ink-2">{sugestao.nome}</p>
                {(mostrarSku || sugestao.fatorConversao > 1) && (
                  <p className="font-mono text-[10px] text-faint">
                    {[
                      mostrarSku ? sugestao.sku : null,
                      sugestao.fatorConversao > 1
                        ? `1 ${uCom} = ${fmtQtd(sugestao.fatorConversao)} ${UNIDADE_ENTRADA}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
          ) : buscandoSugestao && editavel ? (
            <span className="text-faint">Procurando no catálogo…</span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>

        {/* ── Quanto entra no estoque ───────────────────────── */}
        <td className="px-2 py-2">
          {!item.productId ? (
            <span className="text-faint">—</span>
          ) : pendencia === "SEM_EMBALAGEM" ? (
            // O caso que estoura o estoque em silêncio: a nota veio em caixa e
            // ninguém disse quantas cabem, então 3 caixas viram 3 unidades.
            <span
              className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-warn"
              title={`A unidade ${uCom} do XML não tem conversão cadastrada: falta dizer quantas unidades esta linha representa.`}
            >
              <TriangleAlert size={12} aria-hidden />
              Sem conversão
            </span>
          ) : (
            // O XML fica intacto: o que a conversão produz é OUTRO número, ao
            // lado da quantidade da nota, nunca por cima dela.
            <div title={explicacaoConversao}>
              <p className="font-medium whitespace-nowrap text-ink">
                {fmtQtd(entra)} {UNIDADE_ENTRADA}
              </p>
              {convertido && (
                <p
                  className={cn(
                    "font-mono text-[10px] whitespace-nowrap",
                    divergente ? "text-info" : "text-faint",
                  )}
                >
                  1 {uCom} = {fmtQtd(item.fatorConversao)}
                  {divergente ? ` · a nota diz ${fmtQtd(divergente)}` : ""}
                </p>
              )}
            </div>
          )}
        </td>

        {/* ── Custo da NF ───────────────────────────────────── */}
        <td className="px-2 py-2 text-right whitespace-nowrap">
          {item.bonificacao ? (
            <span className="text-muted">sem custo</span>
          ) : (
            <>
              <p className="font-mono text-ink">{fmtValor(custo)}</p>
              {/* Por unidade de estoque — só quando a conversão é conhecida:
                  dividir pela caixa e chamar de unitário é o erro que vira
                  preço de venda errado. */}
              {item.productId && entra > 0 && pendencia !== "SEM_EMBALAGEM" && (
                <p
                  className={cn(
                    "inline-flex items-center gap-0.5 font-mono text-[10px]",
                    desvio == null ? "text-faint" : desvio > 0 ? "text-danger" : "text-ok",
                  )}
                  title={
                    desvio == null
                      ? "Custo por unidade de estoque"
                      : `${Math.abs(Math.round(desvio * 100))}% ${desvio > 0 ? "acima" : "abaixo"} do custo médio (${fmtMoney(item.productCustoMedio ?? 0)})`
                  }
                >
                  {desvio != null &&
                    (desvio > 0 ? (
                      <TrendingUp size={10} aria-hidden />
                    ) : (
                      <TrendingDown size={10} aria-hidden />
                    ))}
                  ({fmtValor(custo / entra)})
                </p>
              )}
            </>
          )}
        </td>

        {/* ── Em que pé está ────────────────────────────────── */}
        {/* Só o ícone: a cor já diz o estado, e a frase completa fica no
            hover — e no leitor de tela, que não vê cor. */}
        <td className="px-2 py-2 text-center">
          {salvando ? (
            <span
              role="status"
              title="Salvando…"
              className="inline-grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-accent"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span className="sr-only">Salvando…</span>
            </span>
          ) : (
            <span
              title={explicacaoDoStatus}
              className={cn("inline-grid h-7 w-7 cursor-help place-items-center rounded-full", situacao.selo)}
            >
              <situacao.Icone className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{explicacaoDoStatus}</span>
            </span>
          )}
        </td>

        {/* ── O próximo passo ───────────────────────────────── */}
        <td className={cn(CELULA_FIXA, "py-2 pr-2 pl-2")}>
          {/* Botão e menu lado a lado: são as ações da mesma linha. */}
          <div className="flex items-center justify-end gap-0.5">
            {!editavel ? (
              <span />
            ) : !item.productId && sugestao ? (
              <BotaoLinha tom="cheio" disabled={salvando} onClick={() => onConfirmar(sugestao)}>
                <Check size={13} aria-hidden />
                Confirmar
              </BotaoLinha>
            ) : !item.productId ? (
              // Só "relacionar". Cadastrar produto novo mora DENTRO do painel de
              // relacionar: a busca vem primeiro porque o produto quase sempre já
              // existe, e o atalho para cadastrar aqui fazia nascer duplicata.
              <BotaoLinha tom="marca" disabled={salvando} onClick={onRelacionar}>
                Relacionar
              </BotaoLinha>
            ) : pendencia === "SEM_EMBALAGEM" ? (
              <BotaoLinha tom="marca" disabled={salvando} onClick={() => setEditando(true)}>
                Converter
              </BotaoLinha>
            ) : pendencia === "CONFERIR" ? (
              <BotaoLinha tom="neutro" onClick={() => setDetalhes((v) => !v)} aria-expanded={detalhes}>
                Revisar
              </BotaoLinha>
            ) : (
              <BotaoLinha tom="neutro" disabled={salvando} onClick={onRelacionar}>
                Editar
              </BotaoLinha>
            )}
            <Menu
              trigger={
                <button
                  type="button"
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  aria-label={`Mais ações da linha ${numero}`}
                >
                  <MoreVertical size={15} aria-hidden />
                </button>
              }
            >
              {editavel && !item.productId && sugestao && (
                <MenuItem icon={<Search size={15} />} onClick={onRelacionar}>
                  Escolher outro produto
                </MenuItem>
              )}
              {editavel && item.productId && pendencia !== "PRONTO" && (
                <MenuItem icon={<Search size={15} />} onClick={onRelacionar}>
                  Trocar produto
                </MenuItem>
              )}
              {editavel && item.productId && (
                <MenuItem icon={<ArrowRightLeft size={15} />} onClick={() => setEditando(true)}>
                  {convertido ? "Alterar conversão" : `Informar unidades por ${emb}`}
                </MenuItem>
              )}
              <MenuItem icon={<Info size={15} />} onClick={() => setDetalhes((v) => !v)}>
                {detalhes ? "Ocultar detalhes" : "Ver detalhes"}
              </MenuItem>
              {/* Desfazer apaga também o de-para do fornecedor: fica por último
                  e em vermelho, longe do que se clica o tempo todo. */}
              {editavel && item.productId && (
                <MenuItem icon={<Unlink size={15} />} danger onClick={onDesrelacionar}>
                  Remover relação
                </MenuItem>
              )}
            </Menu>
          </div>
        </td>
      </tr>

      {/* "Quantas vêm na caixa?" abre logo abaixo da linha: a pergunta precisa
          de mais largura do que uma célula de quantidade tem. */}
      {definindo && (
        <tr className="border-t border-line bg-surface-2/60">
          <td colSpan={colunas} className="px-4 py-3 sm:px-6">
            <DefinirEmbalagem
              item={item}
              sugeridoPelaNota={divergente ?? fatorDaNota(item)}
              salvando={salvando}
              onCancelar={fecharEditor}
              onSalvar={(fator, packagingId) => {
                fecharEditor();
                onDefinirEmbalagem(fator, packagingId);
              }}
            />
          </td>
        </tr>
      )}

      {/* Só quem abriu vê. NCM, CEST, CFOP, GTIN tributável e a lista de
          diferenças moram aqui — disponíveis, nunca no caminho. */}
      {detalhes && (
        <tr className="border-t border-line bg-surface-2/60">
          <td colSpan={colunas} className="px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-3">
              {divergencias.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {divergencias.map((d) => (
                    <li key={d.tipo} className="flex items-start gap-2 text-[12px]">
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          SEVERIDADE_UI[d.severidade].ponto,
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{d.titulo}</span>
                        <span className="block text-muted">{d.detalhe}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <TabelaComparacao linhas={linhasDeRevisao(item)} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}


/**
 * "Quantas unidades vêm nessa caixa?" — respondido na própria linha.
 *
 * Três caminhos, do mais rápido ao mais manual: uma embalagem já cadastrada do
 * produto, o que o fornecedor declarou na nota (qTrib/qCom), ou o número
 * digitado. Os três gravam pelo mesmo caminho do de-para, então a embalagem
 * entra no cadastro do produto e o mapa do fornecedor aprende — a próxima nota
 * já chega com a conta certa, sem ninguém digitar de novo.
 */
function DefinirEmbalagem({
  item,
  sugeridoPelaNota,
  salvando,
  onCancelar,
  onSalvar,
}: {
  item: ItemDePara;
  /** Quantidade por embalagem que a nota declara, quando declara. */
  sugeridoPelaNota: number | null;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (fator: number, packagingId: string | null) => void;
}) {
  /** O que a sigla responde sozinha: milheiro é mil, dúzia é doze. */
  const daUnidade = fatorDaUnidade(item.unidade);
  const [valor, setValor] = useState(
    item.fatorConversao > 1
      ? String(item.fatorConversao)
      : String(sugeridoPelaNota ?? daUnidade ?? ""),
  );
  const fator = Number(valor.replace(",", ".")) || 0;
  const entra = item.quantidade * fator;
  const custoUnitario = fator > 0 && entra > 0 ? custoItem(item) / entra : null;
  /**
   * A conta fecha em peça? 0,5 CX × 3 = 1,5 garrafas não existe, e o servidor
   * recusa gravar — melhor dizer isso aqui, antes do clique.
   */
  const conversao = unidadesDaLinha(item.quantidade, fator);
  const fracionada = fator > 0 && !conversao.exata;
  const medida = medidaDoProduto(item);
  const emb = palavraDaEmbalagem(item);
  const uCom = item.unidade.trim().toUpperCase() || UNIDADE_ENTRADA;
  const unidadeInfo = unidadeComercial(item.unidade);

  return (
    <div
      className="flex max-w-[19rem] flex-col items-start gap-2"
      onClick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <p className="text-[12px] font-medium text-ink">
        {unidadeInfo?.classe === "MEDIDA"
          ? `${fmtQtd(item.quantidade)} ${uCom}: quantas unidades entram no estoque?`
          : `Quantas unidades vêm em cada ${emb}?`}
      </p>

      <div className="flex items-center gap-1.5">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && fator > 0 && !fracionada) onSalvar(fator, null);
            if (e.key === "Escape") onCancelar();
          }}
          inputMode="decimal"
          autoFocus
          placeholder="6"
          aria-label={`Unidades por ${emb}`}
          className="h-9 w-20 rounded-[var(--radius-sm)] border border-line-button bg-surface px-2 text-right font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        <span className="text-[12px] whitespace-nowrap text-muted">
          unidades por {emb}
        </span>
      </div>

      {/* Embalagem já cadastrada é o caminho certo: grava o packagingId junto,
          e aí a quantidade passa a vir do CADASTRO, não de um número solto. */}
      {item.productEmbalagens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.productEmbalagens.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={salvando}
              onClick={() => onSalvar(e.fator, e.id)}
              className="rounded-full border border-line-button px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              {e.nome} · {fmtQtd(e.fator)} un
            </button>
          ))}
        </div>
      )}

      {sugeridoPelaNota != null && sugeridoPelaNota !== fator && (
        <button
          type="button"
          onClick={() => setValor(String(sugeridoPelaNota))}
          className="text-left text-[11px] font-medium text-brand underline"
        >
          usar {fmtQtd(sugeridoPelaNota)}, como o fornecedor declarou
        </button>
      )}

      {/* A sigla que responde sozinha: milheiro é mil em qualquer produto, e
          quem digita "1000" à mão erra um zero mais cedo ou mais tarde. */}
      {daUnidade != null && daUnidade !== fator && (
        <button
          type="button"
          onClick={() => setValor(String(daUnidade))}
          className="text-left text-[11px] font-medium text-brand underline"
        >
          usar {fmtQtd(daUnidade)} — {frasesDeConversao(uCom, daUnidade)}, padrão do{" "}
          {(unidadeInfo?.nome ?? uCom).toLowerCase()}
        </button>
      )}

      {/* O resultado em tempo real é o que denuncia o número errado antes de
          ele virar saldo: 3 caixas × 6 são 18, e R$ 100,80 a garrafa grita. */}
      {fator > 0 && !fracionada && (
        <p className="text-[12px] text-ink-2">
          →{" "}
          <span className="font-mono font-semibold text-brand-strong">
            {fmtQtd(entra)} {UNIDADE_ENTRADA}
          </span>{" "}
          {entra === 1 ? "entrará no estoque" : "entrarão no estoque"}
          {medida && <span className="text-faint"> · {medida} cada</span>}
          {custoUnitario != null && (
            <span className="block font-mono text-[11px] text-faint">
              {fmtMoney(custoUnitario)} por unidade
            </span>
          )}
        </p>
      )}

      {/* Peça é indivisível. Dizer isso com a conta na frente evita o clique
          que o servidor vai recusar — e explica o que está errado. */}
      {fracionada && (
        <p className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {fmtQtd(item.quantidade)} {uCom} × {fmtQtd(fator)} dá{" "}
            {fmtQtd(conversao.bruto)} unidades. O estoque conta peça inteira — ajuste o
            número.
          </span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={salvando || fator <= 0 || fracionada}
          onClick={() => onSalvar(fator, null)}
        >
          {salvando ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Check size={13} />
          )}
          Confirmar
        </Button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={salvando}
          className="text-[11px] font-medium text-muted underline"
        >
          cancelar
        </button>
      </div>

      {fator > 1 && (
        <p className="text-[11px] text-faint">
          Fica salvo no cadastro do produto: as próximas compras deste fornecedor já vêm com
          1 {uCom} = {fmtQtd(fator)} {UNIDADE_ENTRADA}.
        </p>
      )}
    </div>
  );
}
