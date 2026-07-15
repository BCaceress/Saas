"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Loader2,
  ClipboardList,
  CheckCircle2,
  X,
  Boxes,
  Tag,
  ListChecks,
  Eye,
  EyeOff,
  Search,
  CalendarClock,
  PlayCircle,
  Repeat,
  Repeat2,
  ChevronRight,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Check,
  MapPin,
  StickyNote,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  criarInventarioAction,
  iniciarInventarioAction,
  salvarContagemInventarioAction,
  fecharInventarioAction,
  cancelarInventarioAction,
  fetchInventarioProdutosAction,
} from "../actions";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/app/page-header";

type Site = { id: string; nome: string; tipo: string };
type Category = { id: string; nome: string };
type Product = { id: string; nome: string; sku: string };
type InvItem = {
  productId: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  locationNome: string | null;
  qtdSistema: number;
  qtdContada: number | null;
};
type Inventario = {
  id: string;
  status: string;
  siteId: string;
  siteNome: string;
  escopoTipo: string;
  escopoLabel: string;
  categoriaNome: string | null;
  qtdProdutos: number;
  modoCego: boolean;
  dataProgramada: string | Date;
  recorrente: boolean;
  diasSemana: number[];
  observacao: string | null;
  createdAt: string | Date;
  iniciadoEm: string | Date | null;
  fechadoEm: string | Date | null;
  fechadoPorNome: string | null;
  items: InvItem[];
};

type Escopo = "COMPLETO" | "CATEGORIA" | "PRODUTOS";

const ESCOPO_OPTIONS: { value: Escopo; label: string; icon: React.ElementType }[] = [
  { value: "COMPLETO", label: "Estoque completo", icon: Boxes },
  { value: "CATEGORIA", label: "Categoria", icon: Tag },
  { value: "PRODUTOS", label: "Produtos específicos", icon: ListChecks },
];

const DIAS_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const hoje = () => new Date().toISOString().slice(0, 10);

/** Próxima data (>= hoje) que cai em um dos dias da semana informados (0=domingo..6=sábado). */
function proximaData(diasSemana: number[]): string {
  const d = new Date();
  const atual = d.getDay();
  const delta = Math.min(...diasSemana.map((ds) => (ds - atual + 7) % 7));
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** "segunda", "segunda e sexta", "segunda, quarta e sexta" — ordenado pelo dia da semana. */
function formatDiasSemana(dias: number[]): string {
  const nomes = [...dias].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d].toLowerCase());
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

const fmtData = (v: string | Date) =>
  new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtDataHora = (v: string | Date) =>
  new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "2026-07-20" → "20/07/2026". */
function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** "20/07/2026" → "2026-07-20", ou null se incompleta/inválida. */
function brToIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) || dt.getUTCMonth() + 1 !== Number(mo)) return null;
  return iso;
}

/**
 * Campo de data dd/mm/aaaa — o `<input type="date">` nativo segue o locale do SO
 * (podendo exibir mm/dd/aaaa mesmo com a UI em pt-BR), então a digitação é livre
 * de locale aqui; o valor por fora continua sendo ISO (yyyy-mm-dd).
 */
function DateInputBR({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState(() => isoToBr(value));
  const [valorAnterior, setValorAnterior] = useState(value);
  if (value !== valorAnterior) {
    setValorAnterior(value);
    setTexto(isoToBr(value));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digitos = e.target.value.replace(/\D/g, "").slice(0, 8);
    let formatado = digitos;
    if (digitos.length > 4) formatado = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
    else if (digitos.length > 2) formatado = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
    setTexto(formatado);

    const iso = brToIso(formatado);
    if (iso) onChange(iso);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      value={texto}
      onChange={handleChange}
      className={className}
    />
  );
}

/** { diaMes: "20 jul 2026", semana: "Seg" } — usado nos metadados das listas resumidas. */
function fmtFuturoPartes(v: string | Date): { diaMes: string; semana: string } {
  const d = new Date(v);
  const diaMes = fmtDataCurta(d);
  const bruto = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const semana = bruto.charAt(0).toUpperCase() + bruto.slice(1);
  return { diaMes, semana };
}

/** "2026-07-15" → "15 jul 2026" — data compacta dos metadados das listas resumidas. */
function fmtDataCurta(v: string | Date): string {
  return new Date(v)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    .replaceAll(" de ", " ")
    .replace(".", "");
}

const pl = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);

const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

type Grupo = "atrasado" | "hoje" | "futuro";

/**
 * Classifica a ocorrência pela data (não pela recorrência) — compara por dia-calendário
 * UTC, já que `dataProgramada` é gravada como meia-noite UTC (mesma convenção de `hoje()`).
 * Usar hora local aqui subtrairia 1 dia em fusos negativos (ex.: Brasil, UTC-3).
 */
function classificar(dataProgramada: string | Date): { grupo: Grupo; diffDias: number } {
  const data = new Date(dataProgramada);
  const dataUTC = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate());
  const agora = new Date();
  const hojeUTC = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const diffDias = Math.round((hojeUTC - dataUTC) / 864e5);
  if (diffDias > 0) return { grupo: "atrasado", diffDias };
  if (diffDias === 0) return { grupo: "hoje", diffDias: 0 };
  return { grupo: "futuro", diffDias };
}

function tituloEscopo(inv: Inventario): string {
  if (inv.escopoTipo === "CATEGORIA") return inv.categoriaNome ?? "Categoria";
  if (inv.escopoTipo === "PRODUTOS") return "Produtos selecionados";
  return "Estoque completo";
}

function subtituloInventario(inv: Inventario, multiSite: boolean): string {
  const partes: string[] = [];
  if (multiSite) partes.push(inv.siteNome);
  partes.push(`${inv.qtdProdutos} ${pl(inv.qtdProdutos, "produto", "produtos")}`);
  partes.push(inv.modoCego ? "Contagem cega" : "Contagem assistida");
  return partes.join(" · ");
}

function recorrenciaLabel(inv: Inventario): string {
  const dias = inv.diasSemana.length > 0 ? inv.diasSemana : [new Date(inv.dataProgramada).getDay()];
  return `Toda ${formatDiasSemana(dias)}`;
}

/** Itens cujo contado difere do saldo de sistema no momento da abertura. */
function divergenciasDe(inv: Inventario): InvItem[] {
  return inv.items.filter((it) => it.qtdContada != null && it.qtdContada !== it.qtdSistema);
}

/** Resumo de uma ocorrência cancelada — local (se houver) e data. */
function resumoCancelado(inv: Inventario, multiSite: boolean): string {
  const partes: string[] = ["Cancelado"];
  if (multiSite) partes.push(inv.siteNome);
  partes.push(fmtDataCurta(inv.fechadoEm ?? inv.createdAt));
  return partes.join(" · ");
}

// ── Nível 1 (ação) — atrasado / hoje ───────────────────────────

function MetaItem({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon size={13} className="shrink-0 text-faint" />
      {children}
    </span>
  );
}

function CardAcao({
  inv,
  multiSite,
  variant,
  diffDias,
  disabledIniciar,
  carregando,
  onIniciar,
  onVerDetalhes,
}: {
  inv: Inventario;
  multiSite: boolean;
  variant: "atrasado" | "hoje";
  diffDias: number;
  disabledIniciar: boolean;
  carregando: boolean;
  onIniciar: () => void;
  onVerDetalhes: () => void;
}) {
  const ehHoje = variant === "hoje";
  const ModoIcon = inv.modoCego ? EyeOff : Eye;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onVerDetalhes}
      onKeyDown={(e) => { if (e.key === "Enter") onVerDetalhes(); }}
      className={cn(
        "group relative flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-3 overflow-hidden rounded-[var(--radius-lg)] border bg-surface py-4 pl-5 pr-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        ehHoje ? "border-brand/30" : "border-danger/30",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", ehHoje ? "bg-brand" : "bg-danger")} aria-hidden />

      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius)]",
          ehHoje ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger",
        )}
      >
        {ehHoje ? <ClipboardList size={20} /> : <AlertTriangle size={20} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold text-ink">Inventário · {tituloEscopo(inv)}</p>
          {ehHoje ? (
            <Badge tone="brand">Hoje</Badge>
          ) : (
            <Badge tone="danger">Atrasado há {diffDias} {pl(diffDias, "dia", "dias")}</Badge>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {multiSite && <MetaItem icon={MapPin}>{inv.siteNome}</MetaItem>}
          <MetaItem icon={Boxes}>{inv.qtdProdutos} {pl(inv.qtdProdutos, "produto", "produtos")}</MetaItem>
          <MetaItem icon={ModoIcon}>{inv.modoCego ? "Contagem cega" : "Contagem assistida"}</MetaItem>
          {inv.recorrente && <MetaItem icon={Repeat2}>{recorrenciaLabel(inv)}</MetaItem>}
          {!ehHoje && <MetaItem icon={CalendarClock}>Programado para {fmtData(inv.dataProgramada)}</MetaItem>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIniciar(); }}
          disabled={disabledIniciar}
          title={disabledIniciar ? "Finalize a contagem em andamento antes de iniciar outra" : undefined}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {carregando ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          {carregando ? "Iniciando…" : "Iniciar contagem"}
        </button>
        <ChevronRight size={16} className="shrink-0 text-faint transition-colors group-hover:text-muted" />
      </div>
    </div>
  );
}

/**
 * Linha padrão das listas resumidas (próximos/concluídos) — mesma altura,
 * mesmo slot de ícone, mesma tipografia; só o conteúdo muda entre as colunas.
 */
function LinhaResumo({
  icon,
  titulo,
  metadados,
  onVerDetalhes,
}: {
  icon: React.ReactNode;
  titulo: string;
  metadados: React.ReactNode;
  onVerDetalhes: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onVerDetalhes}
      onKeyDown={(e) => { if (e.key === "Enter") onVerDetalhes(); }}
      className="group flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{titulo}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted">{metadados}</p>
      </div>
      <ChevronRight size={15} className="shrink-0 text-faint transition-colors group-hover:text-muted" />
    </div>
  );
}

// ── Nível 2 (planejamento) — agenda compacta de próximos ───────

function LinhaProxima({
  inv,
  multiSite,
  onVerDetalhes,
}: {
  inv: Inventario;
  multiSite: boolean;
  onVerDetalhes: () => void;
}) {
  const { diaMes, semana } = fmtFuturoPartes(inv.dataProgramada);
  const partes = [
    diaMes,
    semana,
    ...(multiSite ? [inv.siteNome] : []),
    `${inv.qtdProdutos} ${pl(inv.qtdProdutos, "produto", "produtos")}`,
    inv.modoCego ? "Contagem cega" : "Contagem assistida",
    ...(inv.recorrente ? ["Recorrente"] : []),
  ];
  return (
    <LinhaResumo
      icon={<CalendarClock size={16} className="text-muted" />}
      titulo={`Inventário · ${tituloEscopo(inv)}`}
      metadados={partes.join(" · ")}
      onVerDetalhes={onVerDetalhes}
    />
  );
}

// ── Nível 3 (histórico) — concluídos/cancelados ─────────────────

function LinhaConcluida({ inv, multiSite, onVerDetalhes }: { inv: Inventario; multiSite: boolean; onVerDetalhes: () => void }) {
  const cancelado = inv.status === "CANCELADO";
  const totalItens = inv.items.length;
  const divergentes = divergenciasDe(inv).length;
  return (
    <LinhaResumo
      icon={
        cancelado
          ? <X size={16} className="text-faint" />
          : <CheckCircle2 size={16} className="text-ok" />
      }
      titulo={`Inventário · ${tituloEscopo(inv)}`}
      metadados={
        cancelado ? (
          resumoCancelado(inv, multiSite)
        ) : (
          <>
            {multiSite && `${inv.siteNome} · `}
            {totalItens} {pl(totalItens, "item contado", "itens contados")}
            {" · "}
            {inv.modoCego ? "Contagem cega" : "Contagem assistida"}
            {" · "}
            {divergentes === 0 ? (
              "Sem divergências"
            ) : (
              <span className="inline-flex items-center gap-0.5 align-text-bottom text-warn">
                <AlertTriangle size={11} className="shrink-0" aria-hidden />
                {divergentes} {pl(divergentes, "divergência", "divergências")}
              </span>
            )}
            {` · ${fmtDataCurta(inv.fechadoEm ?? inv.createdAt)}`}
          </>
        )
      }
      onVerDetalhes={onVerDetalhes}
    />
  );
}

/** Container de lista agrupada — divisores sutis entre linhas em vez de cards soltos. */
function ListaAgrupada({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      {children}
    </div>
  );
}

function VerTodosLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 self-start text-xs font-medium text-brand hover:underline"
    >
      {label} <ArrowRight size={12} />
    </button>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="flex items-center gap-2 text-xs text-muted">
        <Icon size={13} className="shrink-0 text-faint" />
        {label}
      </dt>
      <dd className="text-right text-sm text-ink">{value}</dd>
    </div>
  );
}

/** Linha compacta de um item contado — sistema e contado na mesma linha do item. */
function ItemResultado({ it }: { it: InvItem }) {
  const diff = it.qtdContada != null ? it.qtdContada - it.qtdSistema : 0;
  const diverge = it.qtdContada != null && diff !== 0;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius)] border bg-surface-2 px-3 py-2",
        diverge ? "border-l-2 border-y-line border-r-line border-l-warn" : "border-line",
      )}
    >
      {diverge ? (
        diff > 0 ? (
          <ArrowUpRight size={14} className="shrink-0 text-ok" aria-label="Contado a mais" />
        ) : (
          <ArrowDownRight size={14} className="shrink-0 text-danger" aria-label="Contado a menos" />
        )
      ) : (
        <Check size={14} className="shrink-0 text-faint" aria-label="Sem divergência" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
        <p className="font-mono text-[11px] text-faint">{it.sku}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="w-14 text-center">
          <p className="text-[10px] text-faint">Sistema</p>
          <p className="text-sm tabular-nums text-ink">{fmtQtd(it.qtdSistema)}</p>
        </div>
        <div className="w-14 text-center">
          <p className="text-[10px] text-faint">Contado</p>
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              diverge ? (diff > 0 ? "text-ok" : "text-danger") : "text-ink",
            )}
          >
            {it.qtdContada != null ? fmtQtd(it.qtdContada) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Lista de itens contados — filtro Todos/Divergências, divergentes primeiro. Remonta a cada inventário aberto (via key). */
function ResultadoContagem({ detalhe }: { detalhe: Inventario }) {
  const [filtro, setFiltro] = useState<"todos" | "divergentes">("todos");
  const divergentes = divergenciasDe(detalhe);
  const ordenados = [...detalhe.items].sort((a, b) => {
    const da = a.qtdContada != null && a.qtdContada !== a.qtdSistema ? 1 : 0;
    const db = b.qtdContada != null && b.qtdContada !== b.qtdSistema ? 1 : 0;
    return db - da;
  });
  const exibidos = filtro === "divergentes"
    ? ordenados.filter((it) => it.qtdContada != null && it.qtdContada !== it.qtdSistema)
    : ordenados;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Resultado da contagem</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFiltro("todos")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              filtro === "todos" ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            Todos {detalhe.items.length}
          </button>
          <button
            type="button"
            onClick={() => setFiltro("divergentes")}
            disabled={divergentes.length === 0}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              filtro === "divergentes" ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            Divergências {divergentes.length}
          </button>
        </div>
      </div>
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
        {exibidos.map((it) => (
          <ItemResultado key={it.productId} it={it} />
        ))}
      </div>
    </div>
  );
}

export function InventarioClient({
  inventarios,
  sites,
  activeSiteId,
  categories,
}: {
  inventarios: Inventario[];
  sites: Site[];
  activeSiteId: string | null;
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // inventoryId -> { productId -> qtdContada }
  const [contagem, setContagem] = useState<Record<string, Record<string, number>>>({});
  const [novoAberto, setNovoAberto] = useState(false);
  const [detalhe, setDetalhe] = useState<Inventario | null>(null);
  const [iniciandoId, setIniciandoId] = useState<string | null>(null);
  const [todosFuturos, setTodosFuturos] = useState(false);
  const [todosConcluidos, setTodosConcluidos] = useState(false);
  // Divergência só aparece quando o operador SAI do campo (blur/Enter) —
  // mostrar enquanto digita gera falsos alertas ("1" de "12" parece -11).
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [buscaContagem, setBuscaContagem] = useState("");
  const [rascunhoSalvoEm, setRascunhoSalvoEm] = useState<Date | null>(null);
  const [revisaoAberta, setRevisaoAberta] = useState(false);
  const primeiroInputRef = useRef<HTMLInputElement>(null);
  const multiSite = sites.length > 1;

  // ── Programar inventário ──
  // Catálogo completo só é buscado quando o formulário abre (evita carregar
  // todos os produtos no load inicial da página de inventários).
  const [products, setProducts] = useState<Product[]>([]);
  const [siteId, setSiteId] = useState(activeSiteId ?? sites[0]?.id ?? "");
  const [escopo, setEscopo] = useState<Escopo>("COMPLETO");
  const [categoryId, setCategoryId] = useState("");
  const [produtoBusca, setProdutoBusca] = useState("");
  const [produtoIds, setProdutoIds] = useState<Set<string>>(new Set());
  const [modoCego, setModoCego] = useState(false);
  const [dataProgramada, setDataProgramada] = useState(hoje);
  const [recorrente, setRecorrente] = useState(false);
  const [diasSemana, setDiasSemana] = useState<Set<number>>(() => new Set([new Date().getDay()]));
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    if (!novoAberto || products.length > 0) return;
    let cancelado = false;
    fetchInventarioProdutosAction().then((lista) => {
      if (!cancelado) setProducts(lista);
    });
    return () => { cancelado = true; };
  }, [novoAberto, products.length]);

  function toggleDiaSemana(dia: number) {
    setDiasSemana((prev) => {
      const next = new Set(prev);
      if (next.has(dia)) next.delete(dia); else next.add(dia);
      return next;
    });
  }

  const aberto = inventarios.find((i) => i.status === "ABERTO");
  const programados = inventarios
    .filter((i) => i.status === "PROGRAMADO")
    .sort((a, b) => new Date(a.dataProgramada).getTime() - new Date(b.dataProgramada).getTime());
  const atrasados = programados.filter((i) => classificar(i.dataProgramada).grupo === "atrasado");
  const hojeArr = programados.filter((i) => classificar(i.dataProgramada).grupo === "hoje");
  const futuros = programados.filter((i) => classificar(i.dataProgramada).grupo === "futuro");
  const concluidos = inventarios
    .filter((i) => i.status === "FECHADO" || i.status === "CANCELADO")
    .sort((a, b) => new Date(b.fechadoEm ?? b.createdAt).getTime() - new Date(a.fechadoEm ?? a.createdAt).getTime());

  const totalAberto = aberto?.items.length ?? 0;
  const contadosAberto = aberto
    ? aberto.items.filter((it) => contagem[aberto.id]?.[it.productId] != null).length
    : 0;

  // Trocou o inventário em contagem → zera as confirmações e hidrata a
  // contagem com o rascunho salvo no servidor (reset durante o render,
  // mesmo padrão do DateInputBR). O rascunho conta como confirmado.
  const abertoId = aberto?.id;
  const [abertoAnterior, setAbertoAnterior] = useState(abertoId);
  if (abertoId !== abertoAnterior) {
    setAbertoAnterior(abertoId);
    setBuscaContagem("");
    if (aberto) {
      const rascunho: Record<string, number> = {};
      const conf = new Set<string>();
      for (const it of aberto.items) {
        if (it.qtdContada != null) {
          rascunho[it.productId] = it.qtdContada;
          conf.add(it.productId);
        }
      }
      setContagem((p) => ({ ...p, [aberto.id]: { ...rascunho, ...(p[aberto.id] ?? {}) } }));
      setConfirmados(conf);
    } else {
      setConfirmados(new Set());
    }
  }

  // Ao abrir a contagem, foca o campo "Contado" do primeiro produto.
  useEffect(() => {
    if (abertoId) primeiroInputRef.current?.focus();
  }, [abertoId]);

  /** Confirma o campo (blur/Enter) e persiste o rascunho no servidor. */
  function confirmarCampo(invId: string, productId: string) {
    setConfirmados((prev) => (prev.has(productId) ? prev : new Set(prev).add(productId)));
    const valor = contagem[invId]?.[productId];
    if (valor == null) return;
    // Fire-and-forget: falha de rede no rascunho não interrompe a contagem —
    // o valor continua no estado local e o fechamento reenvia tudo.
    salvarContagemInventarioAction({ inventoryId: invId, items: [{ productId, qtdContada: Math.max(0, valor) }] })
      .then(() => setRascunhoSalvoEm(new Date()))
      .catch(() => {});
  }

  function editarCampo(productId: string) {
    setConfirmados((prev) => {
      if (!prev.has(productId)) return prev;
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }

  /** Enter confirma o campo e pula para o próximo produto da contagem. */
  function focarProximo(idx: number) {
    const proximo = document.querySelector<HTMLInputElement>(`[data-conta-idx="${idx + 1}"]`);
    if (proximo) proximo.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }
  const pctAberto = totalAberto > 0 ? Math.round((contadosAberto / totalAberto) * 100) : 0;

  // Itens da contagem: ordenados por localização (corredor/prateleira, sem
  // localização por último) e filtráveis por nome/SKU/EAN — bipar o código de
  // barras no campo de busca encontra o produto direto. Sem useMemo: o React
  // Compiler do projeto memoiza sozinho e rejeita memoização manual aqui.
  const termoContagem = buscaContagem.trim().toLowerCase();
  const itensOrdenados = aberto
    ? [...aberto.items].sort((a, b) => {
        const la = a.locationNome ?? "￿";
        const lb = b.locationNome ?? "￿";
        return la.localeCompare(lb, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR");
      })
    : [];
  const itensContagem = termoContagem
    ? itensOrdenados.filter(
        (it) =>
          it.nome.toLowerCase().includes(termoContagem) ||
          it.sku.toLowerCase().includes(termoContagem) ||
          (it.ean ?? "").includes(termoContagem),
      )
    : itensOrdenados;

  // Resumo da revisão antes de finalizar.
  const mapaAberto = aberto ? contagem[aberto.id] ?? {} : {};
  const divergentesRevisao = aberto
    ? aberto.items.filter((it) => mapaAberto[it.productId] != null && mapaAberto[it.productId] !== it.qtdSistema)
    : [];
  const naoContadosRevisao = aberto ? aberto.items.filter((it) => mapaAberto[it.productId] == null) : [];

  const produtosFiltrados = useMemo(() => {
    const termo = produtoBusca.trim().toLowerCase();
    if (!termo) return products;
    return products.filter(
      (p) => p.nome.toLowerCase().includes(termo) || p.sku.toLowerCase().includes(termo),
    );
  }, [products, produtoBusca]);

  function toggleProduto(id: string) {
    setProdutoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetForm() {
    setEscopo("COMPLETO");
    setCategoryId("");
    setProdutoBusca("");
    setProdutoIds(new Set());
    setModoCego(false);
    setDataProgramada(hoje());
    setRecorrente(false);
    setDiasSemana(new Set([new Date().getDay()]));
    setObservacao("");
  }

  function programarInventario() {
    setError(null);
    if (escopo === "CATEGORIA" && !categoryId) { setError("Selecione a categoria."); return; }
    if (escopo === "PRODUTOS" && produtoIds.size === 0) { setError("Selecione ao menos um produto."); return; }
    if (!recorrente && !dataProgramada) { setError("Informe a data do inventário."); return; }
    if (recorrente && diasSemana.size === 0) { setError("Selecione ao menos um dia da semana."); return; }

    const dataEnviada = recorrente ? proximaData([...diasSemana]) : dataProgramada;

    startTransition(async () => {
      try {
        await criarInventarioAction({
          siteId,
          escopoTipo: escopo,
          categoryId: escopo === "CATEGORIA" ? categoryId : null,
          productIds: escopo === "PRODUTOS" ? [...produtoIds] : null,
          modoCego,
          dataProgramada: dataEnviada,
          recorrente,
          diasSemana: recorrente ? [...diasSemana] : null,
          observacao: observacao || null,
        });
        resetForm();
        setNovoAberto(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao programar inventário.");
      }
    });
  }

  function iniciar(id: string) {
    setError(null);
    setIniciandoId(id);
    startTransition(async () => {
      try {
        await iniciarInventarioAction(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao iniciar contagem.");
      } finally {
        setIniciandoId(null);
      }
    });
  }

  function setConta(invId: string, productId: string, qtd: number) {
    setContagem((p) => ({ ...p, [invId]: { ...(p[invId] ?? {}), [productId]: qtd } }));
  }

  function fechar(inv: Inventario) {
    setError(null);
    const mapa = contagem[inv.id] ?? {};
    const items = inv.items.map((it) => ({
      productId: it.productId,
      qtdContada: mapa[it.productId] ?? it.qtdSistema,
    }));
    startTransition(async () => {
      try {
        await fecharInventarioAction({ inventoryId: inv.id, items });
        setRevisaoAberta(false);
        setRascunhoSalvoEm(null);
        setBuscaContagem("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar inventário.");
      }
    });
  }

  function cancelar(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await cancelarInventarioAction(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventários"
        icon={ClipboardList}
        description="Programe contagens, acompanhe a contagem em andamento e revise divergências antes de finalizar."
        backHref="/estoque"
        innerClassName="max-w-none"
        actions={
          <button
            type="button"
            onClick={() => setNovoAberto((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <CalendarClock size={15} /> Programar inventário
          </button>
        }
      />

      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}

      <Sheet
        open={novoAberto}
        onClose={() => setNovoAberto(false)}
        title="Programar inventário"
        description="Defina o escopo, a data e o modo de contagem."
        width="lg"
      >
        <div className="flex flex-col gap-4">
          <div className={cn("grid gap-4", sites.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
            {/* Local — só aparece havendo mais de um site */}
            {sites.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-faint">Local</label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Data programada */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">Quando</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRecorrente(false)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                    !recorrente ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  <CalendarClock size={15} className={!recorrente ? "text-brand" : "text-faint"} /> Uma vez
                </button>
                <button
                  type="button"
                  onClick={() => setRecorrente(true)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                    recorrente ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  <Repeat size={15} className={recorrente ? "text-brand" : "text-faint"} /> Recorrente
                </button>
              </div>
              {!recorrente ? (
                <DateInputBR
                  value={dataProgramada}
                  onChange={setDataProgramada}
                  className="mt-1 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              ) : (
                <>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {DIA_CURTO.map((label, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDiaSemana(i)}
                        aria-pressed={diasSemana.has(i)}
                        className={cn(
                          "rounded-[var(--radius)] border py-2 text-xs font-medium transition-colors",
                          diasSemana.has(i)
                            ? "border-brand bg-brand-soft text-brand"
                            : "border-line text-muted hover:bg-surface-2",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-faint">
                    {diasSemana.size > 0
                      ? `Toda ${formatDiasSemana([...diasSemana])} — próxima em ${fmtData(proximaData([...diasSemana]))}.`
                      : "Selecione ao menos um dia."}{" "}
                    Ao finalizar cada contagem, a próxima já é agendada automaticamente.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Escopo */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Escopo</label>
            <div className="grid grid-cols-3 gap-2">
              {ESCOPO_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setEscopo(o.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-[var(--radius)] border px-2 py-2.5 text-center text-xs font-medium transition-colors",
                    escopo === o.value
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-line text-muted hover:bg-surface-2",
                  )}
                >
                  <o.icon size={16} className={escopo === o.value ? "text-brand" : "text-faint"} />
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {escopo === "CATEGORIA" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">Categoria</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="">Selecione...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          )}

          {escopo === "PRODUTOS" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-faint">Produtos</label>
                {produtoIds.size > 0 && (
                  <span className="text-[11px] font-medium text-brand">{produtoIds.size} selecionado(s)</span>
                )}
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={produtoBusca}
                  onChange={(e) => setProdutoBusca(e.target.value)}
                  placeholder="Buscar produto..."
                  className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>
              <div className="flex max-h-40 flex-col overflow-y-auto rounded-[var(--radius)] border border-line">
                {produtosFiltrados.length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-faint">Nenhum produto encontrado.</p>
                ) : (
                  produtosFiltrados.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={produtoIds.has(p.id)}
                        onChange={() => toggleProduto(p.id)}
                        className="accent-brand"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.nome}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{p.sku}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Modo de contagem */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Modo de contagem</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setModoCego(true)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                  modoCego ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                )}
              >
                <EyeOff size={15} className={modoCego ? "text-brand" : "text-faint"} /> Cega
              </button>
              <button
                type="button"
                onClick={() => setModoCego(false)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                  !modoCego ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                )}
              >
                <Eye size={15} className={!modoCego ? "text-brand" : "text-faint"} /> Mostrando saldo
              </button>
            </div>
            <p className="text-[11px] text-faint">
              {modoCego
                ? "O contador não vê o saldo do sistema — a divergência só aparece ao fechar."
                : "O contador vê o saldo do sistema durante a contagem."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Observação (opcional)</label>
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Inventário mensal"
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <button
            type="button"
            onClick={programarInventario}
            disabled={pending || !siteId}
            className="flex cursor-pointer items-center justify-center gap-2 self-start rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            Programar inventário
          </button>
        </div>
      </Sheet>

      {/* ── Em andamento ── */}
      {aberto && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink">Em andamento</h3>
            <Badge tone="brand">1</Badge>
          </div>

          <div className="relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-brand/30 bg-surface p-5">
            <span className="absolute inset-y-0 left-0 w-1 bg-brand" aria-hidden />
            <div className="flex flex-wrap items-start justify-between gap-3 pl-1">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-base font-semibold text-ink">
                  <ClipboardList size={16} className="shrink-0 text-brand" />
                  Inventário · {tituloEscopo(aberto)}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {subtituloInventario(aberto, multiSite)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => cancelar(aberto.id)}
                disabled={pending}
                className="cursor-pointer text-xs font-medium text-muted underline hover:text-danger"
              >
                Cancelar
              </button>
            </div>

            <div className="pl-1">
              <div className="flex items-center justify-between text-[11px] text-faint">
                <span>
                  {contadosAberto} de {totalAberto} {pl(totalAberto, "produto contado", "produtos contados")}
                  {rascunhoSalvoEm && (
                    <span className="text-faint"> · Contagem salva automaticamente</span>
                  )}
                </span>
                <span className="font-semibold text-brand">{pctAberto}% concluído</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${pctAberto}%` }}
                />
              </div>
            </div>

            {/* Busca dentro da contagem — nome, SKU ou EAN (bipar o código filtra direto). */}
            {aberto.items.length > 5 && (
              <div className="relative pl-1">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={buscaContagem}
                  onChange={(e) => setBuscaContagem(e.target.value)}
                  placeholder="Buscar por nome, SKU ou código de barras..."
                  className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {itensContagem.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-faint">Nenhum produto encontrado para “{buscaContagem}”.</p>
              )}
              {itensContagem.map((it, idx) => {
                const touched = contagem[aberto.id]?.[it.productId] != null;
                const contada = touched ? contagem[aberto.id][it.productId] : "";
                // Divergência só é avaliada depois que o operador confirmou o
                // campo (blur/Enter) — não pisca enquanto digita.
                const confirmado = touched && confirmados.has(it.productId);
                const diverge = !aberto.modoCego && confirmado && contagem[aberto.id][it.productId] !== it.qtdSistema;
                const diffVal = diverge ? (contada as number) - it.qtdSistema : 0;
                return (
                  <div key={it.productId} className="flex items-center gap-3 rounded-[var(--radius)] bg-surface-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{it.nome}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {it.sku}
                        {it.ean && ` · ${it.ean}`}
                        {it.locationNome && ` · ${it.locationNome}`}
                        {!aberto.modoCego && (
                          <> · No sistema tem: <span className="font-semibold text-ink">{fmtQtd(it.qtdSistema)}</span></>
                        )}
                      </p>
                    </div>
                    <div className="flex w-28 shrink-0 flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] font-semibold text-faint">Contado</label>
                        {diverge && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums",
                              diffVal > 0 ? "text-ok" : "text-danger",
                            )}
                          >
                            {diffVal > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {diffVal > 0 ? "+" : ""}
                            {fmtQtd(diffVal)}
                          </span>
                        )}
                        {!aberto.modoCego && confirmado && !diverge && (
                          <Check size={11} className="text-ok" aria-label="Confere com o sistema" />
                        )}
                      </div>
                      <input
                        ref={idx === 0 ? primeiroInputRef : undefined}
                        data-conta-idx={idx}
                        type="number"
                        min={0}
                        step={0.001}
                        value={contada}
                        placeholder="0"
                        onChange={(e) => setConta(aberto.id, it.productId, Number(e.target.value))}
                        onFocus={() => editarCampo(it.productId)}
                        onBlur={() => { if (touched) confirmarCampo(aberto.id, it.productId); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (touched) confirmarCampo(aberto.id, it.productId);
                            focarProximo(idx);
                          }
                        }}
                        className={cn(
                          "rounded-[var(--radius)] border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                          diverge ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand"
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setRevisaoAberta(true)}
                disabled={pending}
                className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
              >
                <CheckCircle2 size={14} />
                Revisar divergências e finalizar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Revisão antes de finalizar ── */}
      <Sheet
        open={revisaoAberta && !!aberto}
        onClose={() => setRevisaoAberta(false)}
        title="Revisar e finalizar"
        description="Confira o resultado antes de aplicar os ajustes — divergências geram ajuste automático no saldo."
        width="lg"
      >
        {aberto && (
          <div className="flex flex-col gap-4">
            {/* Aviso de não contados */}
            {naoContadosRevisao.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-warn/30 bg-warn-soft px-4 py-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  <p className="text-sm font-medium text-ink">
                    {naoContadosRevisao.length} {pl(naoContadosRevisao.length, "produto não contado", "produtos não contados")}
                  </p>
                  <p className="text-xs text-muted">
                    {pl(naoContadosRevisao.length, "Será mantido", "Serão mantidos")} com o saldo do sistema, sem ajuste.
                  </p>
                </div>
              </div>
            )}

            {/* Divergências */}
            {divergentesRevisao.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-[var(--radius)] border border-ok/30 bg-ok-soft px-4 py-3">
                <CheckCircle2 size={16} className="shrink-0 text-ok" />
                <p className="text-sm text-ink">Nenhuma divergência — a contagem confere com o sistema.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {divergentesRevisao.length} {pl(divergentesRevisao.length, "divergência será ajustada", "divergências serão ajustadas")}
                </p>
                <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                  {divergentesRevisao.map((it) => {
                    const contadaRev = mapaAberto[it.productId];
                    const diffRev = contadaRev - it.qtdSistema;
                    return (
                      <div
                        key={it.productId}
                        className="flex items-center gap-3 rounded-[var(--radius)] border border-l-2 border-y-line border-r-line border-l-warn bg-surface-2 px-3 py-2"
                      >
                        {diffRev > 0 ? (
                          <ArrowUpRight size={14} className="shrink-0 text-ok" aria-label="Contado a mais" />
                        ) : (
                          <ArrowDownRight size={14} className="shrink-0 text-danger" aria-label="Contado a menos" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
                          <p className="font-mono text-[11px] text-faint">{it.sku}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <div className="w-14 text-center">
                            <p className="text-[10px] text-faint">Sistema</p>
                            <p className="text-sm tabular-nums text-ink">{fmtQtd(it.qtdSistema)}</p>
                          </div>
                          <div className="w-14 text-center">
                            <p className="text-[10px] text-faint">Contado</p>
                            <p className={cn("text-sm font-semibold tabular-nums", diffRev > 0 ? "text-ok" : "text-danger")}>
                              {fmtQtd(contadaRev)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setRevisaoAberta(false)}
                disabled={pending}
                className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                Voltar à contagem
              </button>
              <button
                type="button"
                onClick={() => fechar(aberto)}
                disabled={pending}
                className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
              >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirmar e finalizar
              </button>
            </div>
          </div>
        )}
      </Sheet>

      {/* ── Atrasados ── */}
      {atrasados.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-danger">Atrasados</h3>
            <Badge tone="danger">{atrasados.length}</Badge>
          </div>
          <div className="flex flex-col gap-2">
            {atrasados.map((inv) => (
              <CardAcao
                key={inv.id}
                inv={inv}
                multiSite={multiSite}
                variant="atrasado"
                diffDias={classificar(inv.dataProgramada).diffDias}
                disabledIniciar={pending || !!aberto}
                carregando={iniciandoId === inv.id}
                onIniciar={() => iniciar(inv.id)}
                onVerDetalhes={() => setDetalhe(inv)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Para fazer hoje ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-ink">Para fazer hoje</h3>
          {hojeArr.length > 0 && <Badge tone="brand">{hojeArr.length}</Badge>}
        </div>

        {hojeArr.length > 0 ? (
          <div className="flex flex-col gap-2">
            {hojeArr.map((inv) => (
              <CardAcao
                key={inv.id}
                inv={inv}
                multiSite={multiSite}
                variant="hoje"
                diffDias={0}
                disabledIniciar={pending || !!aberto}
                carregando={iniciandoId === inv.id}
                onIniciar={() => iniciar(inv.id)}
                onVerDetalhes={() => setDetalhe(inv)}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-ok/30 bg-ok-soft px-5 py-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ok">
              <CheckCircle2 size={22} />
            </span>
            <div>
              <p className="text-base font-semibold text-ink">Você está em dia</p>
              <p className="text-sm text-muted">Nenhum inventário pendente para hoje.</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Próximos + Concluídos (visão resumida, lado a lado) ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Próximos agendados</h3>

          {futuros.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-dashed border-line px-4 py-3.5">
              <CheckCircle2 size={16} className="shrink-0 text-ok" />
              <p className="text-sm text-muted">Nenhum inventário agendado.</p>
            </div>
          ) : (
            <>
              <ListaAgrupada>
                {(todosFuturos ? futuros : futuros.slice(0, 6)).map((inv) => (
                  <LinhaProxima
                    key={inv.id}
                    inv={inv}
                    multiSite={multiSite}
                    onVerDetalhes={() => setDetalhe(inv)}
                  />
                ))}
              </ListaAgrupada>
              {futuros.length > 6 && (
                <VerTodosLink
                  label={todosFuturos ? "Ver menos" : "Ver todos os agendados"}
                  onClick={() => setTodosFuturos((v) => !v)}
                />
              )}
            </>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Últimos concluídos</h3>

          {concluidos.length === 0 ? (
            <p className="text-sm text-muted">Nenhum inventário concluído ainda.</p>
          ) : (
            <>
              <ListaAgrupada>
                {(todosConcluidos ? concluidos : concluidos.slice(0, 6)).map((inv) => (
                  <LinhaConcluida key={inv.id} inv={inv} multiSite={multiSite} onVerDetalhes={() => setDetalhe(inv)} />
                ))}
              </ListaAgrupada>
              {concluidos.length > 6 && (
                <VerTodosLink
                  label={todosConcluidos ? "Ver menos" : "Ver histórico completo"}
                  onClick={() => setTodosConcluidos((v) => !v)}
                />
              )}
            </>
          )}
        </section>
      </div>

      {/* ── Detalhes de uma ocorrência ── */}
      <Sheet
        open={detalhe !== null}
        onClose={() => setDetalhe(null)}
        title={detalhe ? `Inventário · ${tituloEscopo(detalhe)}` : ""}
        description={
          detalhe
            ? detalhe.status === "FECHADO"
              ? `Concluído em ${fmtData(detalhe.fechadoEm ?? detalhe.createdAt)}${detalhe.fechadoPorNome ? ` por ${detalhe.fechadoPorNome}` : ""}`
              : detalhe.status === "CANCELADO"
                ? `Cancelado em ${fmtData(detalhe.fechadoEm ?? detalhe.createdAt)}`
                : subtituloInventario(detalhe, multiSite)
            : undefined
        }
        width="xl"
      >
        {detalhe && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {(detalhe.status === "FECHADO" || detalhe.status === "CANCELADO") && (
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">Detalhes do inventário</p>
              )}
              <dl className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line">
                <DetailRow icon={CalendarClock} label="Programado para" value={fmtData(detalhe.dataProgramada)} />
                {multiSite && <DetailRow icon={MapPin} label="Local" value={detalhe.siteNome} />}
                <DetailRow icon={Tag} label="Escopo" value={tituloEscopo(detalhe)} />
                {detalhe.status !== "FECHADO" && (
                  <DetailRow icon={ListChecks} label="Produtos" value={String(detalhe.qtdProdutos)} />
                )}
                <DetailRow icon={Eye} label="Modo de contagem" value={detalhe.modoCego ? "Contagem cega" : "Contagem assistida"} />
                {detalhe.recorrente && <DetailRow icon={Repeat2} label="Recorrência" value={recorrenciaLabel(detalhe)} />}
                {detalhe.observacao && <DetailRow icon={StickyNote} label="Observação" value={detalhe.observacao} />}
                {detalhe.status === "FECHADO" && detalhe.iniciadoEm && (
                  <DetailRow icon={PlayCircle} label="Iniciado em" value={fmtDataHora(detalhe.iniciadoEm)} />
                )}
                {detalhe.status === "FECHADO" && detalhe.fechadoEm && (
                  <DetailRow icon={CheckCircle2} label="Concluído em" value={fmtDataHora(detalhe.fechadoEm)} />
                )}
              </dl>
            </div>

            {detalhe.status === "FECHADO" && detalhe.items.length > 0 && (
              <ResultadoContagem key={detalhe.id} detalhe={detalhe} />
            )}

            {detalhe.status === "PROGRAMADO" && (
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => { cancelar(detalhe.id); setDetalhe(null); }}
                  disabled={pending}
                  className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
                >
                  Cancelar ocorrência
                </button>
                <button
                  type="button"
                  onClick={() => { iniciar(detalhe.id); setDetalhe(null); }}
                  disabled={pending || !!aberto}
                  title={aberto ? "Finalize a contagem em andamento antes de iniciar outra" : undefined}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlayCircle size={14} />
                  {classificar(detalhe.dataProgramada).grupo === "futuro" ? "Iniciar antecipadamente" : "Iniciar contagem"}
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>

    </div>
  );
}
