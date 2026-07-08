"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Boxes,
  Warehouse,
  Users,
  ShoppingCart,
  ShoppingBag,
  ClipboardList,
  BarChart3,
  Settings,
  Recycle,
  Truck,
  Sparkles,
  ChevronRight,
  Clock,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type SidebarToggles = {
  moduloPdv: boolean;
  moduloComodato: boolean;
  moduloRota: boolean;
};

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  show: boolean;
};

type Group = {
  title: string;
  items: Item[];
};

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

  const groups: Group[] = [
    {
      title: "Principal",
      items: [
        {
          href: "/inicio",
          label: "Início",
          icon: <Home size={19} />,
          enabled: true,
          show: true,
        },
        {
          href: "/produtos",
          label: "Produtos",
          icon: <Boxes size={19} />,
          enabled: true,
          show: true,
        },
        {
          href: "/clientes",
          label: "Clientes",
          icon: <Users size={19} />,
          enabled: true,
          show: true,
        },
        {
          href: "/estoque",
          label: "Estoque",
          icon: <Warehouse size={19} />,
          enabled: true,
          show: true,
        },
        {
          href: "/compras",
          label: "Compras",
          icon: <ShoppingBag size={19} />,
          enabled: true,
          show: true,
        },
      ],
    },
    {
      title: "Operações",
      items: [
        {
          href: "/pedidos",
          label: "Pedidos",
          icon: <ClipboardList size={19} />,
          enabled: false,
          show: true,
        },
        {
          href: "/vendas",
          label: "Vendas (PDV)",
          icon: <ShoppingCart size={19} />,
          enabled: true,
          show: toggles.moduloPdv,
        },
        {
          href: "/vendas/totem",
          label: "Autoatendimento",
          icon: <ShoppingCart size={19} />,
          enabled: true,
          show: !toggles.moduloPdv,
        },
        {
          href: "/rota",
          label: "Reposição",
          icon: <Truck size={19} />,
          enabled: false,
          show: toggles.moduloRota,
        },
        {
          href: "/comodato",
          label: "Comodato",
          icon: <Recycle size={19} />,
          enabled: false,
          show: toggles.moduloComodato,
        },
        {
          href: "/relatorios",
          label: "Relatórios",
          icon: <BarChart3 size={19} />,
          enabled: true,
          show: true,
        },
        {
          href: "/configuracoes",
          label: "Configurações",
          icon: <Settings size={19} />,
          enabled: true,
          show: true,
        },
      ],
    },
  ];

  const trialTone = trialDias !== null && trialDias <= 3 ? "warn" : "accent";
  const trialLabel =
    trialDias === null
      ? null
      : trialDias > 0
        ? `Teste: ${trialDias} ${trialDias === 1 ? "dia" : "dias"}`
        : "Teste encerrado";

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
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6">
        {groups.map((group) => {
          const visible = group.items.filter((i) => i.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.title} className="space-y-1">
              {!collapsed ? (
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                  {group.title}
                </p>
              ) : (
                <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden />
              )}
              {visible.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
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
                      {item.icon}
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

      {/* Rodapé — plano / teste / upgrade */}
      <div className="border-t border-line p-3">
        {collapsed ? (
          <Link
            href="/configuracoes"
            title={trialLabel ?? "Fazer upgrade"}
            className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-brand text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Sparkles size={16} />
          </Link>
        ) : (
          <div className="rounded-2xl border border-line bg-surface-2 p-3">
            {trialLabel && (
              <div
                className={cn(
                  "mb-3 flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold",
                  trialTone === "warn"
                    ? "bg-warn-soft text-warn"
                    : "bg-accent-soft text-accent",
                )}
              >
                <Clock size={14} className="shrink-0" />
                <span className="truncate">{trialLabel}</span>
              </div>
            )}
            {/* <p className="px-0.5 pb-1 text-xs text-muted">Plano {planoLabel}</p> */}

            <Link
              href="/configuracoes"
              className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles size={14} /> Fazer upgrade
              </span>
              <ChevronRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
