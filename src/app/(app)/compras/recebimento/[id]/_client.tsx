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
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { termoDeBuscaDoItem, variacaoCusto } from "@/lib/compras/conciliacao-regras";
import { Metrica, MetricaGrid, fmtMoney, fmtQtd, fmtQuando } from "../../_catalogo/ui";
import {
  aceitarCustoAction,
  buscarProdutoAction,
  devolverDivergenciaAction,
  resumoDivergenciasAction,
  confirmarEntradaAction,
  conferirItemAction,
  conferirTudoAction,
  criarPedidoDaNotaAction,
  criarProdutoRapidoAction,
  desvincularPedidoAction,
  relacionarItemRecebimentoAction,
  resolverDivergenciaAction,
  vincularPedidoAction,
} from "../actions";
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

/** "a, b e c" — lista curta em português, sem vírgula antes do "e". */
const listar = (itens: string[]) =>
  itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;

/** Linha conciliada → o que o painel de relacionar precisa saber dela. */
const paraRelacionar = (l: LinhaRecebimento): ItemParaRelacionar => ({
  inboundItemId: l.inboundItemId,
  descricao: l.descricao,
  gtin: l.ean,
});

export function RecebimentoClient({
  dados,
  podeCriarProduto,
  cega,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeCriarProduto: boolean;
  /** Conferência cega: esconde pedido e NF até a pessoa contar. */
  cega: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  if (!dados.pedido) {
    return <EscolherPedido dados={dados} podeCriarProduto={podeCriarProduto} subcategorias={subcategorias} />;
  }
  return (
    <Conferencia
      dados={dados}
      podeCriarProduto={podeCriarProduto}
      cega={cega}
      subcategorias={subcategorias}
    />
  );
}

// ── Sem pedido vinculado ────────────────────────────────────

function EscolherPedido({
  dados,
  podeCriarProduto,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeCriarProduto: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { nota, sugestoes, itensNota } = dados;
  const [salvando, setSalvando] = React.useState<string | null>(null);
  const [relacionar, setRelacionar] = React.useState<ItemParaRelacionar | null>(null);

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

  return (
    <div className="flex flex-col gap-5">
      <Cabecalho nota={nota} pedidoNumero={null} />

      {/* Duas saídas, lado a lado: a nota fatura um pedido que já existe, ou o
          representante deixou a mercadoria sem pedido nenhum. Esconder a
          segunda obrigaria a digitar à mão um pedido que o XML já descreve. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <h2 className="font-display text-[15px] font-semibold text-ink">
            Vincular a um pedido existente
          </h2>
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
                    <p className="mt-1 truncate text-[12px] text-brand">{s.motivos.join(" · ")}</p>
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
          <h2 className="font-display text-[15px] font-semibold text-ink">
            Criar o pedido a partir desta nota
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Compra que chegou sem pedido — representante na porta, entrega de rota. O pedido
            nasce com os {itensNota.length} itens da nota, {fmtMoney(totalItens)} em mercadoria,
            já conciliado e pronto para conferir.
          </p>

          {semProduto.length > 0 && (
            <p className="mt-3 rounded-[var(--radius)] bg-surface px-3 py-2 text-[12px] text-accent">
              Faltam {semProduto.length}{" "}
              {semProduto.length === 1 ? "item sem produto" : "itens sem produto"} no catálogo.
              Relacione abaixo — sem isso o pedido nasceria incompleto.
            </p>
          )}

          <div className="mt-4">
            <Button
              onClick={() => void gerarPedido()}
              disabled={salvando !== null || semProduto.length > 0}
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
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-display text-[14px] font-semibold text-ink">Itens da nota</h2>
          <span className="text-[12px] text-muted">
            {itensNota.length - semProduto.length} de {itensNota.length} no catálogo
          </span>
        </div>

        <ul className="divide-y divide-line border-t border-line">
          {itensNota.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{i.descricao}</p>
                <p className="truncate font-mono text-[11px] text-muted">
                  {i.codigoFornecedor}
                  {i.gtin ? ` · ${i.gtin}` : ""} · {fmtQtd(i.quantidade)} {i.unidade}
                  {i.fatorConversao > 1 ? ` (×${fmtQtd(i.fatorConversao)} un)` : ""}
                </p>
              </div>

              <span className="shrink-0 font-mono text-[12px] text-muted">
                {fmtMoney(i.valorTotal)}
              </span>

              {i.productId ? (
                <span className="max-w-[16rem] shrink-0 truncate rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-medium text-ok">
                  {i.produtoNome ?? "No catálogo"}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setRelacionar({ inboundItemId: i.id, descricao: i.descricao, gtin: i.gtin })
                  }
                >
                  Relacionar produto
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Link
        href="/fiscal/notas-recebidas"
        className="text-[13px] font-medium text-brand hover:underline"
      >
        Prefere dar entrada sem pedido? Abrir em notas recebidas
      </Link>

      {relacionar && (
        <RelacionarProduto
          // Cada item pendente vira uma instância nova — reseta busca/estado
          // sozinho ao avançar na fila, sem efeito espelhando prop em state.
          key={relacionar.inboundItemId ?? relacionar.descricao}
          inboundId={nota.id}
          item={relacionar}
          restantes={Math.max(0, itensNota.filter((i) => !i.productId).length - 1)}
          onFechar={() => setRelacionar(null)}
          onRelacionado={(inboundItemId) => {
            const proximo = itensNota.find((i) => !i.productId && i.id !== inboundItemId);
            setRelacionar(proximo ? { inboundItemId: proximo.id, descricao: proximo.descricao, gtin: proximo.gtin } : null);
          }}
          podeCriarProduto={podeCriarProduto}
          subcategorias={subcategorias}
        />
      )}
    </div>
  );
}

// ── Conferência ─────────────────────────────────────────────

function Conferencia({
  dados,
  podeCriarProduto,
  cega,
  subcategorias,
}: {
  dados: RecebimentoView;
  podeCriarProduto: boolean;
  cega: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const { nota, pedido, resumo, timeline } = dados;
  const encerrada = nota.status === "RECEBIDO";

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
  const [relacionar, setRelacionar] = React.useState<ItemParaRelacionar | null>(null);

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
      toast.success("Entrada registrada.", "Estoque, custo médio e pedido já foram atualizados.");
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
      toast.info("Vínculo desfeito.", "Escolha outro pedido para esta nota.");
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

      <Cabecalho nota={nota} pedidoNumero={pedido!.numero} onDesvincular={encerrada ? undefined : desvincular} />

      <MetricaGrid className="lg:grid-cols-5">
        <Metrica label="Itens" valor={String(resumo.itens)} sub="linhas conciliadas" />
        <Metrica label="Valor da nota" valor={fmtMoney(resumo.valorNota)} sub={`pedido ${fmtMoney(pedido!.valorTotal)}`} />
        <Metrica
          label="Divergências"
          valor={String(divergentes.length)}
          sub={divergentes.length === 0 ? "nota igual ao pedido" : "precisam de decisão"}
          tom={divergentes.length > 0 ? "accent" : "ok"}
          icon={<TriangleAlert size={13} />}
        />
        <Metrica
          label="Custos alterados"
          valor={String(resumo.custosAlterados)}
          sub={impacto === 0 ? "preço igual ao negociado" : `${impacto > 0 ? "+" : ""}${fmtMoney(impacto)} nesta nota`}
          tom={resumo.custosAlterados > 0 ? "accent" : "ok"}
        />
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
          Conferência cega ligada: as quantidades do pedido e da nota aparecem depois que você
          contar. Conte {linhas.length - conferidos} de {linhas.length}{" "}
          {linhas.length === 1 ? "item" : "itens"} para ver o comparativo.
        </p>
      )}

      {encerrada ? (
        <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-[13px] text-ok">
          Esta nota já deu entrada no estoque. A conferência está encerrada — o histórico
          abaixo mostra como ela foi feita.
        </p>
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
          Histórico do pedido {pedido!.numero}
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
        description="Isto atualiza saldo, custo médio, histórico de compras e o status do pedido. Não dá para desfazer por aqui."
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
              Elas ficam registradas no histórico do pedido.
            </p>
          )}
        </div>
      </Sheet>

      {relacionar && (
        <RelacionarProduto
          key={relacionar.inboundItemId ?? relacionar.descricao}
          inboundId={nota.id}
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
  onDesvincular,
}: {
  nota: RecebimentoView["nota"];
  pedidoNumero: string | null;
  onDesvincular?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link
        href="/compras/recebimento"
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-button text-ink-2 hover:bg-surface-2"
        aria-label="Voltar para a fila de recebimento"
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
        {onDesvincular && pedidoNumero && (
          <Button variant="ghost" size="sm" onClick={onDesvincular}>
            Trocar pedido
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
  onAlterar,
  onRelacionar,
}: {
  linha: LinhaRecebimento;
  bloqueado: boolean;
  /** Esconde pedido/NF enquanto a linha não foi contada. */
  cega?: boolean;
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
        {linha.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={linha.imagemUrl}
            alt=""
            className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)] border border-line bg-surface object-contain"
          />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-muted">
            <PackageOpen className="h-4 w-4" aria-hidden />
          </span>
        )}

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
            <Coluna titulo="Pedido / NF" valor="•••" />
          ) : (
            <>
              <Coluna titulo="Pedido" valor={fmtQtd(linha.qtdPedida)} />
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

// ── Relacionar produto ──────────────────────────────────────

export type ItemParaRelacionar = {
  inboundItemId: string | null;
  descricao: string;
  gtin: string | null;
};

type ProdutoBusca = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: number;
  embalagens: { id: string; nome: string; ean: string | null; fator: number }[];
};

/** O GTIN da nota bate com algum código deste produto (unidade ou embalagem)? */
function casaPorCodigo(p: ProdutoBusca, gtin: string | null): boolean {
  if (!gtin) return false;
  return p.ean === gtin || p.embalagens.some((e) => e.ean === gtin);
}

function RelacionarProduto({
  inboundId,
  item,
  restantes = 0,
  onFechar,
  onRelacionado,
  podeCriarProduto,
  subcategorias,
}: {
  inboundId: string;
  item: ItemParaRelacionar;
  /** Quantos outros itens desta nota ainda esperam relacionar — vira fila. */
  restantes?: number;
  onFechar: () => void;
  /** Chamado depois de relacionar com sucesso — quem decide se avança pro
   *  próximo pendente ou fecha é o pai (só ele conhece a fila inteira). */
  onRelacionado: (inboundItemId: string | null) => void;
  podeCriarProduto: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const [termo, setTermo] = React.useState(termoDeBuscaDoItem(item.descricao));
  const [resultados, setResultados] = React.useState<ProdutoBusca[]>([]);
  const [buscando, setBuscando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [cadastrando, setCadastrando] = React.useState(false);

  // Leitor USB/Bluetooth — bipar o código de barras físico do produto (que
  // pode não ser o mesmo que a nota trouxe) já filtra a busca por ele.
  const aoBipar = React.useCallback((codigo: string) => setTermo(codigo), []);
  useLeitorTeclado(aoBipar, { ativo: !cadastrando });

  React.useEffect(() => {
    const alvo = termo.trim();
    let vivo = true;
    // Tudo dentro do timeout, inclusive limpar a lista: mexer no estado no
    // corpo do efeito dispara render em cascata a cada tecla.
    const t = setTimeout(async () => {
      if (alvo.length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        // A ordem vem pronta do servidor: relevância ao que foi digitado, com
        // o código de barras do item como desempate.
        const r = await buscarProdutoAction(alvo, item.gtin);
        if (!vivo) return;
        setResultados(r);
      } catch {
        if (vivo) toast.error("Falha ao buscar produtos.");
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [termo, item.gtin]);

  async function escolher(productId: string, packagingId: string | null, fator: number) {
    if (!item.inboundItemId) {
      toast.error("Este item não veio da nota", "Só itens da nota podem ser relacionados.");
      return;
    }
    setSalvando(true);
    try {
      const r = await relacionarItemRecebimentoAction({
        inboundId,
        inboundItemId: item.inboundItemId,
        productId,
        packagingId,
        fatorConversao: fator,
      });
      toast.success(
        "Produto relacionado.",
        // O que a nota completou no cadastro merece ser dito: é trabalho que o
        // operador não vai precisar fazer depois, e ele não veria sozinho.
        r?.preenchidos.length
          ? `Do XML veio ${listar(r.preenchidos)}. Da próxima nota deste fornecedor ele entra sozinho.`
          : "Da próxima nota deste fornecedor ele entra sozinho.",
      );
      // Fila: o pai decide se há próximo pendente (avança) ou fecha. Sempre
      // reabilita o form — se avançar, o efeito acima troca termo/resultados.
      onRelacionado(item.inboundItemId);
      setSalvando(false);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para relacionar", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(false);
    }
  }

  /** Cadastra e já relaciona pelo mesmo caminho — nasce como "Unidade", sem
   *  embalagem própria (a nota não distingue fardo do fornecedor nesta etapa). */
  async function criarERelacionar(nome: string, subcategoryId: string) {
    setSalvando(true);
    try {
      const produto = await criarProdutoRapidoAction({
        nome,
        subcategoryId,
        ean: item.gtin ?? undefined,
      });
      await escolher(produto.id, null, 1);
    } catch (e) {
      toast.error("Não deu para cadastrar", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onFechar}
      title="Relacionar ao catálogo"
      description={
        <>
          <span className="text-ink-2">{item.descricao}</span>
          {item.gtin && (
            <>
              {" · "}
              <span className="font-mono">{item.gtin}</span>
            </>
          )}
          {restantes > 0 && (
            <>
              {" · "}
              <span className="font-medium text-accent">
                {restantes === 1 ? "mais 1 item por relacionar" : `mais ${restantes} itens por relacionar`}
              </span>
            </>
          )}
        </>
      }
      width="2xl"
    >
      <div className="space-y-3">
        {camera && (
          <Scanner
            onCodigo={(codigo) => {
              setCamera(false);
              setTermo(codigo);
            }}
            onFechar={() => setCamera(false)}
            dica="Bipe o código de barras do produto"
          />
        )}

        {cadastrando ? (
          <CadastroRapido
            nomeInicial={item.descricao}
            subcategorias={subcategorias}
            salvando={salvando}
            onCancelar={() => setCadastrando(false)}
            onSalvar={criarERelacionar}
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <input
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Buscar por nome, SKU ou código de barras"
                  aria-label="Buscar produto no catálogo"
                  autoFocus
                  className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCamera(true)}>
                <ScanLine className="h-4 w-4" aria-hidden />
                Bipar
              </Button>
            </div>

            <p className="text-[12px] text-muted">
              {buscando
                ? "Procurando…"
                : "Escolha a unidade em que o fornecedor vende — é ela que define quantas unidades entram no estoque. Ou bipe o produto: o leitor USB/Bluetooth já está ativo."}
            </p>

        <ul className="space-y-2">
          {resultados.map((p) => {
            const casa = casaPorCodigo(p, item.gtin);
            const sugerida = item.gtin
              ? p.embalagens.find((e) => e.ean === item.gtin)
              : undefined;
            return (
              <li
                key={p.id}
                className={cn(
                  "rounded-[var(--radius)] border px-3 py-2.5",
                  casa ? "border-ok/40 bg-ok-soft/25" : "border-line",
                )}
              >
                <div className="flex items-center gap-3">
                  {p.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imagemUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-line bg-surface object-contain"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
                      <PackageOpen className="h-4 w-4" aria-hidden />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{p.nome}</span>
                      {casa && (
                        <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-medium text-ok">
                          mesmo código
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted">
                      {p.sku}
                      {p.ean ? ` · ${p.ean}` : ""}
                    </p>
                  </div>

                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[11px] text-muted">
                      {p.custoMedio > 0 ? fmtMoney(p.custoMedio) : "sem custo"}
                    </span>
                    <span className="block text-[10px] text-faint">custo médio</span>
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant={sugerida ? "secondary" : "primary"}
                    disabled={salvando}
                    onClick={() => void escolher(p.id, null, 1)}
                  >
                    Unidade
                  </Button>
                  {p.embalagens.map((e) => (
                    <Button
                      key={e.id}
                      size="sm"
                      variant={sugerida?.id === e.id ? "primary" : "secondary"}
                      disabled={salvando}
                      onClick={() => void escolher(p.id, e.id, e.fator)}
                    >
                      {e.nome} ({fmtQtd(e.fator)} un)
                      {sugerida?.id === e.id && " · código da nota"}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        {!buscando && termo.trim().length >= 2 && resultados.length === 0 && (
          <p className="rounded-[var(--radius)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            {podeCriarProduto
              ? `Nenhum produto com "${termo.trim()}". Tente outro termo — ou cadastre um novo abaixo.`
              : `Nenhum produto com "${termo.trim()}". Tente outro termo — ou cadastre o produto e volte aqui, a nota continua esperando.`}
          </p>
        )}

        {podeCriarProduto && (
          <button
            type="button"
            onClick={() => setCadastrando(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-line-button px-4 py-2.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft/40"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
            Não achou? Cadastrar produto novo
          </button>
        )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Mini-cadastro — só nome + categoria, o resto o produto ganha depois em `/produtos`. */
function CadastroRapido({
  nomeInicial,
  subcategorias,
  salvando,
  onCancelar,
  onSalvar,
}: {
  nomeInicial: string;
  subcategorias: SubcategoriaCadastro[];
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (nome: string, subcategoryId: string) => void;
}) {
  const [nome, setNome] = React.useState(nomeInicial);
  const [subcategoryId, setSubcategoryId] = React.useState("");

  const valido = nome.trim().length >= 2 && subcategoryId !== "";

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-line bg-surface-2/40 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <FilePlus2 className="h-4 w-4 text-brand" aria-hidden />
        Cadastrar produto novo
      </p>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
        Nome
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
        Categoria
        <select
          value={subcategoryId}
          onChange={(e) => setSubcategoryId(e.target.value)}
          className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <option value="">Selecione…</option>
          {subcategorias.map((s) => (
            <option key={s.id} value={s.id}>
              {s.categoriaNome} · {s.nome}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[12px] text-muted">
        Nasce com a unidade que a nota usa. Preço de venda, embalagens e o resto do cadastro
        completam depois em Produtos.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!valido || salvando}
          onClick={() => onSalvar(nome.trim(), subcategoryId)}
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Cadastrar e relacionar
        </Button>
      </div>
    </div>
  );
}
