"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Download,
  Gift,
  History,
  Link2,
  Loader2,
  MoreVertical,
  PackagePlus,
  Plus,
  Trash2,
  ScanLine,
  Search,
  Send,
  Undo2,
  TriangleAlert,
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
import { frasesDeConversao, rotuloDaUnidade } from "@/lib/fiscal/unidades";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";
import { fmtMoney, fmtQtd } from "../../cotacoes/_catalogo/ui";
import {
  aceitarCustoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  cancelarRecebimentoAction,
  conferirItemAction,
  conferirTudoAction,
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

/** Contado diferente do esperado. */
const contouDiferente = (l: LinhaRecebimento) =>
  l.qtdRecebida != null && Math.abs(l.qtdRecebida - esperadoDe(l)) > 0.001;

function situacaoDaLinha(l: LinhaRecebimento, cega: boolean): Situacao {
  // Conferência cega: até a pessoa contar, nem o selo pode contar que o
  // pedido e a nota discordam — é o número que ela não pode ver.
  if (cega && l.qtdRecebida == null) return "A_CONFERIR";
  if (l.resolucao || l.motivoDivergencia) return "AJUSTADO";
  if (!l.productId || STATUS_INFO[l.status].grave || contouDiferente(l)) return "DIVERGENCIA";
  return l.qtdRecebida == null ? "A_CONFERIR" : "CONFERIDO";
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
  switch (s) {
    case "A_CONFERIR":
      return `Ainda não contado — entra com a quantidade ${temNota ? "da nota" : "do pedido"} se ninguém contar.`;
    case "CONFERIDO":
      return "Contado e igual ao esperado.";
    case "AJUSTADO":
      return l.motivoDivergencia
        ? `Ajustado: ${l.motivoDivergencia}`
        : "Divergência decidida — fica no histórico.";
    case "DIVERGENCIA":
      if (!l.productId) return "Sem produto relacionado — relacione antes de receber.";
      if (contouDiferente(l)) {
        return `Contado ${fmtQtd(l.qtdRecebida ?? 0)}, esperado ${fmtQtd(esperadoDe(l))}.`;
      }
      return `${STATUS_INFO[l.status].label}: ${explicacao(l, variacaoDaLinha(l))}`;
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

/** Quanto o custo da nota subiu (ou caiu) sobre o negociado, em %. */
function variacaoDaLinha(l: LinhaRecebimento): number | null {
  if (l.status === "NAO_PEDIDO") return null;
  return variacaoCusto(l.custoPedido, l.custoFaturado);
}

/**
 * O que a linha esperava e o que entra se a entrada for confirmada agora —
 * mesma régua do servidor (`esperadoDaLinha`): a nota manda; sem ela, o pedido.
 * Linha sem contagem entra pelo esperado.
 */
const esperadoDe = (l: LinhaRecebimento) => l.qtdFaturada || l.qtdPedida;

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
  const sigla = l.xml?.unidade.trim().toUpperCase() || UNIDADE_CONFERENCIA;
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
  podeCriarProduto,
  podeEditarFornecedor,
  podeBaixarXml,
  mostrarSku,
  cega,
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
  /** Decide sobre o DOCUMENTO: descartar, estornar, documentar entrada manual. */
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  /** Decide as sugestões de contato que o XML trouxe para o fornecedor. */
  podeEditarFornecedor: boolean;
  /** Abre e baixa o XML guardado (`fiscal.baixar`). */
  podeBaixarXml: boolean;
  /** SKU ligado nas configurações de produto. */
  mostrarSku: boolean;
  /** Conferência cega: esconde pedido e NF até a pessoa contar. */
  cega: boolean;
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
      podeCriarProduto={podeCriarProduto}
      podeBaixarXml={podeBaixarXml}
      mostrarSku={mostrarSku}
      cega={cega}
      subcategorias={subcategorias}
    />
  );
}

// ── Conferência ─────────────────────────────────────────────

function Conferencia({
  dados,
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  podeBaixarXml,
  mostrarSku,
  cega,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  podeBaixarXml: boolean;
  mostrarSku: boolean;
  cega: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { recebimento, nota, pedido, semPedido, resumo, timeline } = dados;
  // Recebimento fechado e pessoa que não recebe mercadoria dão no mesmo lugar:
  // a conferência é só leitura. Contar caixa é decisão de quem está na doca.
  const encerrada =
    recebimento.status === "FINALIZADO" ||
    recebimento.status === "CANCELADO" ||
    !podeReceber;

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
  const divergentes = linhas.filter((l) => STATUS_INFO[l.status].grave && !l.resolucao);
  // O que vira saldo se a entrada for confirmada agora: o contado, quando
  // alguém contou; o esperado, quando ninguém contou. É a mesma regra que o
  // servidor aplica em `finalizarRecebimento` — a tela só a mostra antes.
  const itensEntrando = linhas.filter((l) => entrando(l) > 0);
  const entraNoEstoque = itensEntrando.reduce((s, l) => s + entrando(l), 0);
  /** Tudo que ainda espera uma decisão da pessoa antes de receber. */
  const pendencias = divergentes.length + resumo.produtosNovos;
  const semProduto = itensEntrando.filter((l) => !l.productId).length;
  // Mesma régua do servidor (`divergenciasDaConferencia`): contado diferente do
  // esperado e ainda sem explicação. Uma frase resolve todas de uma vez.
  const naoExplicadas = linhas.filter(
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
      dadosItem: { qtdRecebida?: number | null; lote?: string | null; validade?: string | null },
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
      void salvar(achado.linha.id, { qtdRecebida: nova });
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
        achado.linha.descricao,
        cega
          ? `${fmtQtd(naRegua(nova, regua))} ${sigla} contado(s)`
          : `${fmtQtd(naRegua(nova, regua))} de ${fmtQtd(naRegua(esperadoDe(achado.linha), regua))} ${sigla}`,
      );
    },
    [porCodigo, aplicarLocal, salvar, encerrada, cega, porUnidade],
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
    // Retrato de antes do clique. É o que "Desfazer" devolve — inclusive as
    // linhas já contadas, que o "conferi tudo" sobrescreve.
    const antes = linhas.map((l) => ({ itemId: l.id, qtdRecebida: l.qtdRecebida }));
    try {
      await conferirTudoAction(recebimento.id);
      setLinhas((prev) => prev.map((l) => ({ ...l, qtdRecebida: l.qtdFaturada })));
      toast.success(
        "Tudo conferido conforme a nota.",
        "Revise antes de receber no estoque.",
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
      setLinhas((prev) =>
        prev.map((l) => ({
          ...l,
          qtdRecebida: antes.find((a) => a.itemId === l.id)?.qtdRecebida ?? null,
        })),
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
      });
      toast.success(
        `Recebimento ${r.numero} finalizado.`,
        pedido
          ? r.pedidoCompleto
            ? `Estoque atualizado. Pedido ${pedido.numero} recebido por completo.`
            : `Estoque atualizado. Pedido ${pedido.numero} segue aberto para o que falta.`
          : "Estoque e custo atualizados.",
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

  /** Situação de cada linha — a mesma régua no selo, no filtro e na planilha. */
  const situacoes = React.useMemo(
    () => new Map(linhas.map((l) => [l.id, situacaoDaLinha(l, cega)])),
    [linhas, cega],
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
      ],
      linhas: linhas.map((l, i) => {
        const oculto = cega && l.qtdRecebida == null && !encerrada;
        const custo = l.bonificacao ? 0 : l.custoFaturado;
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
          l.qtdRecebida == null ? null : l.qtdRecebida - esperadoDe(l),
          SITUACAO_UI[situacoes.get(l.id) ?? "A_CONFERIR"].rotulo,
          custo,
          l.qtdRecebida == null ? null : custo * l.qtdRecebida,
          l.lote ?? "",
          l.validade ? fmtDia(l.validade) : "",
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
      />

      {/* Conferência cega: mostrar as divergências antes da contagem entregaria
          justamente o número que a pessoa não pode ver. O painel espera todo
          mundo ser contado. */}
      {divergentes.length > 0 && (!cega || conferidos === linhas.length) && (
        <PainelDivergencias
          receiptId={recebimento.id}
          inboundId={nota?.id ?? null}
          linhas={divergentes}
          impactoCusto={resumo.custosAlterados > 0 ? resumo.impactoCusto : 0}
          bloqueado={encerrada}
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
            Este recebimento não tem pedido nem nota por trás. Bipe ou busque cada produto que
            chegou — nada entra no estoque até você finalizar.
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
                  title={`Marca cada linha com a quantidade ${nota ? "da nota" : "esperada"}`}
                >
                  <CheckCheck size={14} aria-hidden />
                  Conferi tudo
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={exportar}
                aria-label="Exportar conferência"
                title="Exportar conferência (planilha)"
              >
                <Download size={14} aria-hidden />
                <span className="hidden @[40rem]:inline">Exportar conferência</span>
              </Button>
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
                    mostrarSku={mostrarSku}
                    bloqueado={encerrada}
                    cega={cega}
                    piscando={piscando === l.id}
                    salvamento={salvandoLinha[l.id] ?? null}
                    onAlterar={(patch) => {
                      aplicarLocal(l.id, patch);
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

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <button
          type="button"
          onClick={() => setVerTimeline((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink hover:bg-surface-2"
        >
          <History className="h-4 w-4 text-faint" aria-hidden />
          {pedido ? `Histórico do pedido ${pedido.numero}` : "Histórico desta nota"}
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
                    atenção — o que não for conferido entra como está na nota.
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
                  {linhas.length - conferidos === 1 ? "item entra" : "itens entram"} como está
                  na nota se ninguém contar.
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
            <div className="flex items-baseline justify-between gap-3 px-3 py-2">
              <dt className="text-muted">Contas a pagar</dt>
              <dd className="text-right text-ink">
                {nota ? (
                  <>
                    <span className="font-mono">{fmtMoney(valorTitulos)}</span>
                    {nota.duplicatas.length > 1 && ` em ${nota.duplicatas.length} títulos`}
                  </>
                ) : (
                  <span className="text-muted">sem NF-e, nenhum título agora</span>
                )}
              </dd>
            </div>
          </dl>

          {conferidos < linhas.length && (
            <p className="rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px] text-accent">
              {linhas.length - conferidos}{" "}
              {linhas.length - conferidos === 1
                ? "item não foi contado — entra"
                : "itens não foram contados — entram"}{" "}
              com a quantidade {nota ? "da nota" : "do pedido"}.
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
                    <span className="min-w-0 truncate text-ink-2">{l.descricao}</span>
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

// ── Painel de divergências ──────────────────────────────────
// Ninguém deve caçar erro numa lista de trinta itens: o que está errado sobe
// para o topo, com a decisão ao lado.

function PainelDivergencias({
  receiptId,
  inboundId,
  linhas,
  impactoCusto,
  bloqueado,
  onRelacionar,
}: {
  receiptId: string;
  /** Nulo quando ainda não há NF-e — aí não há fornecedor a quem reclamar. */
  inboundId: string | null;
  linhas: LinhaRecebimento[];
  /** Quanto a nota custou a mais (ou a menos) que o negociado. Zero = não mudou. */
  impactoCusto: number;
  bloqueado: boolean;
  onRelacionar: (l: LinhaRecebimento) => void;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [decisao, setDecisao] = React.useState<{
    linha: LinhaRecebimento;
    resolucao: "ACEITO" | "IGNORADO";
  } | null>(null);
  const [avisar, setAvisar] = React.useState(false);
  const [devolver, setDevolver] = React.useState<LinhaRecebimento | null>(null);

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
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={() => setAvisar(true)}
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Avisar fornecedor
        </Button>
      </div>

      <ul className="divide-y divide-line border-t border-line bg-surface">
        {linhas.map((l) => {
          const v = variacaoDaLinha(l);
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{l.descricao}</p>
                <p className="truncate text-[12px] text-muted">{explicacao(l, v)}</p>
              </div>

              {bloqueado && l.productId && (
                <Button size="sm" variant="secondary" onClick={() => setDevolver(l)}>
                  Devolver ao fornecedor
                </Button>
              )}

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

      {avisar && inboundId && (
        <SheetAvisarFornecedor inboundId={inboundId} onClose={() => setAvisar(false)} />
      )}

      {devolver && (
        <SheetDevolver
          receiptId={receiptId}
          linha={devolver}
          onClose={() => setDevolver(null)}
          onFeito={() => {
            setDevolver(null);
            router.refresh();
          }}
        />
      )}

      {decisao && (
        <SheetMotivoDivergencia
          linha={decisao.linha}
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
  inboundId,
  onClose,
}: {
  inboundId: string;
  onClose: () => void;
}) {
  const [dados, setDados] = React.useState<{
    texto: string;
    fornecedor: string;
    telefone: string | null;
    email: string | null;
  } | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [texto, setTexto] = React.useState("");

  // Carrega uma vez, ao montar. O texto vem do servidor porque ele tem os
  // números da nota e do pedido — remontar isso no cliente duplicaria a regra.
  React.useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await resumoDivergenciasAction(inboundId);
        if (!vivo) return;
        setDados(r);
        setTexto(r.texto);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Falha ao montar o resumo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [inboundId]);

  const digitos = (dados?.telefone ?? "").replace(/\D/g, "");
  const zap = digitos.length >= 10 ? `https://wa.me/${digitos.length <= 11 ? "55" : ""}${digitos}?text=${encodeURIComponent(texto)}` : null;
  const email = dados?.email
    ? `mailto:${dados.email}?subject=${encodeURIComponent("Divergência na entrega")}&body=${encodeURIComponent(texto)}`
    : null;

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
          {email && (
            <a href={email}>
              <Button size="sm" variant="secondary">
                E-mail
              </Button>
            </a>
          )}
          {zap && (
            <a href={zap} target="_blank" rel="noreferrer">
              <Button size="sm">WhatsApp</Button>
            </a>
          )}
        </div>
      }
    >
      {erro ? (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {erro}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            Revise antes de mandar — o texto sai com os números da nota e do pedido.
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={14}
            className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 font-mono text-[12px] text-ink focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          {dados && !dados.telefone && !dados.email && (
            <p className="text-[12px] text-muted">
              Este fornecedor não tem telefone nem e-mail cadastrado — copie o texto e mande
              pelo canal que você usa com ele.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ── Devolver ao fornecedor ──────────────────────────────────

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
  const sugerida = Math.max(0, linha.qtdFaturada - linha.qtdPedida);
  const [quantidade, setQuantidade] = React.useState(String(sugerida > 0 ? sugerida : ""));
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  const qtd = Number(quantidade.replace(",", "."));
  const podeEnviar = qtd > 0 && motivo.trim().length >= 3 && !enviando;

  function enviar() {
    setEnviando(true);
    void (async () => {
      try {
        await devolverDivergenciaAction({
          receiptId,
          itemId: linha.id,
          quantidade: qtd,
          motivo: motivo.trim(),
        });
        toast.success("Devolução registrada.", "O estoque já foi ajustado.");
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
      description={linha.descricao}
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
          Sai do estoque como devolução ao fornecedor, com o custo desta nota. Só use para
          mercadoria que já entrou — o que ainda não entrou se resolve na conferência.
        </p>

        <Campo label="Quantidade devolvida">
          <input
            type="number"
            step="0.001"
            min={0}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            placeholder={sugerida > 0 ? fmtQtd(sugerida) : "0"}
            className="h-10 w-32 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </Campo>

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
  resolucao,
  salvando,
  onClose,
  onConfirmar,
}: {
  linha: LinhaRecebimento;
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
      description={linha.descricao}
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
          {explicacao(linha, variacaoDaLinha(linha))}
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
            Fica na timeline do pedido, com seu nome e a hora.
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

function explicacao(l: LinhaRecebimento, v: number | null): string {
  const falta = Math.abs(l.qtdPedida - l.qtdFaturada);
  switch (l.status) {
    case "FALTANDO":
      return `Pedido ${fmtQtd(l.qtdPedida)} · faturado ${fmtQtd(l.qtdFaturada)} — faltam ${fmtQtd(falta)}.`;
    case "EXCEDENTE":
      return `Pedido ${fmtQtd(l.qtdPedida)} · faturado ${fmtQtd(l.qtdFaturada)} — ${fmtQtd(falta)} a mais.`;
    case "NAO_FATURADO":
      return `Estava no pedido (${fmtQtd(l.qtdPedida)}) e não veio nesta nota.`;
    case "NAO_PEDIDO":
      return `Veio na nota (${fmtQtd(l.qtdFaturada)}) sem estar no pedido.`;
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
  const [custo, setCusto] = React.useState("");
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
  const custoNum = custo.trim() === "" ? 0 : Number(custo.replace(",", "."));
  const podeEnviar =
    Boolean(escolhido) && qtd > 0 && !enviando && (bonificacao || custoNum >= 0);

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
                    onChange={(e) => setPackagingId(e.target.value || null)}
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
                  inputMode="decimal"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="0"
                  className="h-10 w-24 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-center text-sm tabular-nums text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>
              {!bonificacao && (
                <Campo label={`Custo por ${pacote?.nome ?? "unidade"}`}>
                  <input
                    inputMode="decimal"
                    value={custo}
                    onChange={(e) => setCusto(e.target.value)}
                    placeholder="0,00"
                    className="h-10 w-28 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-right text-sm tabular-nums text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </Campo>
              )}
            </div>

            {qtd > 0 && fator !== 1 && (
              <p className="text-[12px] text-muted">
                Entram <span className="font-mono text-ink-2">{fmtQtd(qtd * fator)}</span> unidades
                no estoque.
              </p>
            )}

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
    /** SKU ligado nas configurações de produto. */
    mostrarSku: boolean;
    bloqueado: boolean;
    /** Esconde o esperado enquanto a linha não foi contada. */
    cega: boolean;
    /** Acabou de receber um bipe — destaca por um instante. */
    piscando: boolean;
    /** Gravando esta linha agora, ou acabou de gravar. */
    salvamento: EstadoSalvamento | null;
    onAlterar: (patch: {
      qtdRecebida?: number | null;
      lote?: string | null;
      validade?: string | null;
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
    mostrarSku,
    bloqueado,
    cega,
    piscando,
    salvamento,
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
  const diferenca = recebido == null ? null : recebido - esperado;
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
      ? { ...linha.xml, sigla: linha.xml.unidade.trim().toUpperCase() }
      : null;
  /** Contando na embalagem da nota: o que se digita e se lê é caixa, não unidade. */
  const naEmbalagem = regua.modo === "EMB" && regua.fator != null;
  const sigla = siglaDaRegua(regua);
  const emb = nomeDaEmbalagem(regua.sigla).toLowerCase();
  const temDetalhe = Boolean(linha.lote || linha.validade || linha.motivoDivergencia);
  const podeIgualar = !bloqueado && !cega;
  const temMenu = podeIgualar || !bloqueado || temDetalhe || Boolean(onRemover);

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
          {(linha.lote || linha.validade) && (
            <p className="mt-0.5 text-[10px] text-muted">
              {[
                linha.lote ? `lote ${linha.lote}` : null,
                linha.validade ? `val. ${fmtDia(linha.validade)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
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
              aria-label={`Contar ${linha.descricao} em`}
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
          {oculto ? (
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
                  ? `Quantidade recebida de ${linha.descricao}, em ${emb}s inteiras de ${fmtQtd(regua.fator ?? 1)}`
                  : `Quantidade recebida de ${linha.descricao}, em unidades inteiras`
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
            o ícone; a frase inteira fica no hover e no leitor de tela. */}
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
              <span className="sr-only @[54rem]:not-sr-only">
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
              <span className="sr-only @[54rem]:not-sr-only">{ui.rotulo}</span>
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
                  {detalhe ? "Fechar lote e validade" : "Lote e validade"}
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
              <p className="text-[13px] text-muted">
                {[
                  linha.lote ? `Lote ${linha.lote}` : null,
                  linha.validade ? `validade ${fmtDia(linha.validade)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Sem lote nem validade."}
              </p>
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
