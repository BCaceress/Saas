"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { type NavToggles } from "@/components/app/nav-config";
import {
  Acordeao,
  acharAtivo,
  acharModulo,
  filtrarGrupos,
  ItemLink,
  NavGrupo,
  type GruposVisiveis,
} from "@/components/app/nav-items";
import type { Acesso } from "@/lib/permissoes";

export type SidebarToggles = NavToggles;

const TRIAL_TOTAL_DIAS = 14;

export function Sidebar({
  toggles,
  acessos,
  collapsed,
  planoLabel,
  trialDias,
}: {
  toggles: SidebarToggles;
  acessos: Acesso[];
  collapsed: boolean;
  planoLabel: string;
  trialDias: number | null;
}) {
  const pathname = usePathname();

  const grupos = React.useMemo(
    () => filtrarGrupos(acessos, toggles),
    [acessos, toggles],
  );
  const activeHref = acharAtivo(grupos, pathname);
  const moduloAtivo = acharModulo(grupos, activeHref);

  const principais = grupos.filter((g) => !g.rodape);
  const rodape = grupos.filter((g) => g.rodape);

  const trialPct =
    trialDias === null
      ? null
      : Math.max(0, Math.min(100, (trialDias / TRIAL_TOTAL_DIAS) * 100));
  const trialWarn = trialDias !== null && trialDias <= 3;

  // "9 dias" / "1 dia" / "Teste encerrado" / "Ativo" — o rótulo curto que cabe
  // na linha única do rodapé.
  const restanteLabel =
    trialDias === null
      ? "Ativo"
      : trialDias > 0
        ? `${trialDias} ${trialDias === 1 ? "dia" : "dias"}`
        : "Encerrado";

  return (
    // O acordeão embrulha a sidebar inteira, e não cada bloco: Configurações
    // mora no rodapé e ainda assim fecha o módulo que estava aberto acima.
    <Acordeao moduloAtivo={moduloAtivo}>
      <aside
        id="menu-lateral"
        className={cn(
          "sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-float)] transition-[width] duration-200 md:flex print:hidden motion-reduce:transition-none",
          collapsed ? "w-18" : "w-60",
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex h-15 items-center border-b border-line px-2",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <Image
              src="/images/logo.png"
              alt="NoHub"
              width={80}
              height={80}
              className="object-contain"
            />
          ) : (
            <Image
              src="/svg/logoTextoHorizontal.svg"
              alt="NoHub Market"
              width={160}
              height={40}
              loading="eager"
              className="h-auto w-auto object-contain"
            />
          )}
        </div>

        {/* Navegação */}
        <nav
          aria-label="Navegação principal"
          className="scrollbar-hairline flex-1 space-y-5 overflow-y-auto px-3 py-5"
        >
          {principais.map((grupo, gi) => (
            <NavGrupo
              key={grupo.title ?? gi}
              grupo={grupo}
              activeHref={activeHref}
              collapsed={collapsed}
              renderItem={
                collapsed
                  ? (item) => (
                      <ItemRegua key={item.href} item={item} activeHref={activeHref} />
                    )
                  : undefined
              }
            />
          ))}
        </nav>

        {/* Rodapé — Configurações + status do plano */}
        <div className="border-t border-line p-3">
          {rodape.map((grupo, gi) => (
            <div key={gi} className="mb-2">
              <NavGrupo
                grupo={grupo}
                activeHref={activeHref}
                collapsed={collapsed}
                renderItem={
                  collapsed
                    ? (item) => (
                        <ItemRegua key={item.href} item={item} activeHref={activeHref} />
                      )
                    : undefined
                }
              />
            </div>
          ))}

          {collapsed ? (
            <Link
              href="/configuracoes/plano"
              title={
                trialDias !== null
                  ? `Plano ${planoLabel} — ${trialDias} ${trialDias === 1 ? "dia restante" : "dias restantes"}`
                  : `Plano ${planoLabel}`
              }
              className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-2 text-accent transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <Sparkles size={16} />
            </Link>
          ) : (
            /* Uma linha e um fio de progresso rente à base. O card antigo gastava
               130px de menu para dizer o que cabe em 46 — e o menu precisa desse
               espaço para os itens. */
            <Link
              href="/configuracoes/plano"
              aria-label={
                trialDias !== null
                  ? `Plano ${planoLabel} — ${restanteLabel}. Fazer upgrade.`
                  : `Plano ${planoLabel}. Gerenciar plano.`
              }
              className="group block overflow-hidden rounded-xl border border-line bg-surface-2 transition-colors hover:border-line-strong hover:bg-surface"
            >
              <span className="flex items-center gap-2 px-3 py-2">
                <Sparkles
                  size={14}
                  aria-hidden
                  className={cn("shrink-0", trialWarn ? "text-warn" : "text-accent")}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                  {planoLabel}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] tabular-nums",
                    trialWarn ? "font-semibold text-warn" : "text-muted",
                  )}
                >
                  {restanteLabel}
                </span>
                <ArrowRight
                  size={13}
                  aria-hidden
                  className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </span>

              {trialDias !== null && (
                <span
                  role="progressbar"
                  aria-valuenow={trialDias}
                  aria-valuemin={0}
                  aria-valuemax={TRIAL_TOTAL_DIAS}
                  aria-label="Dias restantes do teste"
                  className="block h-0.5 bg-line"
                >
                  <span
                    className={cn(
                      "block h-full transition-[width] duration-500 motion-reduce:transition-none",
                      trialWarn ? "bg-warn" : "bg-accent",
                    )}
                    style={{ width: `${trialPct}%` }}
                  />
                </span>
              )}
            </Link>
          )}
        </div>
      </aside>
    </Acordeao>
  );
}

/**
 * Item da régua recolhida. Ícone só, com um flyout à direita que abre no hover
 * E no foco — antes o modo recolhido trocava a gaveta por um atalho cego para
 * a primeira filha, e as irmãs simplesmente sumiam.
 *
 * O painel é `fixed` e posicionado a partir do retângulo do gatilho: a régua
 * rola (`overflow-y-auto`), e em CSS um eixo que rola obriga o outro a cortar
 * — um painel absoluto seria decepado na borda da sidebar.
 */
function ItemRegua({
  item,
  activeHref,
}: {
  item: GruposVisiveis[number]["items"][number];
  activeHref: string | undefined;
}) {
  const filhos = item.children ?? [];
  const ativo = filhos.length
    ? filhos.some((f) => f.href === activeHref)
    : item.href === activeHref;

  const gatilhoRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const abrir = React.useCallback(() => {
    const r = gatilhoRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, left: r.right });
  }, []);
  const fechar = React.useCallback(() => setPos(null), []);

  return (
    <div
      ref={gatilhoRef}
      className="relative"
      onMouseEnter={abrir}
      onMouseLeave={fechar}
      onFocus={abrir}
      onBlur={(e) => {
        // O painel é filho deste nó, então sair para dentro dele não fecha.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) fechar();
      }}
    >
      <ItemLink
        item={filhos.length ? { ...item, href: filhos[0].href } : item}
        active={item.enabled && ativo}
        collapsed
      />

      {pos && (
        <div
          className="fixed z-50 pl-2"
          style={{ top: pos.top, left: pos.left }}
          // O padding esquerdo faz parte do painel: a mão atravessa o vão sem
          // que o hover caia no meio do caminho.
        >
          <div className="min-w-56 rounded-2xl border border-line bg-surface p-2 shadow-[var(--shadow-2)]">
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-faint">
              {item.label}
            </p>
            {filhos.length > 0 ? (
              <div className="space-y-0.5">
                {filhos.map((filho) => (
                  <ItemLink
                    key={filho.href}
                    item={filho}
                    active={filho.enabled && filho.href === activeHref}
                    collapsed={false}
                    filho
                    onNavigate={fechar}
                  />
                ))}
              </div>
            ) : (
              item.descricao && (
                <p className="max-w-56 px-2.5 pb-1 text-xs text-muted">
                  {item.descricao}
                </p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
