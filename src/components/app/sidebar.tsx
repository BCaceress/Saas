"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, type NavToggles } from "@/components/app/nav-config";

export type SidebarToggles = NavToggles;

const TRIAL_TOTAL_DIAS = 14;

export function Sidebar({
  toggles,
  collapsed,
  planoLabel,
  trialDias,
}: {
  toggles: SidebarToggles;
  collapsed: boolean;
  planoLabel: string;
  trialDias: number | null;
}) {
  const pathname = usePathname();

  const groups = NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      ...item,
      show: item.show ? item.show(toggles) : true,
    })),
  }));

  // Ativo = href que casa com o pathname; entre vários que casam
  // (ex.: /configuracoes e /configuracoes/usuarios), vence o mais específico.
  const allHrefs = groups.flatMap((g) =>
    g.items.filter((i) => i.show && i.enabled).map((i) => i.href),
  );
  const matches = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const activeHref = allHrefs
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];

  const trialPct =
    trialDias === null
      ? null
      : Math.max(0, Math.min(100, (trialDias / TRIAL_TOTAL_DIAS) * 100));
  const trialWarn = trialDias !== null && trialDias <= 3;

  return (
    <aside
      className={cn(
        "sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-float)] transition-[width] duration-200 md:flex",
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
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {groups.map((group, gi) => {
          const visible = group.items.filter((i) => i.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.title ?? gi} className="space-y-1">
              {group.title &&
                (!collapsed ? (
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-faint">
                    {group.title}
                  </p>
                ) : (
                  <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden />
                ))}
              {visible.map((item) => {
                const active = item.enabled && item.href === activeHref;
                const content = (
                  <span
                    className={cn(
                      "group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition-all duration-200",
                      collapsed && "justify-center px-0",
                      item.enabled
                        ? active
                          ? "bg-brand font-semibold text-on-brand shadow-[var(--shadow-1)]"
                          : "font-medium text-ink-2 hover:bg-brand-soft hover:text-brand"
                        : "cursor-not-allowed font-medium text-faint hover:bg-surface-2",
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <span
                      className={cn(
                        "shrink-0",
                        active && item.enabled && "text-on-brand",
                      )}
                    >
                      <item.icon size={19} />
                    </span>
                    {!collapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}
                    {!collapsed && !item.enabled && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Em breve
                      </span>
                    )}
                  </span>
                );
                return item.enabled ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={item.href} aria-disabled>
                    {content}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Rodapé — status do plano */}
      <div className="border-t border-line p-3">
        {collapsed ? (
          <Link
            href="/configuracoes"
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
          <div className="rounded-2xl border border-line bg-surface-2 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                Plano
              </p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  trialWarn
                    ? "bg-warn-soft text-warn"
                    : "bg-accent-soft text-accent",
                )}
              >
                {planoLabel}
              </span>
            </div>

            {trialDias !== null ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  {trialDias > 0 ? (
                    <>
                      <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {trialDias}
                      </span>{" "}
                      {trialDias === 1 ? "dia restante" : "dias restantes"}
                    </>
                  ) : (
                    "Período de teste encerrado"
                  )}
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={trialDias}
                  aria-valuemin={0}
                  aria-valuemax={TRIAL_TOTAL_DIAS}
                  aria-label="Dias restantes do teste"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-500",
                      trialWarn ? "bg-warn" : "bg-accent",
                    )}
                    style={{ width: `${trialPct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted">Assinatura ativa</p>
            )}

            <Link
              href="/configuracoes"
              className="group mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs font-semibold text-brand transition-colors hover:text-brand-strong"
            >
              <span>{trialDias !== null ? "Fazer upgrade" : "Gerenciar plano"}</span>
              <ArrowRight
                size={14}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
