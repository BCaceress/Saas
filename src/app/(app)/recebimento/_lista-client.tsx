"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  FileText,
  FileUp,
  Gift,
  Loader2,
  PackageCheck,
  Receipt,
  Search,
  Store,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navDescricao } from "@/components/app/nav-config";
import { cn } from "@/lib/utils";
import { EstadoVazio } from "../cotacoes/_catalogo/ui";
import { fmtMoney, fmtQtd, relDia, Thumb } from "../cotacoes/_ui";
import { ReceberMercadoriaPanel } from "../pedidos/_receber-mercadoria";
import { TransferReceber, type Transfer } from "../pedidos/_recebimentos";
import { itensDoRecebimentoAction } from "./lista-actions";
import { iniciarRecebimentoAction } from "./conferencia-actions";
import { toast } from "@/components/ui/toast";
import {
  abaDePedidos,
  filtrosAtivos,
  periodoAplicavel,
  placeholderBusca,
  REC_FILTROS_VAZIO,
  REC_LIMITES,
  REC_TABS,
  urlDosFiltros,
  type Pagina,
  type RecAba,
  type RecFiltros,
} from "./_query";
import type {
  AguardandoRow,
  ItemRecebido,
  RecebimentoRow,
  ResumoRecebimentos,
} from "./_lista";

// ── Tela de Recebimentos ────────────────────────────────────────
//
// UMA ABA POR VEZ, uma lista por vez. Antes as três listas (aguardando, em
// conferência, concluídos) apareciam empilhadas na mesma tela: quem abria para
// ver o que precisa receber recebia junto o histórico inteiro, que cresce para
// sempre. Agora cada aba é uma consulta própria, paginada no banco, e a tela
// abre em "Aguardando recebimento" — o que exige ação hoje.
//
// E as abas não mostram a mesma coisa, de propósito:
//
//   Aguardando  → PEDIDOS. Não são recebimentos: são o botão que cria um.
//   As demais   → RECEBIMENTOS. /pedidos responde "o que eu comprei?", esta
//                 responde "o que chegou?".

const PERIODOS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "", label: "Tudo" },
];

/** O vazio de cada aba diz o que fazer, não "nenhum resultado". */
const VAZIO: Record<RecAba, { titulo: string; descricao: string }> = {
  aguardando: {
    titulo: "Nenhum pedido aguardando recebimento",
    descricao: "Todos os pedidos estão em dia. Quando um pedido sair para entrega, ele aparece aqui.",
  },
  andamento: {
    titulo: "Nenhum recebimento em conferência",
    descricao: "Quando uma conferência for iniciada, ela aparecerá aqui.",
  },
  divergencia: {
    titulo: "Nenhuma divergência encontrada",
    descricao: "O que chegou bateu com o que foi pedido e faturado.",
  },
  concluidos: {
    titulo: "Nenhum recebimento concluído encontrado",
    descricao: "O histórico começa no primeiro recebimento finalizado.",
  },
  avulsos: {
    titulo: "Nenhum recebimento avulso encontrado",
    descricao: "Avulso é a mercadoria que chegou sem pedido por trás.",
  },
  "sem-nfe": {
    titulo: "Nenhum recebimento aguardando NF-e",
    descricao: "Toda mercadoria que entrou tem documento fiscal vinculado.",
  },
};

export function RecebimentosView({
  aguardando,
  recebimentos,
  transferencias,
  resumo,
  fornecedores,
  filtros,
  podeReceber,
  podeAvulso,
}: {
  /** A página da aba "Aguardando" — pedidos, não recebimentos. Vazia nas outras. */
  aguardando: Pagina<AguardandoRow>;
  /** A página das demais abas. Vazia na aba "Aguardando". */
  recebimentos: Pagina<RecebimentoRow>;
  /** Transferências entre lojas esperando conferência na loja ativa. */
  transferencias: Transfer[];
  resumo: ResumoRecebimentos;
  fornecedores: { id: string; nome: string }[];
  filtros: RecFiltros;
  podeReceber: boolean;
  podeAvulso: boolean;
}) {
  const router = useRouter();
  const [recebendo, setRecebendo] = useState(false);
  const [detalhe, setDetalhe] = useState<RecebimentoRow | null>(null);
  const [receberTransfer, setReceberTransfer] = useState<Transfer | null>(null);
  const [busca, setBusca] = useState(filtros.q);
  const [navegando, iniciarNavegacao] = useTransition();

  const ehPedidos = abaDePedidos(filtros.aba);
  const pagina: Pagina<AguardandoRow | RecebimentoRow> = ehPedidos ? aguardando : recebimentos;

  // A aba mora na URL: o servidor precisa lê-la para consultar SÓ ela, e de
  // quebra o recorte fica compartilhável e sobrevive ao F5.
  const irPara = (patch: Partial<RecFiltros>) => {
    const f: RecFiltros = { ...filtros, ...patch };
    // Trocar de aba com a página 3 aberta mostraria "nenhum resultado" para um
    // recorte que tem resultados — só a página é que não existe mais.
    if (!("pagina" in patch)) f.pagina = 1;
    iniciarNavegacao(() => router.push(`/recebimento${urlDosFiltros(f)}`, { scroll: false }));
  };

  const contagens: Record<string, number> = {
    aguardando: resumo.aguardando,
    emConferencia: resumo.emConferencia,
    divergencia: resumo.divergencia,
  };

  const mostraTransferencias = ehPedidos && transferencias.length > 0;
  const vazio = pagina.items.length === 0 && !mostraTransferencias;

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

      <Resumo resumo={resumo} filtros={filtros} />

      {/* Abas — o recorte da tela. Uma consulta cada, uma lista por vez.
          A busca divide a linha com elas: procurar UM recebimento é a primeira
          coisa que se faz aqui, e enterrar o campo na linha de baixo custava um
          pulo de olho toda vez. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative order-1 w-full min-w-0 sm:w-72 sm:shrink-0"
            onSubmit={(e) => {
              e.preventDefault();
              irPara({ q: busca.trim() });
            }}
          >
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={placeholderBusca(filtros.aba)}
              aria-label={placeholderBusca(filtros.aba)}
              className="h-9 w-full rounded-full border border-line-button bg-surface pr-8 pl-9 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
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
          </form>

          <div
            role="tablist"
            aria-label="Recorte dos recebimentos"
            className="order-2 -mx-1 flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:justify-end"
          >
          {REC_TABS.map((t) => {
            const ativa = filtros.aba === t.aba;
            const n = t.contador ? contagens[t.contador] : null;
            return (
              <button
                key={t.aba}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => irPara({ aba: t.aba })}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none",
                  ativa
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface text-ink-2 hover:bg-surface-2",
                )}
              >
                {t.label}
                {n !== null && n > 0 && (
                  <span className={cn("ml-1.5 tabular-nums", ativa ? "opacity-80" : "text-muted")}>
                    ({n})
                  </span>
                )}
              </button>
            );
          })}
          {/* Recorte sem aba própria: chega pelo indicador "Sem NF-e" e por
              links de fora. Só aparece enquanto está ativo, para a pessoa saber
              onde está — e como sair. */}
          {filtros.aba === "sem-nfe" && (
            <span className="shrink-0 rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent">
              Sem NF-e
            </span>
          )}
          </div>
        </div>

        {/* Filtros — contextuais à aba selecionada. A linha só existe quando
            tem o que mostrar: um espaçamento vazio abaixo das abas parece
            defeito de layout. */}
        {(fornecedores.length > 0 || periodoAplicavel(filtros.aba) || filtrosAtivos(filtros)) && (
        <div className="flex flex-wrap items-center gap-2">
          {fornecedores.length > 0 && (
            <select
              value={filtros.supplierId}
              onChange={(e) => irPara({ supplierId: e.target.value })}
              aria-label="Filtrar por fornecedor"
              className="h-9 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink focus-visible:border-brand focus-visible:outline-none"
            >
              <option value="">Todos os fornecedores</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          )}

          {/* O período recorta histórico. Nas abas de trabalho ele só serviria
              para esconder pendência — por isso nem aparece. */}
          {periodoAplicavel(filtros.aba) && (
            <select
              value={filtros.periodo}
              onChange={(e) => irPara({ periodo: e.target.value })}
              aria-label="Período"
              className="h-9 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink focus-visible:border-brand focus-visible:outline-none"
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          )}

          {filtrosAtivos(filtros) && (
            <button
              type="button"
              onClick={() => {
                setBusca("");
                irPara({ ...REC_FILTROS_VAZIO, aba: filtros.aba });
              }}
              className="ml-auto cursor-pointer text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              Limpar filtros
            </button>
          )}
        </div>
        )}
      </div>

      {/* O recorte "Sem NF-e" avisa, não recebe: a mercadoria já entrou no
          estoque à mão e o que falta é VINCULAR o XML ao recebimento que já
          existe. Abrir um recebimento novo faria a mesma carga entrar duas
          vezes — por isso a instrução vive aqui, onde a fila está. */}
      {filtros.aba === "sem-nfe" && recebimentos.total > 0 && (
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

        {vazio ? (
          <EstadoVazio
            icon={<PackageCheck size={20} />}
            titulo={
              filtrosAtivos(filtros) ? "Nada neste recorte" : VAZIO[filtros.aba].titulo
            }
            descricao={
              filtrosAtivos(filtros)
                ? "Nenhum registro bate com estes filtros. Amplie o período ou limpe a busca."
                : VAZIO[filtros.aba].descricao
            }
            acao={
              filtrosAtivos(filtros) ? (
                <button
                  type="button"
                  onClick={() => {
                    setBusca("");
                    irPara({ ...REC_FILTROS_VAZIO, aba: filtros.aba });
                  }}
                  className="cursor-pointer rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  Limpar filtros
                </button>
              ) : podeReceber && filtros.aba !== "aguardando" ? (
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
        ) : (
          <>
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
              <ul className="divide-y divide-line">
                {ehPedidos
                  ? aguardando.items.map((a) => (
                      <LinhaAguardando key={a.pedidoId} a={a} podeReceber={podeReceber} />
                    ))
                  : recebimentos.items.map((r) => (
                      <LinhaRecebimento
                        key={r.id}
                        r={r}
                        aba={filtros.aba}
                        onAbrir={() => setDetalhe(r)}
                      />
                    ))}
              </ul>
            </div>

            <Paginacao
              pagina={pagina}
              rotulo={ehPedidos ? "pedidos" : "recebimentos"}
              onPagina={(p) => irPara({ pagina: p })}
              onLimite={(l) => irPara({ limite: l })}
            />
          </>
        )}
      </div>

      <DetalheSheet recebimento={detalhe} onClose={() => setDetalhe(null)} />

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
// Faixa baixa, quatro indicadores, só o que pede ação hoje. "Entrou no mês" saiu
// daqui: é pergunta de relatório, não de doca — ocupava a largura inteira sem
// mudar o que alguém faz a seguir.

function Resumo({ resumo, filtros }: { resumo: ResumoRecebimentos; filtros: RecFiltros }) {
  const atalho = (aba: RecAba) =>
    `/recebimento${urlDosFiltros({ ...REC_FILTROS_VAZIO, aba, supplierId: filtros.supplierId })}`;

  const items = [
    {
      icon: Truck,
      label: "Aguardando",
      valor: String(resumo.aguardando),
      sub: resumo.aguardando === 1 ? "pedido" : "pedidos",
      tom: resumo.aguardando > 0 ? ("brand" as const) : undefined,
      href: atalho("aguardando"),
    },
    {
      icon: ClipboardCheck,
      label: "Em conferência",
      valor: String(resumo.emConferencia),
      sub: resumo.emConferencia === 1 ? "recebimento" : "recebimentos",
      tom: resumo.emConferencia > 0 ? ("accent" as const) : undefined,
      href: atalho("andamento"),
    },
    {
      icon: PackageCheck,
      label: "Recebidos hoje",
      valor: String(resumo.recebidosHoje),
      sub: resumo.recebidosHoje === 1 ? "entrada" : "entradas",
      tom: undefined,
      href: undefined,
    },
    {
      icon: Receipt,
      label: "Sem NF-e",
      valor: String(resumo.semDocumento),
      sub: resumo.semDocumento > 0 ? "aguardando XML" : "tudo documentado",
      tom: resumo.semDocumento > 0 ? ("accent" as const) : undefined,
      // A mercadoria pode ter chegado antes do XML. Quando ele chegar, o
      // caminho certo é VINCULAR ao recebimento que já existe — receber de novo
      // faria a mesma carga entrar no estoque duas vezes.
      href: resumo.semDocumento > 0 ? atalho("sem-nfe") : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-4 lg:divide-y-0">
      {items.map((it) => {
        const conteudo = (
          <>
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
              <it.icon
                size={12}
                className={cn(it.tom === "accent" && "text-accent", it.tom === "brand" && "text-brand")}
              />
              <span className="truncate">{it.label}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span
                className={cn(
                  "font-display text-[17px] leading-none font-semibold tabular-nums",
                  it.tom === "accent" ? "text-accent" : it.tom === "brand" ? "text-brand" : "text-ink",
                )}
              >
                {it.valor}
              </span>
              <span className="truncate text-[11px] text-muted">{it.sub}</span>
            </div>
          </>
        );
        // Métrica que aponta para pendência vira atalho: o número diz que há
        // trabalho, e o clique leva direto à aba dele.
        return it.href ? (
          <Link
            key={it.label}
            href={it.href}
            className="min-w-0 cursor-pointer px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-inset focus-visible:outline-none"
          >
            {conteudo}
          </Link>
        ) : (
          <div key={it.label} className="min-w-0 px-4 py-3">
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
  { label: string; tone: "neutral" | "brand" | "accent" | "ok" | "danger" }
> = {
  PENDENTE: { label: "Pendente", tone: "accent" },
  EM_CONFERENCIA: { label: "Em conferência", tone: "brand" },
  DIVERGENCIA: { label: "Com divergência", tone: "accent" },
  FINALIZADO: { label: "Finalizado", tone: "ok" },
  CANCELADO: { label: "Cancelado", tone: "neutral" },
  ESTORNADO: { label: "Estornado", tone: "danger" },
};

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
            <span>previsão {a.previsaoEntrega.toLocaleDateString("pt-BR")}</span>
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
  aba,
  onAbrir,
}: {
  r: RecebimentoRow;
  aba: RecAba;
  onAbrir: () => void;
}) {
  const status = STATUS_META[r.status];
  const emAndamento =
    r.status === "PENDENTE" || r.status === "EM_CONFERENCIA" || r.status === "DIVERGENCIA";
  // Na aba de divergência a pergunta é "quanto faltou?" — o número que responde
  // isso vem antes de qualquer outro detalhe da linha.
  const faltou = aba === "divergencia" ? r.esperado - r.unidades : 0;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
        r.status === "ESTORNADO" && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-faint">{r.numero}</span>
          <span className="truncate text-sm font-medium text-ink">{r.supplierNome}</span>
          <Badge tone={status.tone}>{status.label}</Badge>

          {r.avulso ? (
            <Badge>Avulso</Badge>
          ) : r.pedidoNumero ? (
            <Link
              href={`/pedidos?q=${encodeURIComponent(r.pedidoNumero)}`}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted transition-colors hover:text-brand"
            >
              <FileText size={11} />
              {r.pedidoNumero}
            </Link>
          ) : null}

          {r.notaNumero ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
              <Receipt size={11} /> {r.notaNumero}
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

          {r.divergencias > 0 && aba !== "divergencia" && (
            <Badge tone="accent">
              <TriangleAlert size={11} />
              {r.divergencias} {r.divergencias === 1 ? "divergência" : "divergências"}
            </Badge>
          )}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>{r.data.toLocaleDateString("pt-BR")}</span>
          {aba === "divergencia" ? (
            <span className="tabular-nums">
              Pedido: {fmtQtd(r.esperado)} · Recebido: {fmtQtd(r.unidades)}
            </span>
          ) : (
            r.itens > 0 && (
              <span className="tabular-nums">
                {r.itens} {r.itens === 1 ? "item" : "itens"}
                {r.unidades > 0 && ` · ${fmtQtd(r.unidades)}`}
              </span>
            )
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

        {aba === "divergencia" && Math.abs(faltou) > 0.001 && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
            <TriangleAlert size={12} className="shrink-0" aria-hidden />
            {fmtQtd(Math.abs(faltou))} {Math.abs(faltou) === 1 ? "unidade" : "unidades"}{" "}
            {faltou > 0 ? "a menos" : "a mais"} que o esperado
          </p>
        )}

        {r.divergenciaMotivo && aba === "divergencia" && (
          <p className="mt-1 text-[12px] text-muted">{r.divergenciaMotivo}</p>
        )}

        {r.estornoMotivo && (
          <p className="mt-1 flex items-start gap-1.5 text-[12px] text-danger">
            <Undo2 size={12} className="mt-0.5 shrink-0" aria-hidden />
            {r.estornoMotivo}
          </p>
        )}
      </div>

      <p className="shrink-0 font-display text-[15px] font-semibold tabular-nums text-ink">
        {fmtMoney(r.valor)}
      </p>

      {/* A ação depende do estado: o que está na doca pede continuação; o que
          já entrou pede consulta. */}
      {emAndamento ? (
        <Link
          href={r.href}
          className="shrink-0 cursor-pointer rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          Continuar
        </Link>
      ) : aba === "divergencia" || aba === "avulsos" ? (
        <Link
          href={r.href}
          className="shrink-0 cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Ver recebimento
        </Link>
      ) : (
        <button
          type="button"
          onClick={onAbrir}
          className="shrink-0 cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Ver itens
        </button>
      )}
    </li>
  );
}

// ── Detalhe ─────────────────────────────────────────────────────
// Recebimento avulso não tem nota para onde navegar — sem isto, a única linha
// que nunca teve tela própria seria também a única sem como conferir o que
// entrou.

function DetalheSheet({
  recebimento: r,
  onClose,
}: {
  recebimento: RecebimentoRow | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={r !== null}
      onClose={onClose}
      title={r?.numero ?? "Recebimento"}
      description={r ? `${r.supplierNome} · ${r.data.toLocaleDateString("pt-BR")}` : ""}
      width="xl"
    >
      {r && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2.5 border-y border-line py-3.5 text-sm">
            <Campo rotulo="Valor" valor={fmtMoney(r.valor)} />
            <Campo rotulo="Itens" valor={`${r.itens}`} />
            <Campo rotulo="Pedido" valor={r.avulso ? "Avulso" : (r.pedidoNumero ?? "—")} />
            <Campo rotulo="NF-e" valor={r.notaNumero ?? (r.semDocumento ? "Aguardando" : "—")} />
            {r.siteNome && <Campo rotulo="Loja" valor={r.siteNome} />}
            {r.usuario && <Campo rotulo="Conferido por" valor={r.usuario} />}
          </div>

          {r.divergenciaMotivo && (
            <p className="rounded-[var(--radius)] bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent">
              <strong className="font-semibold">Divergência:</strong> {r.divergenciaMotivo}
            </p>
          )}

          <Link
            href={r.href}
            className="flex cursor-pointer items-center gap-2 self-start rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Receipt size={14} className="text-muted" />
            Abrir o recebimento
          </Link>

          {/* `key` remonta ao trocar de recebimento: sem isso a lista do
              anterior ficaria na tela enquanto a nova carrega. */}
          <ItensDoRecebimento key={r.id} receiptId={r.id} />
        </div>
      )}
    </Sheet>
  );
}

function ItensDoRecebimento({ receiptId }: { receiptId: string }) {
  const [itens, setItens] = useState<ItemRecebido[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    itensDoRecebimentoAction(receiptId)
      .then((r) => vivo && setItens(r))
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar os itens.");
      });
    return () => {
      vivo = false;
    };
  }, [receiptId]);

  if (erro) {
    return (
      <p className="rounded-[var(--radius)] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {erro}
      </p>
    );
  }

  if (itens === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Carregando itens…
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        Nenhum item registrado neste recebimento.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {itens.map((it, i) => (
        <li key={`${it.sku}-${i}`} className="flex items-center gap-3 px-3.5 py-2.5">
          <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
              {it.nome}
              {it.bonificacao && (
                <span title="Bonificação" className="text-violet">
                  <Gift size={12} />
                </span>
              )}
            </p>
            <p className="truncate font-mono text-[11px] text-faint">{it.sku}</p>
          </div>
          <div className="shrink-0 text-right text-sm">
            <p className="font-semibold tabular-nums text-ink">
              {fmtQtd(it.quantidade)}
              {Math.abs(it.quantidade - it.esperado) > 0.001 && (
                <span className="ml-1 text-[11px] font-normal text-accent">
                  de {fmtQtd(it.esperado)}
                </span>
              )}
            </p>
            <p className="text-[11px] tabular-nums text-muted">{fmtMoney(it.custoTotal)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{rotulo}</span>
      <span className="truncate text-ink">{valor}</span>
    </span>
  );
}
