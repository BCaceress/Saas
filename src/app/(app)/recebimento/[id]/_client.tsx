"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  CircleX,
  Check,
  CheckCheck,
  ClipboardCheck,
  FilePlus2,
  FileText,
  History,
  Link2,
  Loader2,
  PackageOpen,
  PackagePlus,
  Plus,
  Trash2,
  ScanLine,
  Search,
  Send,
  MoreVertical,
  Undo2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
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
import { frasesDeConversao, rotuloDaUnidade } from "@/lib/fiscal/unidades";
import { Metrica, MetricaGrid, fmtMoney, fmtQtd, fmtQuando } from "../../cotacoes/_catalogo/ui";
import {
  aceitarCustoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  finalizarRecebimentoAction,
  cancelarRecebimentoAction,
  conferirItemAction,
  conferirTudoAction,
  criarPedidoDaNotaAction,
  desvincularPedidoAction,
  receberSemPedidoAction,
  resolverDivergenciaAction,
  restaurarContagemAction,
  vincularPedidoAction,
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
  // contra a contagem. Só o XML tem porta a escolher — quem clicou "Iniciar
  // recebimento" num pedido já entra conferindo, e o avulso também.
  if (dados.escolherPorta && dados.nota) {
    return (
      <EscolherPedido
        dados={dados}
        nota={dados.nota}
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
  nota,
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  subcategorias,
}: {
  dados: RecebimentoView;
  /** Esta etapa só existe com nota — é ela que está sendo decidida aqui. */
  nota: NonNullable<RecebimentoView["nota"]>;
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { sugestoes, itensNota } = dados;
  const [salvando, setSalvando] = React.useState<string | null>(null);

  const semProduto = itensNota.filter((i) => !i.productId);
  const totalItens = itensNota.reduce((s, i) => s + i.valorTotal, 0);

  async function vincular(purchaseOrderId: string) {
    setSalvando(purchaseOrderId);
    try {
      await vincularPedidoAction({ inboundId: nota.id, purchaseOrderId });
      toast.success("Nota conciliada com o pedido.", "Confira a mercadoria para receber no estoque.");
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
  // O que entra no saldo se a nota for recebida como está — a conta que o
  // operador não faz de cabeça e que muda com cada conversão confirmada.
  const unidades = itensNota.reduce(
    (s, i) => s + (i.productId ? i.quantidade * i.fatorConversao : 0),
    0,
  );

  /**
   * De onde veio esta compra. Antes eram três cards lado a lado, cada um com
   * um parágrafo e um botão próprio: três decisões de peso igual competindo,
   * e o operador lendo tudo para descobrir qual era a dele. Agora é uma
   * pergunta com três respostas — só a escolhida se abre, e o botão de agir é
   * um só, no rodapé.
   */
  type Porta = "PEDIDO" | "NOVO" | "SEM_PEDIDO";
  const [porta, setPorta] = React.useState<Porta | null>(
    sugestoes.length > 0 ? "PEDIDO" : null,
  );
  const [pedidoEscolhido, setPedidoEscolhido] = React.useState<string | null>(
    sugestoes[0]?.purchaseOrderId ?? null,
  );

  const itensRef = React.useRef<HTMLDivElement>(null);

  /** A ação que o botão do rodapé dispara, conforme a resposta escolhida. */
  function seguir() {
    if (porta === "PEDIDO" && pedidoEscolhido) void vincular(pedidoEscolhido);
    else if (porta === "NOVO") void gerarPedido();
    else if (porta === "SEM_PEDIDO") void receberSemPedido();
  }

  /** Por que o botão do rodapé está travado, quando está. */
  const impedimento =
    porta === null
      ? "Escolha de onde veio esta mercadoria."
      : porta === "PEDIDO" && !pedidoEscolhido
        ? "Escolha o pedido que esta nota fatura."
        : porta === "NOVO" && !podeAvancar
          ? `${semProduto.length} ${semProduto.length === 1 ? "item precisa" : "itens precisam"} de produto antes de criar o pedido.`
          : null;

  const CTA: Record<Porta, string> = {
    PEDIDO: "Vincular e conferir",
    NOVO: "Criar pedido e conferir",
    SEM_PEDIDO: "Conferir e receber",
  };

  return (
    <div className="flex min-h-full flex-col gap-5">
      <Cabecalho recebimento={dados.recebimento} nota={nota} pedidoNumero={null} />

      <Trilho etapa={podeAvancar ? 2 : 1} />

      {podeTratarNota && (
        <PainelNota nota={nota} faltamRelacionar={semProduto.length} emConferencia={false} />
      )}

      {/* Etapa 1. Nada acontece antes disto: sem produto relacionado não há
          custo, não há saldo e não há conferência. É a etapa que trava — e por
          isso vem primeiro, com o que falta no topo da tabela. */}
      <section ref={itensRef} className="flex flex-col gap-3">
        <h2 className="font-display text-[15px] font-semibold text-ink">
          <span className="text-faint">1 · </span>Produtos
        </h2>

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

        {/* A nota fecha? Soma dos itens contra o total do XML. Se o parse
            perdeu uma linha ou o frete entrou fora, é aqui que aparece —
            depois da entrada vira custo médio e ninguém mais discute. */}
        <Fechamento itens={totalItens} nota={nota.valorTotal} />
      </section>

      {/* Etapa 2. Quem não recebe mercadoria não responde esta pergunta:
          responder decide o que vai movimentar estoque, e essa é a decisão de
          quem está na doca. */}
      {!podeReceber ? (
        <p className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Você trata a nota: relacionar os itens aos produtos é a sua etapa. Quem recebe a
          mercadoria diz de onde ela veio e confere o que chegou.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15px] font-semibold text-ink">
            <span className="text-faint">2 · </span>Existe um pedido para esta compra?
          </h2>

          <div className="flex flex-col gap-2" role="radiogroup" aria-label="De onde veio esta compra">
            <OpcaoPorta
              selecionada={porta === "PEDIDO"}
              onSelecionar={() => setPorta("PEDIDO")}
              titulo="Vincular a um pedido existente"
              ajuda="Use quando esta NF corresponde a uma compra já registrada."
              desabilitada={sugestoes.length === 0}
              motivoDesabilitada="Nenhum pedido em aberto deste fornecedor nesta loja."
            >
              <ul className="flex flex-col gap-2">
                {sugestoes.map((s) => (
                  <li key={s.purchaseOrderId}>
                    <button
                      type="button"
                      onClick={() => setPedidoEscolhido(s.purchaseOrderId)}
                      aria-pressed={pedidoEscolhido === s.purchaseOrderId}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors",
                        pedidoEscolhido === s.purchaseOrderId
                          ? "border-brand bg-brand-soft/50"
                          : "border-line hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                          pedidoEscolhido === s.purchaseOrderId
                            ? "border-brand bg-brand"
                            : "border-line-button",
                        )}
                        aria-hidden
                      >
                        {pedidoEscolhido === s.purchaseOrderId && (
                          <Check className="h-2.5 w-2.5 text-on-brand" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm font-medium text-ink">
                          {s.numero}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          {s.itens} {s.itens === 1 ? "item" : "itens"} · {fmtMoney(s.valorTotal)} ·{" "}
                          {fmtQuando(String(s.criadoEm))}
                        </span>
                        {s.motivos.length > 0 && (
                          <span className="mt-0.5 block truncate text-[12px] text-brand">
                            {s.motivos.join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </OpcaoPorta>

            <OpcaoPorta
              selecionada={porta === "NOVO"}
              onSelecionar={() => setPorta("NOVO")}
              titulo="Criar pedido com esta NF"
              ajuda="Use quando a mercadoria chegou sem pedido."
            >
              <p className="text-[13px] text-muted">
                Nenhum pedido foi encontrado. O NoHub pode criar um pedido automaticamente
                usando os {itensNota.length} itens desta nota — {fmtMoney(totalItens)} em
                mercadoria, já conciliado e pronto para conferir.
              </p>
              {!podeAvancar && (
                // O pedido é feito DE produtos: nascer com linhas sem catálogo
                // seria um pedido que não dá para comparar com nada depois.
                <p className="mt-2 flex items-start gap-2 rounded-[var(--radius)] bg-warn-soft px-3 py-2 text-[12px] text-warn">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {semProduto.length}{" "}
                    {semProduto.length === 1
                      ? "item ainda precisa ser relacionado"
                      : "itens ainda precisam ser relacionados"}{" "}
                    antes de criar o pedido.
                  </span>
                </p>
              )}
            </OpcaoPorta>

            <OpcaoPorta
              selecionada={porta === "SEM_PEDIDO"}
              onSelecionar={() => setPorta("SEM_PEDIDO")}
              titulo="Receber sem pedido"
              ajuda="Apenas confira a NF e lance a mercadoria no estoque."
            >
              <p className="text-[13px] text-muted">
                A mercadoria será lançada diretamente no estoque. A NF-e fica como referência
                do recebimento — o que não existe é a camada de pedido para comparar preço e
                quantidade negociados.
              </p>
              {!podeAvancar && (
                // Não bloqueia: com o caminhão na porta, contar primeiro e
                // relacionar depois é a ordem certa. Mas a entrada não fecha
                // enquanto sobrar item sem produto, e isso se diz agora.
                <p className="mt-2 rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-[12px] text-muted">
                  Dá para conferir já. A entrada no estoque só fecha depois que a etapa 1
                  terminar.
                </p>
              )}
            </OpcaoPorta>
          </div>
        </section>
      )}

      {/* O botão que faz a coisa acontecer não pode depender de o operador
          rolar quarenta linhas de volta para achá-lo. */}
      {podeReceber && (
        <RodapeAcao>
          <div className="min-w-0 flex-1">
            <MedidorRodape
              total={itensNota.length}
              feitos={itensNota.length - semProduto.length}
              atencao={0}
              rotulo="item com produto"
              rotuloPlural="itens com produto"
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
              {podeAvancar ? (
                <>
                  <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                  <span>
                    Entram{" "}
                    <span className="font-mono text-ink-2">+{fmtQtd(unidades)} UN</span> no
                    estoque quando a conferência fechar.
                  </span>
                </>
              ) : (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                  <span>
                    {semProduto.length}{" "}
                    {semProduto.length === 1
                      ? "item sem produto no catálogo"
                      : "itens sem produto no catálogo"}
                    .
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      itensRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="font-medium text-brand underline"
                  >
                    Ver pendências
                  </button>
                </>
              )}
            </p>
          </div>

          <div className="flex w-full shrink-0 flex-col items-stretch gap-1 sm:w-auto sm:items-end">
            <Button
              onClick={seguir}
              disabled={salvando !== null || impedimento !== null}
              className="w-full sm:w-auto"
            >
              {salvando !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : porta === "NOVO" ? (
                <FilePlus2 className="h-4 w-4" aria-hidden />
              ) : porta === "PEDIDO" ? (
                <Link2 className="h-4 w-4" aria-hidden />
              ) : (
                <ClipboardCheck className="h-4 w-4" aria-hidden />
              )}
              {salvando !== null ? "Abrindo conferência…" : porta ? CTA[porta] : "Conferir recebimento"}
            </Button>
            {impedimento && (
              <p className="text-[11px] text-muted sm:text-right">{impedimento}</p>
            )}
          </div>
        </RodapeAcao>
      )}
    </div>
  );
}

/**
 * Uma resposta da pergunta "de onde veio esta compra?".
 *
 * Fechada é uma linha: título e para que serve. Aberta traz o que aquela
 * resposta precisa — a lista de pedidos, o aviso do que falta. O detalhe das
 * outras duas não fica competindo com a que a pessoa escolheu.
 */
function OpcaoPorta({
  selecionada,
  onSelecionar,
  titulo,
  ajuda,
  desabilitada,
  motivoDesabilitada,
  children,
}: {
  selecionada: boolean;
  onSelecionar: () => void;
  titulo: string;
  ajuda: string;
  desabilitada?: boolean;
  motivoDesabilitada?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border transition-colors",
        selecionada ? "border-brand bg-brand-soft/25" : "border-line bg-surface",
        desabilitada && "opacity-60",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selecionada}
        disabled={desabilitada}
        onClick={onSelecionar}
        className="flex w-full items-start gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
      >
        <span
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
            selecionada ? "border-brand bg-brand" : "border-line-button",
          )}
          aria-hidden
        >
          {selecionada && <Check className="h-2.5 w-2.5 text-on-brand" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">{titulo}</span>
          <span className="block text-[12px] text-muted">
            {desabilitada ? (motivoDesabilitada ?? ajuda) : ajuda}
          </span>
        </span>
      </button>
      {selecionada && !desabilitada && children && (
        <div className="border-t border-line/70 px-4 py-3">{children}</div>
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
const ETAPAS = [
  { n: 1 as const, titulo: "Produtos", ajuda: "Relacione os itens da NF aos produtos do NoHub" },
  { n: 2 as const, titulo: "Compra", ajuda: "Informe de onde veio esta mercadoria" },
  { n: 3 as const, titulo: "Conferência", ajuda: "Confira e dê entrada no estoque" },
];

function Trilho({ etapa }: { etapa: 1 | 2 | 3 }) {
  const atualInfo = ETAPAS.find((e) => e.n === etapa)!;

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {ETAPAS.map((e, i) => {
          const feita = e.n < etapa;
          const atual = e.n === etapa;
          return (
            <React.Fragment key={e.n}>
              {i > 0 && (
                <span className="text-faint" aria-hidden>
                  →
                </span>
              )}
              <li
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2 py-1",
                  // Só a etapa atual ganha fundo: um trilho em que os três
                  // passos pesam igual não diz onde a pessoa está.
                  atual && "bg-brand-soft",
                )}
              >
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
                    atual ? "font-semibold text-ink" : feita ? "text-muted" : "text-faint",
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
      <p className="text-[13px] text-muted">{atualInfo.ajuda}</p>
    </div>
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
  /** Uma frase para o que não bateu — pedida uma vez, no fechamento. */
  const [motivoDivergencia, setMotivoDivergencia] = React.useState("");

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
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
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
  // alguém contou; o faturado, quando ninguém contou. É a mesma regra que o
  // servidor aplica em `confirmarEntradaAction` — a tela só a mostra antes.
  const entraNoEstoque = linhas.reduce((s, l) => s + (l.qtdRecebida ?? l.qtdFaturada), 0);
  /** Tudo que ainda espera uma decisão da pessoa antes de receber. */
  const pendencias = divergentes.length + resumo.produtosNovos;

  /**
   * Linhas contadas diferente do esperado e ainda sem explicação — mesma régua
   * que o servidor aplica ao fechar. Uma frase resolve o recebimento inteiro:
   * pedir justificativa item a item para uma carga que veio pela metade é o
   * tipo de formulário que faz o operador desistir e lançar tudo à mão.
   */
  const esperadoDe = (l: LinhaRecebimento) => l.qtdFaturada || l.qtdPedida;
  const naoExplicadas = linhas.filter(
    (l) =>
      !l.motivoDivergencia &&
      l.resolucao !== "ACEITO" &&
      l.resolucao !== "IGNORADO" &&
      Math.abs((l.qtdRecebida ?? esperadoDe(l)) - esperadoDe(l)) > 0.001,
  );
  const precisaMotivo = naoExplicadas.length > 0;

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

  async function confirmarEntrada() {
    setEnviando(true);
    try {
      const r = await finalizarRecebimentoAction({
        receiptId: recebimento.id,
        motivoDivergencia: motivoDivergencia.trim() || null,
      });
      toast.success(
        `Recebimento ${r.numero} finalizado.`,
        pedido
          ? r.pedidoCompleto
            ? `Estoque atualizado. Pedido ${pedido.numero} recebido por completo.`
            : `Estoque atualizado. Pedido ${pedido.numero} segue aberto para o que falta.`
          : "Estoque e custo médio atualizados.",
      );
      setConfirmando(false);
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível receber", e instanceof Error ? e.message : "Tente de novo.");
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

      {!encerrada && <Trilho etapa={3} />}

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
              {pendencias > 0 ? (
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
                  <span>Tudo conferido. Falta apenas confirmar a entrada física.</span>
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
              disabled={enviando}
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
            <Button
              onClick={() => void confirmarEntrada()}
              disabled={enviando || (precisaMotivo && motivoDivergencia.trim().length < 3)}
              className="flex-1"
            >
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
              Elas ficam registradas no histórico deste recebimento.
            </p>
          )}

          {/* Uma frase, uma vez. Sem ela, a diferença vira daqui a três meses a
              palavra do estoquista contra a do fornecedor. */}
          {precisaMotivo && (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                O que aconteceu com {naoExplicadas.length === 1 ? "a linha" : "as"}{" "}
                {naoExplicadas.length === 1 ? "que não bateu" : `${naoExplicadas.length} linhas que não bateram`}?
              </span>
              <textarea
                value={motivoDivergencia}
                onChange={(e) => setMotivoDivergencia(e.target.value)}
                rows={2}
                placeholder="Ex.: veio só metade da carga, o resto o motorista traz amanhã."
                className="w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
              />
              <span className="mt-1 block text-[12px] text-muted">
                Fica na história do recebimento e do pedido.
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

// ── Rodapé de ação ──────────────────────────────────────────

/**
 * A barra que fecha as duas etapas.
 *
 * `sticky`, não `fixed`: fixo se ancora na viewport inteira, passa por baixo
 * da sidebar e obriga a chutar um `pb-24` que o texto de duas linhas do
 * celular estoura — escondendo o último item da nota.
 *
 * Uma casca só para as duas etapas. Antes cada uma desenhava a sua: mesma
 * altura, mesmo botão, e os números do topo repetidos aqui embaixo em corpo
 * menor. Agora o rodapé responde só duas coisas — quanto falta e o que
 * acontece ao apertar —, e os totais ficam onde já estavam.
 */
function RodapeAcao({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-1 mt-auto sm:-mx-2">
      {/* Véu curto: diz que a lista continua por baixo da barra, em vez de a
          última linha parecer cortada por um traço. */}
      <div
        aria-hidden
        className="pointer-events-none h-5 bg-gradient-to-b from-transparent to-surface"
      />
      <div className="border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * "12 de 40" é um número que se lê; a barra é um estado que se vê.
 *
 * Dois saldos na mesma régua, como o medidor de estoque do produto: o que já
 * foi feito e, dentro dele, o que ainda pede decisão. Quem está na doca olha
 * de longe, com a caixa na mão — texto de 13px não se lê nessa distância.
 *
 * Serve as duas etapas: relacionar produto e contar mercadoria são a mesma
 * pergunta ("quanto falta para poder receber?") em momentos diferentes.
 */
function MedidorRodape({
  total,
  feitos,
  atencao,
  rotulo,
  rotuloPlural,
}: {
  total: number;
  feitos: number;
  /** Subconjunto de `feitos` que ainda espera uma decisão. */
  atencao: number;
  rotulo: string;
  rotuloPlural: string;
}) {
  const pctFeito = total > 0 ? (feitos / total) * 100 : 0;
  const pctAtencao = total > 0 ? (Math.min(atencao, feitos) / total) * 100 : 0;

  return (
    <div>
      <p className="flex items-baseline gap-2 font-display text-[15px] font-semibold text-ink">
        <span className="tabular-nums">
          {feitos} de {total}
        </span>
        <span className="text-[13px] font-normal text-muted">
          {total === 1 ? rotulo : rotuloPlural}
        </span>
      </p>
      <div
        className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={feitos}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={rotuloPlural}
      >
        {/* A fatia de atenção é subconjunto da feita — some da barra verde
            para não somar mais de 100%. */}
        <span
          className="h-full bg-ok transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pctFeito - pctAtencao}%` }}
        />
        <span
          className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pctAtencao}%` }}
        />
      </div>
    </div>
  );
}

// ── Cabeçalho ───────────────────────────────────────────────

function Cabecalho({
  recebimento,
  nota,
  pedidoNumero,
  semPedido,
  onDesvincular,
  onCancelar,
}: {
  recebimento: RecebimentoView["recebimento"];
  /** Nulo é caso normal: recebimento de pedido sem XML, ou avulso. */
  nota: RecebimentoView["nota"];
  pedidoNumero: string | null;
  /** Conferência aberta sem pedido — o rótulo do voltar muda com isso. */
  semPedido?: boolean;
  onDesvincular?: () => void;
  /** Abandonar a conferência sem mover estoque. */
  onCancelar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link
        href="/pedidos"
        className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-button text-ink-2 hover:bg-surface-2"
        aria-label="Voltar para os pedidos de compra"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </Link>

      {/* Hierarquia: quem mandou > qual papel > quanto. O nome do fornecedor é
          o que o operador procura na tela cheia de notas; "Recebimento
          inteligente" é onde ele está, não o que ele está olhando. */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span className="font-mono">{recebimento.numero}</span>
          <span aria-hidden>·</span>
          <span>Recebimento</span>
        </p>
        <h1 className="truncate font-display text-[20px] font-semibold text-ink">
          {recebimento.supplierNome ?? "Sem fornecedor"}
        </h1>
        <p className="truncate text-[13px] text-muted">
          {nota ? (
            <span className="font-mono">
              NF {nota.numero}/{nota.serie}
            </span>
          ) : recebimento.numeroNota ? (
            <span className="font-mono">NF {recebimento.numeroNota} (sem XML)</span>
          ) : (
            <span>Sem nota fiscal</span>
          )}
          {" · "}
          {recebimento.siteNome}
          {pedidoNumero && (
            <>
              {" · pedido "}
              <span className="font-mono text-ink-2">{pedidoNumero}</span>
            </>
          )}
        </p>
        {semPedido && (
          <p className="mt-1 text-[12px] text-muted">
            Sem pedido — a nota é a referência do que deveria vir.
          </p>
        )}
        {!nota && !pedidoNumero && (
          <p className="mt-1 text-[12px] text-muted">
            Recebimento avulso — sem pedido e sem nota. Some o que chegou.
          </p>
        )}
        {!nota && pedidoNumero && (
          <p className="mt-1 text-[12px] text-muted">
            Sem XML por enquanto. Você pode receber assim e vincular a NF-e quando ela chegar.
          </p>
        )}
        {nota?.vinculoAutomatico && pedidoNumero && (
          <p className="mt-1 text-[12px] text-brand">
            Pedido {pedidoNumero} encontrado automaticamente pela nota.
          </p>
        )}
        {nota && nota.duplicatas.length > 0 && (
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

      <div className="flex shrink-0 items-start gap-3">
        {nota && (
          <p className="text-right">
            <span className="block font-mono text-[20px] font-semibold text-ink">
              {fmtMoney(nota.valorTotal)}
            </span>
            <span className="block text-[11px] text-faint">total da nota</span>
          </p>
        )}

        {/* O que não é a decisão da vez sai do caminho. Baixar o XML e trocar
            a forma de receber são coisas que se faz uma vez por nota — não
            merecem competir com o botão de receber. */}
        <Menu
          trigger={
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full border border-line-button text-ink-2 transition-colors hover:bg-surface-2"
              aria-label="Mais opções desta nota"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          {nota?.temXml && (
            // O contador pede o XML, e sem isto o operador volta ao e-mail do
            // fornecedor procurar o anexo que já está guardado aqui.
            <MenuItem
              icon={<FileText size={15} />}
              onClick={() => {
                window.location.href = `/api/fiscal/entrada/${nota.id}/xml`;
              }}
            >
              Baixar XML
            </MenuItem>
          )}
          {onDesvincular && (pedidoNumero || semPedido) && (
            <MenuItem icon={<Undo2 size={15} />} onClick={onDesvincular}>
              {pedidoNumero ? "Trocar pedido" : "Trocar forma de receber"}
            </MenuItem>
          )}
          {onCancelar && (
            <MenuItem icon={<CircleX size={15} />} onClick={onCancelar} danger>
              Cancelar recebimento
            </MenuItem>
          )}
        </Menu>
      </div>
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
