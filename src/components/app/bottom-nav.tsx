"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";
import {
  itemVisivel,
  navMatches,
  navMobile,
  type NavToggles,
} from "@/components/app/nav-config";
import type { Acesso } from "@/lib/permissoes";

/**
 * Barra fixa do celular com os destinos do dia a dia. É o atalho de polegar:
 * o drawer tem o mapa inteiro, mas quem está no salão só quer PDV, Estoque e
 * Compras sem abrir menu nenhum.
 *
 * Quais itens aparecem sai de `mobile: true` no nav-config — não há segunda
 * lista para desatualizar.
 */
export function BottomNav({
  toggles,
  acessos,
  onAbrirMenu,
  menuAberto,
}: {
  toggles: NavToggles;
  acessos: Acesso[];
  onAbrirMenu: () => void;
  menuAberto: boolean;
}) {
  const pathname = usePathname();
  const { contar } = useAlerts();

  const itens = React.useMemo(
    () => navMobile().filter((i) => i.enabled && itemVisivel(i, acessos, toggles)),
    [acessos, toggles],
  );

  if (itens.length === 0) return null;

  return (
    <nav
      aria-label="Atalhos"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <div className="flex items-stretch">
        {itens.map((item) => {
          const ativo = navMatches(pathname, item.href);
          const alertas = contar(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                ativo ? "text-brand" : "text-muted",
              )}
            >
              {ativo && (
                <span
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand"
                  aria-hidden
                />
              )}
              <span className="relative">
                <item.icon size={20} />
                {alertas > 0 && (
                  <span
                    className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface"
                    aria-label={`${alertas} ${alertas === 1 ? "alerta" : "alertas"}`}
                  />
                )}
              </span>
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onAbrirMenu}
          aria-expanded={menuAberto}
          aria-haspopup="dialog"
          className="flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 py-2 text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
        >
          <Menu size={20} />
          <span className="text-[11px] font-medium leading-none">Menu</span>
        </button>
      </div>
    </nav>
  );
}
