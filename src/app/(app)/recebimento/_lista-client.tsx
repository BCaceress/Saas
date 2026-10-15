"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Clock,
  FileClock,
  FileText,
  FileUp,
  Gift,
  Loader2,
  PackageCheck,
  Receipt,
  Search,
  SlidersHorizontal,
  Store,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Combobox } from "@/components/ui/combobox";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navDescricao } from "@/components/app/nav-config";
import { maskCnpj, maskCpf } from "@/lib/masks";
import { cn } from "@/lib/utils";
import { EstadoVazio } from "../cotacoes/_catalogo/ui";
import { fmtMoney, fmtQtd, relDia } from "../cotacoes/_ui";
import { ReceberMercadoriaPanel } from "../pedidos/_receber-mercadoria";
import { TransferReceber, type Transfer } from "../pedidos/_recebimentos";
import { iniciarRecebimentoAction } from "./conferencia-actions";
import { toast } from "@/components/ui/toast";
import {
  filtrosAtivos,
  periodoAplicavel,
  placeholderBusca,
  quantosFiltros,
  REC_FILTROS_VAZIO,
  REC_LIMITES,
  REC_STATUS,
  soPedidos,
  urlDosFiltros,
  type Pagina,
  type RecFiltros,
  type RecMarca,
  type RecStatus,
} from "./_query";
import type {
  AguardandoRow,
  RecebimentoRow,
  ResumoRecebimentos,
} from "./_lista";

// ── Tela de Recebimentos ────────────────────────────────────────
//
// A tela abre em TODOS. O status é uma escolha só (Todos · Aguardando · Em
// aberto · Concluídos); os indicadores ainda recortam divergência e sem NF-e. Tudo
// paginado no banco — o histórico continua recortado pelo período.
//
// E os recortes não mostram a mesma coisa, de propósito:
//
//   Aguardando  → PEDIDOS. Não são recebimentos: são o botão que cria um.
//                 Na visão geral sobem num bloco curto no topo; sozinhos,
//                 viram a lista paginada.
//   Os demais   → RECEBIMENTOS. /pedidos responde "o que eu comprei?", esta
//                 responde "o que chegou?".

const PERIODOS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "", label: "Todo o período" },
];

/** A partir de quantos dias aberto o recebimento acende como parado na doca. */
const DIAS_NA_DOCA_ALERTA = 2;

/** Espera depois da última tecla antes de buscar — digitar não dispara uma consulta por letra. */
const ESPERA_BUSCA_MS = 350;

/** Dias de calendário entre a chegada e hoje — "ontem às 23h" já é 1 dia. */
function diasDesde(d: Date): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d);
  dia.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoje.getTime() - dia.getTime()) / 86_400_000));
}

function tempoNaDoca(d: Date): string {
  const n = diasDesde(d);
  return n === 0 ? "desde hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`;
}

const fmtDia = (d: Date) => d.toLocaleDateString("pt-BR");

/** Enquanto aberto o valor é o esperado — o rótulo diz de onde ele vem. */
const ROTULO_VALOR = { nota: "na nota", previsto: "previsto" } as const;

/** Mesma seleção de marcas, em qualquer ordem. */
const mesmasMarcas = (a: RecMarca[], b: RecMarca[]) =>
  a.length === b.length && a.every((m) => b.includes(m));

/**
 * Select nativo com a pele dos outros filtros: seta do sistema de ícones, não
 * a do navegador, para a barra parecer uma família só.
 */
function SelectFiltro({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        className="h-9 w-full cursor-pointer appearance-none truncate rounded-full border border-line bg-surface pr-9 pl-3.5 text-[13px] text-ink transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </div>
  );
}

const VAZIO_TODOS = {
  titulo: "Nenhum recebimento por aqui ainda",
  descricao: "Quando um pedido sair para entrega ou uma mercadoria chegar, aparece aqui.",
};

/** O vazio de cada status diz o que fazer, não "nenhum resultado". */
const VAZIO: Record<Exclude<RecStatus, "">, { titulo: string; descricao: string }> = {
  aguardando: {
    titulo: "Nenhum pedido aguardando recebimento",
    descricao: "Todos os pedidos estão em dia. Quando um pedido sair para entrega, ele aparece aqui.",
  },
  aberto: {
    titulo: "Nenhum recebimento em aberto",
    descricao: "Tudo o que chegou já foi conferido e entrou no estoque.",
  },
  concluidos: {
    titulo: "Nenhum recebimento concluído no período",
    descricao: "O histórico começa no primeiro recebimento concluído.",
  },
};

export function RecebimentosView({
  aguardando,
  recebimentos,
  transferencias,
  resumo,
  fornecedores,
  filtros,
  multiLoja,
  podeReceber,
  podeAvulso,
}: {
  /**
   * Pedidos aguardando — não são recebimentos. Em "Aguardando" é a lista
   * paginada; na visão geral, é o bloco do topo (primeiros N + total).
   */
  aguardando: Pagina<AguardandoRow>;
  /** A página de recebimentos. Vazia em "Aguardando". */
  recebimentos: Pagina<RecebimentoRow>;
  /** Transferências entre lojas esperando conferência na loja ativa. */
  transferencias: Transfer[];
  resumo: ResumoRecebimentos;
  fornecedores: { id: string; nome: string }[];
  filtros: RecFiltros;
  /** O tenant tem mais de uma loja — só aí a coluna Loja aparece. */
  multiLoja: boolean;
  podeReceber: boolean;
  podeAvulso: boolean;
}) {
  const router = useRouter();
  const [recebendo, setRecebendo] = useState(false);
  const [receberTransfer, setReceberTransfer] = useState<Transfer | null>(null);
  const [busca, setBusca] = useState(filtros.q);
  // No celular os filtros dobram atrás de um botão: quatro controles empilhados
  // empurravam a lista para fora da primeira tela.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [navegando, iniciarNavegacao] = useTransition();

  // O marcado responde no clique; a lista chega quando o servidor devolver.
  const [visao, marcarVisao] = useOptimistic({ status: filtros.status, marcas: filtros.marcas });

  const ehPedidos = soPedidos(filtros);
  const pagina: Pagina<AguardandoRow | RecebimentoRow> = ehPedidos ? aguardando : recebimentos;
  // Pedidos dividindo a tela com recebimentos: bloco curto no topo.
  const pedidosNoTopo = !ehPedidos && aguardando.items.length > 0;
  const focoDivergencia = filtros.marcas.includes("divergencia");

  // O recorte mora na URL: o servidor precisa lê-lo para consultar SÓ ele, e de
  // quebra fica compartilhável e sobrevive ao F5.
  const irPara = (patch: Partial<RecFiltros>) => {
    const f: RecFiltros = { ...filtros, ...patch };
    // Trocar o filtro com a página 3 aberta mostraria "nenhum resultado" para
    // um recorte que tem resultados — só a página é que não existe mais.
    if (!("pagina" in patch)) f.pagina = 1;
    if (f.status === "aguardando") f.marcas = [];
    iniciarNavegacao(() => {
      if (patch.status !== undefined || patch.marcas) {
        marcarVisao({ status: f.status, marcas: f.marcas });
      }
      router.push(`/recebimento${urlDosFiltros(f)}`, { scroll: false });
    });
  };

  // Busca enquanto digita, com uma pausa: o Enter deixou de ser obrigatório.
  // A referência evita reagendar a cada render (irPara nasce de novo em todos).
  const irParaRef = useRef(irPara);
  useEffect(() => {
    irParaRef.current = irPara;
  });
  useEffect(() => {
    const termo = busca.trim();
    if (termo === filtros.q) return;
    const t = setTimeout(() => irParaRef.current({ q: termo }), ESPERA_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca, filtros.q]);

  const limpar = () => {
    setBusca("");
    irPara({ ...REC_FILTROS_VAZIO, limite: filtros.limite });
  };

  const mostraTransferencias = transferencias.length > 0;
  const vazio = pagina.items.length === 0 && !mostraTransferencias && !pedidosNoTopo;
  const vazioTexto = filtros.status ? VAZIO[filtros.status] : VAZIO_TODOS;
  // Um status sozinho tem o seu próprio vazio; qualquer recorte por cima disso
  // é "nada bate com estes filtros".
  const recortado =
    filtros.marcas.length > 0 ||
    filtros.q.trim() !== "" ||
    filtros.supplierId !== "" ||
    (periodoAplicavel(filtros) && filtros.periodo !== REC_FILTROS_VAZIO.periodo);
  const nFiltros = quantosFiltros(filtros);

  const opcoesFornecedor = [
    { value: "", label: "Todos os fornecedores" },
    ...fornecedores.map((f) => ({ value: f.id, label: f.nome })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Recebimentos"
        icon={navIcon("/recebimento")}
        description={navDescricao("/recebimento")}
        innerClassName="max-w-none"
        actions={
          podeReceber && (
            <button
              type="button"
              onClick={() => setRecebendo(true)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <FileUp size={15} />
              Receber mercadoria
            </button>
          )
        }
      />

      {podeReceber && (
        <ReceberMercadoriaPanel
          pedido={null}
          etapaInicial="escolha"
          open={recebendo}
          onClose={() => setRecebendo(false)}
          podeAvulso={podeAvulso}
        />
      )}

      <Resumo resumo={resumo} visao={visao} onIr={irPara} />

      {/* Busca primeiro — procurar UM recebimento é a primeira coisa que se faz
          aqui. Ela cresce e ocupa o que sobra: a linha de filtros vai de ponta
          a ponta, sem buraco no fim. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") irPara({ q: busca.trim() });
              }}
              placeholder={placeholderBusca(filtros)}
              aria-label={placeholderBusca(filtros)}
              className="h-9 w-full rounded-full border border-line bg-surface pr-8 pl-9 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {busca && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  irPara({ q: "" });
                }}
                aria-label="Limpar busca"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-faint hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setFiltrosAbertos((v) => !v)}
            aria-expanded={filtrosAbertos}
            aria-controls="recebimento-filtros"
            className={cn(
              "flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors sm:hidden",
              nFiltros > 0 ? "border-brand text-brand" : "border-line text-ink",
            )}
          >
            <SlidersHorizontal size={14} aria-hidden />
            Filtros{nFiltros > 0 && ` (${nFiltros})`}
          </button>

          {/* No celular este bloco dobra; da tela pequena para cima ele some
              como caixa (`contents`) e os filhos entram na linha da busca. */}
          <div
            id="recebimento-filtros"
            className={cn(
              "w-full flex-col gap-2 sm:contents",
              filtrosAbertos ? "flex" : "hidden",
            )}
          >
            <div
              role="radiogroup"
              aria-label="Status"
              className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-surface p-0.5"
            >
              {REC_STATUS.map((s) => {
                const ativo = visao.status === s.value;
                return (
                  <button
                    key={s.value || "todos"}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => !ativo && irPara({ status: s.value })}
                    className={cn(
                      "h-full shrink-0 cursor-pointer rounded-full px-3 text-[13px] whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none",
                      ativo
                        ? "bg-brand-soft font-semibold text-brand"
                        : "text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            {fornecedores.length > 0 && (
              <Combobox
                value={filtros.supplierId}
                onChange={(v) => irPara({ supplierId: v })}
                options={opcoesFornecedor}
                placeholder="Todos os fornecedores"
                emptyText="Nenhum fornecedor com esse nome."
                className="w-full sm:w-56"
                inputClassName={cn(
                  "h-9 rounded-full pl-3.5 text-[13px]",
                  filtros.supplierId ? "border-brand" : "border-line",
                )}
              />
            )}

            {/* O período recorta histórico. Com só trabalho aberto na tela ele
                serviria apenas para esconder pendência — por isso nem aparece. */}
            {periodoAplicavel(visao) && (
              <SelectFiltro
                value={filtros.periodo}
                onChange={(e) => irPara({ periodo: e.target.value })}
                aria-label="Período dos concluídos — conferências abertas aparecem sempre"
                title="Recorta o histórico. Conferências abertas aparecem sempre, de qualquer data."
                className="w-full sm:w-44"
              >
                {PERIODOS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </SelectFiltro>
            )}

          </div>

          {filtrosAtivos(filtros) && (
            <button
              type="button"
              onClick={limpar}
              className="shrink-0 cursor-pointer text-xs font-medium whitespace-nowrap text-muted transition-colors hover:text-ink"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* "Sem NF-e" avisa, não recebe: a mercadoria já entrou no estoque à mão
          e o que falta é VINCULAR o XML ao recebimento que já existe. Abrir um
          recebimento novo faria a mesma carga entrar duas vezes — por isso a
          instrução vive aqui, onde a fila está. */}
      {filtros.marcas.includes("sem-nfe") && recebimentos.total > 0 && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent">
          <FileClock size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p className="min-w-56 flex-1">
            <strong className="font-semibold">
              {recebimentos.total}{" "}
              {recebimentos.total === 1
                ? "recebimento aguarda NF-e"
                : "recebimentos aguardam NF-e"}
            </strong>{" "}
            — a mercadoria já foi lançada manualmente. Quando o XML chegar, vincule a NF-e ao
            recebimento existente para evitar uma nova entrada no estoque.
          </p>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-4",
          navegando && "pointer-events-none opacity-60 transition-opacity",
        )}
        aria-busy={navegando}
      >
        {navegando && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" aria-hidden /> Carregando…
          </p>
        )}

        {mostraTransferencias && (
          <Grupo
            titulo="Transferências entre lojas"
            contagem={`${transferencias.length} ${transferencias.length === 1 ? "transferência" : "transferências"}`}
            hint="Mercadoria vinda de outra loja nossa — sem pedido, sem fornecedor e sem NF-e."
          >
            {transferencias.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                {/* Violeta é o token que o módulo usa para "não é compra" — o
                    mesmo da bonificação. */}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-violet-soft text-violet">
                  <Truck size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    Transferência de {t.origemNome}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {t.items.length} {t.items.length === 1 ? "produto" : "produtos"} em trânsito
                    {t.expedidoEm && <> · expedida {relDia(t.expedidoEm)}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReceberTransfer(t)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  <PackageCheck size={14} /> Receber
                </button>
              </li>
            ))}
          </Grupo>
        )}

        {pedidosNoTopo && (
          <Grupo
            titulo="Aguardando recebimento"
            contagem={`${aguardando.total} ${aguardando.total === 1 ? "pedido" : "pedidos"}`}
            hint="Pedidos com mercadoria a chegar."
          >
            {aguardando.items.map((a) => (
              <LinhaAguardando key={a.pedidoId} a={a} podeReceber={podeReceber} />
            ))}
            {aguardando.total > aguardando.items.length && (
              <li className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => irPara({ status: "aguardando" })}
                  className="cursor-pointer text-[13px] font-medium text-brand transition-colors hover:text-brand-strong"
                >
                  Ver os {aguardando.total} pedidos aguardando
                </button>
              </li>
            )}
          </Grupo>
        )}

        {vazio ? (
          <EstadoVazio
            icon={<PackageCheck size={20} />}
            titulo={recortado ? "Nada neste recorte" : vazioTexto.titulo}
            descricao={
              recortado
                ? "Nenhum registro bate com estes filtros. Amplie o período ou limpe a busca."
                : vazioTexto.descricao
            }
            acao={
              recortado ? (
                <button
                  type="button"
                  onClick={limpar}
                  className="cursor-pointer rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  Limpar filtros
                </button>
              ) : podeReceber && filtros.status !== "aguardando" ? (
                <button
                  type="button"
                  onClick={() => setRecebendo(true)}
                  className="cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  Receber mercadoria
                </button>
              ) : null
            }
          />
        ) : pagina.items.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            {/* Com blocos acima, a lista precisa de nome — senão parece a
                continuação dos pedidos. */}
            {(pedidosNoTopo || mostraTransferencias) && (
              <div className="flex flex-wrap items-baseline gap-x-2.5 px-1">
                <h2 className="font-display text-sm font-semibold text-ink">
                  {ehPedidos ? "Pedidos aguardando" : "Recebimentos"}
                </h2>
                <span className="text-[12px] tabular-nums text-muted">{pagina.total}</span>
              </div>
            )}
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
              {ehPedidos ? (
                <ul className="divide-y divide-line">
                  {aguardando.items.map((a) => (
                    <LinhaAguardando key={a.pedidoId} a={a} podeReceber={podeReceber} />
                  ))}
                </ul>
              ) : (
                <>
                  <TabelaRecebimentos
                    linhas={recebimentos.items}
                    multiLoja={multiLoja}
                    ordem={filtros.ordem}
                    focoDivergencia={focoDivergencia}
                    onOrdem={() => irPara({ ordem: filtros.ordem === "asc" ? "desc" : "asc" })}
                  />
                  <ul className="divide-y divide-line md:hidden">
                    {recebimentos.items.map((r) => (
                      <LinhaRecebimento key={r.id} r={r} focoDivergencia={focoDivergencia} />
                    ))}
                  </ul>
                </>
              )}
            </div>

            <Paginacao
              pagina={pagina}
              rotulo={ehPedidos ? "pedidos" : "recebimentos"}
              onPagina={(p) => irPara({ pagina: p })}
              onLimite={(l) => irPara({ limite: l })}
            />
          </section>
        )}
      </div>

      <Sheet
        open={receberTransfer !== null}
        onClose={() => setReceberTransfer(null)}
        title="Receber transferência"
        description={
          receberTransfer
            ? `De ${receberTransfer.origemNome} — confira as quantidades recebidas.`
            : ""
        }
        width="xl"
      >
        {receberTransfer && (
          <TransferReceber transfer={receberTransfer} onDone={() => setReceberTransfer(null)} />
        )}
      </Sheet>
    </div>
  );
}

// ── Resumo ──────────────────────────────────────────────────────
//
// Faixa baixa, quatro indicadores, só o que pede ação hoje. Cada um é também
// um atalho de filtro: o número diz que há trabalho, o clique mostra qual. O
// indicador cujo recorte está na tela fica marcado, e clicar nele de novo
// desliga o recorte.

type Indicador = {
  icon: typeof Truck;
  label: string;
  valor: number;
  sub: React.ReactNode;
  tom: "brand" | "accent";
  alvo: { status: RecStatus; marcas: RecMarca[] };
};

function Resumo({
  resumo,
  visao,
  onIr,
}: {
  resumo: ResumoRecebimentos;
  /** Status e marcas na tela (otimista) — o indicador ativo segue o clique. */
  visao: { status: RecStatus; marcas: RecMarca[] };
  onIr: (patch: Partial<RecFiltros>) => void;
}) {
  const items: Indicador[] = [
    {
      icon: Truck,
      label: "Aguardando",
      valor: resumo.aguardando,
      // Previsão vencida é o que leva alguém a ligar para o fornecedor.
      sub: (
        <>
          {resumo.aguardando === 1 ? "pedido" : "pedidos"}
          {resumo.atrasados > 0 && (
            <span className="font-medium text-accent">
              {" "}· {resumo.atrasados} {resumo.atrasados === 1 ? "atrasado" : "atrasados"}
            </span>
          )}
        </>
      ),
      tom: "brand",
      alvo: { status: "aguardando", marcas: [] },
    },
    {
      icon: ClipboardCheck,
      label: "Em aberto",
      valor: resumo.emAberto,
      sub: resumo.emAberto === 1 ? "recebimento" : "recebimentos",
      tom: "accent",
      alvo: { status: "aberto", marcas: [] },
    },
    {
      icon: TriangleAlert,
      label: "Com divergência",
      valor: resumo.divergencia,
      sub: "a resolver",
      tom: "accent",
      alvo: { status: "aberto", marcas: ["divergencia"] },
    },
    {
      icon: Receipt,
      label: "Sem NF-e",
      valor: resumo.semDocumento,
      sub: resumo.semDocumento > 0 ? "aguardando XML" : "tudo documentado",
      tom: "accent",
      // A mercadoria pode ter chegado antes do XML. Quando ele chegar, o
      // caminho certo é VINCULAR ao recebimento que já existe — receber de novo
      // faria a mesma carga entrar no estoque duas vezes.
      alvo: { status: "", marcas: ["sem-nfe"] },
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-4 lg:divide-y-0">
      {items.map((it) => {
        const ativo =
          visao.status === it.alvo.status && mesmasMarcas(visao.marcas, it.alvo.marcas);
        // Zero sem estar ativo não leva a lugar nenhum — vira só leitura.
        const clicavel = it.valor > 0 || ativo;
        const zero = it.valor === 0;
        const conteudo = (
          <>
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
              <it.icon
                size={12}
                className={cn(!zero && (it.tom === "accent" ? "text-accent" : "text-brand"))}
                aria-hidden
              />
              <span className="truncate">{it.label}</span>
              {clicavel && (
                <ChevronRight
                  size={12}
                  className={cn(
                    "ml-auto shrink-0 transition-opacity motion-reduce:transition-none",
                    ativo ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                  )}
                  aria-hidden
                />
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              {/* Zero apagado: o "1" que pede ação precisa saltar aos olhos. */}
              <span
                className={cn(
                  "font-display text-[17px] leading-none font-semibold tabular-nums",
                  zero ? "text-faint" : it.tom === "accent" ? "text-accent" : "text-brand",
                )}
              >
                {it.valor}
              </span>
              <span className={cn("truncate text-[11px]", zero ? "text-faint" : "text-muted")}>
                {it.sub}
              </span>
            </div>
          </>
        );
        const base = "group relative min-w-0 px-4 py-3 text-left";
        return clicavel ? (
          <button
            key={it.label}
            type="button"
            aria-pressed={ativo}
            title={ativo ? "Mostrar tudo de novo" : `Mostrar só: ${it.label.toLowerCase()}`}
            // Mantém busca, fornecedor e período: o indicador troca o recorte,
            // não apaga o resto do que o operador escolheu.
            onClick={() =>
              onIr(ativo ? { status: "", marcas: [] } : { status: it.alvo.status, marcas: it.alvo.marcas })
            }
            className={cn(
              base,
              "cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-inset focus-visible:outline-none",
              ativo ? "bg-brand-soft/60 shadow-[inset_0_-2px_0_var(--color-brand)]" : "hover:bg-surface-2",
            )}
          >
            {conteudo}
          </button>
        ) : (
          <div key={it.label} className={base}>
            {conteudo}
          </div>
        );
      })}
    </div>
  );
}

// ── Paginação ───────────────────────────────────────────────────
//
// No servidor, sempre: o rodapé mostra a fatia, não a lista inteira recortada
// depois de chegar.

function Paginacao({
  pagina,
  rotulo,
  onPagina,
  onLimite,
}: {
  pagina: Pagina<unknown>;
  rotulo: string;
  onPagina: (p: number) => void;
  onLimite: (l: number) => void;
}) {
  const { page, limit, total, totalPages } = pagina;
  const de = total === 0 ? 0 : (page - 1) * limit + 1;
  const ate = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted">
        Mostrando{" "}
        <span className="tabular-nums text-ink">
          {de.toLocaleString("pt-BR")}–{ate.toLocaleString("pt-BR")}
        </span>{" "}
        de <span className="tabular-nums text-ink">{total.toLocaleString("pt-BR")}</span> {rotulo}
      </p>

      <div className="flex items-center gap-3">
        {/* Com tudo cabendo na menor página, escolher o tamanho dela é ruído. */}
        {total > REC_LIMITES[0] && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">Por página</span>
            <select
              value={limit}
              onChange={(e) => onLimite(Number(e.target.value))}
              aria-label="Registros por página"
              className="h-8 cursor-pointer rounded-full border border-line bg-surface px-2.5 text-xs text-ink focus-visible:border-brand focus-visible:outline-none"
            >
              {REC_LIMITES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPagina(page - 1)}
              disabled={page <= 1}
              aria-label="Página anterior"
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-sm border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-default disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>

            {janelaDePaginas(page, totalPages).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-1 text-xs text-faint">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => onPagina(n)}
                  aria-current={n === page ? "page" : undefined}
                  className={cn(
                    "h-8 min-w-8 cursor-pointer rounded-sm border px-2 text-xs font-medium tabular-nums transition-colors",
                    n === page
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {n}
                </button>
              ),
            )}

            <button
              type="button"
              onClick={() => onPagina(page + 1)}
              disabled={page >= totalPages}
              aria-label="Próxima página"
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-sm border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-default disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 1 … 4 5 [6] 7 8 … 174 — `null` é a reticência. */
function janelaDePaginas(atual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const paginas = new Set<number>([1, total, atual]);
  for (const d of [-2, -1, 1, 2]) {
    const n = atual + d;
    if (n > 1 && n < total) paginas.add(n);
  }

  const ordenadas = [...paginas].sort((a, b) => a - b);
  const saida: (number | null)[] = [];
  let anterior = 0;
  for (const n of ordenadas) {
    if (anterior && n - anterior > 1) saida.push(null);
    saida.push(n);
    anterior = n;
  }
  return saida;
}

// ── Lista ───────────────────────────────────────────────────────

function Grupo({
  titulo,
  contagem,
  hint,
  children,
}: {
  titulo: string;
  contagem: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 px-1">
        <h2 className="font-display text-sm font-semibold text-ink">{titulo}</h2>
        <span className="text-[12px] tabular-nums text-muted">{contagem}</span>
        <span className="text-[12px] text-faint">{hint}</span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <ul className="divide-y divide-line">{children}</ul>
      </div>
    </section>
  );
}

const STATUS_META: Record<
  RecebimentoRow["status"],
  {
    label: string;
    tone: "neutral" | "brand" | "accent" | "ok" | "danger";
    /** Todo selo tem ícone: a cor sozinha não basta para quem não distingue tons. */
    icon: typeof Clock;
  }
> = {
  // Mesmo vocabulário dos filtros e da conferência: "A conferir" diz o que
  // falta fazer ("Pendente" não dizia de quê); "Concluído" é o nome do filtro.
  PENDENTE: { label: "A conferir", tone: "accent", icon: Clock },
  EM_CONFERENCIA: { label: "Em conferência", tone: "brand", icon: Clock },
  DIVERGENCIA: { label: "Com divergência", tone: "accent", icon: TriangleAlert },
  FINALIZADO: { label: "Concluído", tone: "ok", icon: CircleCheck },
  CANCELADO: { label: "Cancelado", tone: "neutral", icon: CircleX },
  ESTORNADO: { label: "Estornado", tone: "danger", icon: Undo2 },
};

/** "234517/39" — número e série, como a nota é citada no balcão. */
function fmtNota(r: RecebimentoRow): string {
  return r.notaSerie != null ? `${r.notaNumero}/${r.notaSerie}` : (r.notaNumero ?? "");
}

/** Só a máscara, sem rótulo: 11 dígitos é CPF (produtor), 14 é CNPJ. */
function fmtDocFornecedor(doc: string): string {
  if (doc.length === 11) return maskCpf(doc);
  if (doc.length === 14) return maskCnpj(doc);
  return doc;
}

/**
 * Concluído: o que entrou, em destaque. Aberto: o esperado, apagado e com a
 * origem ("na nota" / "previsto") — é estimativa, não estoque. Embaixo, o
 * tamanho da carga: itens e unidades.
 */
function ValorDaLinha({ r, className }: { r: RecebimentoRow; className?: string }) {
  const aberto = r.valorOrigem !== null;
  const sub = [
    aberto && r.valor > 0 ? ROTULO_VALOR[r.valorOrigem!] : null,
    r.itens > 0 ? `${r.itens} ${r.itens === 1 ? "item" : "itens"}` : null,
    r.unidades > 0 ? `${fmtQtd(r.unidades)} un` : null,
  ].filter(Boolean);

  return (
    <span
      className={cn(
        "block font-display tabular-nums",
        aberto ? "font-medium text-muted" : "font-semibold text-ink",
        className,
      )}
    >
      {aberto && r.valor <= 0 ? "—" : fmtMoney(r.valor)}
      {sub.length > 0 && (
        <span className="block font-sans text-[11px] font-normal whitespace-nowrap text-faint">
          {sub.join(" · ")}
        </span>
      )}
    </span>
  );
}

/**
 * O pedido que ainda espera mercadoria.
 *
 * A ação principal é uma só — "Iniciar recebimento" —, e ela leva direto à
 * conferência. O operador pensa "vou receber este pedido", não "vou criar uma
 * entidade chamada recebimento".
 */
function LinhaAguardando({ a, podeReceber }: { a: AguardandoRow; podeReceber: boolean }) {
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const pct = a.pedido > 0 ? Math.round((a.recebido / a.pedido) * 100) : 0;
  const parcial = a.recebido > 0.001;

  async function iniciar() {
    setAbrindo(true);
    try {
      const id = await iniciarRecebimentoAction(a.pedidoId);
      router.push(`/recebimento/${id}`);
    } catch (e) {
      toast.error(
        "Não deu para iniciar o recebimento",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setAbrindo(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/pedidos?q=${encodeURIComponent(a.numero)}`}
            className="font-mono text-[11px] text-faint transition-colors hover:text-brand"
          >
            {a.numero}
          </Link>
          <span className="truncate text-sm font-medium text-ink">{a.supplierNome}</span>
          {parcial && <Badge tone="accent">Parcialmente recebido</Badge>}
          {a.recebimentosAnteriores > 0 && (
            <span className="text-[11px] text-muted">
              {a.recebimentosAnteriores}{" "}
              {a.recebimentosAnteriores === 1 ? "recebimento" : "recebimentos"} até aqui
            </span>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="tabular-nums">
            {fmtQtd(a.recebido)}/{fmtQtd(a.pedido)} recebidos
            {a.pedido > 0 && ` — ${pct}%`}
          </span>
          <span className="tabular-nums">
            {a.itens} {a.itens === 1 ? "item" : "itens"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Store size={11} /> {a.siteNome}
          </span>
          {a.previsaoEntrega && (
            <span className={cn(a.atrasado && "font-medium text-accent")}>
              {a.atrasado ? "atrasado · previsto " : "previsão "}
              {a.previsaoEntrega.toLocaleDateString("pt-BR")}
            </span>
          )}
        </p>
      </div>

      <p className="shrink-0 text-right">
        <span className="block font-display text-[15px] font-semibold tabular-nums text-ink">
          {fmtMoney(a.valorSaldo)}
        </span>
        <span className="block text-[11px] text-faint">a receber</span>
      </p>

      {podeReceber && (
        <button
          type="button"
          onClick={() => void iniciar()}
          disabled={abrindo}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-default disabled:opacity-60"
        >
          {abrindo && <Loader2 size={12} className="animate-spin" aria-hidden />}
          Iniciar recebimento
        </button>
      )}
    </li>
  );
}

function LinhaRecebimento({
  r,
  focoDivergencia,
}: {
  r: RecebimentoRow;
  /** A tela está só em "Com divergência": a linha abre pelo que faltou. */
  focoDivergencia: boolean;
}) {
  const router = useRouter();
  const status = STATUS_META[r.status];
  const emAndamento =
    r.status === "PENDENTE" || r.status === "EM_CONFERENCIA" || r.status === "DIVERGENCIA";
  // Na aba de divergência a pergunta é "quanto faltou?" — o número que responde
  // isso vem antes de qualquer outro detalhe da linha.
  const faltou = focoDivergencia ? r.esperado - r.unidades : 0;

  return (
    // O cartão inteiro abre o recebimento — sem botão de ação, como a tabela.
    <li
      onClick={() => router.push(r.href)}
      className={cn(
        "flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2",
        r.status === "ESTORNADO" && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={r.href}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm font-mono text-[11px] text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
          >
            {r.numero}
          </Link>
          <span className="truncate text-sm font-medium text-ink">{r.supplierNome}</span>
          <Badge tone={status.tone}>
            <status.icon size={11} aria-hidden />
            {status.label}
          </Badge>

          {r.avulso ? (
            <Badge>Sem pedido</Badge>
          ) : r.pedidoNumero ? (
            <Link
              href={`/pedidos?q=${encodeURIComponent(r.pedidoNumero)}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted transition-colors hover:text-brand"
            >
              <FileText size={11} />
              {r.pedidoNumero}
            </Link>
          ) : null}

          {r.notaNumero ? (
            <span className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-ink">
              <Receipt size={11} className="text-muted" aria-label="Nota fiscal" /> {fmtNota(r)}
            </span>
          ) : r.semDocumento ? (
            <span
              className="text-[11px] text-accent"
              title="Entrou sem documento fiscal. Quando o XML chegar, vincule em vez de receber de novo."
            >
              Aguardando NF-e
            </span>
          ) : (
            <span className="text-[11px] text-faint">Sem NF-e</span>
          )}

          {r.temBonificacao && (
            <span title="Inclui bonificação" aria-label="Inclui bonificação" className="text-violet">
              <Gift size={12} />
            </span>
          )}

          {r.divergencias > 0 && !focoDivergencia && (
            <Badge tone="accent">
              <TriangleAlert size={11} />
              {r.divergencias} {r.divergencias === 1 ? "divergência" : "divergências"}
            </Badge>
          )}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {emAndamento ? (
            <span
              className={cn(
                diasDesde(r.data) >= DIAS_NA_DOCA_ALERTA && "font-medium text-accent",
              )}
            >
              Em aberto {tempoNaDoca(r.data)}
            </span>
          ) : (
            r.concluidoEm && <span>Recebido em {fmtDia(r.concluidoEm)}</span>
          )}
          {/* Itens e unidades moram sob o valor, como na tabela. */}
          {focoDivergencia && (
            <span className="tabular-nums">
              Pedido: {fmtQtd(r.esperado)} · Recebido: {fmtQtd(r.unidades)}
            </span>
          )}
          {r.siteNome && (
            <span className="inline-flex items-center gap-1">
              <Store size={11} /> {r.siteNome}
            </span>
          )}
          {r.usuario && (
            <span className="inline-flex items-center gap-1">
              <User size={11} /> {r.usuario}
            </span>
          )}
        </p>

        {focoDivergencia && Math.abs(faltou) > 0.001 && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
            <TriangleAlert size={12} className="shrink-0" aria-hidden />
            {fmtQtd(Math.abs(faltou))} {Math.abs(faltou) === 1 ? "unidade" : "unidades"}{" "}
            {faltou > 0 ? "a menos" : "a mais"} que o esperado
          </p>
        )}

        {r.divergenciaMotivo && focoDivergencia && (
          <p className="mt-1 text-[12px] text-muted">{r.divergenciaMotivo}</p>
        )}

        {r.estornoMotivo && (
          <p className="mt-1 flex items-start gap-1.5 text-[12px] text-danger">
            <Undo2 size={12} className="mt-0.5 shrink-0" aria-hidden />
            {r.estornoMotivo}
          </p>
        )}
      </div>

      <ValorDaLinha r={r} className="shrink-0 text-right text-[15px]" />
    </li>
  );
}

// ── Tabela de recebimentos (desktop) ────────────────────────────
//
// Em tela larga cada recebimento é uma linha de tabela: número, fornecedor,
// documento, data, valor, status e a ação — colunas fixas, para o olho descer
// por uma só. No celular a mesma lista vira cartão (`LinhaRecebimento`): oito
// colunas não cabem em 360px e rolar para o lado esconde justamente a ação.

const TH = "px-4 py-2.5 font-medium whitespace-nowrap";
const TD = "px-4 py-3 align-middle";

function TabelaRecebimentos({
  linhas,
  multiLoja,
  ordem,
  focoDivergencia,
  onOrdem,
}: {
  linhas: RecebimentoRow[];
  /** Com uma loja só, a coluna diria a mesma coisa em todas as linhas. */
  multiLoja: boolean;
  ordem: RecFiltros["ordem"];
  focoDivergencia: boolean;
  onOrdem: () => void;
}) {
  const router = useRouter();
  // Links dentro da linha clicável: o clique é deles, não da linha.
  const soAqui = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/50 text-[11px] tracking-wide text-faint uppercase">
            <th scope="col" className={TH}>Recebimento</th>
            <th scope="col" className={TH}>Fornecedor</th>
            <th scope="col" className={TH}>NF-e</th>
            {multiLoja && <th scope="col" className={TH}>Loja</th>}
            <th scope="col" className={TH}>Valor</th>
            <th
              scope="col"
              className={TH}
              aria-sort={ordem === "asc" ? "ascending" : "descending"}
            >
              <button
                type="button"
                onClick={onOrdem}
                title={`Quando a conferência foi concluída e a mercadoria entrou no estoque — ${ordem === "asc" ? "mais antigos" : "mais recentes"} primeiro; os em aberto ficam no topo`}
                className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 font-medium tracking-wide uppercase transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
              >
                Recebido em
                <ChevronDown
                  size={13}
                  className={cn(
                    "transition-transform motion-reduce:transition-none",
                    ordem === "asc" && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            </th>
            <th scope="col" className={cn(TH, "text-right")}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {linhas.map((r) => {
            const status = STATUS_META[r.status];
            const emAndamento =
              r.status === "PENDENTE" || r.status === "EM_CONFERENCIA" || r.status === "DIVERGENCIA";
            const faltou = focoDivergencia ? r.esperado - r.unidades : 0;
            const parado = emAndamento && diasDesde(r.data) >= DIAS_NA_DOCA_ALERTA;

            return (
              // A linha inteira abre o recebimento — sem botão de ação. O
              // número continua sendo o link de teclado.
              <tr
                key={r.id}
                onClick={() => router.push(r.href)}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-surface-2",
                  r.status === "ESTORNADO" && "opacity-60",
                )}
              >
                <td className={TD}>
                  <Link
                    href={r.href}
                    onClick={soAqui}
                    className="rounded-sm font-mono text-[13px] font-semibold whitespace-nowrap text-ink transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
                  >
                    {r.numero}
                  </Link>
                  <span className="block text-[11px] text-muted">
                    {r.avulso ? (
                      <span title="Mercadoria que chegou sem pedido de compra por trás.">
                        Sem pedido
                      </span>
                    ) : r.pedidoNumero ? (
                      <Link
                        href={`/pedidos?q=${encodeURIComponent(r.pedidoNumero)}`}
                        onClick={soAqui}
                        className="font-mono transition-colors hover:text-brand"
                      >
                        {r.pedidoNumero}
                      </Link>
                    ) : null}
                  </span>
                </td>

                {/* Filiais da mesma distribuidora têm nomes quase iguais — o
                    documento desempata. O tamanho da carga mora sob o valor. */}
                <td className={cn(TD, "max-w-64")}>
                  <span className="block truncate font-medium text-ink">{r.supplierNome}</span>
                  {r.supplierCnpj && (
                    <span className="block font-mono text-[11px] whitespace-nowrap text-faint">
                      {fmtDocFornecedor(r.supplierCnpj)}
                    </span>
                  )}
                </td>

                {/* O cabeçalho já diz "NF-e": número/série e, embaixo, a emissão
                    (data do fornecedor). Sem nota, o aviso ocupa a linha do
                    número. */}
                <td className={cn(TD, "whitespace-nowrap")}>
                  {r.notaNumero ? (
                    <>
                      <span className="block font-mono text-[14px] font-semibold text-ink">
                        {fmtNota(r)}
                      </span>
                      <span className="block text-[11px] tabular-nums text-faint">
                        {r.notaEmissao ? `emitida em ${fmtDia(r.notaEmissao)}` : "Sem XML"}
                      </span>
                    </>
                  ) : r.semDocumento ? (
                    <span
                      className="text-[12px] font-medium text-accent"
                      title="Entrou sem documento fiscal. Quando o XML chegar, vincule em vez de receber de novo."
                    >
                      Aguardando NF-e
                    </span>
                  ) : (
                    <span className="text-[12px] text-faint">Sem NF-e</span>
                  )}
                </td>

                {multiLoja && (
                  <td className={cn(TD, "max-w-40 truncate text-ink-2")}>{r.siteNome ?? "—"}</td>
                )}

                <td className={cn(TD, "whitespace-nowrap")}>
                  <span className="inline-flex items-start gap-1.5">
                    <ValorDaLinha r={r} />
                    {r.temBonificacao && (
                      <span
                        title="Inclui bonificação"
                        aria-label="Inclui bonificação"
                        className="mt-1 text-violet"
                      >
                        <Gift size={12} />
                      </span>
                    )}
                  </span>
                </td>

                {/* Uma data só: quando foi recebido de fato (conferência
                    concluída, mercadoria no estoque). Aberto ainda não tem essa
                    data — mostra há quanto tempo espera fora do estoque vendável.
                    A emissão é data do fornecedor e mora na coluna NF-e. */}
                <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                  {r.concluidoEm ? (
                    <span className="block text-ink-2">{fmtDia(r.concluidoEm)}</span>
                  ) : emAndamento ? (
                    <>
                      <span className="block text-muted">Em aberto</span>
                      <span
                        className={cn(
                          "block text-[11px]",
                          parado ? "font-medium text-accent" : "text-faint",
                        )}
                      >
                        {tempoNaDoca(r.data)}
                      </span>
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>

                <td className={TD}>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={status.tone} title={r.estornoMotivo ?? undefined}>
                      <status.icon size={11} aria-hidden />
                      {status.label}
                    </Badge>
                    {r.divergencias > 0 && !focoDivergencia && (
                      <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-accent">
                        <TriangleAlert size={11} aria-hidden />
                        {r.divergencias} {r.divergencias === 1 ? "divergência" : "divergências"}
                      </span>
                    )}
                    {focoDivergencia && Math.abs(faltou) > 0.001 && (
                      <span className="text-[11px] whitespace-nowrap text-accent">
                        {fmtQtd(Math.abs(faltou))} {faltou > 0 ? "a menos" : "a mais"}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
