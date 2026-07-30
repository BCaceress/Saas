"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownFromLine,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  Cake,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  CalendarX,
  ChartColumnBig,
  Check,
  Circle,
  CirclePause,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Crown,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  History,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Lock,
  Mail,
  MessageCircle,
  PackagePlus,
  PackageX,
  Percent,
  PiggyBank,
  Play,
  Printer,
  Receipt,
  ReceiptText,
  Scale,
  Search,
  Share2,
  ShoppingCart,
  Star,
  TrendingDown,
  TrendingUp,
  Truck,
  TriangleAlert,
  Users,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
  Wallet,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { semAcento } from "@/lib/normalize";
import {
  CATEGORIAS,
  FILTRO_LABEL,
  PARAMETROS_PADRAO,
  hrefExecucao,
  hrefExport,
  type CategoriaId,
  type Exportacao,
  type FiltroId,
  type Parametros,
  type RelatorioDef,
} from "@/lib/relatorios/catalogo";
import { alternarFavoritoAction, registrarExecucaoAction } from "./actions";

/**
 * Central de Relatórios (client).
 *
 * Uma tela, quatro prateleiras: favoritos, categorias, catálogo e histórico —
 * todas servidas pela MESMA busca do topo. A tela é um índice: ela não gera
 * número nenhum, só leva o operador ao lugar certo com os parâmetros certos.
 *
 * O estado é local e some ao sair de propósito: busca e filtro são gesto de
 * garimpo, não configuração. O que persiste (favorito, execução) vai para o
 * banco na hora em que acontece.
 */

/* ------------------------------------------------------------------ */
/* Ícones — o catálogo guarda o nome; a resolução é aqui              */
/* ------------------------------------------------------------------ */

const ICONES: Record<string, LucideIcon> = {
  ArrowDownFromLine,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  Cake,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX,
  ChartColumnBig,
  CirclePause,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Crown,
  FileText,
  FlaskConical,
  History,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  PackagePlus,
  PackageX,
  Percent,
  PiggyBank,
  Receipt,
  ReceiptText,
  Scale,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Truck,
  TriangleAlert,
  Users,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
  Wallet,
  Wine,
};

/**
 * Ícone pelo nome. Renderiza via `createElement` de propósito: guardar o
 * componente numa variável durante o render faz o React tratá-lo como um
 * componente novo a cada passagem (e o lint reclama, com razão).
 */
function Icone({
  nome,
  size = 16,
  className,
}: {
  nome: string;
  size?: number;
  className?: string;
}) {
  return React.createElement(ICONES[nome] ?? Circle, { size, className, "aria-hidden": true });
}

/* ------------------------------------------------------------------ */
/* Tipos vindos do servidor                                            */
/* ------------------------------------------------------------------ */

export type UsoCliente = { execucoes: number; ultimaEm: string | null };

export type RecenteCliente = {
  id: string;
  relatorioId: string;
  nome: string;
  formato: string;
  criadoEm: string;
};

type Chip = "todos" | "favoritos" | "usados" | "recentes" | "exportaveis";

const CHIPS: { id: Chip; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "favoritos", label: "Favoritos" },
  { id: "usados", label: "Mais utilizados" },
  { id: "recentes", label: "Recentes" },
  { id: "exportaveis", label: "Exportáveis" },
];

const PRESETS: { id: Parametros["periodo"]; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
];

const FORMATO_LABEL: Record<string, string> = {
  tela: "na tela",
  csv: "em CSV",
  xlsx: "em Excel",
  pdf: "em PDF",
  impressao: "impresso",
};

function tempoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  return `há ${m} ${m > 1 ? "meses" : "mês"}`;
}

/* ------------------------------------------------------------------ */
/* Central                                                             */
/* ------------------------------------------------------------------ */

export function CentralClient({
  relatorios,
  favoritos: favoritosIniciais,
  uso,
  recentes,
  podeExportar,
  lojaAtiva,
}: {
  relatorios: RelatorioDef[];
  favoritos: string[];
  uso: Record<string, UsoCliente>;
  recentes: RecenteCliente[];
  podeExportar: boolean;
  lojaAtiva: string | null;
}) {
  const [busca, setBusca] = React.useState("");
  const [chip, setChip] = React.useState<Chip>("todos");
  const [categoria, setCategoria] = React.useState<CategoriaId | null>(null);
  const [favoritos, setFavoritos] = React.useState<string[]>(favoritosIniciais);
  const [executando, setExecutando] = React.useState<RelatorioDef | null>(null);
  const [compartilhando, setCompartilhando] = React.useState<RelatorioDef | null>(null);
  const [, iniciar] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // "/" foca a busca de qualquer lugar da página — o mesmo atalho do hub.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function alternarFavorito(rel: RelatorioDef) {
    const eraFavorito = favoritos.includes(rel.id);
    // Otimista: a estrela responde no clique; se o servidor recusar, volta.
    setFavoritos((atual) =>
      eraFavorito ? atual.filter((id) => id !== rel.id) : [...atual, rel.id],
    );
    iniciar(async () => {
      const r = await alternarFavoritoAction(rel.id);
      if (!r.ok) {
        setFavoritos((atual) =>
          eraFavorito ? [...atual, rel.id] : atual.filter((id) => id !== rel.id),
        );
      }
    });
  }

  const termo = semAcento(busca.trim());

  const filtrados = React.useMemo(() => {
    const combina = (r: RelatorioDef) =>
      termo === "" ||
      [r.nome, r.descricao, ...r.keywords].some((t) => semAcento(t).includes(termo));

    let lista = relatorios.filter(combina);
    if (categoria) lista = lista.filter((r) => r.categoria === categoria);

    if (chip === "favoritos") lista = lista.filter((r) => favoritos.includes(r.id));
    if (chip === "exportaveis") {
      lista = lista.filter((r) => r.exportacoes.some((e) => e !== "imprimir"));
    }
    if (chip === "usados") {
      lista = lista
        .filter((r) => (uso[r.id]?.execucoes ?? 0) > 0)
        .sort((a, b) => (uso[b.id]?.execucoes ?? 0) - (uso[a.id]?.execucoes ?? 0));
    }
    if (chip === "recentes") {
      lista = lista
        .filter((r) => uso[r.id]?.ultimaEm)
        .sort(
          (a, b) =>
            new Date(uso[b.id]!.ultimaEm!).getTime() - new Date(uso[a.id]!.ultimaEm!).getTime(),
        );
    }
    return lista;
  }, [relatorios, termo, categoria, chip, favoritos, uso]);

  const ordenacaoLivre = chip === "usados" || chip === "recentes";

  const porCategoria = React.useMemo(() => {
    const mapa = new Map<CategoriaId, RelatorioDef[]>();
    for (const r of filtrados) {
      const atual = mapa.get(r.categoria) ?? [];
      atual.push(r);
      mapa.set(r.categoria, atual);
    }
    return mapa;
  }, [filtrados]);

  const contagemCategoria = React.useMemo(() => {
    const mapa = new Map<CategoriaId, number>();
    for (const r of relatorios) mapa.set(r.categoria, (mapa.get(r.categoria) ?? 0) + 1);
    return mapa;
  }, [relatorios]);

  const cardsFavoritos = React.useMemo(
    () => relatorios.filter((r) => favoritos.includes(r.id)),
    [relatorios, favoritos],
  );

  const semResultado = filtrados.length === 0;
  const filtrando = termo !== "" || chip !== "todos" || categoria !== null;

  const propsCard = {
    favoritos,
    uso,
    podeExportar,
    onFavoritar: alternarFavorito,
    onExecutar: setExecutando,
    onCompartilhar: setCompartilhando,
  };

  return (
    <div className="space-y-9 pb-4">
      {/* ------------------------------------------------------------ */}
      {/* Busca + filtros                                               */}
      {/* ------------------------------------------------------------ */}
      <section className="space-y-3">
        <div
          className={cn(
            "flex h-13 items-center gap-3 rounded-(--radius) border border-line bg-surface px-4",
            "shadow-(--shadow-float) transition-shadow",
            "focus-within:border-brand/50 focus-within:shadow-[0_0_0_4px_var(--ring),var(--shadow-float)]",
          )}
        >
          <Search size={18} className="shrink-0 text-faint" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            placeholder="Pesquisar relatório..."
            aria-label="Pesquisar relatório"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint sm:block">
            /
          </kbd>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChip(c.id)}
              aria-pressed={chip === c.id}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                chip === c.id
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-muted hover:border-brand/40 hover:text-ink",
              )}
            >
              {c.label}
            </button>
          ))}
          {categoria && (
            <button
              type="button"
              onClick={() => setCategoria(null)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3.5 py-1.5 text-[13px] font-medium text-brand"
            >
              {CATEGORIAS.find((c) => c.id === categoria)?.nome}
              <span aria-hidden>×</span>
              <span className="sr-only">Limpar filtro de categoria</span>
            </button>
          )}
          <span className="ml-auto text-[13px] text-faint">
            {filtrados.length} de {relatorios.length} relatórios
          </span>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Favoritos                                                     */}
      {/* ------------------------------------------------------------ */}
      {cardsFavoritos.length > 0 && !filtrando && (
        <Prateleira
          titulo="Favoritos"
          descricao="Os relatórios que você marcou — sempre à mão."
          icone={<Star size={15} aria-hidden />}
        >
          <Grade>
            {cardsFavoritos.map((r) => (
              <CardRelatorio key={r.id} rel={r} {...propsCard} />
            ))}
          </Grade>
        </Prateleira>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Categorias                                                    */}
      {/* ------------------------------------------------------------ */}
      <section aria-label="Categorias">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIAS.map((c) => {
            const total = contagemCategoria.get(c.id) ?? 0;
            if (total === 0) return null;
            const ativa = categoria === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoria(ativa ? null : c.id)}
                aria-pressed={ativa}
                className={cn(
                  "group flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all",
                  "motion-safe:hover:-translate-y-0.5 hover:shadow-(--shadow-float)",
                  ativa
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface hover:border-brand/40",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-sm transition-colors",
                    ativa ? "bg-brand text-on-brand" : "bg-brand-softer text-brand",
                  )}
                >
                  <Icone nome={c.icon} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[13px] font-bold text-ink">
                    {c.nome}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {total} {total === 1 ? "relatório" : "relatórios"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Catálogo                                                      */}
      {/* ------------------------------------------------------------ */}
      {semResultado ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line py-14 text-center">
          <Search size={22} className="text-faint" aria-hidden />
          <div>
            <p className="text-sm font-medium text-ink">
              Nenhum relatório corresponde a esse filtro
            </p>
            <p className="mt-1 text-sm text-muted">
              Tente outra palavra — a busca também procura por termos como “ruptura”, “pix” ou
              “aniversário”.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setBusca("");
              setChip("todos");
              setCategoria(null);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      ) : ordenacaoLivre ? (
        <Prateleira
          titulo={chip === "usados" ? "Mais utilizados" : "Consultados recentemente"}
          descricao="Ordenado pelo uso da sua loja, não só pelo seu."
          icone={chip === "usados" ? <TrendingUp size={15} aria-hidden /> : <History size={15} aria-hidden />}
        >
          <Grade>
            {filtrados.map((r) => (
              <CardRelatorio key={r.id} rel={r} {...propsCard} />
            ))}
          </Grade>
        </Prateleira>
      ) : (
        CATEGORIAS.map((c) => {
          const itens = porCategoria.get(c.id);
          if (!itens?.length) return null;
          return (
            <Prateleira
              key={c.id}
              titulo={c.nome}
              descricao={c.descricao}
              icone={<Icone nome={c.icon} size={15} />}
              contagem={itens.length}
            >
              <Grade>
                {itens.map((r) => (
                  <CardRelatorio key={r.id} rel={r} {...propsCard} />
                ))}
              </Grade>
            </Prateleira>
          );
        })
      )}

      {/* ------------------------------------------------------------ */}
      {/* Histórico                                                     */}
      {/* ------------------------------------------------------------ */}
      <Prateleira
        titulo="Executados recentemente"
        descricao="O que a loja consultou por último — clique para rodar de novo com os dados de hoje."
        icone={<History size={15} aria-hidden />}
      >
        {recentes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
            <p className="text-sm text-muted">
              Nenhum relatório executado ainda. O histórico se preenche sozinho a partir do
              primeiro <span className="font-medium text-ink">Executar</span>.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {recentes.map((h) => {
              const rel = relatorios.find((r) => r.id === h.relatorioId);
              return (
                <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                    {rel ? (
                      <Icone nome={rel.icon} size={15} />
                    ) : (
                      <FileText size={15} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{h.nome}</p>
                    <p className="text-[11px] text-faint">
                      {tempoRelativo(h.criadoEm)} · {FORMATO_LABEL[h.formato] ?? h.formato}
                    </p>
                  </div>
                  {rel && (
                    <Button size="sm" variant="secondary" onClick={() => setExecutando(rel)}>
                      <Play size={13} aria-hidden /> Executar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Prateleira>

      {executando && (
        <ModalExecutar
          rel={executando}
          lojaAtiva={lojaAtiva}
          podeExportar={podeExportar}
          onClose={() => setExecutando(null)}
        />
      )}

      {compartilhando && (
        <ModalCompartilhar rel={compartilhando} onClose={() => setCompartilhando(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

function Prateleira({
  titulo,
  descricao,
  icone,
  contagem,
  children,
}: {
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={titulo}>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
          {icone}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">
            {titulo}
            {contagem !== undefined && (
              <span className="ml-2 font-sans text-[12px] font-medium text-faint">{contagem}</span>
            )}
          </h2>
          <p className="truncate text-[13px] text-muted">{descricao}</p>
        </div>
        <span className="ml-2 h-px flex-1 bg-line" aria-hidden />
      </div>
      {children}
    </section>
  );
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function CardRelatorio({
  rel,
  favoritos,
  uso,
  podeExportar,
  onFavoritar,
  onExecutar,
  onCompartilhar,
}: {
  rel: RelatorioDef;
  favoritos: string[];
  uso: Record<string, UsoCliente>;
  podeExportar: boolean;
  onFavoritar: (rel: RelatorioDef) => void;
  onExecutar: (rel: RelatorioDef) => void;
  onCompartilhar: (rel: RelatorioDef) => void;
}) {
  const favorito = favoritos.includes(rel.id);
  const u = uso[rel.id];
  const motivo = rel.destino.tipo === "indisponivel" ? rel.destino.motivo : null;
  const indisponivel = motivo !== null;

  return (
    <article
      className={cn(
        "group flex flex-col rounded-lg border bg-surface transition-all",
        indisponivel
          ? "border-dashed border-line"
          : "border-line motion-safe:hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-(--shadow-float)",
      )}
    >
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-sm",
              indisponivel ? "bg-surface-2 text-faint" : "bg-brand-softer text-brand",
            )}
          >
            {indisponivel ? <Lock size={16} aria-hidden /> : <Icone nome={rel.icon} size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "font-display text-sm font-bold transition-colors",
                indisponivel ? "text-muted" : "text-ink group-hover:text-brand",
              )}
            >
              {rel.nome}
            </h3>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{rel.descricao}</p>
          </div>
          <button
            type="button"
            onClick={() => onFavoritar(rel)}
            aria-pressed={favorito}
            title={favorito ? "Remover dos favoritos" : "Favoritar"}
            className={cn(
              "grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors",
              favorito ? "text-accent" : "text-faint hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Star size={15} fill={favorito ? "currentColor" : "none"} aria-hidden />
            <span className="sr-only">{favorito ? "Remover dos favoritos" : "Favoritar"}</span>
          </button>
        </div>

        {/* Rodapé de metadados: só aparece quando há algo a dizer — sem ele o
            card fica uma linha mais baixo, e o tempo de geração não ajudava. */}
        {(motivo || u?.ultimaEm || u?.execucoes) && (
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
            {motivo ? (
              <span className="text-muted">{motivo}</span>
            ) : (
              <>
                {u?.ultimaEm && <span>Executado {tempoRelativo(u.ultimaEm)}</span>}
                {u?.ultimaEm && u?.execucoes ? <span aria-hidden>·</span> : null}
                {u?.execucoes ? (
                  <span>
                    {u.execucoes}× {u.execucoes === 1 ? "vez" : "vezes"}
                  </span>
                ) : null}
              </>
            )}
          </p>
        )}
      </div>

      {!indisponivel && (
        <div className="flex items-center border-t border-line">
          <button
            type="button"
            onClick={() => onExecutar(rel)}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
          >
            <Play size={14} aria-hidden />
            Executar
          </button>
          {podeExportar && rel.exportacoes.length > 0 && (
            <>
              <span className="h-5 w-px bg-line" aria-hidden />
              <button
                type="button"
                onClick={() => onExecutar(rel)}
                title="Exportar — escolha o formato na tela de parâmetros"
                className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <Download size={14} aria-hidden />
                Exportar
              </button>
            </>
          )}
          <span className="h-5 w-px bg-line" aria-hidden />
          <button
            type="button"
            onClick={() => onCompartilhar(rel)}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
          >
            <Share2 size={14} aria-hidden />
            Compartilhar
          </button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Execução — parâmetros e saída                                       */
/* ------------------------------------------------------------------ */

/** Filtros de dimensão que o motor sabe aplicar. Tela dedicada tem os seus. */
const FILTROS_DIMENSAO: FiltroId[] = ["categoria", "fornecedor", "produto", "cliente"];

function ModalExecutar({
  rel,
  lojaAtiva,
  podeExportar,
  onClose,
}: {
  rel: RelatorioDef;
  lojaAtiva: string | null;
  podeExportar: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [params, setParams] = React.useState<Parametros>(PARAMETROS_PADRAO);
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  const usaPeriodo = rel.filtros.includes("periodo");
  const usaSite = rel.filtros.includes("site");
  const camposDimensao = rel.destino.tipo === "consulta"
    ? rel.filtros.filter((f) => FILTROS_DIMENSAO.includes(f))
    : [];

  function setFiltro(chave: string, valor: string) {
    setParams((p) => ({ ...p, filtros: { ...p.filtros, [chave]: valor } }));
  }

  async function gerar(formato: "tela" | Exportacao) {
    const href =
      formato === "tela" ? hrefExecucao(rel, params) : hrefExport(rel, params, formato);
    if (!href) return;

    setOcupado(formato);
    // O log da execução vai antes da navegação: é ele que faz o histórico e o
    // "mais utilizados" existirem, e falhar aqui não pode impedir o relatório.
    await registrarExecucaoAction({
      relatorioId: rel.id,
      parametros: params,
      formato: formato === "imprimir" ? "impressao" : formato,
    }).catch(() => {});

    if (formato === "tela") {
      router.push(href);
      onClose();
      return;
    }
    window.open(href, "_blank", "noopener");
    setOcupado(null);
  }

  const exportaveis = rel.exportacoes.filter((e) => e !== "imprimir");
  const podeImprimir = rel.exportacoes.includes("imprimir");

  return (
    <Modal
      open
      onClose={onClose}
      title={rel.nome}
      description={rel.descricao}
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => gerar("tela")} disabled={ocupado !== null}>
            {ocupado === "tela" ? (
              <LoaderCircle size={15} className="animate-spin" aria-hidden />
            ) : (
              <Play size={15} aria-hidden />
            )}
            Gerar relatório
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {usaPeriodo && (
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Período
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setParams((atual) => ({ ...atual, periodo: p.id }))}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    params.periodo === p.id
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line text-muted hover:text-ink",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {params.periodo === "custom" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Data inicial</label>
                  <input
                    type="date"
                    value={params.de ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, de: e.target.value }))}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Data final</label>
                  <input
                    type="date"
                    value={params.ate ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, ate: e.target.value }))}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {camposDimensao.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {camposDimensao.map((f) => (
              <div key={f}>
                <label className="mb-1 block text-xs font-medium text-muted">
                  {FILTRO_LABEL[f]}
                </label>
                <input
                  type="text"
                  value={params.filtros[f] ?? ""}
                  onChange={(e) => setFiltro(f, e.target.value)}
                  placeholder="Todos"
                  className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint"
                />
              </div>
            ))}
            <p className="text-[12px] text-faint sm:col-span-2">
              Deixe em branco para trazer tudo. O filtro casa por parte do nome — “cerv” encontra
              “Cervejas”.
            </p>
          </div>
        )}

        {usaSite && (
          <div className="rounded-(--radius) border border-line bg-surface-2 px-3.5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Loja</p>
            <p className="mt-1 text-sm text-ink">{lojaAtiva ?? "Todas as lojas"}</p>
            <p className="mt-0.5 text-[12px] text-faint">
              O relatório usa a loja selecionada no topo da tela. Troque lá para comparar pontos.
            </p>
          </div>
        )}

        {rel.destino.tipo === "pagina" && (
          <p className="text-[12px] text-muted">
            Este relatório abre na tela dedicada, que tem os próprios filtros e colunas.
          </p>
        )}

        {(exportaveis.length > 0 || podeImprimir) && (
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Baixar direto
            </p>
            {podeExportar ? (
              <div className="flex flex-wrap gap-2">
                {exportaveis.includes("csv") && (
                  <BotaoSaida
                    icon={FileText}
                    label="CSV"
                    ocupado={ocupado === "csv"}
                    onClick={() => gerar("csv")}
                  />
                )}
                {exportaveis.includes("xlsx") && (
                  <BotaoSaida
                    icon={FileSpreadsheet}
                    label="Excel"
                    ocupado={ocupado === "xlsx"}
                    onClick={() => gerar("xlsx")}
                  />
                )}
                {exportaveis.includes("pdf") && (
                  <BotaoSaida
                    icon={FileText}
                    label="PDF"
                    ocupado={ocupado === "pdf"}
                    onClick={() => gerar("pdf")}
                  />
                )}
                {podeImprimir && (
                  <BotaoSaida
                    icon={Printer}
                    label="Imprimir"
                    ocupado={ocupado === "imprimir"}
                    onClick={() => gerar("imprimir")}
                  />
                )}
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                Seu perfil não tem permissão para exportar. Peça a um administrador.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function BotaoSaida({
  icon: Icon,
  label,
  ocupado,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  ocupado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand disabled:cursor-wait disabled:opacity-60"
    >
      {ocupado ? (
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
      ) : (
        <Icon size={14} aria-hidden />
      )}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Compartilhamento                                                    */
/* ------------------------------------------------------------------ */

function ModalCompartilhar({ rel, onClose }: { rel: RelatorioDef; onClose: () => void }) {
  const [copiado, setCopiado] = React.useState(false);

  const caminho = hrefExecucao(rel, PARAMETROS_PADRAO) ?? "/relatorios/central";
  const url = typeof window === "undefined" ? caminho : `${window.location.origin}${caminho}`;
  const texto = `${rel.nome} — ${rel.descricao}`;

  async function copiar() {
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Compartilhar ${rel.nome}`}
      description="O link abre o relatório com os dados do momento em que for aberto — não é uma cópia congelada."
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-(--radius) border border-line bg-surface-2 px-3 py-2">
          <Link2 size={15} className="shrink-0 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{url}</span>
          <Button size="sm" variant="secondary" onClick={copiar}>
            {copiado ? <Check size={14} className="text-ok" aria-hidden /> : null}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${texto}\n${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-(--radius) border border-line bg-surface px-3.5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-soft"
          >
            <MessageCircle size={16} className="text-muted" aria-hidden />
            WhatsApp
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(rel.nome)}&body=${encodeURIComponent(`${texto}\n\n${url}`)}`}
            className="flex items-center gap-2.5 rounded-(--radius) border border-line bg-surface px-3.5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-soft"
          >
            <Mail size={16} className="text-muted" aria-hidden />
            E-mail
          </a>
        </div>

        <div className="rounded-(--radius) border border-dashed border-line px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <CalendarPlus size={15} aria-hidden />
            Envio automático
          </p>
          <p className="mt-1 text-[13px] text-faint">
            Diário, semanal ou mensal por e-mail. A estrutura já está no banco; o disparo entra na
            próxima fase — até lá, o botão ficaria mentindo.
          </p>
        </div>

        <p className="text-[12px] text-faint">
          Quem receber o link precisa ter acesso a esta conta e permissão para o relatório.
        </p>
      </div>
    </Modal>
  );
}
