"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ClipboardCheck,
  FilePlus2,
  FileText,
  History,
  Link2,
  Loader2,
  PackageOpen,
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
import { TabelaDePara } from "@/components/recebimento/tabela-de-para";
import { PainelNota } from "./_painel-nota";
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { variacaoCusto } from "@/lib/compras/conciliacao-regras";
import { Metrica, MetricaGrid, fmtMoney, fmtQtd, fmtQuando } from "../../cotacoes/_catalogo/ui";
import {
  aceitarCustoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  confirmarEntradaAction,
  conferirItemAction,
  conferirTudoAction,
  criarPedidoDaNotaAction,
  desvincularPedidoAction,
  receberSemPedidoAction,
  resolverDivergenciaAction,
  vincularPedidoAction,
} from "../conferencia-actions";
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

/** Quanto o custo da nota subiu (ou caiu) sobre o negociado, em %. */
function variacaoDaLinha(l: LinhaRecebimento): number | null {
  if (l.status === "NAO_PEDIDO") return null;
  return variacaoCusto(l.custoPedido, l.custoFaturado);
}

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
  /** Conferência cega: esconde pedido e NF até a pessoa contar. */
  cega: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  // Três portas, uma tela: com pedido é conciliação, sem pedido é a nota
  // contra a contagem. O que ainda não escolheu porta fica na escolha.
  if (!dados.pedido && !dados.semPedido) {
    return (
      <EscolherPedido
        dados={dados}
        podeReceber={podeReceber}
        podeTratarNota={podeTratarNota}
        podeCriarProduto={podeCriarProduto}
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

// ── Sem pedido vinculado ────────────────────────────────────

function EscolherPedido({
  dados,
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { nota, sugestoes, itensNota } = dados;
  const [salvando, setSalvando] = React.useState<string | null>(null);

  const semProduto = itensNota.filter((i) => !i.productId);
  const totalItens = itensNota.reduce((s, i) => s + i.valorTotal, 0);

  async function vincular(purchaseOrderId: string) {
    setSalvando(purchaseOrderId);
    try {
      await vincularPedidoAction({ inboundId: nota.id, purchaseOrderId });
      toast.success("Nota conciliada com o pedido.", "Confira a mercadoria para dar entrada.");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para vincular", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(null);
    }
  }

  async function gerarPedido() {
    setSalvando("novo");
    try {
      await criarPedidoDaNotaAction(nota.id);
      toast.success("Pedido criado a partir da nota.", "Já nasce conciliado — falta conferir.");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para criar o pedido", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(null);
    }
  }

  async function receberSemPedido() {
    setSalvando("sem-pedido");
    try {
      await receberSemPedidoAction(nota.id);
      toast.success("Conferência aberta sem pedido.", "A nota é a referência do que deveria vir.");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para abrir a conferência", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(null);
    }
  }

  const podeAvancar = semProduto.length === 0;
  // Nota que chegou inteira relacionada (o comum depois que o mapa do
  // fornecedor aprendeu) abriria com 40 linhas de tabela cobrindo o trabalho
  // real, que é escolher a porta. Fica dobrada até alguém querer ver.
  const [verTabela, setVerTabela] = React.useState(!podeAvancar);

  return (
    <div className="flex flex-col gap-5">
      <Cabecalho nota={nota} pedidoNumero={null} />

      <Trilho etapa={podeAvancar ? 2 : 1} />

      {podeTratarNota && (
        <PainelNota nota={nota} faltamRelacionar={semProduto.length} emConferencia={false} />
      )}

      {/* Etapa 1. Nada acontece antes disto: sem produto relacionado não há
          custo, não há saldo e não há conferência. É a etapa que trava — e por
          isso vem primeiro, com o que falta no topo da tabela. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[15px] font-semibold text-ink">
            1 · Relacionar os itens ao catálogo
          </h2>
          <p className="flex items-center gap-2 text-[12px]">
            <span className={podeAvancar ? "text-ok" : "text-warn"}>
              {podeAvancar
                ? `Os ${itensNota.length} itens da nota já têm produto.`
                : `${semProduto.length} de ${itensNota.length} ${
                    semProduto.length === 1 ? "item ainda sem produto" : "itens ainda sem produto"
                  }.`}
            </span>
            {podeAvancar && (
              <button
                type="button"
                onClick={() => setVerTabela((v) => !v)}
                aria-expanded={verTabela}
                className="font-medium text-brand underline"
              >
                {verTabela ? "ocultar" : "ver tabela"}
              </button>
            )}
          </p>
        </div>

        {verTabela && (
          <TabelaDePara
            inboundId={nota.id}
            itens={itensNota}
            sugestoesIniciais={dados.sugestoesDePara}
            editavel
            podeCriarProduto={podeCriarProduto}
            supplierId={nota.supplierId}
            siteId={nota.siteId}
            subcategorias={subcategorias}
          />
        )}

        {/* A nota fecha? Soma dos itens contra o total do XML. Se o parse
            perdeu uma linha ou o frete entrou fora, é aqui que aparece —
            depois da entrada vira custo médio e ninguém mais discute. */}
        <Fechamento itens={totalItens} nota={nota.valorTotal} />
      </section>

      {/* Etapa 2. Três saídas, lado a lado. A nota fatura um pedido que já
          existe; o representante deixou mercadoria sem pedido e vale abrir um
          para o histórico; ou não há compra a documentar como pedido nenhum —
          só mercadoria na porta para conferir. Esconder qualquer uma joga o
          operador para outra tela no meio do recebimento.

          Quem não recebe mercadoria não escolhe porta: escolher decide o que
          vai movimentar estoque, e essa é a decisão de quem está na doca. */}
      {!podeReceber ? (
        <p className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Você trata a nota: relacionar os itens ao catálogo é a sua etapa. Quem recebe a
          mercadoria escolhe de onde ela veio e confere o que chegou.
        </p>
      ) : (
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[15px] font-semibold text-ink">
            2 · De onde veio esta mercadoria
          </h2>
          <p className="text-[12px] text-muted">
            {fmtMoney(totalItens)} em {itensNota.length}{" "}
            {itensNota.length === 1 ? "item" : "itens"}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface p-5">
            <h3 className="font-display text-[14px] font-semibold text-ink">
              Vincular a um pedido existente
            </h3>
            <p className="mt-1 text-[13px] text-muted">
              {sugestoes.length === 0
                ? "Nenhum pedido em aberto deste fornecedor nesta loja."
                : "Nenhum candidato se destacou o bastante para o vínculo automático — escolha o certo."}
            </p>

            <ul className="mt-4 space-y-2">
              {sugestoes.map((s) => (
                <li
                  key={s.purchaseOrderId}
                  className="flex items-center gap-3 rounded-[var(--radius)] border border-line px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-medium text-ink">{s.numero}</p>
                    <p className="truncate text-[12px] text-muted">
                      {s.itens} {s.itens === 1 ? "item" : "itens"} · {fmtMoney(s.valorTotal)} ·{" "}
                      {fmtQuando(String(s.criadoEm))}
                    </p>
                    {s.motivos.length > 0 && (
                      <p className="mt-1 truncate text-[12px] text-brand">
                        {s.motivos.join(" · ")}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void vincular(s.purchaseOrderId)}
                    disabled={salvando !== null}
                  >
                    {salvando === s.purchaseOrderId ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Link2 className="h-4 w-4" aria-hidden />
                    )}
                    Vincular
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col rounded-[var(--radius-lg)] border border-brand/30 bg-brand-soft/40 p-5">
            <h3 className="font-display text-[14px] font-semibold text-ink">
              Criar o pedido a partir desta nota
            </h3>
            <p className="mt-1 text-[13px] text-ink-2">
              Compra que chegou sem pedido — representante na porta, entrega de rota. O pedido
              nasce com os {itensNota.length} itens da nota, {fmtMoney(totalItens)} em mercadoria,
              já conciliado e pronto para conferir.
            </p>

            {!podeAvancar && (
              // O pedido é feito DE produtos: nascer com linhas sem catálogo
              // seria um pedido que não dá para comparar com nada depois.
              <p className="mt-3 rounded-[var(--radius)] bg-surface px-3 py-2 text-[12px] text-accent">
                Termine a etapa 1 — o pedido nasceria incompleto com{" "}
                {semProduto.length === 1
                  ? "1 item sem produto"
                  : `${semProduto.length} itens sem produto`}
                .
              </p>
            )}

            <div className="mt-auto pt-4">
              <Button
                onClick={() => void gerarPedido()}
                disabled={salvando !== null || !podeAvancar}
              >
                {salvando === "novo" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FilePlus2 className="h-4 w-4" aria-hidden />
                )}
                Criar pedido com os itens da nota
              </Button>
            </div>
          </div>

          <div className="flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface p-5">
            <h3 className="font-display text-[14px] font-semibold text-ink">
              Só conferir e receber
            </h3>
            <p className="mt-1 text-[13px] text-muted">
              Sem pedido nenhum, nem agora nem depois. A nota vira a referência da conferência:
              você confere os {itensNota.length} itens contra o que ela diz e dá entrada. O
              documento da compra é a própria NF-e.
            </p>

            <p className="mt-3 text-[12px] text-faint">
              A mercadoria entra no estoque igual — o que não existe é a camada de pedido para
              comparar preço e quantidade negociados.
            </p>

            {!podeAvancar && (
              // Não bloqueia: com o caminhão na porta, contar primeiro e
              // relacionar depois é a ordem certa. Mas a entrada não fecha
              // enquanto sobrar item sem produto, e isso se diz agora.
              <p className="mt-3 rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-[12px] text-muted">
                Dá para conferir já. A entrada no estoque só fecha depois que a etapa 1 terminar.
              </p>
            )}

            <div className="mt-auto pt-4">
              <Button
                variant="secondary"
                onClick={() => void receberSemPedido()}
                disabled={salvando !== null}
              >
                {salvando === "sem-pedido" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                )}
                Conferir sem pedido
              </Button>
            </div>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

/**
 * A nota fecha com ela mesma?
 *
 * A soma dos itens raramente é igual ao total da NF-e — frete, ST e IPI entram
 * fora da mercadoria. O que importa não é o zero: é a diferença ter TAMANHO de
 * imposto, e não de item faltando. Acima de 15% o parse provavelmente perdeu
 * linha, e receber assim põe no estoque uma mercadoria que ninguém conferiu.
 */
function Fechamento({ itens, nota }: { itens: number; nota: number }) {
  const dif = nota - itens;
  const pct = nota > 0 ? Math.abs(dif) / nota : 0;
  const suspeito = pct >= 0.15;

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius)] border px-3.5 py-2.5 text-[12px]",
        suspeito ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface-2 text-muted",
      )}
    >
      <span>
        Itens: <span className="font-mono text-ink-2">{fmtMoney(itens)}</span>
      </span>
      <span>
        Total da nota: <span className="font-mono text-ink-2">{fmtMoney(nota)}</span>
      </span>
      <span>
        Diferença: <span className="font-mono">{fmtMoney(dif)}</span>
      </span>
      <span className={suspeito ? "font-medium" : "text-faint"}>
        {suspeito
          ? "Diferença grande para ser só frete e imposto — confira se falta item."
          : "Compatível com frete, ST e IPI."}
      </span>
    </p>
  );
}

/**
 * O trilho do recebimento. Três etapas, sempre as mesmas, sempre visíveis: o
 * operador precisa saber em que pé está uma nota que abriu ontem e voltou a
 * abrir hoje — e o que ainda falta antes de a mercadoria virar saldo.
 */
function Trilho({ etapa }: { etapa: 1 | 2 | 3 }) {
  const etapas = [
    { n: 1 as const, titulo: "Relacionar ao catálogo" },
    { n: 2 as const, titulo: "Origem da mercadoria" },
    { n: 3 as const, titulo: "Conferir e dar entrada" },
  ];

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {etapas.map((e, i) => {
        const feita = e.n < etapa;
        const atual = e.n === etapa;
        return (
          <React.Fragment key={e.n}>
            {i > 0 && (
              <span className="text-faint" aria-hidden>
                ·
              </span>
            )}
            <li className="flex items-center gap-1.5">
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold",
                  atual && "bg-brand text-on-brand",
                  feita && "bg-ok-soft text-ok",
                  !atual && !feita && "bg-surface-2 text-faint",
                )}
                aria-hidden
              >
                {feita ? <Check className="h-3 w-3" /> : e.n}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  atual ? "font-medium text-ink" : feita ? "text-muted" : "text-faint",
                )}
                aria-current={atual ? "step" : undefined}
              >
                {e.titulo}
              </span>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
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
  const { nota, pedido, semPedido, resumo, timeline } = dados;
  // Nota já recebida e pessoa que não recebe mercadoria dão no mesmo lugar:
  // a conferência é só leitura. Contar caixa é decisão de quem está na doca.
  const encerrada = nota.status === "RECEBIDO" || !podeReceber;

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
  const [camera, setCamera] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [verTimeline, setVerTimeline] = React.useState(false);
  const [relacionar, setRelacionar] = React.useState<ItemDeNota | null>(null);

  const conferidos = linhas.filter((l) => l.qtdRecebida != null).length;
  const divergentes = linhas.filter((l) => STATUS_INFO[l.status].grave && !l.resolucao);
  const impacto = resumo.impactoCusto;

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
      try {
        await conferirItemAction({ inboundId: nota.id, itemId: linhaId, ...dadosItem });
      } catch (e) {
        toast.error("Não deu para salvar", e instanceof Error ? e.message : "Tente de novo.");
        router.refresh();
      }
    },
    [nota.id, router],
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
        toast.error("Fora desta nota", `O código ${codigo} não está entre os itens.`);
        return;
      }
      const atual = achado.linha.qtdRecebida ?? 0;
      const nova = atual + achado.incremento;
      aplicarLocal(achado.linha.id, { qtdRecebida: nova });
      void salvar(achado.linha.id, { qtdRecebida: nova });
      toast.success(
        achado.linha.descricao,
        cega ? `${fmtQtd(nova)} contado(s)` : `${fmtQtd(nova)} de ${fmtQtd(achado.linha.qtdFaturada)}`,
      );
    },
    [porCodigo, aplicarLocal, salvar, encerrada, cega],
  );

  // Leitor USB/Bluetooth funciona sem foco em campo nenhum — quem está na
  // porta tem o leitor numa mão e a caixa na outra.
  useLeitorTeclado(aoLerCodigo, { ativo: !encerrada });

  async function conferirTudo() {
    try {
      await conferirTudoAction(nota.id);
      setLinhas((prev) => prev.map((l) => ({ ...l, qtdRecebida: l.qtdFaturada })));
      toast.success("Tudo conferido conforme a nota.", "Revise antes de dar entrada.");
      router.refresh();
    } catch (e) {
      toast.error("Não deu para confirmar", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  async function confirmarEntrada() {
    setEnviando(true);
    try {
      await confirmarEntradaAction(nota.id);
      toast.success(
        "Entrada registrada.",
        semPedido
          ? "Estoque e custo médio atualizados — a NF-e é o documento desta compra."
          : "Estoque, custo médio e pedido já foram atualizados.",
      );
      setConfirmando(false);
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível receber", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  async function desvincular() {
    try {
      await desvincularPedidoAction(nota.id);
      toast.info(
        semPedido ? "Conferência cancelada." : "Vínculo desfeito.",
        "Escolha de novo como receber esta nota.",
      );
      router.refresh();
    } catch (e) {
      toast.error("Não deu para desvincular", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter((l) =>
      `${l.descricao} ${l.sku ?? ""} ${l.ean ?? ""} ${l.codigoFornecedor ?? ""}`
        .toLowerCase()
        .includes(termo),
    );
  }, [linhas, busca]);

  return (
    <div className="flex flex-col gap-5 pb-24">
      {camera && (
        <Scanner
          onCodigo={aoLerCodigo}
          continuo
          onFechar={() => setCamera(false)}
          dica="Bipe a unidade, a caixa ou o fardo"
        />
      )}

      <Cabecalho
        nota={nota}
        pedidoNumero={pedido?.numero ?? null}
        semPedido={semPedido}
        onDesvincular={encerrada ? undefined : desvincular}
      />

      {!encerrada && <Trilho etapa={3} />}

      {podeTratarNota && (
        <PainelNota
          nota={nota}
          faltamRelacionar={resumo.produtosNovos}
          emConferencia
        />
      )}

      {/* Sem pedido não há preço negociado para comparar: a métrica de custo
          alterado sairia sempre zero e ocuparia espaço mentindo por omissão. */}
      <MetricaGrid className={semPedido ? "lg:grid-cols-4" : "lg:grid-cols-5"}>
        <Metrica
          label="Itens"
          valor={String(resumo.itens)}
          sub={semPedido ? "linhas da nota" : "linhas conciliadas"}
        />
        <Metrica
          label="Valor da nota"
          valor={fmtMoney(resumo.valorNota)}
          sub={pedido ? `pedido ${fmtMoney(pedido.valorTotal)}` : "sem pedido para comparar"}
        />
        <Metrica
          label="Divergências"
          valor={String(divergentes.length)}
          sub={
            divergentes.length > 0
              ? "precisam de decisão"
              : semPedido
                ? "confira contra a nota"
                : "nota igual ao pedido"
          }
          tom={divergentes.length > 0 ? "accent" : "ok"}
          icon={<TriangleAlert size={13} />}
        />
        {!semPedido && (
          <Metrica
            label="Custos alterados"
            valor={String(resumo.custosAlterados)}
            sub={impacto === 0 ? "preço igual ao negociado" : `${impacto > 0 ? "+" : ""}${fmtMoney(impacto)} nesta nota`}
            tom={resumo.custosAlterados > 0 ? "accent" : "ok"}
          />
        )}
        <Metrica
          label="Produtos novos"
          valor={String(resumo.produtosNovos)}
          sub={resumo.produtosNovos === 0 ? "tudo relacionado" : "faltam relacionar ao catálogo"}
          tom={resumo.produtosNovos > 0 ? "accent" : "ok"}
          icon={<PackageOpen size={13} />}
        />
      </MetricaGrid>

      {/* Conferência cega: mostrar as divergências antes da contagem entregaria
          justamente o número que a pessoa não pode ver. O painel espera todo
          mundo ser contado. */}
      {divergentes.length > 0 && (!cega || conferidos === linhas.length) && (
        <PainelDivergencias
          inboundId={nota.id}
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
        nota.status === "RECEBIDO" ? (
          <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-[13px] text-ok">
            Esta nota já deu entrada no estoque. A conferência está encerrada — o histórico
            abaixo mostra como ela foi feita.
          </p>
        ) : (
          <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
            Esta conferência está em andamento. Você acompanha o que já foi contado; quem
            recebe a mercadoria é quem conta e dá a entrada.
          </p>
        )
      ) : (
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
          {!cega && (
            <Button variant="secondary" onClick={() => void conferirTudo()}>
              <CheckCheck className="h-4 w-4" aria-hidden />
              Conferi tudo conforme a nota
            </Button>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {visiveis.map((l) => (
          <ItemCard
            key={l.id}
            linha={l}
            bloqueado={encerrada}
            cega={cega}
            semPedido={semPedido}
            onAlterar={(patch) => {
              aplicarLocal(l.id, patch);
              void salvar(l.id, patch);
            }}
            onRelacionar={() => setRelacionar(paraRelacionar(l))}
          />
        ))}
      </ul>

      {visiveis.length === 0 && (
        <p className="rounded-[var(--radius)] border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          Nenhum item com “{busca.trim()}”.
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
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {conferidos} de {linhas.length} itens conferidos
              </p>
              <p className="truncate text-[12px] text-muted">
                {divergentes.length > 0
                  ? `${divergentes.length} ${divergentes.length === 1 ? "divergência aberta" : "divergências abertas"} — o que não for conferido entra como está na nota.`
                  : "Tudo conferido. Falta apenas confirmar a entrada física."}
              </p>
            </div>
            <Button onClick={() => setConfirmando(true)} disabled={enviando}>
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              Confirmar entrada no estoque
            </Button>
          </div>
        </div>
      )}

      <Sheet
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title="Confirmar entrada no estoque"
        description={
          semPedido
            ? "Isto atualiza saldo, custo médio e histórico de compras. A NF-e fica como documento desta entrada. Não dá para desfazer por aqui."
            : "Isto atualiza saldo, custo médio, histórico de compras e o status do pedido. Não dá para desfazer por aqui."
        }
        width="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmando(false)} className="flex-1">
              Voltar
            </Button>
            <Button onClick={() => void confirmarEntrada()} disabled={enviando} className="flex-1">
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-[13px] text-ink-2">
          <p>
            Entram <strong className="text-ink">{linhas.filter((l) => (l.qtdRecebida ?? l.qtdFaturada) > 0).length}</strong>{" "}
            itens, pelo custo da nota.
          </p>
          {linhas.length - conferidos > 0 && (
            <p className="rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-accent">
              {linhas.length - conferidos}{" "}
              {linhas.length - conferidos === 1 ? "item não foi conferido" : "itens não foram conferidos"}{" "}
              — entram com a quantidade que a nota informa.
            </p>
          )}
          {divergentes.length > 0 && (
            <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-danger">
              {divergentes.length}{" "}
              {divergentes.length === 1 ? "divergência segue aberta" : "divergências seguem abertas"}.
              Elas ficam registradas no histórico {semPedido ? "desta nota" : "do pedido"}.
            </p>
          )}
        </div>
      </Sheet>

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

// ── Cabeçalho ───────────────────────────────────────────────

function Cabecalho({
  nota,
  pedidoNumero,
  semPedido,
  onDesvincular,
}: {
  nota: RecebimentoView["nota"];
  pedidoNumero: string | null;
  /** Conferência aberta sem pedido — o rótulo do voltar muda com isso. */
  semPedido?: boolean;
  onDesvincular?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link
        href="/pedidos"
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-button text-ink-2 hover:bg-surface-2"
        aria-label="Voltar para os pedidos de compra"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </Link>

      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[19px] font-semibold text-ink">
          Recebimento inteligente
        </h1>
        <p className="truncate text-[13px] text-muted">
          {pedidoNumero && (
            <>
              <span className="font-mono text-ink-2">{pedidoNumero}</span>
              {" · "}
            </>
          )}
          {nota.fornecedor} ·{" "}
          <span className="font-mono">
            NF {nota.numero}/{nota.serie}
          </span>{" "}
          · {nota.siteNome}
        </p>
        {semPedido && (
          <p className="mt-1 text-[12px] text-muted">
            Conferência sem pedido — a nota é a referência do que deveria vir.
          </p>
        )}
        {nota.vinculoAutomatico && pedidoNumero && (
          <p className="mt-1 text-[12px] text-brand">
            Pedido {pedidoNumero} encontrado automaticamente pela nota.
          </p>
        )}
        {nota.duplicatas.length > 0 && (
          <p className="mt-1 text-[12px] text-muted">
            {nota.duplicatas.length === 1 ? "Vencimento" : `${nota.duplicatas.length} parcelas`}:{" "}
            {nota.duplicatas
              .map(
                (d) =>
                  `${new Date(d.vencimento).toLocaleDateString("pt-BR")} ${fmtMoney(d.valor)}`,
              )
              .join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {nota.temXml && (
          // O contador pede o XML, e sem isto o operador volta ao e-mail do
          // fornecedor procurar o anexo que já está guardado aqui.
          <a
            href={`/api/fiscal/entrada/${nota.id}/xml`}
            className="hidden items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-line hover:text-ink sm:inline-flex"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Baixar XML
          </a>
        )}
        {onDesvincular && (pedidoNumero || semPedido) && (
          <Button variant="ghost" size="sm" onClick={onDesvincular}>
            {pedidoNumero ? "Trocar pedido" : "Trocar forma de receber"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Painel de divergências ──────────────────────────────────
// Ninguém deve caçar erro numa lista de trinta itens: o que está errado sobe
// para o topo, com a decisão ao lado.

function PainelDivergencias({
  inboundId,
  linhas,
  bloqueado,
  onRelacionar,
}: {
  inboundId: string;
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
          {linhas.length === 1 ? "1 divergência encontrada" : `${linhas.length} divergências encontradas`}
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
                              () => aceitarCustoAction({ inboundId, itemId: l.id }),
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

      {avisar && <SheetAvisarFornecedor inboundId={inboundId} onClose={() => setAvisar(false)} />}

      {devolver && (
        <SheetDevolver
          inboundId={inboundId}
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
                  inboundId,
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

  const digitos = (dados?.telefone ?? "").replace(/D/g, "");
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
  inboundId,
  linha,
  onClose,
  onFeito,
}: {
  inboundId: string;
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
          inboundId,
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

function ItemCard({
  linha,
  bloqueado,
  cega,
  semPedido,
  onAlterar,
  onRelacionar,
}: {
  linha: LinhaRecebimento;
  bloqueado: boolean;
  /** Esconde pedido/NF enquanto a linha não foi contada. */
  cega?: boolean;
  /** Recebimento sem pedido: não existe coluna "Pedido" para mostrar. */
  semPedido?: boolean;
  onAlterar: (patch: { qtdRecebida?: number | null; lote?: string | null; validade?: string | null }) => void;
  onRelacionar: () => void;
}) {
  const info = STATUS_INFO[linha.status];
  const v = variacaoDaLinha(linha);
  const [aberto, setAberto] = React.useState(false);
  const recebido = linha.qtdRecebida;
  /** Contou? Então pode ver. Antes disso, o número do pedido enviesa a contagem. */
  const oculto = Boolean(cega) && recebido == null && !bloqueado;

  return (
    <li
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border bg-surface",
        info.grave && !linha.resolucao ? "border-accent/40" : "border-line",
      )}
    >
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
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
          </span>
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

        <span className="hidden shrink-0 items-center gap-5 sm:flex">
          {oculto ? (
            <Coluna titulo={semPedido ? "NF" : "Pedido / NF"} valor="•••" />
          ) : (
            <>
              {!semPedido && <Coluna titulo="Pedido" valor={fmtQtd(linha.qtdPedida)} />}
              <Coluna titulo="NF" valor={fmtQtd(linha.qtdFaturada)} />
            </>
          )}
          <Coluna
            titulo="Recebido"
            valor={recebido == null ? "—" : fmtQtd(recebido)}
            destaque={recebido != null}
          />
        </span>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
            linha.resolucao || oculto ? "bg-surface-2 text-muted" : info.classe,
          )}
        >
          {linha.resolucao ? "Resolvido" : oculto ? "A conferir" : info.label}
        </span>
      </button>

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
              <Campo label="Quantidade recebida">
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  defaultValue={recebido ?? ""}
                  placeholder={oculto ? "conte e digite" : fmtQtd(linha.qtdFaturada)}
                  onBlur={(e) => {
                    const bruto = e.target.value.trim();
                    onAlterar({ qtdRecebida: bruto === "" ? null : Number(bruto) });
                  }}
                  className="h-10 w-32 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink tabular-nums focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </Campo>
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

              <Button
                variant="secondary"
                size="sm"
                onClick={() => onAlterar({ qtdRecebida: linha.qtdFaturada })}
              >
                <Check className="h-4 w-4" aria-hidden />
                Recebi como na nota
              </Button>

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
}

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
