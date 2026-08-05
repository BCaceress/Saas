"use client";

import * as React from "react";
import {
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
  ChevronDown,
  Circle,
  CirclePause,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Crown,
  Download,
  Eye,
  FileText,
  FlaskConical,
  History,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  PackagePlus,
  PackageX,
  Percent,
  PiggyBank,
  Receipt,
  ReceiptText,
  Scale,
  Search,
  ShoppingCart,
  SlidersHorizontal,
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { semAcento } from "@/lib/normalize";
import {
  CATEGORIAS,
  type CategoriaId,
  type RelatorioDef,
} from "@/lib/relatorios/catalogo";
import { ConfiguradorRelatorio } from "./_configurador/configurador";
import { VisualizadorRelatorio } from "./_configurador/visualizador";
import { MenuExportar, hrefSaida, type Saida } from "./_configurador/previa";
import { registrarSaidaPadraoAction } from "./_configurador/actions";
import { alternarFavoritoAction } from "./_central-actions";

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

type Chip = "todos" | "favoritos" | "usados" | "recentes";

const CHIPS: { id: Chip; label: string; icon: LucideIcon }[] = [
  { id: "todos", label: "Todos", icon: LayoutGrid },
  { id: "favoritos", label: "Favoritos", icon: Star },
  { id: "usados", label: "Mais utilizados", icon: TrendingUp },
  { id: "recentes", label: "Recentes", icon: History },
];

/* ------------------------------------------------------------------ */
/* Central                                                             */
/* ------------------------------------------------------------------ */

export function CentralClient({
  relatorios,
  favoritos: favoritosIniciais,
  uso,
  podeExportar,
}: {
  relatorios: RelatorioDef[];
  favoritos: string[];
  uso: Record<string, UsoCliente>;
  podeExportar: boolean;
}) {
  const [busca, setBusca] = React.useState("");
  const [chip, setChip] = React.useState<Chip>("todos");
  const [categoria, setCategoria] = React.useState<CategoriaId | null>(null);
  const [favoritos, setFavoritos] = React.useState<string[]>(favoritosIniciais);
  const [visualizando, setVisualizando] = React.useState<RelatorioDef | null>(null);
  const [personalizando, setPersonalizando] = React.useState<RelatorioDef | null>(null);
  const [, iniciar] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  /**
   * "Exportar" direto do card: o arquivo sai no padrão, sem passar por tela
   * nenhuma. A rota executa o relatório sem `?c=` e cai no mesmo padrão que o
   * servidor usaria — por isso não precisamos carregar definição aqui.
   */
  function exportarPadrao(rel: RelatorioDef, formato: Saida) {
    // Abrir a janela ANTES do await: navegador só confia em `window.open` que
    // nasce do clique — depois de um `await` ele trata como popup e bloqueia.
    window.open(hrefSaida(rel.id, formato), "_blank", "noopener");
    void registrarSaidaPadraoAction({ relatorioId: rel.id, formato }).catch(() => {});
  }

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
    podeExportar,
    onFavoritar: alternarFavorito,
    onVisualizar: setVisualizando,
    onPersonalizar: setPersonalizando,
    onExportar: exportarPadrao,
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

        {/* Uma linha só: recortes (todos/favoritos/uso) e categorias são o mesmo
            gesto — escolher por onde entrar. Separados por um traço, não por
            duas seções: quem procura não quer decidir em qual lista procurar. */}
        <div className="flex flex-wrap items-center gap-2">
          {CHIPS.map((c) => (
            <Pilula
              key={c.id}
              ativa={chip === c.id}
              onClick={() => setChip(c.id)}
              icone={React.createElement(c.icon, { size: 14, "aria-hidden": true })}
            >
              {c.label}
            </Pilula>
          ))}

          <span className="mx-1 hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden />

          {CATEGORIAS.map((c) => {
            const total = contagemCategoria.get(c.id) ?? 0;
            if (total === 0) return null;
            const ativa = categoria === c.id;
            return (
              <Pilula
                key={c.id}
                ativa={ativa}
                onClick={() => setCategoria(ativa ? null : c.id)}
                icone={<Icone nome={c.icon} size={14} />}
                contagem={total}
              >
                {c.nome}
              </Pilula>
            );
          })}

          <span className="ml-auto shrink-0 text-[13px] text-faint">
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

      {/* Visualizar: abre já com o resultado, no padrão, sem perguntar nada. */}
      {visualizando && (
        <VisualizadorRelatorio
          relatorioId={visualizando.id}
          nome={visualizando.nome}
          descricao={visualizando.descricao}
          categoria={CATEGORIAS.find((c) => c.id === visualizando.categoria)?.nome ?? ""}
          exportacoes={podeExportar ? visualizando.exportacoes : []}
          onPersonalizar={() => {
            setPersonalizando(visualizando);
            setVisualizando(null);
          }}
          onClose={() => setVisualizando(null)}
        />
      )}

      {/* Personalizar: o painel de colunas, para quem realmente precisa. */}
      {personalizando && (
        <ConfiguradorRelatorio
          relatorioId={personalizando.id}
          nome={personalizando.nome}
          descricao={personalizando.descricao}
          categoria={CATEGORIAS.find((c) => c.id === personalizando.categoria)?.nome ?? ""}
          exportacoes={personalizando.exportacoes}
          onClose={() => setPersonalizando(null)}
        />
      )}

    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

/** Pílula de filtro — mesma forma para recorte e categoria, de propósito. */
function Pilula({
  ativa,
  icone,
  contagem,
  onClick,
  children,
}: {
  ativa: boolean;
  icone: React.ReactNode;
  contagem?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        ativa
          ? "border-brand bg-brand text-on-brand"
          : "border-line bg-surface text-muted hover:border-brand/40 hover:text-ink",
      )}
    >
      <span className={cn("shrink-0", ativa ? "text-on-brand" : "text-faint")}>{icone}</span>
      {children}
      {contagem !== undefined && (
        <span
          className={cn(
            "font-mono text-[11px]",
            ativa ? "text-on-brand/70" : "text-faint",
          )}
        >
          {contagem}
        </span>
      )}
    </button>
  );
}

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

/**
 * Card do catálogo: ícone, nome, descrição, estrela e três ações.
 *
 * A hierarquia é a do uso real: **Visualizar** abre o relatório no padrão sem
 * perguntar nada, **Exportar** entrega o arquivo (também no padrão, o formato
 * escolhido no menu) e **Personalizar** — o menor dos três — leva ao painel de
 * colunas. Configurar deixou de ser pedágio para virar exceção.
 */
function CardRelatorio({
  rel,
  favoritos,
  podeExportar,
  onFavoritar,
  onVisualizar,
  onPersonalizar,
  onExportar,
}: {
  rel: RelatorioDef;
  favoritos: string[];
  podeExportar: boolean;
  onFavoritar: (rel: RelatorioDef) => void;
  onVisualizar: (rel: RelatorioDef) => void;
  onPersonalizar: (rel: RelatorioDef) => void;
  onExportar: (rel: RelatorioDef, formato: Saida) => void;
}) {
  const favorito = favoritos.includes(rel.id);
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
      <div className="flex flex-1 items-start gap-2.5 p-3">
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-sm",
            indisponivel ? "bg-surface-2 text-faint" : "bg-brand-softer text-brand",
          )}
        >
          {indisponivel ? <Lock size={15} aria-hidden /> : <Icone nome={rel.icon} size={16} />}
        </span>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "font-display text-[13.5px] font-bold leading-tight transition-colors",
              indisponivel ? "text-muted" : "text-ink group-hover:text-brand",
            )}
          >
            {rel.nome}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">
            {motivo ?? rel.descricao}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onFavoritar(rel)}
          aria-pressed={favorito}
          title={favorito ? "Remover dos favoritos" : "Favoritar"}
          className={cn(
            "grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full transition-colors",
            favorito ? "text-accent" : "text-faint hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Star size={14} fill={favorito ? "currentColor" : "none"} aria-hidden />
          <span className="sr-only">{favorito ? "Remover dos favoritos" : "Favoritar"}</span>
        </button>
      </div>

      {!indisponivel && (
        <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-2">
          <AcaoCard tom="primaria" icone={Eye} onClick={() => onVisualizar(rel)}>
            Visualizar
          </AcaoCard>

          {podeExportar && rel.exportacoes.length > 0 && (
            <MenuExportar
              exportacoes={rel.exportacoes}
              ocupado={null}
              onExportar={(f) => onExportar(rel, f)}
              trigger={
                <AcaoCard tom="secundaria" icone={Download} seta>
                  Exportar
                </AcaoCard>
              }
            />
          )}

          <AcaoCard
            tom="icone"
            icone={SlidersHorizontal}
            title="Personalizar colunas e ordem"
            onClick={() => onPersonalizar(rel)}
          >
            <span className="sr-only">Personalizar {rel.nome}</span>
          </AcaoCard>
        </div>
      )}
    </article>
  );
}

/**
 * Botão do rodapé do card — três pesos para três intenções.
 *
 * `primaria` (Visualizar) puxa o olho e ocupa o espaço que sobra: é o que 9 em
 * 10 pessoas querem. `secundaria` (Exportar) é contorno, e `icone`
 * (Personalizar) é só o símbolo — ação de exceção não merece rótulo ocupando
 * largura em trinta cards. `onClick` pode chegar por `cloneElement` (quando o
 * botão é o gatilho do menu), então é repassado em vez de fixado.
 */
function AcaoCard({
  tom,
  icone: Icon,
  seta,
  title,
  onClick,
  children,
}: {
  tom: "primaria" | "secundaria" | "icone";
  icone: LucideIcon;
  /** Sinaliza que o clique abre um menu. */
  seta?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border text-[12.5px] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        tom === "primaria" &&
          "flex-1 border-brand/35 bg-brand-soft px-3 text-brand-strong hover:border-brand hover:bg-brand hover:text-on-brand",
        tom === "secundaria" &&
          "border-line bg-surface px-3 text-muted hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong",
        tom === "icone" &&
          "w-8 shrink-0 border-line bg-surface text-faint hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong",
      )}
    >
      <Icon size={14} aria-hidden />
      {children}
      {seta && <ChevronDown size={13} className="-ml-0.5 opacity-70" aria-hidden />}
    </button>
  );
}

