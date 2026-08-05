"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";
import {
  NAV_GROUPS,
  itemVisivel,
  navMatches,
  type NavGroup,
  type NavItem,
  type NavToggles,
} from "@/components/app/nav-config";
import type { Acesso } from "@/lib/permissoes";
import type { AlertPriority } from "@/lib/alerts-types";

/**
 * Renderização dos itens de navegação — compartilhada pela sidebar do desktop
 * e pelo drawer do mobile. As duas mostram a MESMA lista; o que muda é só a
 * moldura em volta. Enquanto cada uma tinha sua cópia, elas divergiam.
 */

export type GruposVisiveis = ReturnType<typeof filtrarGrupos>;

/**
 * Grupos podados para este operador: some o que a permissão nega, o que o
 * toggle do tenant desliga e o que é só mapa (`ocultoNoMenu`, que existe para
 * as abas e para a paleta). Esconder aqui é conforto — quem digita a URL ainda
 * bate no guard da rota.
 */
export function filtrarGrupos(acessos: Acesso[], toggles: NavToggles) {
  return NAV_GROUPS.map((group: NavGroup) => ({
    title: group.title,
    rodape: group.rodape ?? false,
    items: group.items
      .filter((i) => itemVisivel(i, acessos, toggles))
      .map((item) => ({
        ...item,
        children: item.children?.filter(
          (c) => !c.ocultoNoMenu && itemVisivel(c, acessos, toggles),
        ),
      })),
  })).filter((g) => g.items.length > 0);
}

/**
 * Rota ativa: entre todos os href que casam com a tela atual, vence o mais
 * específico (/estoque/validade ganha de /estoque).
 */
export function acharAtivo(
  grupos: GruposVisiveis,
  pathname: string,
): string | undefined {
  return grupos
    .flatMap((g) =>
      // Gaveta que ficou sem filha visível (todas `ocultoNoMenu`) vira link do
      // próprio pai — então ela também precisa concorrer à rota ativa.
      g.items.flatMap((i) => (i.children?.length ? i.children : [i]).filter((x) => x.enabled)),
    )
    .map((i) => i.href)
    .filter((href) => navMatches(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
}

/** Href do pai cuja gaveta guarda a rota atual — null quando a tela é raiz. */
export function acharModulo(
  grupos: GruposVisiveis,
  activeHref: string | undefined,
): string | null {
  if (!activeHref) return null;
  return (
    grupos
      .flatMap((g) => g.items)
      .find((i) => i.children?.some((c) => c.href === activeHref))?.href ?? null
  );
}

// ── Acordeão ────────────────────────────────────────────────────

type AcordeaoCtx = { aberta: string | null; alternar: (href: string) => void };

const AcordeaoContext = React.createContext<AcordeaoCtx | null>(null);

/**
 * Uma gaveta aberta por vez: abrir Compras fecha Estoque. O estado mora aqui,
 * e não dentro de cada gaveta, porque "só uma" é regra do menu inteiro — com
 * o estado espalhado, cada gaveta só sabia de si e todas ficavam abertas,
 * empurrando os módulos de baixo para fora da tela.
 */
export function Acordeao({
  moduloAtivo,
  children,
}: {
  moduloAtivo: string | null;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = React.useState<string | null>(moduloAtivo);

  // Mudar de módulo devolve o comando à rota: a gaveta da tela nova abre e a
  // que estava aberta na mão fecha. Ajuste durante o render — sem effect e sem
  // render em cascata.
  const [anterior, setAnterior] = React.useState(moduloAtivo);
  if (anterior !== moduloAtivo) {
    setAnterior(moduloAtivo);
    setAberta(moduloAtivo);
  }

  const valor = React.useMemo<AcordeaoCtx>(
    () => ({
      aberta,
      alternar: (href) => setAberta((a) => (a === href ? null : href)),
    }),
    [aberta],
  );

  return (
    <AcordeaoContext.Provider value={valor}>{children}</AcordeaoContext.Provider>
  );
}

// ── Badge ───────────────────────────────────────────────────────

const BADGE_TOM: Record<AlertPriority, string> = {
  critico: "bg-danger-soft text-danger",
  alto: "bg-warn-soft text-warn",
  medio: "bg-warn-soft text-warn",
  baixo: "bg-surface-2 text-muted",
  info: "bg-surface-2 text-muted",
};

/**
 * Conta os alertas do item — e, num pai de gaveta, os das filhas também, para
 * que o número apareça mesmo com a gaveta fechada.
 */
function useBadge(item: NavItem) {
  const { contar, prioridadeDe } = useAlerts();
  const total = contar(item.href);
  const prioridade = prioridadeDe(item.href);
  return { total, tom: BADGE_TOM[prioridade ?? "baixo"] };
}

function Badge({ total, tom, ponto }: { total: number; tom: string; ponto?: boolean }) {
  if (total === 0) return null;
  if (ponto) {
    return (
      <span
        className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full", tom)}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        tom,
      )}
      aria-label={`${total} ${total === 1 ? "alerta" : "alertas"}`}
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}

// ── Linha do menu ───────────────────────────────────────────────

/** Linha simples do menu — pílula com ícone, rótulo, badge e selo de "Em breve". */
export function ItemLink({
  item,
  active,
  collapsed,
  filho = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  filho?: boolean;
  onNavigate?: () => void;
}) {
  const { total, tom } = useBadge(item);

  const content = (
    <span
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-full text-sm transition-all duration-200",
        filho ? "px-3 py-2 text-[13px]" : "px-3.5 py-2.5",
        collapsed && "justify-center px-0",
        item.enabled
          ? active
            ? "bg-brand font-semibold text-on-brand shadow-[var(--shadow-1)]"
            : "font-medium text-ink-2 hover:bg-brand-soft hover:text-brand"
          : "cursor-not-allowed font-medium text-faint",
      )}
    >
      <span className={cn("shrink-0", active && item.enabled && "text-on-brand")}>
        <item.icon size={filho ? 16 : 19} />
      </span>
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && !item.enabled && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Em breve
        </span>
      )}
      {item.enabled && !active && (
        <Badge total={total} tom={tom} ponto={collapsed} />
      )}
    </span>
  );

  // Item por vir não é link nem botão clicável, mas continua alcançável pelo
  // teclado: um `div aria-disabled` sumiria da ordem de foco sem avisar.
  return item.enabled ? (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {content}
    </Link>
  ) : (
    <button type="button" disabled className="block w-full cursor-not-allowed">
      {content}
    </button>
  );
}

/**
 * Item com gaveta (ex.: Compras). Abre sozinha quando a tela atual é uma das
 * filhas e continua abrindo/fechando no clique.
 */
export function Gaveta({
  item,
  filhos,
  activeHref,
  onNavigate,
}: {
  item: NavItem;
  filhos: NavItem[];
  activeHref: string | undefined;
  onNavigate?: () => void;
}) {
  const temFilhaAtiva = filhos.some((f) => f.href === activeHref);
  const { total, tom } = useBadge(item);

  // Fora de um <Acordeao> a gaveta se vira sozinha — o fallback mantém o item
  // clicável em qualquer moldura que reuse este componente.
  const acordeao = React.useContext(AcordeaoContext);
  const [solta, setSolta] = React.useState(temFilhaAtiva);
  const aberta = acordeao ? acordeao.aberta === item.href : solta;
  const alternar = () =>
    acordeao ? acordeao.alternar(item.href) : setSolta((v) => !v);

  const painelId = `nav-${item.href.replace(/\W+/g, "-")}`;

  return (
    <div className="relative">
      {/* Barra do módulo ativo: dá para achar onde se está só rolando o olho. */}
      {temFilhaAtiva && (
        <span
          className="absolute left-0 top-1 h-8 w-0.5 rounded-full bg-brand"
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        aria-controls={painelId}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          temFilhaAtiva
            ? "font-semibold text-brand"
            : "font-medium text-ink-2 hover:bg-brand-soft hover:text-brand",
        )}
      >
        <span className="shrink-0">
          <item.icon size={19} />
        </span>
        <span className="flex-1 truncate text-left">{item.label}</span>
        {!aberta && <Badge total={total} tom={tom} />}
        <ChevronDown
          size={15}
          aria-hidden
          className={cn(
            "shrink-0 text-faint transition-transform duration-200 motion-reduce:transition-none",
            aberta && "rotate-180",
          )}
        />
      </button>

      {/* Abre e fecha por altura, sem número mágico: o truque das linhas de
          grid (0fr → 1fr) anima até a altura real do conteúdo, que muda com o
          número de filhas. `inert` tira as filhas do foco enquanto fechadas —
          altura zero esconde do olho, não do teclado. */}
      <div
        id={painelId}
        inert={!aberta}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          aberta ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 ml-5 space-y-0.5 border-l border-line pl-2">
            {filhos.map((filho) => (
              <ItemLink
                key={filho.href}
                item={filho}
                active={filho.enabled && filho.href === activeHref}
                collapsed={false}
                filho
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Um grupo com seu título. `collapsed` só existe na sidebar do desktop. */
export function NavGrupo({
  grupo,
  activeHref,
  collapsed = false,
  onNavigate,
  renderItem,
}: {
  grupo: GruposVisiveis[number];
  activeHref: string | undefined;
  collapsed?: boolean;
  onNavigate?: () => void;
  /** A sidebar recolhida troca a gaveta por um flyout — daí o gancho. */
  renderItem?: (item: GruposVisiveis[number]["items"][number]) => React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {grupo.title &&
        (!collapsed ? (
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-faint">
            {grupo.title}
          </p>
        ) : (
          <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden />
        ))}
      {grupo.items.map((item) => {
        const custom = renderItem?.(item);
        if (custom) return <React.Fragment key={item.href}>{custom}</React.Fragment>;
        return item.children && item.children.length > 0 ? (
          <Gaveta
            key={item.href}
            item={item}
            filhos={item.children}
            activeHref={activeHref}
            onNavigate={onNavigate}
          />
        ) : (
          <ItemLink
            key={item.href}
            item={item}
            active={item.enabled && item.href === activeHref}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}
