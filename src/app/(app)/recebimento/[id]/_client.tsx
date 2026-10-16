"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Beer,
  CalendarClock,
  Check,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  FileUp,
  Gift,
  History,
  Layers,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  MoreVertical,
  PackagePlus,
  Plus,
  Tag,
  Trash2,
  TrendingDown,
  ScanLine,
  Search,
  Send,
  Undo2,
  TriangleAlert,
  Wallet,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import {
  RelacionarProduto,
  type ItemDeNota,
} from "@/components/recebimento/relacionar-produto";
import { Filtro, Th } from "@/components/recebimento/tabela-de-para";
import { EtapaNota } from "./_entrada";
import { MedidorRodape, RodapeAcao, Topo } from "./_partes";
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { baixarXlsx } from "@/lib/baixar-xlsx";
import { variacaoCusto } from "@/lib/compras/conciliacao-regras";
import {
  avisoDeValidade,
  custoDeEntradaDaLinha,
  esperadoDaLinha,
  faltaDaConferencia,
  problemaNosLotes,
  validadeMaisCurta,
  type AvisoValidade,
  type LoteDaLinha,
} from "@/lib/compras/recebimento-regras";
import { frasesDeConversao, rotuloDaUnidade, siglaDeExibicao } from "@/lib/fiscal/unidades";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";
import { fmtMoney, fmtQtd } from "../../cotacoes/_catalogo/ui";
import {
  aceitarCustoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  cancelarRecebimentoAction,
  conferirItemAction,
  conferirTudoAction,
  enviarAvisoPorEmailAction,
  estornarRecebimentoAction,
  importarXmlParaRecebimentoAction,
  notasParaVincularAction,
  salvarVasilhameAction,
  somarContagemAction,
  vincularNotaAction,
  finalizarRecebimentoAction,
  salvarRascunhoAction,
  resolverDivergenciaAction,
  restaurarContagemAction,
  adicionarItemAction,
  removerItemAction,
} from "../conferencia-actions";
import {
  buscarProdutosRecebimentoAction,
  buscarProdutoPorCodigoAction,
  type ProdutoRecebimento,
} from "../../pedidos/actions";
import type { LinhaRecebimento, RecebimentoView, SubcategoriaCadastro } from "../_data";
import type { ReconciliationStatus } from "@/generated/prisma";

// ============================================================
// Recebimento em duas etapas.
//
//   1. Nota e produtos — o que o XML diz: fornecedor, valores, pedido e a
//      relação dos itens com o catálogo (`_entrada.tsx`).
//   2. Conferência     — o que a doca contou, as diferenças e a entrada no
//      estoque. É este arquivo.
//
// A conferência mostra as três camadas lado a lado — Pedido, NF, Recebido — e
// destaca SÓ a exceção. Quando tudo bate, receber um pedido de trinta itens é
// conferir e apertar um botão; quando não bate, a divergência está na cara,
// com a ação ao lado dela.
//
// O que o operador edita aqui é só o que a conferência física revela:
// quantidade, lote e validade. Preço, produto e quantidade faturada vêm da
// nota e não se digitam. Os dados do documento ficam na etapa 1 — repeti-los
// aqui em cartões de resumo era a mesma nota contada duas vezes.
// ============================================================

/** Gravação de uma linha: em voo, ou recém-confirmada pelo servidor. */
type EstadoSalvamento = "salvando" | "salvo";

const STATUS_INFO: Record<
  ReconciliationStatus,
  { label: string; classe: string; grave: boolean }
> = {
  OK: { label: "OK", classe: "bg-ok-soft text-ok", grave: false },
  FALTANDO: { label: "Faltando", classe: "bg-danger-soft text-danger", grave: true },
  EXCEDENTE: { label: "Excedente", classe: "bg-accent-soft text-accent", grave: true },
  NAO_FATURADO: { label: "Não faturado", classe: "bg-danger-soft text-danger", grave: true },
  NAO_PEDIDO: { label: "Fora do pedido", classe: "bg-accent-soft text-accent", grave: true },
  PRECO_ALTERADO: { label: "Preço alterado", classe: "bg-accent-soft text-accent", grave: true },
};

/**
 * Em que pé está cada linha da contagem. Uma régua só para o selo de status,
 * os filtros e a planilha exportada — três lugares que não podem discordar.
 *
 *   A conferir      ninguém contou; entra pelo esperado se ninguém contar.
 *   Conferido       contado, e bate com o esperado.
 *   Com divergência o contado não bate, a nota não bate com o pedido, ou a
 *                   linha não tem produto — alguém precisa decidir.
 *   Ajustado        a diferença existiu e já foi decidida (aceita, ignorada
 *                   ou explicada). Fica à vista: decidido não é sumido.
 */
type Situacao = "A_CONFERIR" | "CONFERIDO" | "DIVERGENCIA" | "AJUSTADO";

/**
 * Como a tela FALA do item com a pessoa (toast do bipe, painéis, leitor de
 * tela): o nome do catálogo, que é o que ela conhece. O texto do fornecedor
 * fica na coluna "Produto na nota", onde se confere contra o papel.
 */
const nomeDe = (l: LinhaRecebimento) => l.produtoNome ?? l.descricao;

/** Contado diferente do esperado. */
const contouDiferente = (l: LinhaRecebimento) =>
  l.qtdRecebida != null && Math.abs(l.qtdRecebida - esperadoDe(l)) > 0.001;

/**
 * O que o recebimento tinha como referência. Sem pedido e sem nota (o avulso
 * puro), cada linha foi acrescentada pela própria doca — "fora do pedido" ali
 * não é divergência, é o recebimento inteiro.
 */
type Referencia = { temNota: boolean; temPedido: boolean };

/** A linha discorda do que se esperava, no papel (pedido × nota)? */
function divergeNoPapel(l: LinhaRecebimento, ref: Referencia): boolean {
  if (l.avulsa && !ref.temNota && !ref.temPedido) return false;
  return STATUS_INFO[l.status].grave;
}

function situacaoDaLinha(l: LinhaRecebimento, cega: boolean, ref: Referencia): Situacao {
  // Conferência cega: até a pessoa contar, nem o selo pode contar que o
  // pedido e a nota discordam — é o número que ela não pode ver.
  if (cega && l.qtdRecebida == null) return "A_CONFERIR";
  if (l.resolucao || l.motivoDivergencia) return "AJUSTADO";
  // A linha acrescentada na doca não tem "esperado": o número dela É o que
  // chegou. Se ela diverge de algo, é do papel (fora da nota/do pedido).
  if (!l.productId || divergeNoPapel(l, ref) || (!l.avulsa && contouDiferente(l))) {
    return "DIVERGENCIA";
  }
  return l.qtdRecebida == null ? "A_CONFERIR" : "CONFERIDO";
}

/** "Fora do pedido" só existe quando havia pedido; com nota, é "fora da nota". */
function rotuloDoStatus(l: LinhaRecebimento, temNota: boolean): string {
  if (l.status === "NAO_PEDIDO" && l.avulsa) return temNota ? "Fora da nota" : "Fora do pedido";
  return STATUS_INFO[l.status].label;
}

const SITUACAO_UI: Record<
  Situacao,
  { rotulo: string; filtro: string; selo: string; Icone: typeof CircleCheck }
> = {
  A_CONFERIR: {
    rotulo: "A conferir",
    filtro: "A conferir",
    selo: "bg-surface-2 text-muted",
    Icone: Clock3,
  },
  CONFERIDO: {
    rotulo: "Conferido",
    filtro: "Conferidos",
    selo: "bg-ok-soft text-ok",
    Icone: CircleCheck,
  },
  DIVERGENCIA: {
    rotulo: "Divergência",
    filtro: "Com divergência",
    selo: "bg-danger-soft text-danger",
    Icone: TriangleAlert,
  },
  AJUSTADO: {
    rotulo: "Ajustado",
    filtro: "Ajustados",
    selo: "bg-brand-softer text-accent",
    Icone: Wrench,
  },
};

const SITUACOES: Situacao[] = ["A_CONFERIR", "CONFERIDO", "DIVERGENCIA", "AJUSTADO"];

/**
 * Busca responde "onde está o item X?"; o filtro responde "o que ainda falta?"
 * — a pergunta que o operador faz o tempo todo numa nota de quarenta linhas.
 */
type Lente = "TODOS" | Situacao;

/** A frase inteira por trás do selo — no hover e no leitor de tela. */
function porqueDaSituacao(l: LinhaRecebimento, s: Situacao, temNota: boolean): string {
  const quem = quemContou(l);
  return quem ? `${fraseDaSituacao(l, s, temNota)} ${quem}` : fraseDaSituacao(l, s, temNota);
}

function fraseDaSituacao(l: LinhaRecebimento, s: Situacao, temNota: boolean): string {
  switch (s) {
    case "A_CONFERIR":
      return esperadoDe(l) > 0
        ? `Ainda não contado — entra com a quantidade ${temNota ? "da nota" : "do pedido"} se ninguém contar.`
        : "Ainda não contado — a nota não trouxe este item; sem contagem, nada entra.";
    case "CONFERIDO":
      return "Contado e igual ao esperado.";
    case "AJUSTADO":
      return l.motivoDivergencia
        ? `Ajustado: ${l.motivoDivergencia}`
        : "Divergência decidida — fica no histórico.";
    case "DIVERGENCIA":
      if (!l.productId) return "Sem produto relacionado — relacione antes de receber.";
      if (contouDiferente(l) && !l.avulsa) {
        return `Contado ${fmtQtd(l.qtdRecebida ?? 0)}, esperado ${fmtQtd(esperadoDe(l))}.`;
      }
      return `${rotuloDoStatus(l, temNota)}: ${explicacao(l, variacaoDaLinha(l), temNota)}`;
  }
}

/** "125,42" — o cabeçalho da coluna já diz que é em reais. */
const fmtValor = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "2026-10-14" → "14/10/2026" sem passar por `Date`: meia-noite UTC vira o
 * dia anterior no fuso de Brasília, e a validade mostrada sairia um dia antes.
 */
const fmtDia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** A validade que vence primeiro na linha (com lotes, a do lote mais curto). */
const validadeDaLinha = (l: LinhaRecebimento) => validadeMaisCurta(l.validade, l.lotes);

/** "lote A · val. 14/10/2026", ou "3 lotes · val. 14/10 a 30/11/2026". */
function resumoDoLote(l: LinhaRecebimento): string {
  if (l.lotes?.length) {
    const datas = l.lotes
      .map((x) => x.validade)
      .filter((v): v is string => Boolean(v))
      .sort();
    const val =
      datas.length === 0
        ? null
        : datas[0] === datas[datas.length - 1]
          ? `val. ${fmtDia(datas[0])}`
          : `val. ${fmtDia(datas[0]).slice(0, 5)} a ${fmtDia(datas[datas.length - 1])}`;
    return [`${l.lotes.length} ${l.lotes.length === 1 ? "lote" : "lotes"}`, val].filter(Boolean).join(" · ");
  }
  return [l.lote ? `lote ${l.lote}` : null, l.validade ? `val. ${fmtDia(l.validade)}` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Contado por Ana em 15/10, 14:32." — quem responde pela contagem. O fuso é
 * o da loja, fixo: a mesma frase sai no servidor (UTC) e no navegador.
 */
function quemContou(l: LinhaRecebimento): string | null {
  if (l.qtdRecebida == null || (!l.contadoPor && !l.contadoEm)) return null;
  const quando = l.contadoEm
    ? new Date(l.contadoEm).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : null;
  return `Contado${l.contadoPor ? ` por ${l.contadoPor}` : ""}${quando ? ` em ${quando}` : ""}.`;
}

/** Quanto o custo da nota subiu (ou caiu) sobre o negociado, em %. */
function variacaoDaLinha(l: LinhaRecebimento): number | null {
  if (l.status === "NAO_PEDIDO") return null;
  return variacaoCusto(l.custoPedido, l.custoFaturado);
}

/**
 * O que a linha esperava e o que entra se a entrada for confirmada agora — a
 * MESMA função do servidor (`esperadoDaLinha`): a nota manda; sem ela, o
 * pedido; e o que a nota não trouxe espera zero. Linha sem contagem entra pelo
 * esperado.
 */
const esperadoDe = (l: LinhaRecebimento) => esperadoDaLinha(l);

/** Inteiro, com folga para o ruído do decimal do banco. */
const inteiro = (n: number) => Math.abs(n - Math.round(n)) < 1e-6;

/**
 * Quantas unidades vêm na embalagem em que a nota faturou — quando dá para
 * contar nela. Só com XML (é "a quantidade que vem na nota") e só quando a
 * conta fecha em embalagens inteiras: "0,5 CX" não se conta em caixa.
 */
function fatorDaEmbalagem(l: LinhaRecebimento): number | null {
  const f = l.xml?.fatorConversao ?? 1;
  if (f <= 1 || !inteiro(f)) return null;
  return inteiro(esperadoDe(l) / f) ? f : null;
}

/**
 * Régua da contagem desta linha.
 *
 * O padrão é contar como a nota faturou: 1 CX no papel, 1 CX na doca — quem
 * confere tem a caixa fechada na frente, não 24 garrafas soltas. A exceção
 * (caixa aberta, fardo misto, item que chega solto) conta por unidade, e
 * contagem que já não fecha em caixas inteiras só cabe na unidade.
 *
 * O banco grava SEMPRE em unidade de estoque: a régua muda o que se digita e
 * se lê, nunca o que é salvo.
 */
type Regua = { modo: "EMB" | "UN"; fator: number | null; sigla: string; forcado: boolean };

function reguaDaLinha(l: LinhaRecebimento, pediuUnidade: boolean): Regua {
  const fator = fatorDaEmbalagem(l);
  // "CX027" vira "CX": o 27 já está no "= 27 UN" ao lado (ver `siglaDeExibicao`).
  const sigla = l.xml ? siglaDeExibicao(l.xml.unidade) : UNIDADE_CONFERENCIA;
  if (!fator) return { modo: "UN", fator: null, sigla, forcado: false };
  const forcado = l.qtdRecebida != null && !inteiro(l.qtdRecebida / fator);
  return { modo: pediuUnidade || forcado ? "UN" : "EMB", fator, sigla, forcado };
}

// A régua escolhida por linha mora no aparelho (localStorage). Sem
// armazenamento (aba anônima, bloqueio) a troca ainda vale na tela, via a
// cópia em memória — só não sobrevive ao recarregar.
const EVENTO_POR_UNIDADE = "nohub:por-unidade";
const memoriaPorUnidade = new Map<string, string>();

function assinarPorUnidade(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO_POR_UNIDADE, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO_POR_UNIDADE, avisar);
  };
}

function lerArmazenado(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave) ?? memoriaPorUnidade.get(chave) ?? null;
  } catch {
    return memoriaPorUnidade.get(chave) ?? null;
  }
}

function gravarArmazenado(chave: string, valor: string) {
  memoriaPorUnidade.set(chave, valor);
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // Fica só a cópia em memória.
  }
  window.dispatchEvent(new Event(EVENTO_POR_UNIDADE));
}

/** A quantidade em unidades lida na régua da linha. */
const naRegua = (qtd: number, r: Regua) => (r.modo === "EMB" && r.fator ? qtd / r.fator : qtd);
const siglaDaRegua = (r: Regua) => (r.modo === "EMB" ? r.sigla : UNIDADE_CONFERENCIA);
const entrando = (l: LinhaRecebimento) => l.qtdRecebida ?? esperadoDe(l);

const pct = (v: number) => `${v > 0 ? "▲" : "▼"}${Math.abs(v).toFixed(1).replace(".", ",")}%`;

/** Linha conciliada → o que o painel de relacionar precisa saber dela. */
const paraRelacionar = (l: LinhaRecebimento): ItemDeNota => ({
  inboundItemId: l.inboundItemId,
  descricao: l.descricao,
  gtin: l.ean,
  codigoFornecedor: l.codigoFornecedor,
  productId: l.productId,
});

export function RecebimentoClient({
  dados,
  verNota,
  podeReceber,
  podeTratarNota,
  podeEstornar,
  podeDevolver,
  podeEtiquetas,
  podeVerFinanceiro,
  podeCriarProduto,
  podeEditarFornecedor,
  podeBaixarXml,
  mostrarSku,
  cega,
  validadeAlertaDias,
  hoje,
  subcategorias,
}: {
  dados: RecebimentoView;
  /** A pessoa pediu a etapa 1 (`?etapa=nota`) com a conferência já aberta. */
  verNota: boolean;
  /**
   * Falso = a pessoa trata a NOTA (contador com `fiscal.importar`), não a
   * mercadoria. Relaciona itens ao catálogo, mas não escolhe porta nem conta
   * caixa — a conferência inteira vira leitura.
   */
  podeReceber: boolean;
  /** Decide sobre o DOCUMENTO: descartar, documentar entrada manual. */
  podeTratarNota: boolean;
  /** Desfaz a entrada de um recebimento concluído (`estoque.ajustar` na loja). */
  podeEstornar: boolean;
  /** Devolve ao fornecedor o que já entrou (`compras.devolver` na loja). */
  podeDevolver: boolean;
  /** Imprime etiqueta de prateleira — é o preço impresso (`produto.preco`). */
  podeEtiquetas: boolean;
  /** Vê contas a pagar (`financeiro.ver`). */
  podeVerFinanceiro: boolean;
  podeCriarProduto: boolean;
  /** Decide as sugestões de contato que o XML trouxe para o fornecedor. */
  podeEditarFornecedor: boolean;
  /** Abre e baixa o XML guardado (`fiscal.baixar`). */
  podeBaixarXml: boolean;
  /** SKU ligado nas configurações de produto. */
  mostrarSku: boolean;
  /** Conferência cega: esconde pedido e NF até a pessoa contar. */
  cega: boolean;
  /** "Vence em até N dias" — a mesma régua de Configurações → Estoque. */
  validadeAlertaDias: number;
  /** Dia de hoje na loja (`aaaa-mm-dd`), vindo do servidor: servidor e navegador contam igual. */
  hoje: string;
  subcategorias: SubcategoriaCadastro[];
}) {
  // A nota recém-importada ainda não tem conferência: antes de contar caixa é
  // preciso ler o que ela diz, dizer de qual pedido é e relacionar os produtos.
  // Quem clicou "Iniciar recebimento" num pedido já entra conferindo, e o
  // avulso também — e os dois voltam à etapa 1 pelo botão do cabeçalho, quando
  // há nota.
  if (dados.nota && (dados.escolherPorta || verNota)) {
    return (
      <EtapaNota
        dados={dados}
        nota={dados.nota}
        podeReceber={podeReceber}
        podeTratarNota={podeTratarNota}
        podeCriarProduto={podeCriarProduto}
        podeEditarFornecedor={podeEditarFornecedor}
        podeBaixarXml={podeBaixarXml}
        mostrarSku={mostrarSku}
        subcategorias={subcategorias}
      />
    );
  }
  return (
    <Conferencia
      dados={dados}
      podeReceber={podeReceber}
      podeTratarNota={podeTratarNota}
      podeEstornar={podeEstornar}
      podeDevolver={podeDevolver}
      podeEtiquetas={podeEtiquetas}
      podeVerFinanceiro={podeVerFinanceiro}
      podeCriarProduto={podeCriarProduto}
      podeBaixarXml={podeBaixarXml}
      mostrarSku={mostrarSku}
      cega={cega}
      validadeAlertaDias={validadeAlertaDias}
      hoje={hoje}
      subcategorias={subcategorias}
    />
  );
}

// ── Conferência ─────────────────────────────────────────────

function Conferencia({
  dados,
  podeReceber,
  podeTratarNota,
  podeEstornar,
  podeDevolver,
  podeEtiquetas,
  podeVerFinanceiro,
  podeCriarProduto,
  podeBaixarXml,
  mostrarSku,
  cega,
  validadeAlertaDias,
  hoje,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeEstornar: boolean;
  podeDevolver: boolean;
  podeEtiquetas: boolean;
  podeVerFinanceiro: boolean;
  podeCriarProduto: boolean;
  podeBaixarXml: boolean;
  mostrarSku: boolean;
  cega: boolean;
  validadeAlertaDias: number;
  hoje: string;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { recebimento, nota, pedido, semPedido, resumo, timeline } = dados;
  const finalizado = recebimento.status === "FINALIZADO";
  // Recebimento fechado e pessoa que não recebe mercadoria dão no mesmo lugar:
  // a conferência é só leitura. Contar caixa é decisão de quem está na doca.
  const encerrada = finalizado || recebimento.status === "CANCELADO" || !podeReceber;
  const temNota = Boolean(nota);
  const temPedido = Boolean(pedido);
  const ref = React.useMemo<Referencia>(() => ({ temNota, temPedido }), [temNota, temPedido]);
  /** O que se diz da linha que ninguém contou: entra como está "na nota" ou "no pedido". */
  const comoNoPapel = nota ? "como está na nota" : "como está no pedido";

  // Cópia local para o bipe e os campos responderem na hora; o servidor é a
  // verdade e o refresh reconcilia.
  const [linhas, setLinhas] = React.useState(dados.linhas);
  // Quando o servidor devolve dados novos (refresh depois de salvar), a cópia
  // local é descartada — ajuste durante o render, não efeito: assim a tela
  // nunca chega a pintar com o estado velho.
  const [ultimoServidor, setUltimoServidor] = React.useState(dados.linhas);
  if (ultimoServidor !== dados.linhas) {
    setUltimoServidor(dados.linhas);
    setLinhas(dados.linhas);
  }

  const [busca, setBusca] = React.useState("");
  const [lente, setLente] = React.useState<Lente>("TODOS");
  const [camera, setCamera] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);
  const [motivoEntrada, setMotivoEntrada] = React.useState("");
  const [verTimeline, setVerTimeline] = React.useState(false);
  const [relacionar, setRelacionar] = React.useState<ItemDeNota | null>(null);
  /** Estorno do recebimento concluído — pede motivo, como o cancelamento. */
  const [estornando, setEstornando] = React.useState(false);
  const [motivoEstorno, setMotivoEstorno] = React.useState("");
  /** O texto pronto para o representante (pedido × nota e caixa × papel). */
  const [avisando, setAvisando] = React.useState(false);
  /** Linha concluída que vai voltar, parcial ou toda, ao fornecedor. */
  const [devolvendo, setDevolvendo] = React.useState<LinhaRecebimento | null>(null);
  /** A NF-e chegou depois: escolher (ou enviar) a nota deste recebimento. */
  const [vinculando, setVinculando] = React.useState(false);
  /**
   * Abater do título o que a nota cobra e não chegou. Ligado por padrão: o
   * caminho comum é não pagar pela caixa que não veio.
   */
  const [abaterFalta, setAbaterFalta] = React.useState(true);
  /**
   * Item que ninguém esperava. É o único caminho de entrada do recebimento
   * AVULSO (que nasce sem linha nenhuma) e a resposta ao "veio uma caixa a
   * mais" nos outros dois — o excedente vira linha visível em vez de sumir
   * num ajuste de estoque sem dono.
   */
  const [adicionando, setAdicionando] = React.useState<
    { produto: ProdutoRecebimento; packagingId: string | null } | true | null
  >(null);
  /** Última linha bipada — pisca para dizer ONDE o número entrou. */
  const [piscando, setPiscando] = React.useState<string | null>(null);
  /**
   * O que cada linha está fazendo com o servidor agora.
   *
   * A contagem grava sozinha, no blur do campo — sem sinal nenhum, o operador
   * não tem como distinguir "salvou" de "não pegou" a não ser recarregando a
   * página. O giro aparece NA LINHA que ele acabou de mexer, vira "salvo" e
   * some: confirmação é momentânea, não estado permanente.
   */
  const [salvandoLinha, setSalvandoLinha] = React.useState<
    Record<string, EstadoSalvamento>
  >({});
  /**
   * Linhas que a pessoa pediu para contar por unidade — a exceção ao padrão de
   * contar na embalagem da nota. Lembrado neste aparelho, por recebimento:
   * recarregar no meio da contagem não pode trocar a régua de quem conta.
   */
  const chavePorUnidade = `nohub:recebimento:${recebimento.id}:por-unidade`;
  const salvoPorUnidade = React.useSyncExternalStore(
    assinarPorUnidade,
    () => lerArmazenado(chavePorUnidade),
    // No servidor não há aparelho: vale o padrão, contar na embalagem.
    () => null,
  );
  const porUnidade = React.useMemo<ReadonlySet<string>>(() => {
    try {
      return new Set(salvoPorUnidade ? (JSON.parse(salvoPorUnidade) as string[]) : []);
    } catch {
      return new Set();
    }
  }, [salvoPorUnidade]);
  const trocarRegua = React.useCallback(
    (linhaId: string, unidade: boolean) => {
      const n = new Set(porUnidade);
      if (unidade) n.add(linhaId);
      else n.delete(linhaId);
      gravarArmazenado(chavePorUnidade, JSON.stringify([...n]));
    },
    [porUnidade, chavePorUnidade],
  );
  const itensRef = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Sair da tela no meio de um "salvo" não pode deixar timer pendurado.
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const conferidos = linhas.filter((l) => l.qtdRecebida != null).length;
  const divergentes = linhas.filter((l) => divergeNoPapel(l, ref) && !l.resolucao);
  // O que vira saldo se a entrada for confirmada agora: o contado, quando
  // alguém contou; o esperado, quando ninguém contou. É a mesma regra que o
  // servidor aplica em `finalizarRecebimento` — a tela só a mostra antes.
  const itensEntrando = linhas.filter((l) => entrando(l) > 0);
  const entraNoEstoque = itensEntrando.reduce((s, l) => s + entrando(l), 0);
  /** O dinheiro da mercadoria que entra, pelo custo com que ela entra. */
  const valorEntrando = itensEntrando.reduce((s, l) => s + entrando(l) * custoDeEntradaDaLinha(l), 0);
  /** O que a nota cobra e não chegou — o que dá para abater do título. */
  const falta = faltaDaConferencia(linhas);
  const vaiAbater = Boolean(nota) && falta.valor > 0.005 && abaterFalta;
  /** Validade vencida em linha que vai entrar — avisa, não trava. */
  const vencidosEntrando = itensEntrando.filter(
    (l) => avisoDeValidade(validadeDaLinha(l), hoje, validadeAlertaDias)?.tipo === "VENCIDO",
  ).length;
  /** Linhas que o "Conferi tudo" preencheria agora. */
  const naoContadas = linhas.filter((l) => l.qtdRecebida == null);
  /** Diferença entre a caixa e o papel em alguma linha contada. */
  const temDiferencaContada = linhas.some((l) => !l.avulsa && contouDiferente(l));
  /**
   * O painel das diferenças do papel (pedido × nota). Na conferência cega ele
   * espera todo mundo ser contado: mostrá-lo antes entregaria justamente o
   * número que a pessoa não pode ver.
   */
  const mostraPainel = divergentes.length > 0 && (!cega || conferidos === linhas.length);
  /** Tudo que ainda espera uma decisão da pessoa antes de receber. */
  const pendencias = divergentes.length + resumo.produtosNovos;
  const semProduto = itensEntrando.filter((l) => !l.productId).length;
  // Mesma régua do servidor (`divergenciasDaConferencia`): contado diferente do
  // esperado e ainda sem explicação. Uma frase resolve todas de uma vez. O
  // avulso puro não tem contra o que divergir — o servidor também não cobra.
  const naoExplicadas =
    !ref.temNota && !ref.temPedido
      ? []
      : linhas.filter(
          (l) =>
            !l.motivoDivergencia &&
            l.resolucao !== "ACEITO" &&
            l.resolucao !== "IGNORADO" &&
            Math.abs(entrando(l) - esperadoDe(l)) > 0.001,
        );
  /** O que o servidor recusaria — dito antes do clique, não depois. */
  const impedimento =
    semProduto > 0
      ? `${semProduto} ${semProduto === 1 ? "item ainda não tem" : "itens ainda não têm"} produto relacionado — relacione antes de receber.`
      : linhas.length > 0 && itensEntrando.length === 0
        ? "Nenhum item foi recebido — nada a dar entrada."
        : null;
  const valorTitulos = nota
    ? nota.duplicatas.length > 0
      ? nota.duplicatas.reduce((s, d) => s + d.valor, 0)
      : nota.valorTotal
    : 0;

  // Um índice de código → item, com o fator de cada embalagem: bipar a caixa
  // soma 12, bipar a unidade soma 1. É a diferença entre conferir um fardo e
  // digitar doze vezes.
  const porCodigo = React.useMemo(() => {
    const mapa = new Map<string, { linha: LinhaRecebimento; incremento: number }>();
    for (const l of linhas) {
      if (l.ean) mapa.set(l.ean, { linha: l, incremento: 1 });
      if (l.sku) mapa.set(l.sku.toLowerCase(), { linha: l, incremento: 1 });
      for (const e of l.embalagens) {
        if (e.ean) mapa.set(e.ean, { linha: l, incremento: e.fator });
      }
    }
    return mapa;
  }, [linhas]);

  const salvar = React.useCallback(
    async (
      linhaId: string,
      dadosItem: {
        qtdRecebida?: number | null;
        lote?: string | null;
        validade?: string | null;
        lotes?: LoteDaLinha[] | null;
      },
    ) => {
      clearTimeout(timersRef.current[linhaId]);
      setSalvandoLinha((s) => ({ ...s, [linhaId]: "salvando" }));
      const limpar = () =>
        setSalvandoLinha((s) =>
          Object.fromEntries(Object.entries(s).filter(([id]) => id !== linhaId)),
        );
      try {
        await conferirItemAction({ receiptId: recebimento.id, itemId: linhaId, ...dadosItem });
        setSalvandoLinha((s) => ({ ...s, [linhaId]: "salvo" }));
        timersRef.current[linhaId] = setTimeout(limpar, 1800);
      } catch (e) {
        limpar();
        toast.error("Não deu para salvar", e instanceof Error ? e.message : "Tente de novo.");
        router.refresh();
      }
    },
    [recebimento.id, router],
  );

  const aplicarLocal = React.useCallback(
    (linhaId: string, patch: Partial<LinhaRecebimento>) =>
      setLinhas((prev) => prev.map((l) => (l.id === linhaId ? { ...l, ...patch } : l))),
    [],
  );

  /**
   * Bipes ainda a caminho do servidor, por linha. A tela soma na hora; quando
   * a ÚLTIMA resposta da linha chega, o total do servidor manda — ele inclui o
   * que outro celular bipou na mesma carga. Aplicar cada resposta no meio da
   * rajada faria o número voltar e avançar diante de quem está bipando.
   */
  const bipesPendentesRef = React.useRef<Record<string, number>>({});
  const somar = React.useCallback(
    async (linhaId: string, incremento: number) => {
      clearTimeout(timersRef.current[linhaId]);
      bipesPendentesRef.current[linhaId] = (bipesPendentesRef.current[linhaId] ?? 0) + 1;
      setSalvandoLinha((s) => ({ ...s, [linhaId]: "salvando" }));
      const limpar = () =>
        setSalvandoLinha((s) =>
          Object.fromEntries(Object.entries(s).filter(([id]) => id !== linhaId)),
        );
      try {
        const total = await somarContagemAction({
          receiptId: recebimento.id,
          itemId: linhaId,
          incremento,
        });
        bipesPendentesRef.current[linhaId] -= 1;
        if (bipesPendentesRef.current[linhaId] === 0) {
          aplicarLocal(linhaId, { qtdRecebida: total });
          setSalvandoLinha((s) => ({ ...s, [linhaId]: "salvo" }));
          timersRef.current[linhaId] = setTimeout(limpar, 1800);
        }
      } catch (e) {
        bipesPendentesRef.current[linhaId] = 0;
        limpar();
        toast.error("Não deu para somar o bipe", e instanceof Error ? e.message : "Tente de novo.");
        router.refresh();
      }
    },
    [recebimento.id, aplicarLocal, router],
  );

  const aoLerCodigo = React.useCallback(
    (codigo: string) => {
      if (encerrada) return;
      const achado = porCodigo.get(codigo) ?? porCodigo.get(codigo.toLowerCase());
      if (!achado) {
        // Fornecedor mandar item a mais é rotina. Em vez de dizer "não está
        // aqui" e morrer, a tela procura o produto no catálogo e abre a linha.
        void buscarProdutoPorCodigoAction(codigo).then((r) => {
          if (!r) {
            toast.error("Código desconhecido", `${codigo} não está neste recebimento nem no catálogo.`);
            return;
          }
          setAdicionando({ produto: r.produto, packagingId: r.packagingId });
        });
        return;
      }
      const atual = achado.linha.qtdRecebida ?? 0;
      const nova = atual + achado.incremento;
      aplicarLocal(achado.linha.id, { qtdRecebida: nova });
      void somar(achado.linha.id, achado.incremento);
      // O toast diz o QUE entrou; a linha diz ONDE. Sem ancorar, quem bipa
      // trinta caixas seguidas não tem como conferir se o número foi parar no
      // item certo — e a linha pode estar fora da tela.
      itensRef.current[achado.linha.id]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
      setPiscando(achado.linha.id);
      // O toast fala na régua da linha: quem conta caixa lê "2 CX de 3".
      const regua = reguaDaLinha(
        { ...achado.linha, qtdRecebida: nova },
        porUnidade.has(achado.linha.id),
      );
      const sigla = siglaDaRegua(regua);
      toast.success(
        nomeDe(achado.linha),
        cega
          ? `${fmtQtd(naRegua(nova, regua))} ${sigla} contado(s)`
          : `${fmtQtd(naRegua(nova, regua))} de ${fmtQtd(naRegua(esperadoDe(achado.linha), regua))} ${sigla}`,
      );
    },
    [porCodigo, aplicarLocal, somar, encerrada, cega, porUnidade],
  );

  // O destaque do bipe se apaga sozinho: é confirmação momentânea, não estado.
  React.useEffect(() => {
    if (!piscando) return;
    const t = setTimeout(() => setPiscando(null), 1200);
    return () => clearTimeout(t);
  }, [piscando]);

  // Leitor USB/Bluetooth funciona sem foco em campo nenhum — quem está na
  // porta tem o leitor numa mão e a caixa na outra.
  useLeitorTeclado(aoLerCodigo, { ativo: !encerrada });

  /**
   * Contar é o trabalho desta tela: o cursor já nasce no primeiro item que
   * falta contar (numa conferência nova, a linha 1), e quem chega com a nota
   * na mão começa digitando. Só ao abrir — o refresh depois de cada gravação
   * não pode arrancar o cursor de onde a pessoa está. No celular não: o foco
   * abriria o teclado por cima da tabela antes de alguém pedir.
   */
  const tabelaRef = React.useRef<HTMLTableElement>(null);
  React.useEffect(() => {
    if (encerrada || window.matchMedia("(pointer: coarse)").matches) return;
    const campos = Array.from(
      tabelaRef.current?.querySelectorAll<HTMLInputElement>("input[data-contagem]") ?? [],
    );
    (campos.find((c) => c.value === "") ?? campos[0])?.focus();
  }, [encerrada]);

  async function conferirTudo() {
    // Só o que ninguém contou muda — a contagem feita e a linha acrescentada
    // na doca ficam como estão (mesma régua do servidor). É também só isso
    // que o "Desfazer" devolve.
    const alvo = naoContadas.map((l) => l.id);
    if (alvo.length === 0) return;
    const antes = alvo.map((itemId) => ({ itemId, qtdRecebida: null }));
    try {
      const n = await conferirTudoAction(recebimento.id);
      setLinhas((prev) =>
        prev.map((l) => (l.qtdRecebida == null ? { ...l, qtdRecebida: esperadoDe(l) } : l)),
      );
      toast.success(
        n === 1 ? "1 item marcado como está no papel." : `${n} itens marcados como estão no papel.`,
        `Os já contados ficaram como estavam. Revise antes de receber no estoque.`,
        { rotulo: "Desfazer", onClick: () => desfazerConferirTudo(antes) },
      );
      router.refresh();
    } catch (e) {
      toast.error("Não deu para confirmar", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  async function desfazerConferirTudo(
    antes: { itemId: string; qtdRecebida: number | null }[],
  ) {
    try {
      await restaurarContagemAction({ receiptId: recebimento.id, itens: antes });
      const voltou = new Map(antes.map((a) => [a.itemId, a.qtdRecebida]));
      setLinhas((prev) =>
        prev.map((l) => (voltou.has(l.id) ? { ...l, qtdRecebida: voltou.get(l.id) ?? null } : l)),
      );
      toast.info("Contagem restaurada.", "Voltou como estava antes do clique.");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para desfazer", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  /**
   * Receber é o botão da conferência, com uma confirmação curta: estoque,
   * custo e contas a pagar mudam juntos. Preço de venda fica de fora — ele mora
   * no cadastro do produto. A contagem grava sozinha a cada campo, e o servidor
   * lê o que ficou gravado; por isso o botão espera a última gravação.
   */
  const gravando = Object.values(salvandoLinha).includes("salvando");
  async function receber() {
    setEnviando(true);
    try {
      const r = await finalizarRecebimentoAction({
        receiptId: recebimento.id,
        motivoDivergencia: motivoEntrada.trim() || null,
        abaterFalta: vaiAbater,
      });
      toast.success(
        `Recebimento ${r.numero} finalizado.`,
        (pedido
          ? r.pedidoCompleto
            ? `Estoque atualizado. Pedido ${pedido.numero} recebido por completo.`
            : `Estoque atualizado. Pedido ${pedido.numero} segue aberto para o que falta.`
          : "Estoque e custo atualizados.") +
          (r.faltaAbatida > 0 ? ` ${fmtMoney(r.faltaAbatida)} de falta abatidos do título.` : ""),
      );
      setConfirmando(false);
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível receber", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Avulso recém-aberto não aparece na lista até alguém salvar. O rascunho
   * guarda o que já foi lançado (a contagem grava sozinha) e devolve a pessoa à
   * lista, onde ele agora está esperando.
   */
  async function salvarRascunho() {
    setEnviando(true);
    try {
      await salvarRascunhoAction(recebimento.id);
      toast.success(
        `Rascunho ${recebimento.numero} salvo.`,
        "Nada entrou no estoque. Continue a conferência pela lista quando quiser.",
      );
      router.push("/recebimento");
    } catch (e) {
      toast.error("Não deu para salvar o rascunho", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  /**
   * Conferência abandonada — o caminhão foi embora, o pedido estava errado.
   *
   * Não apaga nada: o recebimento fica CANCELADO com o motivo. Some do caminho
   * por status, não por DELETE, e o pedido volta a aparecer em "aguardando
   * recebimento" com o saldo intacto.
   */
  async function cancelar() {
    setEnviando(true);
    try {
      await cancelarRecebimentoAction({
        receiptId: recebimento.id,
        motivo: motivoCancelamento.trim(),
      });
      toast.info(
        `Recebimento ${recebimento.numero} cancelado.`,
        "Nada entrou no estoque. O pedido continua aberto.",
      );
      setCancelando(false);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para cancelar", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Desfaz a entrada do recebimento concluído: o saldo volta, os títulos em
   * aberto são cancelados e a conferência reabre com a contagem que tinha —
   * para corrigir e receber de novo, ou cancelar de vez.
   */
  async function estornar() {
    setEnviando(true);
    try {
      const r = await estornarRecebimentoAction({
        receiptId: recebimento.id,
        motivo: motivoEstorno.trim(),
      });
      toast.success(
        `Recebimento ${recebimento.numero} estornado.`,
        `${r.itens} ${r.itens === 1 ? "item saiu" : "itens saíram"} do estoque` +
          (r.titulosCancelados > 0
            ? ` e ${r.titulosCancelados} ${r.titulosCancelados === 1 ? "título foi cancelado" : "títulos foram cancelados"}.`
            : ".") +
          " A conferência está aberta de novo.",
      );
      setEstornando(false);
      setMotivoEstorno("");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para estornar", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  /** Situação de cada linha — a mesma régua no selo, no filtro e na planilha. */
  const situacoes = React.useMemo(
    () => new Map(linhas.map((l) => [l.id, situacaoDaLinha(l, cega, ref)])),
    [linhas, cega, ref],
  );
  /** Quantas linhas cada filtro tem hoje — o número mora no próprio chip. */
  const contagens = React.useMemo(() => {
    const n: Record<Lente, number> = {
      TODOS: linhas.length,
      A_CONFERIR: 0,
      CONFERIDO: 0,
      DIVERGENCIA: 0,
      AJUSTADO: 0,
    };
    for (const s of situacoes.values()) n[s]++;
    return n;
  }, [linhas.length, situacoes]);
  /** Número da linha na ordem do documento — o mesmo com ou sem filtro. */
  const numeroDe = React.useMemo(
    () => new Map(linhas.map((l, i) => [l.id, i + 1])),
    [linhas],
  );

  // Filtro que esvaziou — o operador contou o último item "a conferir" —
  // deixaria a tela em branco sem explicação. Derivado, não corrigido por
  // efeito: a lista volta a ser todos no mesmo render.
  const lenteAtiva: Lente = contagens[lente] === 0 ? "TODOS" : lente;

  // A tabela segue a ordem da nota, como o papel na mão de quem confere. Nada
  // é agrupado nem dobrado: quem quer só o que falta usa o filtro.
  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (lenteAtiva !== "TODOS" && situacoes.get(l.id) !== lenteAtiva) return false;
      if (!termo) return true;
      // Os dois lados da linha: como o fornecedor escreveu e o que isso é no
      // catálogo.
      return `${l.descricao} ${l.produtoNome ?? ""} ${l.sku ?? ""} ${l.ean ?? ""} ${l.codigoFornecedor ?? ""}`
        .toLowerCase()
        .includes(termo);
    });
  }, [linhas, busca, lenteAtiva, situacoes]);

  /**
   * A conferência numa planilha: o que veio, o que se contou e a diferença,
   * linha a linha — o papel que vai para o fornecedor ou para a pasta da nota.
   * Sai inteira, sem o filtro da tela. Na conferência cega o esperado do que
   * ninguém contou fica em branco, como na tela.
   */
  function exportar() {
    const qtdNota = nota ? "Qtd. da nota" : "Qtd. esperada";
    baixarXlsx({
      nomeArquivo: `conferencia-${recebimento.numero}.xlsx`,
      aba: "Conferência",
      cabecalho: [
        "#",
        "Produto na nota",
        "Código do fornecedor",
        "Produto no NoHub",
        ...(mostrarSku ? ["SKU"] : []),
        "EAN",
        "Unidade",
        qtdNota,
        "Qtd. recebida",
        "Diferença",
        "Status",
        "Custo unitário (R$)",
        "Total recebido (R$)",
        "Lote",
        "Validade",
        "Contado por",
      ],
      linhas: linhas.map((l, i) => {
        // Sem papel nenhum (avulso puro) não há esperado nem diferença — a
        // planilha fica igual à tela.
        const oculto = (cega && l.qtdRecebida == null && !encerrada) || (l.avulsa && !temNota && !temPedido);
        const custo = custoDeEntradaDaLinha(l);
        return [
          i + 1,
          l.descricao,
          l.codigoFornecedor ?? "",
          l.produtoNome ?? "",
          ...(mostrarSku ? [l.sku ?? ""] : []),
          l.ean ?? "",
          UNIDADE_CONFERENCIA,
          oculto ? null : esperadoDe(l),
          l.qtdRecebida,
          l.qtdRecebida == null || oculto ? null : l.qtdRecebida - esperadoDe(l),
          SITUACAO_UI[situacoes.get(l.id) ?? "A_CONFERIR"].rotulo,
          custo,
          l.qtdRecebida == null ? null : custo * l.qtdRecebida,
          // Dividida em lotes: um por vez, com a quantidade de cada.
          l.lotes?.length
            ? l.lotes.map((x) => `${x.lote ?? "sem lote"} (${fmtQtd(x.quantidade)})`).join("; ")
            : (l.lote ?? ""),
          l.lotes?.length
            ? l.lotes.map((x) => (x.validade ? fmtDia(x.validade) : "—")).join("; ")
            : l.validade
              ? fmtDia(l.validade)
              : "",
          l.qtdRecebida == null ? "" : (l.contadoPor ?? ""),
        ];
      }),
    });
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      {camera && (
        <Scanner
          onCodigo={aoLerCodigo}
          continuo
          onFechar={() => setCamera(false)}
          dica="Bipe a unidade, a caixa ou o fardo"
        />
      )}

      {/* Sem faixa de números aqui. Itens, pendências e o que entra no saldo já
          têm dono nesta tela — os chips do filtro, o painel de diferenças e o
          rodapé — e o valor da nota mora na etapa 1. */}
      <Topo
        dados={dados}
        etapa="conferencia"
        podeTratarNota={podeTratarNota}
        podeBaixarXml={podeBaixarXml}
        onCancelar={encerrada ? undefined : () => setCancelando(true)}
        onEstornar={finalizado && podeEstornar ? () => setEstornando(true) : undefined}
        // O painel de diferenças tem o próprio "Avisar fornecedor". Sem ele
        // na tela (só a caixa discordou do papel), o atalho mora no menu.
        onAvisarFornecedor={
          podeReceber && !mostraPainel && temDiferencaContada ? () => setAvisando(true) : undefined
        }
        onExportar={linhas.length > 0 ? exportar : undefined}
        onVincularNota={
          !nota && podeReceber && recebimento.status !== "CANCELADO"
            ? () => setVinculando(true)
            : undefined
        }
        acoesDoConcluido={
          finalizado ? (
            <ProximosPassos
              produtos={[...new Set(linhas.filter((l) => l.productId && entrando(l) > 0).map((l) => l.productId as string))]}
              podeEtiquetas={podeEtiquetas}
              podeVerFinanceiro={podeVerFinanceiro && Boolean(recebimento.supplierId)}
              supplierId={recebimento.supplierId}
              temDiferenca={podeReceber && (divergentes.length > 0 || temDiferencaContada)}
              onAvisar={() => setAvisando(true)}
              // Fechado sem XML: a nota que chegar depois documenta a entrada
              // e traz o boleto. O atalho fica onde a pessoa já está olhando.
              onVincularNota={!nota && podeReceber ? () => setVinculando(true) : undefined}
              margens={dados.margens}
            />
          ) : undefined
        }
      />

      {/* Conferência cega: mostrar as divergências antes da contagem entregaria
          justamente o número que a pessoa não pode ver. O painel espera todo
          mundo ser contado. */}
      {mostraPainel && (
        <PainelDivergencias
          receiptId={recebimento.id}
          linhas={divergentes}
          temNota={Boolean(nota)}
          impactoCusto={resumo.custosAlterados > 0 ? resumo.impactoCusto : 0}
          bloqueado={encerrada}
          podeAvisar={podeReceber}
          onAvisar={() => setAvisando(true)}
          onRelacionar={(l) => setRelacionar(paraRelacionar(l))}
        />
      )}

      {cega && conferidos < linhas.length && (
        <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Conferência cega ligada: as quantidades {semPedido ? "da nota" : "do pedido e da nota"}{" "}
          aparecem depois que você contar. Conte {linhas.length - conferidos} de {linhas.length}{" "}
          {linhas.length === 1 ? "item" : "itens"} para ver o comparativo.
        </p>
      )}

      {/* Quem só acompanha. Finalizado e cancelado já são ditos no topo. */}
      {encerrada && recebimento.status !== "FINALIZADO" && recebimento.status !== "CANCELADO" && (
        <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Esta conferência está em andamento. Você acompanha o que já foi contado; quem
          recebe a mercadoria é quem conta e dá a entrada.
        </p>
      )}

      {linhas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted">
            <PackagePlus size={20} aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">Nada conferido ainda</p>
          <p className="max-w-sm text-[13px] text-muted">
            {nota
              ? "A conferência desta nota ainda não tem itens. Volte à nota e produtos para escolher como receber — ou bipe o que chegou."
              : pedido
                ? "O pedido não tem saldo a conferir neste recebimento. Bipe ou busque cada produto que chegou — nada entra no estoque até você finalizar."
                : "Este recebimento não tem pedido nem nota por trás. Bipe ou busque cada produto que chegou — nada entra no estoque até você finalizar."}
          </p>
          {!encerrada && (
            <div className="mt-1 flex gap-2">
              <Button variant="secondary" onClick={() => setCamera(true)}>
                <ScanLine className="h-4 w-4" aria-hidden />
                Bipar
              </Button>
              <Button onClick={() => setAdicionando(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Adicionar item
              </Button>
            </div>
          )}
        </div>
      ) : (
        // `overflow-clip`, não `hidden`: recorta os cantos sem virar contêiner
        // de rolagem — é o que deixa a barra de busca presa no topo enquanto a
        // nota de quarenta linhas rola por baixo dela.
        <div className="@container overflow-clip rounded-[var(--radius-lg)] border border-line bg-surface">
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-3 sm:px-4">
            <div className="relative min-w-48 flex-1 sm:max-w-72">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto na nota…"
                aria-label="Buscar item por nome, SKU, EAN ou código do fornecedor"
                className="h-9 w-full rounded-full border border-line-strong bg-surface pr-3 pl-8 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filtrar itens da conferência"
            >
              <Filtro
                rotulo="Todos"
                total={linhas.length}
                ativo={lenteAtiva === "TODOS"}
                conta="bg-surface-2 text-muted"
                onClick={() => setLente("TODOS")}
              />
              {SITUACOES.map((s) => (
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

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!encerrada && (
                <Button size="sm" variant="secondary" onClick={() => setCamera(true)}>
                  <ScanLine size={14} aria-hidden />
                  Bipar
                </Button>
              )}
              {!encerrada && !cega && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void conferirTudo()}
                  disabled={naoContadas.length === 0 || gravando}
                  title={
                    naoContadas.length === 0
                      ? "Todos os itens já foram contados."
                      : `Marca ${naoContadas.length === 1 ? "o item ainda não contado" : `os ${naoContadas.length} itens ainda não contados`} com a quantidade ${nota ? "da nota" : "do pedido"}. O que já foi contado fica como está.`
                  }
                >
                  <CheckCheck size={14} aria-hidden />
                  Conferi tudo
                </Button>
              )}
            </div>
          </div>

          {/* As colunas acompanham a largura do cartão, não da tela: no
              celular sobra o que a doca usa — o item, quanto veio, quanto
              chegou e o status. Foto, NoHub, unidade e valores voltam quando
              há espaço. */}
          <div className="overflow-x-auto">
            <table ref={tabelaRef} className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-surface-2">
                  <Th className="w-10 pl-3 sm:pl-4">#</Th>
                  <Th className={cn(COLUNA_LARGA, "w-12")}>
                    <span className="sr-only">Foto</span>
                  </Th>
                  <Th sub="Código do fornecedor">Produto na nota</Th>
                  <Th sub={mostrarSku ? "SKU / EAN" : "EAN"} className={COLUNA_LARGA}>
                    Produto no NoHub
                  </Th>
                  <Th
                    className={cn(COLUNA_LARGA, "text-center")}
                    dica="Por padrão a conferência conta na embalagem em que a nota faturou: 1 CX na nota, 1 CX na doca. Para contar um item unidade a unidade, troque para UN na linha. O estoque sempre recebe em unidades."
                  >
                    Unidade
                  </Th>
                  {/* No celular o cabeçalho encolhe para a coluna "⋮" caber
                      sem rolar de lado. */}
                  <Th className="text-center">
                    <span className="hidden @[54rem]:inline">
                      {nota ? "Qtd. da nota" : "Qtd. esperada"}
                    </span>
                    <span className="@[54rem]:hidden">{nota ? "Nota" : "Esperado"}</span>
                  </Th>
                  <Th className="text-center">
                    <span className="hidden @[54rem]:inline">Qtd. recebida</span>
                    <span className="@[54rem]:hidden">Recebido</span>
                  </Th>
                  <Th className="hidden text-center @[30rem]:table-cell">Diferença</Th>
                  <Th>Status</Th>
                  <Th sub="(unitário)" className={cn(COLUNA_LARGA, "text-right")}>
                    Custo (R$)
                  </Th>
                  <Th sub="(recebido)" className={cn(COLUNA_LARGA, "text-right")}>
                    Total (R$)
                  </Th>
                  <Th className="w-10 pr-3">
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => (
                  <LinhaConferencia
                    key={l.id}
                    ref={(el) => {
                      itensRef.current[l.id] = el;
                    }}
                    linha={l}
                    regua={reguaDaLinha(l, porUnidade.has(l.id))}
                    onRegua={(unidade) => trocarRegua(l.id, unidade)}
                    numero={numeroDe.get(l.id) ?? 0}
                    situacao={situacoes.get(l.id) ?? "A_CONFERIR"}
                    temNota={Boolean(nota)}
                    semEsperado={l.avulsa && !temNota && !temPedido}
                    mostrarSku={mostrarSku}
                    bloqueado={encerrada}
                    cega={cega}
                    piscando={piscando === l.id}
                    salvamento={salvandoLinha[l.id] ?? null}
                    validade={avisoDeValidade(validadeDaLinha(l), hoje, validadeAlertaDias)}
                    onDevolver={
                      // Depois da entrada, o que voltou para o caminhão sai do
                      // estoque pela linha — a do produto que voltou.
                      finalizado && podeDevolver && l.productId && entrando(l) > 0
                        ? () => setDevolvendo(l)
                        : undefined
                    }
                    onAlterar={(patch) => {
                      // "Um lote só" vai ao servidor como lista vazia; na tela é
                      // a linha sem lotes, como o servidor a devolve.
                      aplicarLocal(
                        l.id,
                        patch.lotes !== undefined
                          ? { ...patch, lotes: patch.lotes?.length ? patch.lotes : null }
                          : patch,
                      );
                      void salvar(l.id, patch);
                    }}
                    onRelacionar={() => setRelacionar(paraRelacionar(l))}
                    onBipe={aoLerCodigo}
                    onRemover={
                      // Só a linha que ninguém esperava sai da lista. A do pedido
                      // ou da nota se zera — apagar esconderia a falta em vez de
                      // mostrá-la.
                      l.avulsa && !encerrada
                        ? () => {
                            void removerItemAction({ receiptId: recebimento.id, itemId: l.id })
                              .then(() => router.refresh())
                              .catch((e: unknown) =>
                                toast.error(
                                  "Não deu para remover",
                                  e instanceof Error ? e.message : "Tente de novo.",
                                ),
                              );
                          }
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {visiveis.length === 0 && (
            <p className="border-t border-line px-4 py-8 text-center text-[13px] text-muted">
              {busca.trim()
                ? `Nenhum item com “${busca.trim()}”${lenteAtiva !== "TODOS" ? " neste filtro" : ""}. `
                : "Nenhum item neste filtro. "}
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setLente("TODOS");
                }}
                className="cursor-pointer font-medium text-brand-strong underline"
              >
                Ver os {linhas.length} itens
              </button>
            </p>
          )}

          {/* O excedente do caminhão entra como linha própria, no fim da
              tabela — a diferença fica visível em vez de sumir num ajuste. */}
          {!encerrada && (
            <button
              type="button"
              onClick={() => setAdicionando(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-dashed border-line px-4 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset"
            >
              <Plus size={14} aria-hidden />
              {nota ? "Adicionar item que chegou fora da nota" : "Adicionar item"}
            </button>
          )}
        </div>
      )}

      {dados.vasilhame && dados.vasilhame.length > 0 && (
        <CartaoVasilhame
          receiptId={recebimento.id}
          tipos={dados.vasilhame}
          // O caminhão leva os vazios depois de descarregar: vale também com o
          // recebimento já concluído.
          editavel={podeReceber && recebimento.status !== "CANCELADO"}
        />
      )}

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <button
          type="button"
          onClick={() => setVerTimeline((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink hover:bg-surface-2"
        >
          <History className="h-4 w-4 text-faint" aria-hidden />
          {/* A história é DESTE recebimento — a do pedido inteiro, com as
              outras entregas, mora na tela do pedido. */}
          Histórico do recebimento
          <span className="ml-auto text-[12px] text-muted">
            {verTimeline ? "ocultar" : `${timeline.length} eventos`}
          </span>
        </button>
        {verTimeline && (
          <ol className="border-t border-line px-4 py-3">
            {timeline.map((e) => (
              <li key={e.id} className="flex gap-3 py-1.5 text-[13px]">
                <span className="w-32 shrink-0 font-mono text-[12px] text-faint">
                  {new Date(e.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1 text-ink-2">
                  {e.descricao}
                  {e.autor && <span className="text-faint"> · {e.autor}</span>}
                </span>
              </li>
            ))}
            {timeline.length === 0 && <li className="py-2 text-[13px] text-muted">Sem eventos.</li>}
          </ol>
        )}
      </div>

      {!encerrada && (
        <RodapeAcao>
          <div className="min-w-0 flex-1">
            <MedidorRodape
              total={linhas.length}
              feitos={conferidos}
              atencao={divergentes.length}
              rotulo="item conferido"
              rotuloPlural="itens conferidos"
            />
            {/* Uma frase: o que falta, ou o que acontece com o que ninguém
                contou. Quanto entra e quanto se paga é assunto da confirmação,
                um clique adiante — não de um segundo resumo aqui. */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
              {impedimento ? (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                  <span>{impedimento}</span>
                </>
              ) : pendencias > 0 ? (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span>
                    {pendencias} {pendencias === 1 ? "item precisa" : "itens precisam"} de
                    atenção — o que não for conferido entra {comoNoPapel}.
                  </span>
                </>
              ) : conferidos === linhas.length ? (
                <>
                  <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                  <span>Tudo conferido. Falta apenas receber no estoque.</span>
                </>
              ) : (
                <span>
                  {linhas.length - conferidos}{" "}
                  {linhas.length - conferidos === 1 ? "item entra" : "itens entram"} {comoNoPapel}{" "}
                  se ninguém contar.
                </span>
              )}
            </p>
          </div>

          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            {recebimento.provisorio && (
              <Button
                variant="secondary"
                onClick={() => void salvarRascunho()}
                disabled={enviando || gravando || linhas.length === 0}
                title={linhas.length === 0 ? "Adicione ao menos um item para salvar" : undefined}
                className="flex-1 sm:flex-none"
              >
                Salvar rascunho
              </Button>
            )}
            <Button
              onClick={() => setConfirmando(true)}
              disabled={enviando || gravando || linhas.length === 0 || impedimento !== null}
              className="flex-1 sm:flex-none"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              Receber no estoque
            </Button>
          </div>
        </RodapeAcao>
      )}

      <Sheet
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title="Receber no estoque"
        description="A mercadoria vira saldo e o custo médio é recalculado. O preço de venda não muda — continua o do cadastro do produto."
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmando(false)} className="flex-1">
              Voltar
            </Button>
            <Button
              onClick={() => void receber()}
              disabled={
                enviando || gravando || (naoExplicadas.length > 0 && motivoEntrada.trim().length < 3)
              }
              className="flex-1"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {enviando ? "Recebendo…" : "Confirmar entrada"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <dl className="divide-y divide-line rounded-[var(--radius)] border border-line text-[13px]">
            <div className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-muted">Estoque · {recebimento.siteNome}</dt>
              <dd className="text-right font-mono text-ink">
                +{fmtQtd(entraNoEstoque)} UN em {itensEntrando.length}{" "}
                {itensEntrando.length === 1 ? "item" : "itens"}
              </dd>
            </div>
            {/* O custo com que a mercadoria entra — é ele que mexe no custo
                médio. Difere da nota quando chegou menos (ou mais) do que ela
                cobra; a diferença é a conversa com o fornecedor. */}
            <div className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-muted">Mercadoria recebida</dt>
              <dd className="text-right text-ink">
                <span className="font-mono">{fmtMoney(valorEntrando)}</span>
                {nota && Math.abs(valorEntrando - nota.valorTotal) >= 0.01 && (
                  <span className="block text-[11px] text-muted">
                    nota: <span className="font-mono">{fmtMoney(nota.valorTotal)}</span>
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-muted">Contas a pagar</dt>
              <dd className="text-right text-ink">
                {nota ? (
                  <>
                    <span className="font-mono">
                      {fmtMoney(Math.max(0, valorTitulos - (vaiAbater ? falta.valor : 0)))}
                    </span>
                    {nota.duplicatas.length > 1 && ` em ${nota.duplicatas.length} títulos`}
                    {vaiAbater && (
                      <span className="block text-[11px] text-muted">
                        nota <span className="font-mono">{fmtMoney(valorTitulos)}</span> − falta{" "}
                        <span className="font-mono">{fmtMoney(falta.valor)}</span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">sem NF-e, nenhum título agora</span>
                )}
              </dd>
            </div>
          </dl>

          {nota && falta.valor > 0.005 && (
            // A nota cobra a carga inteira; o título não precisa nascer
            // cobrando a caixa que não veio. Ligado por padrão.
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius)] border border-line px-3 py-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={abaterFalta}
                onChange={(e) => setAbaterFalta(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                <span className="font-medium text-ink">Abater a falta do título a pagar</span>
                <span className="block text-[12px] text-muted">
                  A nota cobra <span className="font-mono">{fmtMoney(falta.valor)}</span> em{" "}
                  {falta.itens === 1 ? "1 item que não entrou" : `${falta.itens} itens que não entraram`}.
                  O título já nasce com o desconto — o boleto do fornecedor vem cheio, combine com
                  ele.
                </span>
              </span>
            </label>
          )}

          {conferidos < linhas.length && (
            <p className="rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px] text-accent">
              {linhas.length - conferidos}{" "}
              {linhas.length - conferidos === 1
                ? "item não foi contado — entra"
                : "itens não foram contados — entram"}{" "}
              com a quantidade {nota ? "da nota" : "do pedido"}.
            </p>
          )}

          {vencidosEntrando > 0 && (
            // Avisa, não trava: vencido é decisão de quem recebe (devolver ao
            // motorista ou dar baixa depois), não do sistema.
            <p className="flex items-start gap-2 rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {vencidosEntrando === 1
                ? "1 item entra com a validade já vencida."
                : `${vencidosEntrando} itens entram com a validade já vencida.`}{" "}
              Confira antes de receber — depois, só com devolução ou baixa.
            </p>
          )}

          {naoExplicadas.length > 0 && (
            // Uma frase, uma vez. Sem ela, a diferença vira daqui a três meses
            // a palavra do estoquista contra a do fornecedor.
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                O que aconteceu com{" "}
                {naoExplicadas.length === 1
                  ? "a linha que não bateu"
                  : `as ${naoExplicadas.length} linhas que não bateram`}
                ?
              </span>
              <ul className="mb-2 space-y-0.5 text-[12px] text-muted">
                {naoExplicadas.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-x-2">
                    <span className="min-w-0 truncate text-ink-2">{nomeDe(l)}</span>
                    <span className="font-mono">
                      esperado {fmtQtd(esperadoDe(l))} · contado {fmtQtd(entrando(l))}
                    </span>
                  </li>
                ))}
                {naoExplicadas.length > 4 && <li>e mais {naoExplicadas.length - 4}.</li>}
              </ul>
              <textarea
                value={motivoEntrada}
                onChange={(e) => setMotivoEntrada(e.target.value)}
                rows={2}
                maxLength={240}
                placeholder="Ex.: veio só metade da carga, o resto o motorista traz amanhã."
                className="w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
              />
              <span className="mt-1 block text-[12px] text-muted">
                Fica na história do recebimento{pedido ? " e do pedido" : ""}.
              </span>
            </label>
          )}
        </div>
      </Sheet>

      <Sheet
        open={cancelando}
        onClose={() => setCancelando(false)}
        title="Cancelar recebimento"
        description="A conferência é encerrada sem mover estoque. O pedido continua aberto, com o saldo intacto."
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCancelando(false)} className="flex-1">
              Voltar
            </Button>
            <Button
              onClick={() => void cancelar()}
              disabled={enviando || motivoCancelamento.trim().length < 3}
              className="flex-1"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Cancelar recebimento
            </Button>
          </div>
        }
      >
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">
            Por que esta conferência não vai continuar?
          </span>
          <textarea
            value={motivoCancelamento}
            onChange={(e) => setMotivoCancelamento(e.target.value)}
            rows={2}
            placeholder="Ex.: carga era de outra loja, o motorista levou de volta."
            className="w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
          />
          <span className="mt-1 block text-[12px] text-muted">
            Fica no histórico. Nada é apagado.
          </span>
        </label>
      </Sheet>

      <Sheet
        open={estornando}
        onClose={() => setEstornando(false)}
        title="Estornar recebimento"
        description="A mercadoria sai do estoque, o custo médio volta ao que era e os títulos em aberto deste recebimento são cancelados. A conferência reabre com a contagem que tinha."
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEstornando(false)} className="flex-1">
              Voltar
            </Button>
            <Button
              variant="danger"
              onClick={() => void estornar()}
              disabled={enviando || motivoEstorno.trim().length < 3}
              className="flex-1"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Estornar entrada
            </Button>
          </div>
        }
      >
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">
            Por que esta entrada está sendo desfeita?
          </span>
          <textarea
            value={motivoEstorno}
            onChange={(e) => setMotivoEstorno(e.target.value)}
            rows={2}
            maxLength={240}
            placeholder="Ex.: contagem lançada errada, a nota era de outra loja."
            className="w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
          />
          <span className="mt-1 block text-[12px] text-muted">
            Fica na razão de estoque e no histórico, com seu nome e a hora. Título já pago não é
            cancelado — o crédito com o fornecedor é tratado no financeiro.
          </span>
        </label>
      </Sheet>

      {avisando && (
        <SheetAvisarFornecedor receiptId={recebimento.id} onClose={() => setAvisando(false)} />
      )}

      {vinculando && (
        <SheetVincularNota
          receiptId={recebimento.id}
          finalizado={finalizado}
          onClose={() => setVinculando(false)}
          onFeito={() => {
            setVinculando(false);
            router.refresh();
          }}
        />
      )}

      {devolvendo && (
        <SheetDevolver
          receiptId={recebimento.id}
          linha={devolvendo}
          onClose={() => setDevolvendo(null)}
          onFeito={() => {
            setDevolvendo(null);
            router.refresh();
          }}
        />
      )}

      {adicionando && !encerrada && (
        <AdicionarItem
          receiptId={recebimento.id}
          inicial={adicionando === true ? null : adicionando}
          onClose={() => setAdicionando(null)}
          onPronto={() => {
            setAdicionando(null);
            router.refresh();
          }}
        />
      )}

      {relacionar && (
        <RelacionarProduto
          key={relacionar.inboundItemId ?? relacionar.descricao}
          item={relacionar}
          restantes={Math.max(0, linhas.filter((l) => !l.productId).length - 1)}
          onFechar={() => setRelacionar(null)}
          onRelacionado={(inboundItemId) => {
            const proximo = linhas.find((l) => !l.productId && l.inboundItemId !== inboundItemId);
            setRelacionar(proximo ? paraRelacionar(proximo) : null);
          }}
          podeCriarProduto={podeCriarProduto}
          subcategorias={subcategorias}
          mostrarSku={mostrarSku}
        />
      )}
    </div>
  );
}

// ── Vincular a NF-e que chegou depois ───────────────────────
//
// A carga entrou (ou está sendo contada) sem o XML. Quando ele chega, a pessoa
// escolhe entre as notas livres da loja — do mesmo fornecedor, emitidas perto
// da chegada — ou envia o arquivo, que é importado e vinculado de uma vez.

type NotaCandidata = Awaited<ReturnType<typeof notasParaVincularAction>>[number];

function SheetVincularNota({
  receiptId,
  finalizado,
  onClose,
  onFeito,
}: {
  receiptId: string;
  finalizado: boolean;
  onClose: () => void;
  onFeito: () => void;
}) {
  const [notas, setNotas] = React.useState<NotaCandidata[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  /** O que está indo para o servidor: o id da nota escolhida, ou "arquivo". */
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let vivo = true;
    notasParaVincularAction(receiptId)
      .then((r) => vivo && setNotas(r))
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : "Não deu para buscar as notas.");
      });
    return () => {
      vivo = false;
    };
  }, [receiptId]);

  const depois = finalizado
    ? "Ela documenta o que já entrou: o estoque não se move de novo."
    : "A conferência passa a seguir a nota; o que já foi contado continua contado.";

  async function vincular(n: NotaCandidata) {
    setEnviando(n.inboundId);
    try {
      await vincularNotaAction({ receiptId, inboundId: n.inboundId });
      toast.success(`NF-e ${n.numero}/${n.serie} vinculada.`, depois);
      onFeito();
    } catch (e) {
      toast.error("Não deu para vincular", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(null);
    }
  }

  async function enviarArquivo(arquivo: File) {
    setEnviando("arquivo");
    try {
      const form = new FormData();
      form.set("arquivo", arquivo);
      await importarXmlParaRecebimentoAction(receiptId, form);
      toast.success("XML importado e vinculado.", depois);
      onFeito();
    } catch (e) {
      toast.error("Não deu para usar este XML", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title="Vincular NF-e"
      description={
        finalizado
          ? "A mercadoria já entrou. A nota documenta a entrada e as duplicatas dela viram contas a pagar — nada entra no estoque de novo."
          : "A nota passa a ser a referência desta conferência. O que já foi contado fica, inclusive os itens abertos à mão."
      }
    >
      <div className="flex flex-col gap-4">
        {erro ? (
          <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-3 text-[13px] text-danger">{erro}</p>
        ) : notas === null ? (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Procurando notas desta loja…
          </p>
        ) : notas.length === 0 ? (
          <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
            Nenhuma NF-e livre desta loja, deste fornecedor, emitida perto da chegada. Envie o XML
            abaixo — ele é importado e vinculado de uma vez.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius)] border border-line">
            {notas.map((n) => (
              <li key={n.inboundId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">
                    NF-e <span className="font-mono">{n.numero}/{n.serie}</span>
                    <span className="font-normal text-muted"> · {n.emitente}</span>
                  </p>
                  <p className="font-mono text-[12px] text-muted">
                    {new Date(n.dataEmissao).toLocaleDateString("pt-BR")} · {fmtMoney(n.valorTotal)} ·{" "}
                    {n.itens} {n.itens === 1 ? "item" : "itens"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void vincular(n)}
                  disabled={enviando !== null}
                >
                  {enviando === n.inboundId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  É esta nota
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* O XML que ainda não está no sistema: importa na loja deste
            recebimento e já vincula. Nota repetida usa a que existe. */}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-3 text-[13px] transition-colors hover:bg-surface-2 focus-within:ring-2 focus-within:ring-[var(--ring)]",
            enviando !== null && "pointer-events-none opacity-60",
          )}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            {enviando === "arquivo" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <FileUp size={16} aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-ink">
              {enviando === "arquivo" ? "Importando o XML…" : "Enviar o XML da nota"}
            </span>
            <span className="block text-[12px] text-muted">
              Arquivo .xml que o fornecedor mandou por e-mail ou WhatsApp.
            </span>
          </span>
          <input
            ref={arquivoRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="sr-only"
            disabled={enviando !== null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarArquivo(f);
            }}
          />
        </label>
      </div>
    </Sheet>
  );
}

// ── Vasilhame com o fornecedor ──────────────────────────────
//
// Cerveja retornável e barril chegam cheios e o caminhão leva os vazios. A
// conta do casco era de caderno; aqui ela fica no recebimento em que
// aconteceu. Recolhido quando não há nada lançado — a maioria das cargas não
// tem casco, e uma seção aberta à toa é uma faixa a mais na tela.

type TipoVasilhame = NonNullable<RecebimentoView["vasilhame"]>[number];
type ContagemCasco = { recebidos: string; devolvidos: string };

const cascosDe = (tipos: TipoVasilhame[]): Record<string, ContagemCasco> =>
  Object.fromEntries(
    tipos.map((t) => [
      t.containerTypeId,
      { recebidos: t.recebidos ? String(t.recebidos) : "", devolvidos: t.devolvidos ? String(t.devolvidos) : "" },
    ]),
  );

function CartaoVasilhame({
  receiptId,
  tipos,
  editavel,
}: {
  receiptId: string;
  tipos: TipoVasilhame[];
  editavel: boolean;
}) {
  const router = useRouter();
  const lancado = tipos.some((t) => t.recebidos > 0 || t.devolvidos > 0);
  const [aberto, setAberto] = React.useState(lancado);
  const [valores, setValores] = React.useState(() => cascosDe(tipos));
  // Dado novo do servidor (depois de gravar) substitui o rascunho local —
  // ajuste durante o render, como a cópia das linhas da conferência.
  const [ultimo, setUltimo] = React.useState(tipos);
  if (ultimo !== tipos) {
    setUltimo(tipos);
    setValores(cascosDe(tipos));
  }
  const [salvando, setSalvando] = React.useState<string | null>(null);

  const numero = (v: string) => (v.trim() === "" ? 0 : Number(v));

  async function salvar(t: TipoVasilhame) {
    const v = valores[t.containerTypeId];
    const recebidos = numero(v.recebidos);
    const devolvidos = numero(v.devolvidos);
    if (recebidos === t.recebidos && devolvidos === t.devolvidos) return;
    if (![recebidos, devolvidos].every((n) => Number.isInteger(n) && n >= 0)) {
      toast.error("Casco se conta inteiro", "Informe quantos cheios chegaram e quantos vazios voltaram, de 0 para cima.");
      setValores((s) => ({ ...s, [t.containerTypeId]: cascosDe([t])[t.containerTypeId] }));
      return;
    }
    setSalvando(t.containerTypeId);
    try {
      await salvarVasilhameAction({ receiptId, containerTypeId: t.containerTypeId, recebidos, devolvidos });
      router.refresh();
    } catch (e) {
      toast.error("Não deu para salvar o vasilhame", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setSalvando(null);
    }
  }

  const resumo = lancado
    ? tipos
        .filter((t) => t.recebidos > 0 || t.devolvidos > 0)
        .map((t) => `${t.nome}: ${t.recebidos} cheio(s), ${t.devolvidos} vazio(s)`)
        .join(" · ")
    : "nada lançado";

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset"
      >
        <Beer className="h-4 w-4 text-faint" aria-hidden />
        Vasilhame com o fornecedor
        <span className="ml-auto min-w-0 truncate text-[12px] font-normal text-muted">
          {aberto ? "ocultar" : resumo}
        </span>
      </button>
      {aberto && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2.5 text-[12px] text-muted">
            Cheio que chegou, vazio que o caminhão levou. O saldo é quanto casco a loja deve a este
            fornecedor, somando todas as entregas.
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {tipos.map((t) => {
              const v = valores[t.containerTypeId] ?? { recebidos: "", devolvidos: "" };
              // O saldo do servidor já conta este recebimento; o que está sendo
              // digitado troca a parte dele.
              const saldo =
                t.saldo - (t.recebidos - t.devolvidos) + (numero(v.recebidos) - numero(v.devolvidos));
              const campo = (chave: keyof ContagemCasco, rotulo: string) => (
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  {rotulo}
                  <input
                    value={v[chave]}
                    onChange={(e) =>
                      setValores((s) => ({
                        ...s,
                        [t.containerTypeId]: { ...v, [chave]: e.target.value.replace(/\D/g, "") },
                      }))
                    }
                    onBlur={() => void salvar(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    disabled={!editavel || salvando === t.containerTypeId}
                    aria-label={`${rotulo} — ${t.nome}`}
                    className="h-8 w-16 rounded-[var(--radius)] border border-line-strong bg-surface px-2 text-center font-mono text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:bg-surface-2"
                  />
                </label>
              );
              return (
                <li key={t.containerTypeId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
                  <span className="min-w-32 flex-1 text-[13px] font-medium text-ink">{t.nome}</span>
                  {campo("recebidos", "Cheios")}
                  {campo("devolvidos", "Vazios")}
                  <span
                    className={cn(
                      "w-28 text-right font-mono text-[12px]",
                      saldo > 0 ? "text-accent" : saldo < 0 ? "text-brand-strong" : "text-muted",
                    )}
                  >
                    {salvando === t.containerTypeId ? (
                      <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" aria-label="Salvando" />
                    ) : saldo > 0 ? (
                      `deve ${saldo}`
                    ) : saldo < 0 ? (
                      `crédito de ${-saldo}`
                    ) : (
                      "em dia"
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Próximos passos do concluído ────────────────────────────
//
// A mercadoria entrou; o trabalho não acabou. Etiqueta de prateleira para o
// que chegou, a reclamação ao fornecedor quando houve diferença, o título que
// nasceu — e o produto que ficou sem margem com o custo novo. Tudo dentro do
// próprio aviso de concluído: um cartão a mais seria uma faixa a mais.

const CHIP_PASSO =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-ok/30 bg-surface px-3 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

function ProximosPassos({
  produtos,
  podeEtiquetas,
  podeVerFinanceiro,
  supplierId,
  temDiferenca,
  onAvisar,
  onVincularNota,
  margens,
}: {
  /** Produtos que entraram — uma etiqueta de cada. */
  produtos: string[];
  podeEtiquetas: boolean;
  podeVerFinanceiro: boolean;
  supplierId: string | null;
  temDiferenca: boolean;
  onAvisar: () => void;
  /** Recebido sem NF-e: o XML que chegar depois documenta a entrada. */
  onVincularNota?: () => void;
  margens: RecebimentoView["margens"];
}) {
  // A folha de etiquetas aceita 60 produtos por vez (`/documento/etiquetas`).
  const paraEtiqueta = produtos.slice(0, 60);
  const urlEtiquetas = `/documento/etiquetas?itens=${encodeURIComponent(
    paraEtiqueta.map((id) => `${id}:1`).join(","),
  )}`;
  const temAcao =
    (podeEtiquetas && paraEtiqueta.length > 0) ||
    temDiferenca ||
    Boolean(onVincularNota) ||
    (podeVerFinanceiro && supplierId);
  if (!temAcao && margens.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 border-t border-ok/20 pt-2.5">
      {temAcao && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-ok">Próximos passos:</span>
          {podeEtiquetas && paraEtiqueta.length > 0 && (
            <a href={urlEtiquetas} target="_blank" rel="noreferrer" className={CHIP_PASSO}>
              <Tag size={13} aria-hidden />
              Imprimir etiquetas ({paraEtiqueta.length})
            </a>
          )}
          {onVincularNota && (
            <button type="button" onClick={onVincularNota} className={CHIP_PASSO}>
              <FileUp size={13} aria-hidden />
              Vincular NF-e
            </button>
          )}
          {temDiferenca && (
            <button type="button" onClick={onAvisar} className={CHIP_PASSO}>
              <Send size={13} aria-hidden />
              Avisar fornecedor
            </button>
          )}
          {podeVerFinanceiro && supplierId && (
            <Link href={`/financeiro/contas-a-pagar?fornecedor=${supplierId}`} className={CHIP_PASSO}>
              <Wallet size={13} aria-hidden />
              Ver contas a pagar
            </Link>
          )}
        </div>
      )}

      {margens.length > 0 && (
        // Aviso, não remarcação: o preço de venda mora no cadastro, e é lá que
        // a pessoa decide. Aqui só não deixa o custo novo passar calado.
        <div className="rounded-[var(--radius)] border border-warn/30 bg-surface px-3 py-2.5 text-ink-2">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-warn">
            <TrendingDown size={13} aria-hidden />
            {margens.length === 1
              ? "1 produto ficou com margem abaixo de 15% com o custo desta entrada"
              : `${margens.length} produtos ficaram com margem abaixo de 15% com o custo desta entrada`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {margens.slice(0, 6).map((m) => (
              <li key={m.productId} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="min-w-0 font-medium text-ink">{m.nome}</span>
                <span className="font-mono text-muted">
                  preço {fmtMoney(m.precoVenda)} · custo {fmtMoney(m.custo)} ·{" "}
                  <span className={m.nivel === "NEGATIVA" ? "text-danger" : "text-warn"}>
                    margem {m.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  </span>
                </span>
                <Link
                  href={`/produtos/${m.productId}/editar`}
                  className="font-medium text-brand-strong underline-offset-2 hover:underline"
                >
                  Revisar preço
                </Link>
              </li>
            ))}
            {margens.length > 6 && (
              <li className="text-[12px] text-muted">e mais {margens.length - 6}.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Painel de divergências ──────────────────────────────────
// Ninguém deve caçar erro numa lista de trinta itens: o que está errado sobe
// para o topo, com a decisão ao lado.

function PainelDivergencias({
  receiptId,
  linhas,
  temNota,
  impactoCusto,
  bloqueado,
  podeAvisar,
  onAvisar,
  onRelacionar,
}: {
  receiptId: string;
  linhas: LinhaRecebimento[];
  /** Há NF-e: a linha acrescentada na doca é "fora da nota". */
  temNota: boolean;
  /** Quanto a nota custou a mais (ou a menos) que o negociado. Zero = não mudou. */
  impactoCusto: number;
  bloqueado: boolean;
  /** O texto ao fornecedor sai da action de quem recebe. */
  podeAvisar: boolean;
  onAvisar: () => void;
  onRelacionar: (l: LinhaRecebimento) => void;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [decisao, setDecisao] = React.useState<{
    linha: LinhaRecebimento;
    resolucao: "ACEITO" | "IGNORADO";
  } | null>(null);

  async function agir(id: string, fn: () => Promise<unknown>, msg: string) {
    setOcupado(id);
    try {
      await fn();
      toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para registrar", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-accent/30 bg-accent-soft/40">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <TriangleAlert className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="font-display text-[14px] font-semibold text-ink">
          {linhas.length === 1 ? "1 diferença encontrada" : `${linhas.length} diferenças encontradas`}
        </h2>
        {Math.abs(impactoCusto) > 0.005 && (
          <p className="text-[12px] text-muted">
            custo{" "}
            <span className={cn("font-mono", impactoCusto > 0 ? "text-danger" : "text-ok")}>
              {impactoCusto > 0 ? "+" : "−"}
              {fmtMoney(Math.abs(impactoCusto))}
            </span>{" "}
            sobre o negociado
          </p>
        )}
        {/* O desfecho de verdade acontece com o representante — o sistema só
            precisa entregar o texto pronto, com os números certos. */}
        {podeAvisar && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={onAvisar}>
            <Send className="h-3.5 w-3.5" aria-hidden />
            Avisar fornecedor
          </Button>
        )}
      </div>

      <ul className="divide-y divide-line border-t border-line bg-surface">
        {linhas.map((l) => {
          const v = variacaoDaLinha(l);
          return (
            // No celular a frase vem inteira em cima e os botões embaixo: lado
            // a lado, a descrição era espremida até virar "Dis…".
            <li
              key={l.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink sm:truncate">{nomeDe(l)}</p>
                <p className="text-[12px] text-muted sm:truncate">{explicacao(l, v, temNota)}</p>
              </div>

              {!bloqueado && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {l.status === "NAO_PEDIDO" && !l.productId ? (
                    // Sem produto, "Aceitar"/"Ignorar" só escondem a divergência
                    // daqui — a entrada trava do mesmo jeito lá na frente, exigindo
                    // relacionar. Melhor não oferecer um botão que não resolve nada.
                    <Button size="sm" variant="secondary" onClick={() => onRelacionar(l)}>
                      Relacionar produto
                    </Button>
                  ) : (
                    <>
                      {l.status === "PRECO_ALTERADO" && (
                        <Button
                          size="sm"
                          disabled={ocupado === l.id}
                          onClick={() =>
                            void agir(
                              l.id,
                              () => aceitarCustoAction({ receiptId, itemId: l.id }),
                              "Custo do pedido atualizado para o da nota.",
                            )
                          }
                        >
                          Aceitar novo custo
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={ocupado === l.id}
                        onClick={() => setDecisao({ linha: l, resolucao: "ACEITO" })}
                      >
                        Aceitar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ocupado === l.id}
                        onClick={() => setDecisao({ linha: l, resolucao: "IGNORADO" })}
                      >
                        Ignorar
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {decisao && (
        <SheetMotivoDivergencia
          linha={decisao.linha}
          temNota={temNota}
          resolucao={decisao.resolucao}
          salvando={ocupado === decisao.linha.id}
          onClose={() => setDecisao(null)}
          onConfirmar={(motivo) => {
            const alvo = decisao;
            setDecisao(null);
            void agir(
              alvo.linha.id,
              () =>
                resolverDivergenciaAction({
                  receiptId,
                  itemId: alvo.linha.id,
                  resolucao: alvo.resolucao,
                  motivo,
                }),
              alvo.resolucao === "ACEITO"
                ? "Divergência aceita como está na nota."
                : "Divergência ignorada — fica no histórico.",
            );
          }}
        />
      )}
    </div>
  );
}

// ── Avisar o fornecedor ─────────────────────────────────────

function SheetAvisarFornecedor({
  receiptId,
  onClose,
}: {
  receiptId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [dados, setDados] = React.useState<{
    texto: string;
    fornecedor: string;
    telefone: string | null;
    email: string | null;
    contatos: {
      id: string;
      nome: string;
      cargo: string | null;
      telefone: string | null;
      email: string | null;
      principal: boolean;
    }[];
  } | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState("");
  /**
   * Para quem vai. A reclamação é para o VENDEDOR — o telefone do cadastro
   * costuma ser o do faturamento, que é o que o XML traz. "cadastro" é o
   * telefone/e-mail do próprio fornecedor, quando não há contato.
   */
  const [destino, setDestino] = React.useState<string>("cadastro");
  const [enviando, setEnviando] = React.useState(false);

  // Carrega uma vez, ao montar. O texto vem do servidor porque ele tem os
  // números da nota, do pedido e da contagem — remontar isso no cliente
  // duplicaria a regra.
  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await resumoDivergenciasAction(receiptId);
        if (!vivo) return;
        setDados(r);
        setTexto(r.texto);
        // O principal primeiro; sem contato, o cadastro do fornecedor.
        setDestino(r.contatos[0]?.id ?? "cadastro");
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Falha ao montar o resumo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [receiptId]);

  const contato = dados?.contatos.find((c) => c.id === destino) ?? null;
  const telefone = contato ? contato.telefone : (dados?.telefone ?? null);
  const email = contato ? contato.email : (dados?.email ?? null);
  const nomeDestino = contato?.nome ?? dados?.fornecedor ?? null;

  const digitos = (telefone ?? "").replace(/\D/g, "");
  const zap =
    digitos.length >= 10
      ? `https://wa.me/${digitos.length <= 11 ? "55" : ""}${digitos}?text=${encodeURIComponent(texto)}`
      : null;

  async function enviarEmail() {
    if (!email) return;
    setEnviando(true);
    try {
      await enviarAvisoPorEmailAction({
        receiptId,
        email,
        nomeContato: nomeDestino,
        texto,
      });
      toast.success("E-mail enviado.", `Para ${nomeDestino ?? email}, com a planilha da conferência.`);
      onClose();
      router.refresh();
    } catch (e) {
      toast.error("Não deu para enviar", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="lg"
      title="Avisar o fornecedor"
      description={dados ? dados.fornecedor : "Montando o resumo da divergência…"}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(texto);
              toast.success("Resumo copiado.");
            }}
          >
            Copiar
          </Button>
          {zap && (
            <a href={zap} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                WhatsApp
              </Button>
            </a>
          )}
          <Button
            size="sm"
            onClick={() => void enviarEmail()}
            disabled={!email || enviando || texto.trim().length < 10}
            title={email ? `Enviar para ${email}, com a planilha anexada` : "Este contato não tem e-mail"}
          >
            {enviando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Mail className="h-3.5 w-3.5" aria-hidden />
            )}
            {enviando ? "Enviando…" : "Enviar por e-mail"}
          </Button>
        </div>
      }
    >
      {erro ? (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {erro}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {dados && (dados.contatos.length > 0 || dados.telefone || dados.email) && (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink">Para quem vai</legend>
              <div className="flex flex-wrap gap-1.5">
                {dados.contatos.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={destino === c.id}
                    onClick={() => setDestino(c.id)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start rounded-[var(--radius)] border px-3 py-1.5 text-left text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                      destino === c.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2",
                    )}
                  >
                    <span className="font-medium text-ink">
                      {c.nome}
                      {c.principal && <span className="ml-1 text-faint">· principal</span>}
                    </span>
                    <span className="text-muted">
                      {[c.cargo, c.telefone ? "WhatsApp" : null, c.email ? "e-mail" : null]
                        .filter(Boolean)
                        .join(" · ") || "sem telefone nem e-mail"}
                    </span>
                  </button>
                ))}
                {(dados.telefone || dados.email) && (
                  <button
                    type="button"
                    aria-pressed={destino === "cadastro"}
                    onClick={() => setDestino("cadastro")}
                    className={cn(
                      "flex cursor-pointer flex-col items-start rounded-[var(--radius)] border px-3 py-1.5 text-left text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                      destino === "cadastro" ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2",
                    )}
                  >
                    <span className="font-medium text-ink">Cadastro do fornecedor</span>
                    <span className="text-muted">costuma ser o faturamento</span>
                  </button>
                )}
              </div>
            </fieldset>
          )}

          <p className="text-[13px] text-muted">
            Revise antes de mandar — o texto sai com os números do papel e da contagem. Por
            e-mail, a planilha da conferência vai anexada.
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={12}
            className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 font-mono text-[12px] text-ink focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          {dados && !telefone && !email && (
            <p className="text-[12px] text-muted">
              {contato
                ? "Este contato não tem telefone nem e-mail — escolha outro ou copie o texto."
                : "Este fornecedor não tem telefone nem e-mail cadastrado — copie o texto e mande pelo canal que você usa com ele."}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ── Devolver ao fornecedor ──────────────────────────────────

/** Os motivos de devolução que a doca encontra — os mesmos do módulo de devoluções. */
const TIPOS_DEVOLUCAO = [
  { id: "AVARIA", rotulo: "Avaria" },
  { id: "VALIDADE", rotulo: "Validade" },
  { id: "DIVERGENCIA", rotulo: "Veio diferente" },
  { id: "RECUSA", rotulo: "Recusado" },
  { id: "OUTRO", rotulo: "Outro" },
] as const;

function SheetDevolver({
  receiptId,
  linha,
  onClose,
  onFeito,
}: {
  receiptId: string;
  linha: LinhaRecebimento;
  onClose: () => void;
  onFeito: () => void;
}) {
  /** O que esta linha pôs no estoque — o teto do que pode voltar. */
  const entrou = entrando(linha);
  // O excedente faturado é o palpite natural; sem ele, a pessoa diz quanto.
  const sugerida = Math.min(entrou, Math.max(0, linha.qtdFaturada - linha.qtdPedida));
  const [quantidade, setQuantidade] = React.useState(String(sugerida > 0 ? sugerida : ""));
  // O mesmo vocabulário de /estoque/devolucoes: a devolução nasce lá também.
  const [tipoMotivo, setTipoMotivo] = React.useState<(typeof TIPOS_DEVOLUCAO)[number]["id"]>(
    linha.validade ? "VALIDADE" : "AVARIA",
  );
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  const qtd = Number(quantidade.replace(",", "."));
  const qtdValida = Number.isInteger(qtd) && qtd > 0 && qtd <= entrou;
  const podeEnviar = qtdValida && motivo.trim().length >= 3 && !enviando;

  function enviar() {
    setEnviando(true);
    void (async () => {
      try {
        const r = await devolverDivergenciaAction({
          receiptId,
          itemId: linha.id,
          quantidade: qtd,
          tipoMotivo,
          motivo: motivo.trim(),
        });
        toast.success(
          `Devolução ${r.numero} registrada.`,
          r.abatido > 0.005
            ? `Saiu do estoque e ${fmtMoney(r.abatido)} foram abatidos do que se deve ao fornecedor.`
            : "Saiu do estoque. Não havia título em aberto para abater — trate o crédito com o fornecedor.",
        );
        onFeito();
      } catch (e) {
        toast.error("Não deu para devolver", e instanceof Error ? e.message : "Tente de novo.");
        setEnviando(false);
      }
    })();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title="Devolver ao fornecedor"
      description={nomeDe(linha)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" disabled={!podeEnviar} onClick={enviar}>
            <Undo2 className="h-4 w-4" aria-hidden />
            {enviando ? "Registrando…" : "Registrar devolução"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-[var(--radius)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
          Vira uma devolução com número (a mesma de Estoque → Devoluções): sai do estoque pelo
          custo com que entrou e abate o que se deve ao fornecedor. Só para mercadoria que já
          entrou — o que ainda não entrou se resolve na conferência.
        </p>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-ink">Por que está voltando?</legend>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS_DEVOLUCAO.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tipoMotivo === t.id}
                onClick={() => setTipoMotivo(t.id)}
                className={cn(
                  "h-8 cursor-pointer rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  tipoMotivo === t.id
                    ? "border-brand bg-brand-soft text-ink"
                    : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2",
                )}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        <Campo label="Quantidade devolvida (UN)">
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min={1}
            max={entrou}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            placeholder={sugerida > 0 ? fmtQtd(sugerida) : "0"}
            aria-describedby="devolucao-teto"
            className="h-10 w-32 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </Campo>
        <p
          id="devolucao-teto"
          className={cn("-mt-2 text-[12px]", quantidade && !qtdValida ? "text-danger" : "text-muted")}
        >
          {quantidade && !qtdValida
            ? `Use um número inteiro de 1 a ${fmtQtd(entrou)} — foi o que entrou por esta linha.`
            : `Entraram ${fmtQtd(entrou)} UN por esta linha.`}
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            Motivo <span className="text-muted">(obrigatório)</span>
          </span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={240}
            placeholder="Ex.: 2 caixas avariadas, recolhidas pelo motorista."
            className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </label>
      </div>
    </Sheet>
  );
}

// ── Motivo da divergência ───────────────────────────────────
// Divergência sem motivo vira discussão com o fornecedor sem prova. O motivo
// é obrigatório justamente aqui, onde alguém ainda lembra o que aconteceu na
// porta — não no dia da cobrança.

const MOTIVOS_DIVERGENCIA = [
  { id: "FALTOU", label: "Faltou produto" },
  { id: "AVARIA", label: "Avaria no transporte" },
  { id: "RECUSADO", label: "Produto recusado" },
  { id: "QUANTIDADE", label: "Quantidade diferente" },
  { id: "PRECO", label: "Preço diferente do combinado" },
  { id: "OUTRO", label: "Outro" },
] as const;

function SheetMotivoDivergencia({
  linha,
  temNota,
  resolucao,
  salvando,
  onClose,
  onConfirmar,
}: {
  linha: LinhaRecebimento;
  temNota: boolean;
  resolucao: "ACEITO" | "IGNORADO";
  salvando: boolean;
  onClose: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState<string>(sugestaoDeMotivo(linha.status));
  const [observacao, setObservacao] = React.useState("");

  const rotulo = MOTIVOS_DIVERGENCIA.find((m) => m.id === motivo)?.label ?? "Outro";
  const texto = observacao.trim();
  const podeConfirmar = texto.length >= 3 && !salvando;

  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title={resolucao === "ACEITO" ? "Aceitar divergência" : "Ignorar divergência"}
      description={nomeDe(linha)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!podeConfirmar}
            onClick={() => onConfirmar(`${rotulo}: ${texto}`)}
          >
            {salvando ? "Registrando…" : "Registrar decisão"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-[var(--radius)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
          {explicacao(linha, variacaoDaLinha(linha), temNota)}
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink">O que aconteceu?</legend>
          {MOTIVOS_DIVERGENCIA.map((m) => (
            <label
              key={m.id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px] transition-colors",
                motivo === m.id ? "border-brand bg-brand-soft text-ink" : "border-line hover:bg-surface-2",
              )}
            >
              <input
                type="radio"
                name="motivo-divergencia"
                className="accent-[var(--brand)]"
                checked={motivo === m.id}
                onChange={() => setMotivo(m.id)}
              />
              {m.label}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            Observação <span className="text-muted">(obrigatória)</span>
          </span>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder="Ex.: 2 caixas chegaram amassadas, motorista levou de volta."
            className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          <span className="text-[12px] text-muted">
            Fica no histórico do recebimento, com seu nome e a hora.
          </span>
        </label>
      </div>
    </Sheet>
  );
}

/** Chute do motivo pelo tipo da divergência — quase sempre acerta. */
function sugestaoDeMotivo(status: ReconciliationStatus): string {
  switch (status) {
    case "FALTANDO":
    case "NAO_FATURADO":
      return "FALTOU";
    case "EXCEDENTE":
    case "NAO_PEDIDO":
      return "QUANTIDADE";
    case "PRECO_ALTERADO":
      return "PRECO";
    default:
      return "OUTRO";
  }
}

function explicacao(l: LinhaRecebimento, v: number | null, temNota: boolean): string {
  const falta = Math.abs(l.qtdPedida - l.qtdFaturada);
  switch (l.status) {
    case "FALTANDO":
      return `Pedido ${fmtQtd(l.qtdPedida)} · faturado ${fmtQtd(l.qtdFaturada)} — faltam ${fmtQtd(falta)}.`;
    case "EXCEDENTE":
      return `Pedido ${fmtQtd(l.qtdPedida)} · faturado ${fmtQtd(l.qtdFaturada)} — ${fmtQtd(falta)} a mais.`;
    case "NAO_FATURADO":
      return `Estava no pedido (${fmtQtd(l.qtdPedida)}) e não veio nesta nota — sem contagem, não entra no estoque.`;
    case "NAO_PEDIDO":
      // A linha acrescentada na doca não "veio na nota": chegou fora dela.
      return l.avulsa
        ? `Chegou fora ${temNota ? "da nota" : "do pedido"} — ${fmtQtd(l.qtdRecebida ?? 0)} acrescentado(s) na conferência.`
        : `Veio na nota (${fmtQtd(l.qtdFaturada)}) sem estar no pedido.`;
    case "PRECO_ALTERADO":
      return `Negociado ${fmtMoney(l.custoPedido)} · faturado ${fmtMoney(l.custoFaturado)}${
        v ? ` (${pct(v)})` : ""
      }.`;
    default:
      return "";
  }
}

// ── Adicionar item ──────────────────────────────────────────
//
// Uma linha que ninguém esperava: o excedente do caminhão, ou — no recebimento
// avulso — TODAS as linhas, já que ele nasce vazio de propósito (não há pedido
// nem nota de onde tirá-las).
//
// A quantidade é digitada na unidade de COMPRA (caixa, fardo) porque é assim
// que a mercadoria chega empilhada; o servidor converte para peça com o fator
// do cadastro. Digitar 3 quando chegaram 3 caixas de 12 é o erro que a
// conferência inteira herda.

function AdicionarItem({
  receiptId,
  inicial,
  onClose,
  onPronto,
}: {
  receiptId: string;
  /** Já veio do bipe: o produto está escolhido, falta a quantidade. */
  inicial: { produto: ProdutoRecebimento; packagingId: string | null } | null;
  onClose: () => void;
  onPronto: () => void;
}) {
  const [termo, setTermo] = React.useState("");
  /**
   * O resultado carrega o TERMO que o produziu. É o que deixa "procurando…"
   * ser derivado (`o termo mudou e a resposta ainda é do anterior`) em vez de
   * um segundo estado ligado e desligado à mão — dois booleanos para o mesmo
   * fato acabam discordando.
   */
  const [resultado, setResultado] = React.useState<{
    q: string;
    itens: ProdutoRecebimento[];
  }>({ q: "", itens: [] });
  const [escolhido, setEscolhido] = React.useState<ProdutoRecebimento | null>(
    inicial?.produto ?? null,
  );
  /**
   * Embalagem escolhida À MÃO. Nula = vale a de compra padrão do cadastro,
   * derivada abaixo — guardar o padrão no estado obrigaria um efeito para
   * corrigi-lo a cada troca de produto, e efeito que só ajusta estado é
   * render a mais sem informação nova.
   */
  const [packagingManual, setPackagingManual] = React.useState<
    { id: string | null } | null
  >(inicial ? { id: inicial.packagingId } : null);
  const [quantidade, setQuantidade] = React.useState("");
  /**
   * Custo digitado À MÃO. Nulo = vale o custo médio do produto na embalagem
   * escolhida, derivado abaixo — quem confere na porta raramente sabe o preço,
   * e o campo vazio fazia o item entrar a R$ 0, puxando o custo médio para
   * baixo sem ninguém ter ganhado nada.
   */
  const [custoDigitado, setCustoDigitado] = React.useState<string | null>(null);
  const [lote, setLote] = React.useState("");
  const [validade, setValidade] = React.useState("");
  const [bonificacao, setBonificacao] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  // Busca com folga: a doca digita devagar e uma consulta por tecla derrubaria
  // o banco para mostrar resultado de "ce", "cer", "cerv".
  const buscavel = !escolhido && termo.trim().length >= 2;
  React.useEffect(() => {
    if (!buscavel) return;
    const q = termo.trim();
    const t = setTimeout(() => {
      buscarProdutosRecebimentoAction(q).then((itens) => setResultado({ q, itens }));
    }, 250);
    return () => clearTimeout(t);
  }, [termo, buscavel]);

  // Tudo derivado: com produto já escolhido (ou termo curto) não há resultado a
  // mostrar, e limpar o estado por efeito só adicionaria um render.
  const buscando = buscavel && resultado.q !== termo.trim();
  const visiveis = buscavel && resultado.q === termo.trim() ? resultado.itens : [];

  // Embalagem de compra padrão já vem escolhida: na porta, o que se digita é a
  // quantidade.
  const packagingId =
    packagingManual?.id ??
    escolhido?.packagings.find((e) => e.isCompraDefault)?.id ??
    null;
  const setPackagingId = (id: string | null) => setPackagingManual({ id });

  const pacote = escolhido?.packagings.find((e) => e.id === packagingId) ?? null;
  const fator = pacote?.fatorConversao ?? 1;
  const qtd = Number(quantidade.replace(",", "."));
  /** Custo médio da unidade × fator da embalagem: o "quanto custou da última vez". */
  const custoSugerido =
    escolhido?.custoMedio && escolhido.custoMedio > 0
      ? (escolhido.custoMedio * fator).toFixed(2).replace(".", ",")
      : "";
  const custo = custoDigitado ?? custoSugerido;
  const custoNum = custo.trim() === "" ? 0 : Number(custo.replace(",", "."));
  // Peça inteira: a embalagem é inteira e o estoque não guarda meia garrafa.
  const qtdValida = Number.isInteger(qtd) && qtd > 0;
  const custoValido = bonificacao || (Number.isFinite(custoNum) && custoNum > 0);
  const podeEnviar = Boolean(escolhido) && qtdValida && custoValido && !enviando;

  async function enviar() {
    if (!escolhido) return;
    setEnviando(true);
    try {
      await adicionarItemAction({
        receiptId,
        productId: escolhido.id,
        packagingId,
        quantidade: qtd,
        custoUnitario: bonificacao ? 0 : custoNum,
        lote: lote.trim() || null,
        validade: validade || null,
        bonificacao,
        motivo: motivo.trim() || null,
      });
      toast.success(escolhido.nome, `${fmtQtd(qtd * fator)} adicionadas ao recebimento.`);
      onPronto();
    } catch (e) {
      toast.error("Não deu para adicionar", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Adicionar item"
      description="Produto que chegou e não estava na lista. Ele entra como linha própria — a diferença fica visível."
      width="lg"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} disabled={!podeEnviar} className="flex-1">
            {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Adicionar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!escolhido ? (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                autoFocus
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Nome, SKU ou código de barras"
                aria-label="Buscar produto no catálogo"
                className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>

            {buscando && (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Procurando…
              </p>
            )}

            {!buscando && buscavel && visiveis.length === 0 && (
              <p className="rounded-[var(--radius)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                Nenhum produto com “{termo.trim()}”. Cadastre-o antes de receber — mercadoria sem
                cadastro é rastro perdido.
              </p>
            )}

            <ul className="flex flex-col gap-1.5">
              {visiveis.map((prod) => (
                <li key={prod.id}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(prod)}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <ProdutoThumb url={prod.imagemUrl} nome={prod.nome} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {prod.nome}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted">
                        {prod.sku}
                        {prod.custoMedio != null && (
                          <span className="font-sans text-faint">
                            {" · custo médio "}
                            {fmtMoney(prod.custoMedio)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-3 py-2.5">
              <ProdutoThumb url={escolhido.imagemUrl} nome={escolhido.nome} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{escolhido.nome}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{escolhido.sku}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setEscolhido(null);
                  setPackagingManual(null);
                  setCustoDigitado(null);
                }}
                className="shrink-0 text-xs font-medium text-muted hover:text-ink"
              >
                Trocar
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {escolhido.packagings.length > 0 && (
                <Campo label="Embalagem">
                  <select
                    value={packagingId ?? ""}
                    onChange={(e) => {
                      setPackagingId(e.target.value || null);
                      // O custo sugerido acompanha a embalagem; o digitado
                      // valia para a outra.
                      setCustoDigitado(null);
                    }}
                    className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  >
                    <option value="">Unidade</option>
                    {escolhido.packagings.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome} ({e.fatorConversao}x)
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              <Campo label="Quantidade">
                <input
                  autoFocus
                  inputMode="numeric"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="0"
                  aria-invalid={quantidade !== "" && !qtdValida}
                  className="h-10 w-24 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-center text-sm tabular-nums text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none aria-invalid:border-danger"
                />
              </Campo>
              {!bonificacao && (
                <Campo label={`Custo por ${pacote?.nome ?? "unidade"} (R$)`}>
                  <input
                    inputMode="decimal"
                    value={custo}
                    onChange={(e) => setCustoDigitado(e.target.value)}
                    placeholder="0,00"
                    aria-invalid={custo !== "" && !custoValido}
                    className="h-10 w-28 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-right text-sm tabular-nums text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none aria-invalid:border-danger"
                  />
                </Campo>
              )}
            </div>

            {/* Uma linha só de ajuda, a que importa agora: a conta do estoque,
                de onde veio o custo, ou o que falta para poder adicionar. */}
            <p className="text-[12px] text-muted">
              {quantidade !== "" && !qtdValida ? (
                <span className="text-danger">
                  Quantidade em número inteiro — o estoque conta peças.
                </span>
              ) : !bonificacao && !custoValido ? (
                "Informe quanto custou — sem custo, o item puxaria o custo médio para baixo. Se veio de graça, marque bonificação."
              ) : (
                <>
                  {qtdValida && fator !== 1 && (
                    <>
                      Entram <span className="font-mono text-ink-2">{fmtQtd(qtd * fator)}</span>{" "}
                      unidades no estoque.{" "}
                    </>
                  )}
                  {!bonificacao && custoDigitado == null && custoSugerido && (
                    <>Custo sugerido pelo custo médio do produto — corrija se a nota disser outro.</>
                  )}
                </>
              )}
            </p>

            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={bonificacao}
                onChange={(e) => setBonificacao(e.target.checked)}
                className="h-4 w-4 rounded border-line-button"
              />
              Bonificação — entra no estoque sem custo
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <Campo label="Lote">
                <input
                  value={lote}
                  onChange={(e) => setLote(e.target.value)}
                  placeholder="opcional"
                  className="h-10 w-36 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>
              <Campo label="Validade">
                <input
                  type="date"
                  value={validade}
                  onChange={(e) => setValidade(e.target.value)}
                  className="h-10 w-40 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>
            </div>

            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                Por que este item entrou? <span className="font-normal text-faint">(opcional)</span>
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: veio a mais, o vendedor mandou junto."
                className="h-10 w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ── Linha da conferência ────────────────────────────────────

/**
 * A conferência conta UNIDADE de estoque — garrafa, lata, maço —, nunca a
 * embalagem do papel: quem está na doca conta maço, não milheiro. A embalagem
 * que a nota faturou aparece embaixo da quantidade, para quem confere contra o
 * papel achar o número dele.
 */
const UNIDADE_CONFERENCIA = "UN";

/** Colunas que só aparecem com espaço: no celular a doca vê o essencial. */
const COLUNA_LARGA = "hidden @[54rem]:table-cell";

/**
 * Uma linha da nota, lida da esquerda para a direita: o que chegou (como o
 * fornecedor escreveu), o que isso é no NoHub, quanto a nota diz, quanto a
 * doca contou, a diferença — e quanto isso custa.
 *
 * O que o operador digita aqui é só o que a conferência física revela:
 * quantidade e, de vez em quando, lote e validade (no "⋮", que abre embaixo
 * da linha).
 */
const LinhaConferencia = React.forwardRef<
  HTMLTableRowElement,
  {
    linha: LinhaRecebimento;
    /** Em que se conta esta linha: na embalagem da nota (padrão) ou na unidade. */
    regua: Regua;
    /** true = contar por unidade (a exceção); false = voltar à embalagem. */
    onRegua: (unidade: boolean) => void;
    /** Número da linha no documento — o mesmo com ou sem filtro. */
    numero: number;
    situacao: Situacao;
    /** Há NF-e: o esperado é "da nota"; sem ela, do pedido. */
    temNota: boolean;
    /**
     * Linha do avulso puro: não havia papel nenhum dizendo quanto viria. Sem
     * esperado, não há diferença — "+6" em toda linha seria ruído.
     */
    semEsperado: boolean;
    /** SKU ligado nas configurações de produto. */
    mostrarSku: boolean;
    bloqueado: boolean;
    /** Esconde o esperado enquanto a linha não foi contada. */
    cega: boolean;
    /** Acabou de receber um bipe — destaca por um instante. */
    piscando: boolean;
    /** Gravando esta linha agora, ou acabou de gravar. */
    salvamento: EstadoSalvamento | null;
    /** A validade digitada já venceu, ou vence dentro do alerta da loja. */
    validade: AvisoValidade;
    /** Só depois da entrada: devolver ao fornecedor o que voltou no caminhão. */
    onDevolver?: () => void;
    onAlterar: (patch: {
      qtdRecebida?: number | null;
      lote?: string | null;
      validade?: string | null;
      /** Lista vazia = volta a um lote só. */
      lotes?: LoteDaLinha[] | null;
    }) => void;
    onRelacionar: () => void;
    /** Código de barras que o leitor digitou dentro do campo de quantidade. */
    onBipe: (codigo: string) => void;
    /** Só nas linhas avulsas — o que veio do pedido/nota se zera, não some. */
    onRemover?: () => void;
  }
>(function LinhaConferencia(
  {
    linha,
    regua,
    onRegua,
    numero,
    situacao,
    temNota,
    semEsperado,
    mostrarSku,
    bloqueado,
    cega,
    piscando,
    salvamento,
    validade,
    onDevolver,
    onAlterar,
    onRelacionar,
    onBipe,
    onRemover,
  },
  ref,
) {
  const [detalhe, setDetalhe] = React.useState(false);
  const recebido = linha.qtdRecebida;
  /** Contou? Então pode ver. Antes disso, o número da nota enviesa a contagem. */
  const oculto = cega && recebido == null && !bloqueado;
  const esperado = esperadoDe(linha);
  const diferenca = recebido == null || semEsperado ? null : recebido - esperado;
  const v = variacaoDaLinha(linha);
  const ui = SITUACAO_UI[situacao];
  const porque = porqueDaSituacao(linha, situacao, temNota);
  const custo = linha.bonificacao ? 0 : linha.custoFaturado;
  /**
   * A nota faturou numa embalagem que não é a da prateleira (MI, CX, FD). O
   * número do papel é outro, e sem ele à vista a pessoa procura "1 CX" na tela
   * e não acha. O XML não muda — o convertido é que é derivado dele.
   */
  const doXml =
    linha.xml && linha.xml.fatorConversao !== 1
      ? { ...linha.xml, sigla: siglaDeExibicao(linha.xml.unidade) }
      : null;
  /** Contando na embalagem da nota: o que se digita e se lê é caixa, não unidade. */
  const naEmbalagem = regua.modo === "EMB" && regua.fator != null;
  const sigla = siglaDaRegua(regua);
  const emb = nomeDaEmbalagem(regua.sigla).toLowerCase();
  const temDetalhe = Boolean(
    linha.lote || linha.validade || linha.lotes?.length || linha.motivoDivergencia,
  );
  const resumoLote = resumoDoLote(linha);
  /** Lote e validade, ou a linha dividida em lotes — o que o detalhe edita. */
  const [emLotes, setEmLotes] = React.useState(Boolean(linha.lotes?.length));
  // "Igual à nota" não existe para a linha acrescentada na doca: o papel diz
  // zero para ela, e o atalho zeraria o que alguém acabou de contar.
  const podeIgualar = !bloqueado && !cega && !linha.avulsa;
  const temMenu =
    podeIgualar || !bloqueado || temDetalhe || Boolean(onRemover) || Boolean(onDevolver);
  /** "vencida há 3 dias" / "vence em 5 dias" — a frase do selo de validade. */
  const fraseValidade = !validade
    ? null
    : validade.tipo === "VENCIDO"
      ? `vencida há ${validade.dias} ${validade.dias === 1 ? "dia" : "dias"}`
      : validade.dias === 0
        ? "vence hoje"
        : `vence em ${validade.dias} ${validade.dias === 1 ? "dia" : "dias"}`;

  return (
    <>
      <tr
        ref={ref}
        className={cn(
          "border-t border-line bg-surface align-middle transition-colors first:border-t-0 hover:bg-surface-2",
          // O bipe acerta a linha certa; o destaque é o que prova isso a quem
          // está de pé, com a caixa na mão, longe da tela.
          piscando && "bg-ok-soft hover:bg-ok-soft motion-reduce:transition-none",
        )}
      >
        <td className="py-2 pr-2 pl-3 font-semibold text-ink tabular-nums sm:pl-4">{numero}</td>

        <td className={cn(COLUNA_LARGA, "py-2 pr-1 pl-2")}>
          <ProdutoThumb url={linha.imagemUrl} nome={linha.produtoNome ?? linha.descricao} size="sm" />
        </td>

        {/* ── O que chegou ─────────────────────────────────── */}
        <td className="max-w-[15rem] px-2 py-2">
          <p className="leading-snug font-medium text-ink">{linha.descricao}</p>
          <p className="font-mono text-[10px] text-faint">
            {linha.codigoFornecedor ?? (linha.avulsa ? "adicionado na conferência" : "sem código")}
          </p>
          {linha.bonificacao && (
            <span className="mt-1 inline-block">
              <Badge tone="accent">
                <Gift size={11} /> bonificação
              </Badge>
            </span>
          )}
          {(resumoLote || fraseValidade) && (
            <p className="mt-0.5 text-[10px] text-muted">
              {resumoLote}
              {/* Vencido na porta é a hora de devolver ao motorista — não o
                  inventário do mês que vem. Avisa; quem decide é a doca. */}
              {fraseValidade && validade && (
                <span
                  className={cn(
                    "ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
                    validade.tipo === "VENCIDO"
                      ? "bg-danger-soft text-danger"
                      : "bg-warn-soft text-warn",
                  )}
                >
                  <CalendarClock size={10} aria-hidden />
                  {fraseValidade}
                </span>
              )}
            </p>
          )}
        </td>

        {/* ── O que isso é no NoHub ─────────────────────────── */}
        <td className={cn(COLUNA_LARGA, "max-w-[14rem] px-2 py-2")}>
          {linha.productId ? (
            <>
              <p className="leading-snug font-medium text-ink">{linha.produtoNome}</p>
              {(mostrarSku ? linha.sku : null) || linha.ean ? (
                <p className="font-mono text-[10px] text-faint">
                  {[mostrarSku ? linha.sku : null, linha.ean].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </>
          ) : bloqueado ? (
            <span className="text-faint">Sem produto</span>
          ) : (
            <button
              type="button"
              onClick={onRelacionar}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full font-medium text-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Link2 size={12} aria-hidden />
              Relacionar produto
            </button>
          )}
        </td>

        <td className={cn(COLUNA_LARGA, "px-2 py-2 text-center font-medium text-ink-2")}>
          {regua.fator && !bloqueado ? (
            // As duas réguas lado a lado: a da nota é o padrão, a unidade é a
            // exceção de um item só. O número salvo não muda ao trocar.
            <div
              role="group"
              aria-label={`Contar ${nomeDe(linha)} em`}
              className="inline-flex rounded-full border border-line-strong bg-surface p-0.5"
            >
              {(
                [
                  { unidade: false, rotulo: regua.sigla, dica: `Contar em ${emb} (como a nota)` },
                  { unidade: true, rotulo: UNIDADE_CONFERENCIA, dica: "Contar por unidade" },
                ] as const
              ).map((o) => {
                const ativo = (regua.modo === "UN") === o.unidade;
                // Contagem que já não fecha em caixas inteiras só cabe na
                // unidade: voltar para a caixa mostraria "1,5 CX".
                const travado = !o.unidade && regua.forcado;
                return (
                  <button
                    key={o.rotulo}
                    type="button"
                    aria-pressed={ativo}
                    disabled={travado}
                    title={
                      travado
                        ? `A contagem (${fmtQtd(recebido ?? 0)} ${UNIDADE_CONFERENCIA}) não fecha em ${emb}s inteiras de ${fmtQtd(regua.fator ?? 1)}.`
                        : o.dica
                    }
                    onClick={() => onRegua(o.unidade)}
                    className={cn(
                      "h-6 min-w-9 cursor-pointer rounded-full px-2 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
                      ativo ? "bg-brand text-on-brand" : "text-muted enabled:hover:text-ink",
                    )}
                  >
                    {o.rotulo}
                  </button>
                );
              })}
            </div>
          ) : (
            <span title={naEmbalagem ? rotuloDaUnidade(regua.sigla) : "Unidade de estoque"}>
              {sigla}
            </span>
          )}
        </td>

        {/* ── Quanto a nota diz ─────────────────────────────── */}
        <td className="px-2 py-2 text-center whitespace-nowrap">
          {semEsperado ? (
            <span className="text-faint" title="Sem pedido e sem nota: não havia quantidade esperada.">
              —
            </span>
          ) : oculto ? (
            <span className="text-faint" title="Conferência cega: aparece depois que você contar">
              •••
            </span>
          ) : (
            // O número que se compara com a contagem vem em destaque, do mesmo
            // tamanho do campo ao lado; embaixo, de onde ele saiu no papel —
            // "1 CX c/ 24" diz por que a nota de uma caixa espera 24.
            naEmbalagem ? (
              // Na régua da nota o número é o do papel — "1 CX" — e embaixo,
              // quanto isso vira no estoque.
              <>
                <p className="text-[13px] font-semibold text-ink tabular-nums">
                  {fmtQtd(naRegua(esperado, regua))}{" "}
                  <span className="text-[11px] font-medium text-muted">{sigla}</span>
                </p>
                <p
                  className="text-[10px] whitespace-nowrap text-muted"
                  title={`${frasesDeConversao(regua.sigla, regua.fator ?? 1)}.`}
                >
                  = {fmtQtd(esperado)} {UNIDADE_CONFERENCIA}
                </p>
              </>
            ) : (
            <>
              <p className="text-[13px] font-semibold text-ink tabular-nums">{fmtQtd(esperado)}</p>
              {doXml && (
                <p
                  className="text-[10px] whitespace-nowrap text-muted"
                  title={`A nota fatura em ${rotuloDaUnidade(doXml.unidade)}. ${frasesDeConversao(doXml.sigla, doXml.fatorConversao)} — ${fmtQtd(doXml.quantidade)} ${doXml.sigla} valem ${fmtQtd(doXml.quantidade * doXml.fatorConversao)} ${UNIDADE_CONFERENCIA}.`}
                >
                  {fmtQtd(doXml.quantidade)} {doXml.sigla} c/ {fmtQtd(doXml.fatorConversao)}
                </p>
              )}
            </>
            )
          )}
        </td>

        {/* ── Quanto a doca contou ──────────────────────────── */}
        <td className="px-2 py-1.5 text-center">
          {bloqueado ? (
            <span className="font-medium text-ink tabular-nums">
              {recebido == null ? (
                <span className="text-faint">—</span>
              ) : (
                <>
                  {fmtQtd(naRegua(recebido, regua))}
                  {naEmbalagem && <span className="ml-1 text-[11px] text-muted">{sigla}</span>}
                </>
              )}
            </span>
          ) : (
            <div className="inline-flex flex-col items-center gap-0.5">
            <input
              // `key` amarrado ao valor do servidor E à régua: o campo é não
              // controlado (para não brigar com a digitação), e sem remontar
              // ele ficava exibindo 12 depois de o bipe somar 13 — ou "24"
              // depois de a pessoa trocar para contar em caixa.
              key={`${linha.id}:${recebido ?? "-"}:${regua.modo}`}
              type="number"
              // Peça inteira, sempre: o saldo conta garrafa, não meia garrafa.
              // Aceitar decimal aqui só empurraria o erro para a hora de
              // receber, quando a nota inteira trava.
              inputMode="numeric"
              step="1"
              min={0}
              // Sem número sugerido: o campo nasce vazio e só se enche com o
              // que alguém contou. Um "24" cinza dentro dele passava por
              // contado — e era justamente o número que a pessoa não conferiu.
              defaultValue={recebido == null ? "" : naRegua(recebido, regua)}
              data-contagem
              aria-label={
                naEmbalagem
                  ? `Quantidade recebida de ${nomeDe(linha)}, em ${emb}s inteiras de ${fmtQtd(regua.fator ?? 1)}`
                  : `Quantidade recebida de ${nomeDe(linha)}, em unidades inteiras`
              }
              onBlur={(e) => {
                const bruto = e.target.value.trim();
                const mostrado = recebido == null ? "" : String(naRegua(recebido, regua));
                // O cursor mora neste campo, e o leitor USB "digita" onde o
                // cursor está: oito dígitos ou mais não são quantidade, são um
                // código de barras. Volta o campo e trata como bipe.
                if (/^\d{8,}$/.test(bruto)) {
                  e.target.value = mostrado;
                  onBipe(bruto);
                  return;
                }
                const digitado = bruto === "" ? null : Math.round(Number(bruto));
                // O campo devolve o inteiro para a tela não ficar mostrando
                // "1,5" que o servidor nunca vai gravar.
                if (digitado != null && String(digitado) !== bruto) e.target.value = String(digitado);
                // Digitou caixas; o banco guarda unidades. 2 CX de 24 = 48.
                const novo =
                  digitado != null && naEmbalagem ? digitado * (regua.fator ?? 1) : digitado;
                if (novo === recebido) return;
                onAlterar({ qtdRecebida: novo });
              }}
              onKeyDown={(e) => {
                // Enter fecha a linha e devolve o teclado ao leitor: contar
                // quarenta itens é digitar, tab, digitar — não mirar botão.
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-8 w-14 [appearance:textfield] rounded-[var(--radius)] border border-line-strong bg-surface px-2 text-center text-[13px] font-semibold text-ink tabular-nums focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none @[54rem]:w-16 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {/* Sem a coluna Unidade (celular), a régua fica colada no campo —
                "2" sozinho não diz se é caixa ou garrafa. */}
            {regua.fator && (
              <span className="text-[10px] font-medium text-muted @[54rem]:hidden">{sigla}</span>
            )}
            {/* Contou em caixa: o quanto isso vira no estoque, à vista. */}
            {naEmbalagem && recebido != null && (
              <span className="hidden text-[10px] text-faint tabular-nums @[54rem]:inline">
                = {fmtQtd(recebido)} {UNIDADE_CONFERENCIA}
              </span>
            )}
            </div>
          )}
        </td>

        {/* ── A diferença ───────────────────────────────────── */}
        <td className="hidden px-2 py-2 text-center tabular-nums @[30rem]:table-cell">
          {diferenca == null ? (
            <span className="text-faint">—</span>
          ) : Math.abs(diferenca) < 0.001 ? (
            <span className="text-ink-2">0</span>
          ) : (
            <span className={cn("font-semibold", diferenca < 0 ? "text-danger" : "text-accent")}>
              {diferenca > 0 ? "+" : "−"}
              {fmtQtd(Math.abs(naRegua(diferenca, regua)))}
              {naEmbalagem && <span className="ml-0.5 text-[10px] font-medium">{sigla}</span>}
            </span>
          )}
        </td>

        {/* ── Em que pé está ────────────────────────────────── */}
        {/* Enquanto grava, o selo dá lugar ao do salvamento: são a mesma
            informação em momentos diferentes — a situação da linha só vale
            depois que o servidor confirmou o número novo. No celular sobra
            o ícone; a frase inteira fica no hover e no leitor de tela.
            `not-sr-only` devolve `white-space: normal` — sem o nowrap forçado,
            o selo quebrava em "A / conferir" e dobrava a altura da linha. */}
        <td className="px-2 py-2">
          {salvamento ? (
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium whitespace-nowrap",
                salvamento === "salvando" ? "bg-brand-soft text-accent" : "bg-ok-soft text-ok",
              )}
            >
              {salvamento === "salvando" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="sr-only @[54rem]:not-sr-only @[54rem]:whitespace-nowrap!">
                {salvamento === "salvando" ? "Salvando…" : "Salvo"}
              </span>
            </span>
          ) : (
            <span
              title={porque}
              className={cn(
                "inline-flex cursor-help items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium whitespace-nowrap",
                ui.selo,
              )}
            >
              <ui.Icone className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only @[54rem]:not-sr-only @[54rem]:whitespace-nowrap!">{ui.rotulo}</span>
              <span className="sr-only">: {porque}</span>
            </span>
          )}
        </td>

        {/* ── Quanto custa ──────────────────────────────────── */}
        <td className={cn(COLUNA_LARGA, "px-2 py-2 text-right whitespace-nowrap")}>
          {linha.bonificacao ? (
            <span className="text-muted">sem custo</span>
          ) : (
            <>
              <p className="font-mono text-ink">{fmtValor(custo)}</p>
              {v != null && !oculto && (
                <p
                  className={cn("font-mono text-[10px]", v > 0 ? "text-danger" : "text-ok")}
                  title={`Negociado no pedido: ${fmtMoney(linha.custoPedido)}`}
                >
                  {pct(v)}
                </p>
              )}
            </>
          )}
        </td>

        {/* Total do que foi CONTADO. Sem contagem, nada — um valor ali
            passaria por recebido, como o número sugerido no campo passava. */}
        <td className={cn(COLUNA_LARGA, "px-2 py-2 text-right whitespace-nowrap")}>
          {recebido == null ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="font-mono text-ink">{fmtValor(custo * recebido)}</span>
          )}
        </td>

        <td className="py-2 pr-2 pl-1 text-right sm:pr-3">
          {temMenu && (
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
              {/* "Igual à nota" é o caso de 90% das linhas: um toque, sem
                  digitar o número que já está na tela ao lado. */}
              {podeIgualar && (
                <MenuItem icon={<Check size={15} />} onClick={() => onAlterar({ qtdRecebida: esperado })}>
                  Recebi {fmtQtd(naRegua(esperado, regua))} {sigla}, igual{" "}
                  {temNota ? "à nota" : "ao pedido"}
                </MenuItem>
              )}
              {/* A troca de régua também mora aqui: no celular a coluna
                  Unidade, onde fica o botão, some. */}
              {regua.fator && !bloqueado && (
                <MenuItem
                  icon={<ArrowRightLeft size={15} />}
                  disabled={regua.modo === "UN" && regua.forcado}
                  onClick={() => onRegua(regua.modo === "EMB")}
                >
                  {regua.modo === "EMB"
                    ? "Contar por unidade"
                    : `Contar em ${emb} (${fmtQtd(regua.fator)} ${UNIDADE_CONFERENCIA})`}
                </MenuItem>
              )}
              {(!bloqueado || temDetalhe) && (
                <MenuItem icon={<CalendarClock size={15} />} onClick={() => setDetalhe((d) => !d)}>
                  {detalhe ? "Fechar lote e validade" : linha.lotes?.length ? "Lotes e validades" : "Lote e validade"}
                </MenuItem>
              )}
              {!bloqueado && !linha.productId && (
                <MenuItem icon={<Link2 size={15} />} onClick={onRelacionar}>
                  Relacionar produto
                </MenuItem>
              )}
              {onRemover && (
                <MenuItem icon={<Trash2 size={15} />} danger onClick={onRemover}>
                  Remover do recebimento
                </MenuItem>
              )}
              {onDevolver && (
                <MenuItem icon={<Undo2 size={15} />} onClick={onDevolver}>
                  Devolver ao fornecedor
                </MenuItem>
              )}
            </Menu>
          )}
        </td>
      </tr>

      {/* Lote e validade abrem embaixo da linha: precisam de mais largura do
          que uma célula tem, e só se preenchem de vez em quando. */}
      {detalhe && (
        <tr className="border-t border-line bg-surface-2/60">
          <td colSpan={12} className="px-4 py-3 sm:px-6">
            {bloqueado ? (
              linha.lotes?.length ? (
                <ul className="flex flex-col gap-0.5 text-[13px] text-muted">
                  {linha.lotes.map((x, i) => (
                    <li key={i} className="font-mono">
                      {[
                        x.lote ? `Lote ${x.lote}` : "Sem lote",
                        x.validade ? `validade ${fmtDia(x.validade)}` : null,
                        `${fmtQtd(x.quantidade)} ${UNIDADE_CONFERENCIA}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">
                  {[
                    linha.lote ? `Lote ${linha.lote}` : null,
                    linha.validade ? `validade ${fmtDia(linha.validade)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sem lote nem validade."}
                </p>
              )
            ) : emLotes ? (
              <EditorDeLotes
                linha={linha}
                total={entrando(linha)}
                onSalvar={(lotes) => {
                  onAlterar({ lotes });
                  if (lotes.length === 0) setEmLotes(false);
                }}
                onCancelar={() => setEmLotes(Boolean(linha.lotes?.length))}
              />
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Campo label="Lote">
                  <input
                    defaultValue={linha.lote ?? ""}
                    onBlur={(e) => {
                      const novo = e.target.value.trim() || null;
                      if (novo !== linha.lote) onAlterar({ lote: novo });
                    }}
                    placeholder="opcional"
                    className="h-9 w-36 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </Campo>
                <Campo label="Validade">
                  <input
                    type="date"
                    defaultValue={linha.validade ?? ""}
                    onBlur={(e) => {
                      const novo = e.target.value || null;
                      if (novo !== linha.validade) onAlterar({ validade: novo });
                    }}
                    className="h-9 w-40 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </Campo>
                {/* Duas produções no mesmo caminhão, na mesma linha da nota: o
                    FEFO só vende primeiro a que vence primeiro se souber. */}
                <button
                  type="button"
                  onClick={() => setEmLotes(true)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-brand-strong transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                >
                  <Layers size={14} aria-hidden />
                  Dividir em lotes
                </button>
              </div>
            )}
            {linha.motivoDivergencia && (
              <p className="mt-2 text-[12px] text-muted">Motivo: {linha.motivoDivergencia}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
});

/**
 * A linha da nota repartida em lotes: a mesma cerveja, duas produções, duas
 * validades. As quantidades são em unidades (o que o estoque guarda) e somam
 * até o que entra pela linha; o que sobrar entra sem lote. Grava num clique —
 * lote pela metade não vai ao servidor a cada tecla.
 */
type RascunhoLote = { lote: string; validade: string; quantidade: string };

function EditorDeLotes({
  linha,
  total,
  onSalvar,
  onCancelar,
}: {
  linha: LinhaRecebimento;
  /** O que entra pela linha: o contado, ou o esperado se ninguém contou. */
  total: number;
  /** Lista vazia = voltar a um lote só. */
  onSalvar: (lotes: LoteDaLinha[]) => void;
  onCancelar: () => void;
}) {
  const [rascunho, setRascunho] = React.useState<RascunhoLote[]>(() =>
    linha.lotes?.length
      ? linha.lotes.map((x) => ({
          lote: x.lote ?? "",
          validade: x.validade ?? "",
          quantidade: String(x.quantidade),
        }))
      : [
          // O lote que já estava nos campos simples abre a divisão.
          { lote: linha.lote ?? "", validade: linha.validade ?? "", quantidade: "" },
          { lote: "", validade: "", quantidade: "" },
        ],
  );

  const preenchidos = rascunho.filter((r) => r.lote.trim() || r.validade || r.quantidade.trim());
  const lotes: LoteDaLinha[] = preenchidos.map((r) => ({
    lote: r.lote.trim() || null,
    validade: r.validade || null,
    quantidade: Number(r.quantidade || 0),
  }));
  const soma = lotes.reduce((s, l) => s + (Number.isFinite(l.quantidade) ? l.quantidade : 0), 0);
  // Nada digitado ainda não é erro — só não há o que salvar.
  const vazio = lotes.length === 0;
  const problema = vazio ? null : problemaNosLotes(lotes, total);
  const resto = Math.max(0, total - soma);

  const mudar = (i: number, campo: keyof RascunhoLote, valor: string) =>
    setRascunho((rs) => rs.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));

  const INPUT =
    "h-9 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <p className="text-[12px] text-muted">
        Quantidades em unidades ({UNIDADE_CONFERENCIA}). Entram {fmtQtd(total)}{" "}
        {UNIDADE_CONFERENCIA} por esta linha; o que os lotes não cobrirem entra sem lote.
      </p>
      <ul className="flex flex-col gap-2">
        {rascunho.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={r.lote}
              onChange={(e) => mudar(i, "lote", e.target.value)}
              placeholder={`Lote ${i + 1}`}
              maxLength={60}
              aria-label={`Lote ${i + 1}`}
              className={cn(INPUT, "min-w-28 flex-1")}
            />
            <input
              type="date"
              value={r.validade}
              onChange={(e) => mudar(i, "validade", e.target.value)}
              aria-label={`Validade do lote ${i + 1}`}
              className={cn(INPUT, "w-40")}
            />
            <input
              value={r.quantidade}
              onChange={(e) => mudar(i, "quantidade", e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Qtd."
              aria-label={`Quantidade do lote ${i + 1}, em unidades`}
              className={cn(INPUT, "w-20 text-center font-mono")}
            />
            <button
              type="button"
              onClick={() => setRascunho((rs) => rs.filter((_, j) => j !== i))}
              disabled={rascunho.length <= 1}
              aria-label={`Tirar o lote ${i + 1}`}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-danger focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {rascunho.length < 20 && (
        <button
          type="button"
          onClick={() => setRascunho((rs) => [...rs, { lote: "", validade: "", quantidade: "" }])}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-medium text-brand-strong hover:bg-surface focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <Plus size={14} aria-hidden />
          Adicionar lote
        </button>
      )}
      <p className={cn("text-[12px]", problema ? "text-danger" : "text-muted")} role="status">
        {problema ??
          `Os lotes somam ${fmtQtd(soma)} de ${fmtQtd(total)} ${UNIDADE_CONFERENCIA}${
            resto > 0 ? ` — ${fmtQtd(resto)} entram sem lote.` : "."
          }`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onSalvar(lotes)} disabled={vazio || problema !== null}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Salvar lotes
        </Button>
        {linha.lotes?.length ? (
          <Button size="sm" variant="ghost" onClick={() => onSalvar([])}>
            Voltar a um lote só
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}
