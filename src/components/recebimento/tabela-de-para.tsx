"use client";

import {
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  ChevronDown,
  Gift,
  Loader2,
  Plus,
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

// ============================================================
// Etapa 1 do recebimento: o que chegou × o que isso é no NoHub.
//
// A pergunta que o operador faz olhando uma nota de quarenta linhas nunca é
// "qual o CFOP desta?" — é "esse aí virou qual produto meu, e quantas unidades
// entram?". Todo o resto (NCM, CEST, GTIN tributável, código do fornecedor)
// continua aqui, mas atrás de "Mais detalhes": dado fiscal disputando espaço
// com a decisão é o que fazia a tela parecer um formulário de conferência.
//
// A tela trabalha por PENDÊNCIA, não por linha: o que chegou pronto sai do
// caminho, e o que falta sobe ao topo com a ação ao lado.
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
  const uCom = i.unidade.trim() || UNIDADE_ENTRADA;
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
      rotulo: "Embalagem",
      xml: uCom,
      nohub: emb ? `${emb.nome} → ${UNIDADE_ENTRADA}` : UNIDADE_ENTRADA,
    },
    {
      rotulo: "Quantidade",
      xml: `${fmtQtd(i.quantidade)} ${uCom}`,
      nohub: `${fmtQtd(unidades)} ${UNIDADE_ENTRADA}`,
    },
    {
      rotulo: "Unidades por embalagem",
      xml: daNota != null ? `1 ${uCom} = ${fmtQtd(daNota)} ${UNIDADE_ENTRADA}` : null,
      nohub: `1 ${uCom} = ${fmtQtd(i.fatorConversao)} ${UNIDADE_ENTRADA} · ${ORIGEM_FATOR[origemDoFator(i)]}`,
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
  MANUAL: "informado por você",
  SEM_CONVERSAO: "ninguém informou",
};

/** Verde pronto, laranja confirma, vermelho erro, cinza secundário — e só. */
const SEVERIDADE_UI: Record<Severidade, { chip: string; ponto: string }> = {
  CRITICA: { chip: "bg-danger-soft text-danger hover:bg-danger/15", ponto: "bg-danger" },
  ATENCAO: { chip: "bg-warn-soft text-warn hover:bg-warn/15", ponto: "bg-warn" },
  INFORMATIVA: { chip: "bg-surface-2 text-muted hover:text-ink", ponto: "bg-faint" },
};

const PENDENCIA_UI: Record<
  Pendencia,
  { titulo: string; curto: string; ponto: string; linha: string; tom: string }
> = {
  SEM_PRODUTO: {
    titulo: "Precisam de produto",
    curto: "sem produto",
    ponto: "bg-warn",
    linha: "bg-warn-soft/40",
    tom: "bg-warn-soft text-warn",
  },
  SEM_EMBALAGEM: {
    titulo: "Precisam da quantidade por embalagem",
    curto: "sem quantidade por embalagem",
    ponto: "bg-warn",
    linha: "bg-warn-soft/40",
    tom: "bg-warn-soft text-warn",
  },
  CONFERIR: {
    titulo: "Confira antes de receber",
    curto: "com diferença",
    ponto: "bg-info",
    linha: "bg-info-soft/40",
    tom: "bg-info-soft text-info",
  },
  PRONTO: {
    titulo: "Prontos",
    curto: "prontos",
    ponto: "bg-ok",
    linha: "",
    tom: "bg-surface-2 text-muted",
  },
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

/** Nota com mais linhas que isto ganha campo de busca. */
const LIMIAR_BUSCA = 12;

/** As lentes da etapa 1 — o operador trabalha só no que ainda pede ação. */
type Lente = "TODOS" | "PENDENCIAS" | Pendencia;

/**
 * O resumo de pendências — a única coisa que o operador lê antes de decidir
 * onde gastar os próximos cinco minutos.
 *
 * "8 de 19 itens ainda sem produto" respondia metade da pergunta: dizia que
 * havia trabalho, não QUAL trabalho. Aqui a barra mostra o quanto já andou e
 * cada linha do resumo é um filtro clicável — ninguém precisa rolar quarenta
 * linhas procurando as laranjas.
 */
function ResumoDePara({
  contagens,
  total,
  lente,
  onLente,
  verTabela,
  onVerTabela,
}: {
  contagens: Record<Pendencia, number>;
  total: number;
  lente: Lente;
  onLente: (l: Lente) => void;
  verTabela: boolean;
  onVerTabela: () => void;
}) {
  const pendencias = total - contagens.PRONTO;
  const pct = total > 0 ? (contagens.PRONTO / total) * 100 : 0;

  const resumo: { chave: Pendencia; rotulo: string; icone: string; classe: string }[] = [
    {
      chave: "PRONTO",
      rotulo: contagens.PRONTO === 1 ? "pronto" : "prontos",
      icone: "✓",
      classe: "text-ok",
    },
    {
      chave: "SEM_PRODUTO",
      rotulo: contagens.SEM_PRODUTO === 1 ? "precisa de produto" : "precisam de produto",
      icone: "!",
      classe: "text-warn",
    },
    {
      chave: "SEM_EMBALAGEM",
      rotulo:
        contagens.SEM_EMBALAGEM === 1
          ? "precisa da quantidade por embalagem"
          : "precisam da quantidade por embalagem",
      icone: "!",
      classe: "text-warn",
    },
    {
      chave: "CONFERIR",
      rotulo: contagens.CONFERIR === 1 ? "com diferença" : "com diferenças",
      icone: "⚠",
      classe: "text-info",
    },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-[15px] font-semibold text-ink">
          {total} {total === 1 ? "item" : "itens"} na nota
        </p>
        <p className="flex items-center gap-2 text-[13px]">
          <span className={cn("font-medium", pendencias === 0 ? "text-ok" : "text-warn")}>
            {pendencias === 0
              ? "Tudo pronto para a próxima etapa."
              : `${pendencias} ${pendencias === 1 ? "item precisa" : "itens precisam"} de você.`}
          </span>
          {/* Nota que chegou inteira relacionada (o comum, depois que o mapa do
              fornecedor aprendeu) abria com 40 linhas cobrindo o trabalho real,
              que é dizer de onde veio a compra. O resumo fica; a tabela dobra. */}
          <button
            type="button"
            onClick={onVerTabela}
            aria-expanded={verTabela}
            className="font-medium text-brand underline"
          >
            {verTabela ? "ocultar itens" : "ver itens"}
          </button>
        </p>
      </div>

      {/* Dois saldos na mesma régua, como o medidor de estoque: o que já está
          pronto e o que falta. Quem olha de longe lê a barra, não o número. */}
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-warn-soft"
        role="progressbar"
        aria-valuenow={contagens.PRONTO}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Itens prontos"
      >
        <span
          className="h-full bg-ok transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {resumo
          .filter((r) => contagens[r.chave] > 0)
          .map((r) => (
            <li key={r.chave}>
              <button
                type="button"
                onClick={() => onLente(lente === r.chave ? "TODOS" : r.chave)}
                aria-pressed={lente === r.chave}
                className={cn(
                  "flex items-center gap-1.5 text-[13px] transition-opacity hover:opacity-80",
                  lente === r.chave && "underline underline-offset-4",
                )}
              >
                <span className={cn("font-semibold", r.classe)} aria-hidden>
                  {r.icone}
                </span>
                <span className="font-semibold tabular-nums text-ink">
                  {contagens[r.chave]}
                </span>
                <span className="text-muted">{r.rotulo}</span>
              </button>
            </li>
          ))}
      </ul>

      {/* Só existem os filtros que têm item. Chip com zero é botão que não leva
          a lugar nenhum — e ainda faz a barra parecer mais cheia do que está. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["TODOS", "Todos", total],
            ["PENDENCIAS", "Pendências", pendencias],
            ["SEM_PRODUTO", "Sem produto", contagens.SEM_PRODUTO],
            ["SEM_EMBALAGEM", "Sem quantidade por embalagem", contagens.SEM_EMBALAGEM],
            ["CONFERIR", "Com diferença", contagens.CONFERIR],
            ["PRONTO", "Prontos", contagens.PRONTO],
          ] as const
        )
          .filter(([id, , n]) => id === "TODOS" || n > 0)
          .map(([id, rotulo, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => onLente(id)}
              aria-pressed={lente === id}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                lente === id
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line-button bg-surface text-muted hover:text-ink",
              )}
            >
              {rotulo}
              <span
                className={cn(
                  "ml-1.5 tabular-nums",
                  lente === id ? "opacity-80" : "text-faint",
                )}
              >
                {n}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

export function TabelaDePara({
  inboundId,
  itens,
  sugestoesIniciais,
  editavel,
  podeCriarProduto,
  supplierId,
  siteId,
  subcategorias,
  atalhosAtivos = true,
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
  /** A tela hospedeira desliga os atalhos quando abre outro diálogo. */
  atalhosAtivos?: boolean;
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
  const [ultimoServidor, setUltimoServidor] = useState(sugestoesIniciais);
  if (ultimoServidor !== sugestoesIniciais) {
    setUltimoServidor(sugestoesIniciais);
    setPalpites(sugestoesIniciais);
  }
  /** Linha gravando agora — o giro fica nela, não numa barra global. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  /** Gravando o lote inteiro. */
  const [emLote, setEmLote] = useState(false);
  const [busca, setBusca] = useState("");
  const [lente, setLente] = useState<Lente>("TODOS");
  /** Nota já inteira relacionada abre dobrada — o resumo basta. */
  const [verTabela, setVerTabela] = useState(() => itens.some((i) => !i.productId));
  const [foco, setFoco] = useState<string | null>(null);
  // O anel só aparece na navegação por teclado: desenhar um em cada linha que
  // o mouse passa transforma feedback em ruído.
  const [porTeclado, setPorTeclado] = useState(false);
  /**
   * Linha que deve abrir o campo de "quantas unidades vêm na caixa" sozinha.
   * É o que emenda a fila: resolveu uma pendência, a próxima já chega aberta
   * em vez de exigir um clique para reencontrar onde parou.
   */
  const [abrirEmbalagem, setAbrirEmbalagem] = useState<string | null>(null);
  const linhasRef = useRef<Record<string, HTMLTableRowElement | null>>({});

  const faltam = itens.filter((i) => !i.productId).length;
  // Derivado, não sincronizado: nota já resolvida não tem palpite a mostrar.
  const sugestoes = editavel && faltam > 0 ? palpites : [];

  /**
   * Palpites por código de barras — os que dá para gravar em lote. EAN batendo
   * é prova; palpite por nome continua um a um, porque ali a decisão é do
   * operador e não da máquina.
   */
  const porCodigo = (sugestoes ?? []).filter((s) => s.motivo === "EAN");

  const contagens = useMemo(() => {
    const base: Record<Pendencia, number> = {
      SEM_PRODUTO: 0,
      SEM_EMBALAGEM: 0,
      CONFERIR: 0,
      PRONTO: 0,
    };
    for (const i of itens) base[pendenciaDoItem(i)]++;
    return base;
  }, [itens]);

  // Lente que esvaziou — o operador resolveu a última pendência dela — deixaria
  // a tela em branco sem explicação. Derivado, não corrigido por efeito: o
  // chip some e a lista volta a ser todos no mesmo render.
  const vazia =
    (lente === "PENDENCIAS" && itens.length - contagens.PRONTO === 0) ||
    (lente !== "TODOS" && lente !== "PENDENCIAS" && contagens[lente] === 0);
  const lenteAtiva: Lente = vazia ? "TODOS" : lente;

  const q = busca.trim().toLowerCase();
  const visiveis = itens.filter((i) => {
    const p = pendenciaDoItem(i);
    if (lenteAtiva === "PENDENCIAS" && p === "PRONTO") return false;
    if (lenteAtiva !== "TODOS" && lenteAtiva !== "PENDENCIAS" && p !== lenteAtiva) return false;
    if (!q) return true;
    return [i.descricao, i.codigoFornecedor, i.gtin, i.productNome, i.productSku]
      .filter(Boolean)
      .some((c) => String(c).toLowerCase().includes(q));
  });

  // O que trava o recebimento vem primeiro, depois o que pede conferência, e
  // por último o que já está resolvido — cada bloco na ordem original da nota.
  // Bloco vazio não vira cabeçalho, e nota inteira num estado só não ganha
  // separador nenhum.
  const grupos = (["SEM_PRODUTO", "SEM_EMBALAGEM", "CONFERIR", "PRONTO"] as const)
    .map((chave) => ({
      chave,
      ...PENDENCIA_UI[chave],
      itens: visiveis.filter((i) => pendenciaDoItem(i) === chave),
    }))
    .filter((g) => g.itens.length > 0);

  const ordemVisual = grupos.flatMap((g) => g.itens);

  /** Refaz os palpites depois de mexer no de-para. */
  function recalcularPalpites() {
    setPalpites(null);
    sugestoesDaNotaAction(inboundId)
      .then(setPalpites)
      .catch(() => setPalpites([]));
  }

  /**
   * A próxima linha que ainda pede alguma coisa, tirando a que acabou de ser
   * resolvida. Recebimento é trabalho em série: quem confirma uma conversão
   * quer a próxima já na frente, não a tabela inteira de volta.
   */
  function proximaPendente(exceto: string): ItemDePara | null {
    return (
      ordemVisual.find((i) => i.id !== exceto && pendenciaDoItem(i) !== "PRONTO") ?? null
    );
  }

  /** Leva o foco (e o campo aberto, quando for o caso) para a próxima pendência. */
  function emendarNaProxima(exceto: string) {
    const proximo = proximaPendente(exceto);
    if (!proximo) return;
    setFoco(proximo.id);
    setPorTeclado(true);
    linhasRef.current[proximo.id]?.scrollIntoView({ block: "nearest" });
    if (pendenciaDoItem(proximo) === "SEM_EMBALAGEM") setAbrirEmbalagem(proximo.id);
  }

  /** Grava de uma vez tudo que o código de barras já provou. */
  function confirmarTodasPorCodigo() {
    if (porCodigo.length === 0) return;
    setEmLote(true);
    start(async () => {
      try {
        const r = await relacionarEmLoteAction(
          porCodigo.map((s) => ({
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
          // Na fila rápida o operador confirma em sequência e só percebe o
          // engano na linha seguinte. Sem isto, desfazer é fechar tudo, achar
          // a linha na tabela e clicar em "desfazer".
          {
            rotulo: "Desfazer",
            onClick: () => desrelacionar({ id: s.itemId }),
          },
        );
        emendarNaProxima(s.itemId);
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
        emendarNaProxima(item.id);
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

  // Teclado: recebimento é trabalho repetitivo, e tirar a mão do teclado a
  // cada linha custa mais que a linha inteira. Só age quando nenhum diálogo
  // está aberto e o foco não está num campo.
  useEffect(() => {
    if (!editavel || !atalhosAtivos || relacionando) return;

    function onKey(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;

      const ids = ordemVisual.map((i) => i.id);
      if (ids.length === 0) return;
      const atual = foco ? ids.indexOf(foco) : -1;

      if (e.key === "Enter") {
        const item = ordemVisual.find((i) => i.id === foco);
        if (!item) return;
        e.preventDefault();
        const s = sugestoes?.find((x) => x.itemId === item.id);
        if (s) confirmarSugestao(s);
        // Enter numa linha que só espera o número da caixa abre o campo ali
        // mesmo, em vez de jogar o operador na busca de produto que ele já fez.
        else if (pendenciaDoItem(item) === "SEM_EMBALAGEM") setAbrirEmbalagem(item.id);
        else setRelacionando(item);
        return;
      }

      e.preventDefault();
      setPorTeclado(true);
      const proximo =
        e.key === "ArrowDown"
          ? Math.min(atual + 1, ids.length - 1)
          : Math.max(atual <= 0 ? 0 : atual - 1, 0);
      const id = ids[proximo];
      setFoco(id);
      linhasRef.current[id]?.scrollIntoView({ block: "nearest" });
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {itens.length > 0 && (
        <ResumoDePara
          contagens={contagens}
          total={itens.length}
          lente={lenteAtiva}
          onLente={(l) => {
            setLente(l);
            // Filtrar com a tabela dobrada não mostraria nada — quem clicou
            // num filtro quer ver as linhas dele.
            setVerTabela(true);
          }}
          verTabela={verTabela}
          onVerTabela={() => setVerTabela((v) => !v)}
        />
      )}

      {verTabela && editavel && (porCodigo.length > 0 || itens.length > LIMIAR_BUSCA) && (
        <div className="mt-3 mb-2 flex flex-wrap items-center gap-2">
          {/* Trinta linhas com o código de barras do fornecedor batendo são
              trinta cliques para dizer "sim" trinta vezes. EAN é prova — o
              lote grava o que a máquina não precisava perguntar. */}
          {porCodigo.length > 0 && (
            <Button size="sm" onClick={confirmarTodasPorCodigo} disabled={emLote || pending}>
              {emLote ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <CheckCheck size={14} />
              )}
              {emLote
                ? "Relacionando…"
                : `Relacionar ${porCodigo.length} pelo código de barras`}
            </Button>
          )}

          {itens.length > LIMIAR_BUSCA && (
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Achar item na nota"
                aria-label="Achar item na nota"
                className="h-9 w-full rounded-full border border-line-button bg-surface pr-3 pl-8 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* `overflow-x-auto`: as colunas não cabem num celular, e espremer até
          ficar ilegível é pior que rolar. Recebimento é trabalho de doca. */}
      <div
        className={cn(
          "mt-2 overflow-x-auto rounded-[var(--radius-md)] border border-line",
          !verTabela && "hidden",
        )}
      >
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 text-left text-[10px] uppercase tracking-wider text-faint">
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-surface-2">
              <th className="w-6 rounded-tl-[var(--radius-md)] py-2 pl-3">
                <span className="sr-only">Situação</span>
              </th>
              <th className="px-3 py-2 font-medium">Item da nota</th>
              <th className="px-3 py-2 font-medium">Produto no NoHub</th>
              <th className="px-3 py-2 font-medium">Quanto entra no estoque</th>
              <th className="rounded-tr-[var(--radius-md)] px-3 py-2 pr-3 text-right font-medium">
                Custo da NF
              </th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td:first-child]:rounded-bl-[var(--radius-md)] [&>tr:last-child>td:last-child]:rounded-br-[var(--radius-md)]">
            {grupos.map((g) => (
              <Fragment key={g.chave}>
                {grupos.length > 1 && (
                  <tr>
                    <td
                      colSpan={5}
                      className={cn(
                        "border-y border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider",
                        g.tom,
                      )}
                    >
                      {g.titulo} · {g.itens.length}
                    </td>
                  </tr>
                )}
                {g.itens.map((i) => (
                  <LinhaItem
                    key={i.id}
                    ref={(el) => {
                      linhasRef.current[i.id] = el;
                    }}
                    item={i}
                    editavel={editavel && !pending}
                    salvando={confirmando === i.id}
                    focado={foco === i.id && porTeclado}
                    abrirEmbalagem={abrirEmbalagem === i.id}
                    onFecharEmbalagem={() => setAbrirEmbalagem(null)}
                    sugestao={sugestoes?.find((s) => s.itemId === i.id) ?? null}
                    buscandoSugestao={sugestoes === null}
                    onFocar={() => {
                      setFoco(i.id);
                      setPorTeclado(false);
                    }}
                    onConfirmar={confirmarSugestao}
                    onRelacionar={() => setRelacionando(i)}
                    onDefinirEmbalagem={(fator, packagingId) =>
                      definirEmbalagem(i, fator, packagingId)
                    }
                    onDesrelacionar={() => desrelacionar(i)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {verTabela && visiveis.length === 0 && (
        <p className="mt-2 rounded-[var(--radius)] border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">
          {q ? `Nenhum item da nota com “${busca.trim()}”. ` : "Nenhum item neste filtro. "}
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setLente("TODOS");
            }}
            className="font-medium text-brand underline"
          >
            Ver os {itens.length} itens
          </button>
        </p>
      )}

      {verTabela && editavel && itens.length > 3 && (
        <p className="mt-2 text-[11px] text-faint">
          Atalhos: <span className="font-mono text-muted">↑</span>{" "}
          <span className="font-mono text-muted">↓</span> percorrem as linhas,{" "}
          <span className="font-mono text-muted">Enter</span> resolve a pendência da linha,{" "}
          <span className="font-mono text-muted">Esc</span> fecha. Ao confirmar, o foco vai
          para a próxima pendência.
        </p>
      )}

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
          onFechar={() => setRelacionando(null)}
          onPular={() => {
            // Item duvidoso não pode travar a fila: pula para o próximo
            // pendente e deixa este para o fim, em vez de o operador fechar o
            // painel inteiro e perder o embalo.
            const proximo = itens.find((i) => !i.productId && i.id !== relacionando.id);
            setRelacionando(proximo ?? null);
          }}
          onRelacionado={(itemId) => {
            // Fila: emenda no próximo pendente em vez de fechar e obrigar o
            // operador a caçar a próxima linha laranja na tabela.
            const proximo = itens.find((i) => !i.productId && i.id !== itemId);
            setRelacionando(proximo ?? null);
            if (!proximo && itemId) emendarNaProxima(itemId);
            recalcularPalpites();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Uma linha da nota, em quatro perguntas: o que chegou, o que isso é no NoHub,
 * quanto entra no estoque e quanto custou. O que é fiscal (NCM, CEST, CFOP,
 * GTIN tributável) vive atrás de "Mais detalhes" — continua tudo aqui, só não
 * disputa a atenção com a decisão. Linha sem produto é clicável inteira: em
 * nota grande, mirar num botão pequeno é imposto de tempo.
 */
const LinhaItem = forwardRef<
  HTMLTableRowElement,
  {
    item: ItemDePara;
    editavel: boolean;
    /** Esta linha está gravando agora. */
    salvando: boolean;
    focado: boolean;
    /** A fila mandou esta linha abrir o campo de unidades por embalagem. */
    abrirEmbalagem: boolean;
    onFecharEmbalagem: () => void;
    sugestao: Sugestao | null;
    buscandoSugestao: boolean;
    onFocar: () => void;
    onConfirmar: (s: Sugestao) => void;
    onRelacionar: () => void;
    /** Só quantas unidades vêm na embalagem muda — o produto continua o mesmo. */
    onDefinirEmbalagem: (fator: number, packagingId: string | null) => void;
    onDesrelacionar: () => void;
  }
>(function LinhaItem(
  {
    item,
    editavel,
    salvando,
    focado,
    abrirEmbalagem,
    onFecharEmbalagem,
    sugestao,
    buscandoSugestao,
    onFocar,
    onConfirmar,
    onRelacionar,
    onDefinirEmbalagem,
    onDesrelacionar,
  },
  ref,
) {
  const [editando, setEditando] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const divergencias = divergenciasDaLinha(item);
  const pendencia = pendenciaDoItem(item);
  const ui = PENDENCIA_UI[pendencia];
  const severidade = severidadeMaxima(divergencias);
  const divergente = fatorDivergente(item);
  // O que entra na compra é SEMPRE unidade fechada. Rotular com a unidadeBase
  // fazia a tela dizer "entra 12 ML" numa caixa de 12 garrafas de suco — e o
  // operador ia procurar no cadastro do produto um erro que não existia.
  const medida = medidaDoProduto(item);
  const entra = item.quantidade * item.fatorConversao;
  const desvio = desvioDeCusto(item);
  const origem = origemDoFator(item);
  const uCom = item.unidade.trim() || UNIDADE_ENTRADA;
  const emb = palavraDaEmbalagem(item);
  // Com palpite à vista, o clique solto na linha abriria a busca justamente
  // quando o operador queria confirmar. Aí a ação é só pelos botões.
  const clicavel = editavel && !item.productId && !sugestao;
  const definindo = editavel && (editando || abrirEmbalagem);

  function fecharEditor() {
    setEditando(false);
    onFecharEmbalagem();
  }

  return (
    <Fragment>
      <tr
        ref={ref}
        onMouseEnter={onFocar}
        onClick={clicavel ? onRelacionar : undefined}
        className={cn(
          "border-b border-line align-top last:border-b-0",
          ui.linha,
          clicavel && "cursor-pointer transition-colors hover:bg-warn-soft/70",
          !clicavel && "transition-colors hover:bg-surface-2",
          focado && editavel && "ring-1 ring-brand/60 ring-inset",
        )}
      >
        <td className="py-2.5 pl-3">
          <span
            className={cn("mt-1.5 block h-2 w-2 rounded-full", ui.ponto)}
            title={ui.titulo}
            aria-label={ui.titulo}
          />
        </td>

        {/* ── O que chegou ─────────────────────────────────── */}
        <td className="px-3 py-2.5">
          <p className="text-ink">{item.descricao}</p>
          {/* Código do fornecedor e código de barras não decidem nada — mas
              são o que a pessoa confere contra o papel quando desconfia. */}
          <p className="font-mono text-[11px] text-faint">
            {item.codigoFornecedor}
            {item.gtin ? ` · ${item.gtin}` : ""}
            {` · ${fmtQtd(item.quantidade)} ${uCom}`}
          </p>
          {item.bonificacao && (
            <span className="mt-1 inline-block">
              <Badge tone="accent">
                <Gift size={11} /> bonificação
              </Badge>
            </span>
          )}
        </td>

        {/* ── O que isso é no NoHub ─────────────────────────── */}
        <td className="px-3 py-2.5">
          {item.productId ? (
            <div className="flex items-start gap-2">
              <ProdutoThumb url={item.productImagemUrl} nome={item.productNome} size="xs" />
              <div className="min-w-0">
                <p className="font-medium text-ink">{item.productNome}</p>
                {/* Um menu no lugar de dois links soltos: "alterar" e
                    "desfazer" lado a lado, em 11px, davam ao desfazer o mesmo
                    peso do trocar — e desfazer apaga o de-para do fornecedor. */}
                {editavel ? (
                  <Menu
                    align="start"
                    trigger={
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-line-button px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-brand"
                      >
                        <Check size={10} className="text-ok" aria-hidden />
                        Produto relacionado
                        <span className="font-mono">{item.productSku}</span>
                        <ChevronDown size={10} aria-hidden />
                      </button>
                    }
                  >
                    <MenuItem icon={<Search size={15} />} onClick={onRelacionar}>
                      Trocar produto
                    </MenuItem>
                    <MenuItem icon={<Unlink size={15} />} danger onClick={onDesrelacionar}>
                      Remover relação
                    </MenuItem>
                  </Menu>
                ) : (
                  <p className="font-mono text-[11px] text-faint">{item.productSku}</p>
                )}

                {/* Chip só existe quando algo destoa — o caminho limpo segue
                    sem ruído, e a comparação abre na própria linha. */}
                {divergencias.length > 0 && severidade && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetalhes((v) => !v);
                    }}
                    aria-expanded={detalhes}
                    className={cn(
                      "mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[10px] font-medium transition-colors",
                      SEVERIDADE_UI[severidade].chip,
                    )}
                  >
                    <TriangleAlert size={10} aria-hidden />
                    {divergencias.length === 1
                      ? divergencias[0].titulo
                      : `${divergencias.length} diferenças encontradas`}
                    <ChevronDown
                      size={10}
                      aria-hidden
                      className={cn("transition-transform", detalhes && "rotate-180")}
                    />
                  </button>
                )}
              </div>
            </div>
          ) : sugestao ? (
            // Palpite do servidor: um clique resolve. O motivo aparece porque
            // "mesmo código de barras" é prova e "nome parecido" é chute — e o
            // operador confia diferente em cada um.
            <div
              className="flex items-start gap-2"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <ProdutoThumb url={sugestao.imagemUrl} nome={sugestao.nome} size="xs" />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-brand">
                  <Sparkles size={11} aria-hidden />
                  {sugestao.motivo === "EAN"
                    ? "código de barras reconhecido"
                    : "encontrado pelo nome"}
                </p>
                <p className="font-medium text-ink">{sugestao.nome}</p>
                <p className="font-mono text-[11px] text-faint">{sugestao.sku}</p>
                {sugestao.fatorConversao > 1 && (
                  <p className="font-mono text-[11px] text-muted">
                    1 {uCom} = {fmtQtd(sugestao.fatorConversao)} {UNIDADE_ENTRADA}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!editavel || salvando}
                    onClick={() => onConfirmar(sugestao)}
                  >
                    {salvando ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Check size={14} />
                    )}
                    {salvando ? "Relacionando…" : "É este"}
                  </Button>
                  {!salvando && (
                    <button
                      type="button"
                      onClick={onRelacionar}
                      className="text-xs font-medium text-brand underline"
                    >
                      outro produto
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="font-medium text-warn">
                {buscandoSugestao && editavel
                  ? "Procurando no catálogo…"
                  : "Nenhum produto relacionado"}
              </p>
              {editavel ? (
                // Só "relacionar". Cadastrar produto novo mora DENTRO do painel
                // de relacionar (e em Produtos): a busca vem primeiro porque o
                // produto quase sempre já existe, e o atalho para cadastrar aqui
                // fazia nascer duplicata do que estava a uma busca de distância.
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <Button size="sm" variant="secondary" onClick={onRelacionar}>
                    <Plus size={14} /> Relacionar produto
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-faint">Este item não entrou no estoque.</p>
              )}
            </>
          )}
        </td>

        {/* ── Quanto entra no estoque ───────────────────────── */}
        <td className="px-3 py-2.5">
          {!item.productId ? (
            <p className="font-mono text-faint">—</p>
          ) : definindo ? (
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
          ) : pendencia === "SEM_EMBALAGEM" ? (
            // O caso que estoura o estoque em silêncio: a nota veio em caixa e
            // ninguém disse quantas cabem, então 3 caixas viram 3 unidades.
            // Não é "ajustar conversão" — é uma pergunta em português.
            <div className="flex flex-col items-start gap-1">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-warn">
                <TriangleAlert size={12} aria-hidden />
                Quantidade por embalagem não definida
              </p>
              <p className="text-[12px] text-muted">
                Chegaram {fmtQtd(item.quantidade)} {uCom}. Quantas unidades vêm em cada {emb}?
              </p>
              {editavel && (
                <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>
                  Informar unidades por {emb}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-0.5">
              <p className="text-[12px] text-muted">
                {fmtQtd(item.quantidade)} {uCom} {item.quantidade === 1 ? "recebida" : "recebidas"}
              </p>
              {item.fatorConversao !== 1 && (
                <p className={cn("font-mono text-[11px]", divergente ? "text-info" : "text-faint")}>
                  1 {uCom} = {fmtQtd(item.fatorConversao)} {UNIDADE_ENTRADA}
                </p>
              )}
              <p className="font-mono text-[15px] font-semibold text-brand-strong">
                {fmtQtd(entra)} {UNIDADE_ENTRADA}
              </p>
              <p className="text-[11px] text-muted">
                {entra === 1 ? "entrará no estoque" : "entrarão no estoque"}
                {/* Produto medido em ml/g: dizer o conteúdo evita a leitura
                    errada de que o saldo passou a ser contado em mililitro. */}
                {medida && (
                  <span
                    className="text-faint"
                    title="A compra soma unidades fechadas. O mililitro só conta no saldo aberto, quando alguém abre uma para usar em receita."
                  >
                    {" "}
                    · {medida} cada
                  </span>
                )}
              </p>

              {item.fatorConversao !== 1 && (
                <p
                  className={cn(
                    "flex items-center gap-1 text-[11px]",
                    origem === "CADASTRO" ? "text-ok" : "text-muted",
                  )}
                  title={
                    divergente
                      ? `A nota declara ${fmtQtd(item.quantidadeTributavel ?? 0)} ${item.unidadeTributavel} — dá ${fmtQtd(divergente)} por ${uCom}.`
                      : undefined
                  }
                >
                  {origem === "CADASTRO" && <Check size={11} aria-hidden />}
                  {origem === "CADASTRO"
                    ? "Quantidade do cadastro"
                    : `Quantidade ${ORIGEM_FATOR[origem]}`}
                  {divergente ? ` · a nota diz ${fmtQtd(divergente)}` : ""}
                </p>
              )}

              {editavel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditando(true);
                  }}
                  className="mt-0.5 text-[11px] font-medium text-brand underline"
                >
                  Alterar unidades por {emb}
                </button>
              )}
            </div>
          )}
        </td>

        {/* ── Custo da NF ───────────────────────────────────── */}
        <td className="px-3 py-2.5 pr-3 text-right whitespace-nowrap">
          {item.bonificacao ? (
            <p className="text-[12px] text-muted">sem custo</p>
          ) : (
            <>
              <p className="font-mono text-ink-2">{fmtMoney(custoItem(item))}</p>
              {desvio != null && (
                <>
                  <p
                    className={cn(
                      "flex items-center justify-end gap-0.5 font-mono text-[11px]",
                      desvio > 0 ? "text-danger" : "text-ok",
                    )}
                  >
                    {desvio > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {Math.abs(Math.round(desvio * 100))}%{" "}
                    {desvio > 0 ? "acima do médio" : "abaixo do médio"}
                  </p>
                  <p className="font-mono text-[11px] text-faint">
                    médio {fmtMoney(item.productCustoMedio ?? 0)}
                  </p>
                </>
              )}
            </>
          )}

          {/* O fiscal continua todo aqui — atrás de um clique, para não
              competir com a decisão que a linha realmente pede. */}
          {item.productId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetalhes((v) => !v);
              }}
              aria-expanded={detalhes}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted underline hover:text-ink"
            >
              {detalhes ? "Ocultar detalhes" : "Mais detalhes"}
              <ChevronDown
                size={10}
                aria-hidden
                className={cn("transition-transform", detalhes && "rotate-180")}
              />
            </button>
          )}
        </td>
      </tr>

      {/* Só quem abriu vê. NCM, CEST, CFOP, GTIN tributável e a lista de
          diferenças moram aqui — disponíveis, nunca no caminho. */}
      {detalhes && (
        <tr className="border-b border-line bg-surface-2/60">
          <td colSpan={5} className="px-3 py-3">
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
});

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
  const [valor, setValor] = useState(
    item.fatorConversao > 1 ? String(item.fatorConversao) : (sugeridoPelaNota?.toString() ?? ""),
  );
  const fator = Number(valor.replace(",", ".")) || 0;
  const entra = item.quantidade * fator;
  const custoUnitario = fator > 0 && entra > 0 ? custoItem(item) / entra : null;
  const medida = medidaDoProduto(item);
  const emb = palavraDaEmbalagem(item);
  const uCom = item.unidade.trim() || UNIDADE_ENTRADA;

  return (
    <div
      className="flex max-w-[19rem] flex-col items-start gap-2"
      onClick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <p className="text-[12px] font-medium text-ink">
        Quantas unidades vêm em cada {emb}?
      </p>

      <div className="flex items-center gap-1.5">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && fator > 0) onSalvar(fator, null);
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

      {/* O resultado em tempo real é o que denuncia o número errado antes de
          ele virar saldo: 3 caixas × 6 são 18, e R$ 100,80 a garrafa grita. */}
      {fator > 0 && (
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

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={salvando || fator <= 0} onClick={() => onSalvar(fator, null)}>
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
