"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  ClipboardCheck,
  History,
  Loader2,
  PackageOpen,
  PackagePlus,
  Plus,
  Trash2,
  ScanLine,
  Search,
  Send,
  Undo2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import {
  RelacionarProduto,
  type ItemDeNota,
} from "@/components/recebimento/relacionar-produto";
import { PainelNota } from "./_painel-nota";
import { EntradaDaNota } from "./_entrada";
import {
  Cabecalho,
  ETAPAS_COM_NOTA,
  MedidorRodape,
  RodapeAcao,
  Trilho,
} from "./_partes";
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { variacaoCusto } from "@/lib/compras/conciliacao-regras";
import { frasesDeConversao, rotuloDaUnidade } from "@/lib/fiscal/unidades";
import { Metrica, MetricaGrid, fmtMoney, fmtQtd } from "../../cotacoes/_catalogo/ui";
import {
  aceitarCustoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  cancelarRecebimentoAction,
  conferirItemAction,
  conferirTudoAction,
  desvincularPedidoAction,
  finalizarRecebimentoAction,
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
// Recebimento inteligente.
//
// A tela mostra as três camadas lado a lado — Pedido, NF, Recebido — e
// destaca SÓ a exceção. Quando tudo bate, receber um pedido de trinta itens é
// ler um resumo e apertar um botão; quando não bate, a divergência está na
// cara, com a ação ao lado dela.
//
// O que o operador edita aqui é só o que a conferência física revela:
// quantidade, lote e validade. Preço, produto e quantidade faturada vêm da
// nota e não se digitam.
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
 * As quatro perguntas que o operador faz olhando uma nota de quarenta linhas.
 *
 * Busca por texto responde "onde está o item X?"; isto responde "o que ainda
 * falta?" — que é a pergunta que ele faz o tempo todo, e que antes só se
 * respondia rolando a lista inteira contando de cabeça.
 */
type Filtro = "TODOS" | "FALTA" | "DIVERGENTE" | "SEM_PRODUTO";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "TODOS", label: "Todos" },
  { id: "FALTA", label: "Falta contar" },
  { id: "DIVERGENTE", label: "Com diferença" },
  { id: "SEM_PRODUTO", label: "Sem produto" },
];

function casaComFiltro(l: LinhaRecebimento, filtro: Filtro): boolean {
  switch (filtro) {
    case "FALTA":
      return l.qtdRecebida == null;
    case "DIVERGENTE":
      return STATUS_INFO[l.status].grave && !l.resolucao;
    case "SEM_PRODUTO":
      return !l.productId;
    default:
      return true;
  }
}

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
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  podeEditarFornecedor,
  cega,
  subcategorias,
}: {
  dados: RecebimentoView;
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
  /** Conferência cega: esconde pedido e NF até a pessoa contar. */
  cega: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  // A nota recém-importada ainda não tem conferência: antes de contar caixa é
  // preciso ler o que ela diz, dizer de qual pedido é e relacionar os produtos.
  // Quem clicou "Iniciar recebimento" num pedido já entra conferindo, e o
  // avulso também.
  if (dados.escolherPorta && dados.nota) {
    return (
      <EntradaDaNota
        dados={dados}
        nota={dados.nota}
        podeReceber={podeReceber}
        podeTratarNota={podeTratarNota}
        podeCriarProduto={podeCriarProduto}
        podeEditarFornecedor={podeEditarFornecedor}
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
  cega,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
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
  const [filtro, setFiltro] = React.useState<Filtro>("TODOS");
  const [camera, setCamera] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);
  const [motivoEntrada, setMotivoEntrada] = React.useState("");
  const [verTimeline, setVerTimeline] = React.useState(false);
  /** Os itens que já fecharam ficam dobrados até alguém querer reler. */
  const [verFechados, setVerFechados] = React.useState(false);
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
  const itensRef = React.useRef<Record<string, HTMLLIElement | null>>({});
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
  const impacto = resumo.impactoCusto;
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
      toast.success(
        achado.linha.descricao,
        cega ? `${fmtQtd(nova)} contado(s)` : `${fmtQtd(nova)} de ${fmtQtd(achado.linha.qtdFaturada)}`,
      );
    },
    [porCodigo, aplicarLocal, salvar, encerrada, cega],
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

  async function desvincular() {
    try {
      if (!nota) return;
      await desvincularPedidoAction({ receiptId: recebimento.id, inboundId: nota.id });
      toast.info(
        semPedido ? "Conferência cancelada." : "Vínculo desfeito.",
        "Escolha de novo como receber esta nota.",
      );
      router.refresh();
    } catch (e) {
      toast.error("Não deu para desvincular", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  /** Quantas linhas cada filtro tem hoje — o número mora no próprio chip. */
  const contagens = React.useMemo(
    () => ({
      TODOS: linhas.length,
      FALTA: linhas.filter((l) => l.qtdRecebida == null).length,
      DIVERGENTE: linhas.filter((l) => STATUS_INFO[l.status].grave && !l.resolucao).length,
      SEM_PRODUTO: linhas.filter((l) => !l.productId).length,
    }),
    [linhas],
  );

  // Filtro que esvaziou — o operador contou o último item de "falta contar" —
  // deixaria a tela em branco sem explicação. Derivado, não corrigido por
  // efeito: o chip some e a lista volta a ser todos no mesmo render.
  const filtroAtivo: Filtro = contagens[filtro] === 0 ? "TODOS" : filtro;

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (!casaComFiltro(l, filtroAtivo)) return false;
      if (!termo) return true;
      return `${l.descricao} ${l.sku ?? ""} ${l.ean ?? ""} ${l.codigoFornecedor ?? ""}`
        .toLowerCase()
        .includes(termo);
    });
  }, [linhas, busca, filtroAtivo]);

  /**
   * A lista em duas alturas: o que ainda pede decisão, e o que já fechou.
   *
   * Item conferido, sem divergência e com produto é leitura — dezesseis deles
   * empurram as três linhas que importam para fora da tela. Só agrupa no
   * estado neutro: com filtro ou busca ativos, a lista JÁ é o recorte pedido, e
   * esconder metade dele seria o segundo filtro que ninguém pediu.
   */
  const agrupar = filtroAtivo === "TODOS" && busca.trim() === "";
  const fechado = (l: LinhaRecebimento) =>
    l.qtdRecebida != null && Boolean(l.productId) && !(STATUS_INFO[l.status].grave && !l.resolucao);
  const emAberto = agrupar ? visiveis.filter((l) => !fechado(l)) : visiveis;
  const fechados = agrupar ? visiveis.filter(fechado) : [];

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

      <Cabecalho
        recebimento={recebimento}
        nota={nota}
        pedidoNumero={pedido?.numero ?? null}
        semPedido={semPedido}
        onDesvincular={encerrada || !nota ? undefined : desvincular}
        onCancelar={encerrada ? undefined : () => setCancelando(true)}
      />

      {/* Sem XML a conferência é a tela inteira: trilho de um passo só não diz
          nada. */}
      {!encerrada && nota && (
        <Trilho
          etapas={ETAPAS_COM_NOTA}
          atual="conferencia"
          avisos={{ produtos: resumo.produtosNovos }}
        />
      )}

      {podeTratarNota && nota && (
        <PainelNota
          nota={nota}
          faltamRelacionar={resumo.produtosNovos}
          emConferencia
        />
      )}

      {/* Quatro números, na ordem em que a pergunta é feita: quantos itens,
          quanto custou, quanto entra no saldo, quanto ainda pede decisão. As
          contas de segundo plano (custo negociado, produtos novos) viram a
          linha de apoio de quem as explica — cinco cartões de peso igual não
          dizem por onde começar. */}
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Itens"
          valor={String(resumo.itens)}
          sub={semPedido ? "linhas da nota" : "linhas conciliadas"}
        />
        <Metrica
          label={nota ? "Valor da NF" : "Valor esperado"}
          valor={fmtMoney(resumo.valorNota)}
          sub={
            semPedido
              ? "sem pedido para comparar"
              : resumo.custosAlterados === 0
                ? "preço igual ao negociado"
                : `${resumo.custosAlterados} ${resumo.custosAlterados === 1 ? "custo mudou" : "custos mudaram"} · ${impacto > 0 ? "+" : ""}${fmtMoney(impacto)}`
          }
          tom={!semPedido && resumo.custosAlterados > 0 ? "accent" : undefined}
        />
        <Metrica
          label="Entrada no estoque"
          valor={`+${fmtQtd(entraNoEstoque)} UN`}
          sub={
            conferidos === linhas.length
              ? "tudo conferido"
              : `${linhas.length - conferidos} ${linhas.length - conferidos === 1 ? "item entra" : "itens entram"} como esperado`
          }
          icon={<PackageOpen size={13} />}
        />
        <Metrica
          label="Pendências"
          valor={String(pendencias)}
          sub={
            pendencias === 0
              ? "nada a decidir"
              : [
                  divergentes.length > 0
                    ? `${divergentes.length} ${divergentes.length === 1 ? "diferença" : "diferenças"}`
                    : null,
                  resumo.produtosNovos > 0
                    ? `${resumo.produtosNovos} sem produto`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          tom={pendencias > 0 ? "accent" : "ok"}
          icon={<TriangleAlert size={13} />}
        />
      </MetricaGrid>

      {/* Conferência cega: mostrar as divergências antes da contagem entregaria
          justamente o número que a pessoa não pode ver. O painel espera todo
          mundo ser contado. */}
      {divergentes.length > 0 && (!cega || conferidos === linhas.length) && (
        <PainelDivergencias
          receiptId={recebimento.id}
          inboundId={nota?.id ?? null}
          linhas={divergentes}
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

      {encerrada ? (
        recebimento.status === "FINALIZADO" ? (
          <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-[13px] text-ok">
            Recebimento {recebimento.numero} finalizado — a mercadoria já entrou no estoque. O
            histórico abaixo mostra como a conferência foi feita.
          </p>
        ) : recebimento.status === "CANCELADO" ? (
          <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
            Recebimento cancelado{recebimento.canceladoMotivo ? `: ${recebimento.canceladoMotivo}` : "."}{" "}
            Nada entrou no estoque.
          </p>
        ) : (
          <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
            Esta conferência está em andamento. Você acompanha o que já foi contado; quem
            recebe a mercadoria é quem conta e dá a entrada.
          </p>
        )
      ) : (
        // Sticky: em nota de quarenta linhas, procurar um item ou bipar exigia
        // rolar até o topo e voltar. Quem rola aqui é o <main> do shell, então
        // o topo desta barra é o topo da área de conteúdo.
        <div className="sticky top-0 z-20 -mt-2 flex flex-col gap-2 bg-canvas/95 py-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Achar item por nome, SKU ou código"
                aria-label="Buscar item da nota"
                className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>
            <Button variant="secondary" onClick={() => setCamera(true)}>
              <ScanLine className="h-4 w-4" aria-hidden />
              Bipar
            </Button>
            <Button variant="secondary" onClick={() => setAdicionando(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Adicionar item</span>
              <span className="sm:hidden">Item</span>
            </Button>
            {!cega && linhas.length > 0 && (
              <Button variant="secondary" onClick={() => void conferirTudo()}>
                <CheckCheck className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">
                  Conferi tudo conforme {nota ? "a nota" : "o esperado"}
                </span>
                <span className="sm:hidden">Conferi tudo</span>
              </Button>
            )}
          </div>

          {/* Chips só de estado que existe. Filtro com zero é botão que não
              leva a lugar nenhum. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTROS.filter((f) => f.id === "TODOS" || contagens[f.id] > 0).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                aria-pressed={filtroAtivo === f.id}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                  filtroAtivo === f.id
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line-button bg-surface text-muted hover:text-ink",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ml-1.5 tabular-nums",
                    filtroAtivo === f.id ? "opacity-80" : "text-faint",
                  )}
                >
                  {contagens[f.id]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* O que pede decisão em cima; o que já fechou, dobrado embaixo.
          Sem isso, três divergências ficavam perdidas no meio de dezesseis
          linhas idênticas que ninguém precisava reler. Agrupa só quando não há
          filtro nem busca — ali a lista já é o recorte que a pessoa pediu. */}
      {linhas.length === 0 && (
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
      )}

      <ul className="space-y-2">
        {emAberto.map((l) => (
          <ItemCard
            key={l.id}
            ref={(el) => {
              itensRef.current[l.id] = el;
            }}
            linha={l}
            bloqueado={encerrada}
            cega={cega}
            semPedido={semPedido}
            piscando={piscando === l.id}
            salvamento={salvandoLinha[l.id] ?? null}
            onAlterar={(patch) => {
              aplicarLocal(l.id, patch);
              void salvar(l.id, patch);
            }}
            onRelacionar={() => setRelacionar(paraRelacionar(l))}
            onRemover={
              // Só a linha que ninguém esperava sai da lista. A do pedido ou da
              // nota se zera — apagar esconderia a falta em vez de mostrá-la.
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
      </ul>

      {fechados.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <button
            type="button"
            onClick={() => setVerFechados((v) => !v)}
            aria-expanded={verFechados}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-medium text-ink hover:bg-surface-2"
          >
            <Check className="h-4 w-4 text-ok" aria-hidden />
            {fechados.length} {fechados.length === 1 ? "item conferido" : "itens conferidos"} sem
            diferença
            <span className="ml-auto text-[12px] text-muted">
              {verFechados ? "ocultar" : "ver"}
            </span>
          </button>
          {verFechados && (
            <ul className="space-y-2 border-t border-line p-3">
              {fechados.map((l) => (
                <ItemCard
                  key={l.id}
                  ref={(el) => {
                    itensRef.current[l.id] = el;
                  }}
                  linha={l}
                  bloqueado={encerrada}
                  cega={cega}
                  semPedido={semPedido}
                  piscando={piscando === l.id}
                  salvamento={salvandoLinha[l.id] ?? null}
                  onAlterar={(patch) => {
                    aplicarLocal(l.id, patch);
                    void salvar(l.id, patch);
                  }}
                  onRelacionar={() => setRelacionar(paraRelacionar(l))}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {visiveis.length === 0 && (
        <p className="rounded-[var(--radius)] border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          {busca.trim() ? (
            <>Nenhum item com “{busca.trim()}”{filtroAtivo !== "TODOS" && " neste filtro"}.</>
          ) : (
            "Nenhum item neste filtro."
          )}{" "}
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setFiltro("TODOS");
            }}
            className="font-medium text-brand underline"
          >
            Ver os {linhas.length} itens
          </button>
        </p>
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
            {/* Os totais já estão no topo da tela; aqui embaixo cabe só a
                consequência de apertar o botão — repetir "R$ 1.234,00" em
                corpo 12 não é resumo, é ruído em cima da decisão. */}
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

          <div className="flex w-full shrink-0 flex-col items-stretch gap-1 sm:w-auto sm:items-end">
            <Button
              onClick={() => setConfirmando(true)}
              disabled={enviando || gravando || linhas.length === 0 || impedimento !== null}
              className="w-full sm:w-auto"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              Receber no estoque
            </Button>
            <p className="text-[11px] text-muted sm:text-right">
              <span className="font-mono text-ink-2">+{fmtQtd(entraNoEstoque)} UN</span> no
              estoque
            </p>
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
  bloqueado,
  onRelacionar,
}: {
  receiptId: string;
  /** Nulo quando ainda não há NF-e — aí não há fornecedor a quem reclamar. */
  inboundId: string | null;
  linhas: LinhaRecebimento[];
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

// ── Card do item ────────────────────────────────────────────


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

const ItemCard = React.forwardRef<
  HTMLLIElement,
  {
    linha: LinhaRecebimento;
    bloqueado: boolean;
    /** Esconde pedido/NF enquanto a linha não foi contada. */
    cega?: boolean;
    /** Recebimento sem pedido: não existe coluna "Pedido" para mostrar. */
    semPedido?: boolean;
    /** Acabou de receber um bipe — destaca por um instante. */
    piscando?: boolean;
    /** Gravando esta linha agora, ou acabou de gravar. */
    salvamento?: EstadoSalvamento | null;
    onAlterar: (patch: {
      qtdRecebida?: number | null;
      lote?: string | null;
      validade?: string | null;
    }) => void;
    onRelacionar: () => void;
    /** Só nas linhas avulsas — o que veio do pedido/nota se zera, não some. */
    onRemover?: () => void;
  }
>(function ItemCard(
  { linha, bloqueado, cega, semPedido, piscando, salvamento, onAlterar, onRelacionar, onRemover },
  ref,
) {
  const info = STATUS_INFO[linha.status];
  const v = variacaoDaLinha(linha);
  const [aberto, setAberto] = React.useState(false);
  const recebido = linha.qtdRecebida;
  /** Contou? Então pode ver. Antes disso, o número do pedido enviesa a contagem. */
  const oculto = Boolean(cega) && recebido == null && !bloqueado;
  const temDetalhe = Boolean(linha.lote || linha.validade || linha.motivoDivergencia);
  /**
   * A nota faturou numa unidade que não é a da prateleira (MI, CX, FD).
   *
   * A conferência conta unidade — quem está na doca conta maço, não milheiro.
   * Mas o número do papel é o outro, e sem ele à vista a pessoa procura "0,6"
   * na tela e não acha.
   */
  const doXml =
    linha.xml && linha.xml.fatorConversao !== 1
      ? {
          ...linha.xml,
          sigla: linha.xml.unidade.trim().toUpperCase(),
        }
      : null;

  return (
    <li
      ref={ref}
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-lg)] border bg-surface transition-colors",
        info.grave && !linha.resolucao ? "border-accent/40" : "border-line",
        // O bipe acerta a linha certa; o destaque é o que prova isso a quem
        // está de pé, com a caixa na mão, longe da tela.
        piscando && "border-ok bg-ok-soft/50 motion-reduce:transition-none",
        salvamento === "salvando" && "border-brand/50",
        salvamento === "salvo" && "border-ok/60",
      )}
    >
      {/* Fio de luz no topo do card enquanto a linha grava. O operador conta
          de pé, olhando a caixa e não a tela: o movimento é o que ele capta
          de canto de olho. Fica atrás do conteúdo e some com o "salvo". */}
      {salvamento === "salvando" && (
        <span
          aria-hidden
          className="linha-salvando absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-brand-soft"
        >
          <span className="block h-full w-1/3 bg-brand" />
        </span>
      )}

      {/* A linha fechada não é mais um botão só: contar é o trabalho, e
          trabalho não pode morar atrás de um clique de "expandir". O toggle
          cobre a identidade do item; a quantidade fica ao lado, digitável. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius)] text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <ProdutoThumb url={linha.imagemUrl} nome={linha.descricao} size="lg" />

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-ink">{linha.descricao}</span>
              {linha.bonificacao && (
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                  Bonificação
                </span>
              )}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted">
              {linha.sku ?? linha.codigoFornecedor ?? "sem código"}
              {temDetalhe && !aberto && (
                <span className="font-sans text-faint">
                  {linha.lote ? ` · lote ${linha.lote}` : ""}
                  {linha.validade
                    ? ` · val. ${new Date(linha.validade).toLocaleDateString("pt-BR")}`
                    : ""}
                </span>
              )}
            </span>
            {/* Nota em milheiro, caixa ou fardo: a quantidade do papel e a
                contada na porta são números diferentes, e os dois ficam à
                vista. O XML não muda — o convertido é que é derivado dele. */}
            {doXml && (
              <span
                className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted"
                title={`A nota fatura em ${rotuloDaUnidade(doXml.unidade)}. ${frasesDeConversao(doXml.sigla, doXml.fatorConversao)} — ${fmtQtd(doXml.quantidade)} ${doXml.sigla} valem ${fmtQtd(doXml.quantidade * doXml.fatorConversao)} UN. A conferência conta unidades.`}
              >
                <ArrowRightLeft size={11} aria-hidden />
                <span className="font-mono">
                  XML {fmtQtd(doXml.quantidade)} {doXml.sigla}
                </span>
                <span className="text-faint">
                  · {frasesDeConversao(doXml.sigla, doXml.fatorConversao)}
                </span>
              </span>
            )}
            {v != null && !oculto && (
              <span
                className={cn(
                  "mt-0.5 inline-flex items-center gap-1 text-[11px]",
                  v > 0 ? "text-danger" : "text-ok",
                )}
              >
                {v > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {fmtMoney(linha.custoPedido)} → {fmtMoney(linha.custoFaturado)} ({pct(v)})
              </span>
            )}
          </span>
        </button>

        <div className="hidden shrink-0 items-center gap-5 sm:flex">
          {oculto ? (
            <Coluna titulo={semPedido ? "NF" : "Pedido / NF"} valor="•••" />
          ) : (
            <>
              {!semPedido && <Coluna titulo="Pedido" valor={fmtQtd(linha.qtdPedida)} />}
              <Coluna titulo="NF" valor={fmtQtd(linha.qtdFaturada)} />
            </>
          )}
        </div>

        {bloqueado ? (
          <Coluna
            titulo="Recebido"
            valor={recebido == null ? fmtQtd(linha.qtdFaturada) : fmtQtd(recebido)}
            destaque={recebido != null}
          />
        ) : (
          <div className="flex shrink-0 items-end gap-1.5">
            <Campo label="Recebido">
              <input
                // `key` amarrado ao valor do servidor: o campo é não
                // controlado (para não brigar com a digitação), e sem remontar
                // ele ficava exibindo 12 depois de o bipe somar 13.
                key={`${linha.id}:${recebido ?? "-"}`}
                type="number"
                // Peça inteira, sempre: o saldo conta garrafa, não meia
                // garrafa. Aceitar decimal aqui só empurraria o erro para a
                // hora de receber, quando a nota inteira trava.
                inputMode="numeric"
                step="1"
                min={0}
                defaultValue={recebido ?? ""}
                placeholder={oculto ? "conte" : fmtQtd(linha.qtdFaturada)}
                aria-label={`Quantidade recebida de ${linha.descricao}, em unidades inteiras`}
                onBlur={(e) => {
                  const bruto = e.target.value.trim();
                  const novo = bruto === "" ? null : Math.round(Number(bruto));
                  // O campo devolve o inteiro para a tela não ficar mostrando
                  // "1,5" que o servidor nunca vai gravar.
                  if (novo != null && String(novo) !== bruto) e.target.value = String(novo);
                  if (novo === recebido) return;
                  onAlterar({ qtdRecebida: novo });
                }}
                onKeyDown={(e) => {
                  // Enter fecha a linha e devolve o teclado ao leitor: contar
                  // quarenta itens é digitar, tab, digitar — não mirar botão.
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={cn(
                  "h-10 w-[4.5rem] rounded-[var(--radius)] border bg-surface px-2 text-center text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  recebido == null
                    ? "border-line-button text-ink placeholder:text-faint"
                    : "border-ok/50 font-semibold text-ink",
                )}
              />
            </Campo>
            {/* "Igual à nota" é o caso de 90% das linhas. Um toque, sem abrir
                nada, sem digitar o número que já está na tela ao lado. */}
            <button
              type="button"
              onClick={() => onAlterar({ qtdRecebida: linha.qtdFaturada })}
              title="Recebi como está na nota"
              aria-label={`Recebi ${fmtQtd(linha.qtdFaturada)} de ${linha.descricao}, como na nota`}
              className={cn(
                "grid h-10 w-9 place-items-center rounded-[var(--radius)] border border-line-button text-muted transition-colors hover:bg-ok-soft hover:text-ok focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                recebido != null &&
                  Math.abs(recebido - linha.qtdFaturada) < 0.001 &&
                  "border-ok/50 bg-ok-soft text-ok",
              )}
            >
              <Check className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* Enquanto grava, o selo de status dá lugar ao do salvamento: são a
            mesma informação em momentos diferentes — o status da linha só vale
            depois que o servidor confirmou o número novo. */}
        {salvamento ? (
          <span
            role="status"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              salvamento === "salvando" ? "bg-brand-soft text-brand" : "bg-ok-soft text-ok",
            )}
          >
            {salvamento === "salvando" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Salvando…
              </>
            ) : (
              <>
                <Check className="h-3 w-3" aria-hidden />
                Salvo
              </>
            )}
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
              linha.resolucao || oculto ? "bg-surface-2 text-muted" : info.classe,
            )}
          >
            {linha.resolucao ? "Resolvido" : oculto ? "A conferir" : info.label}
          </span>
        )}

        {onRemover && (
          <button
            type="button"
            onClick={onRemover}
            aria-label={`Remover ${linha.descricao} do recebimento`}
            title="Remover — esta linha foi adicionada na porta"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {aberto && (
        <div className="border-t border-line px-4 py-3">
          {bloqueado ? (
            <p className="text-[13px] text-muted">
              Recebido {recebido == null ? fmtQtd(linha.qtdFaturada) : fmtQtd(recebido)}
              {linha.lote && ` · lote ${linha.lote}`}
              {linha.validade &&
                ` · validade ${new Date(linha.validade).toLocaleDateString("pt-BR")}`}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {/* Quantidade saiu daqui: vive na linha fechada. Aqui fica o que
                  só se preenche de vez em quando. */}
              <Campo label="Lote">
                <input
                  defaultValue={linha.lote ?? ""}
                  onBlur={(e) => onAlterar({ lote: e.target.value.trim() || null })}
                  placeholder="opcional"
                  className="h-10 w-36 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>
              <Campo label="Validade">
                <input
                  type="date"
                  defaultValue={linha.validade ?? ""}
                  onBlur={(e) => onAlterar({ validade: e.target.value || null })}
                  className="h-10 w-40 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>

              {/* Só no celular: no desktop as colunas Pedido/NF ficam à vista
                  na própria linha. */}
              {!oculto && (
                <p className="text-[12px] text-muted sm:hidden">
                  {!semPedido && <>Pedido {fmtQtd(linha.qtdPedida)} · </>}
                  NF {fmtQtd(linha.qtdFaturada)}
                </p>
              )}

              {!linha.productId && (
                <Button size="sm" onClick={onRelacionar}>
                  Relacionar produto
                </Button>
              )}
            </div>
          )}

          {linha.motivoDivergencia && (
            <p className="mt-2 text-[12px] text-muted">Nota: {linha.motivoDivergencia}</p>
          )}
        </div>
      )}
    </li>
  );
});

function Coluna({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <span className="block text-right">
      <span className="block text-[10px] font-medium tracking-wide text-faint uppercase">
        {titulo}
      </span>
      <span
        className={cn(
          "block font-display text-[15px] leading-tight font-semibold tabular-nums",
          destaque ? "text-ink" : "text-ink-2",
        )}
      >
        {valor}
      </span>
    </span>
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
