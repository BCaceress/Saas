"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";
import { navMatches, type NavToggles } from "@/components/app/nav-config";
import { abasMobile, type MobileTab } from "@/components/mobile/nav";
import type { Acesso } from "@/lib/permissoes";

/**
 * Barra de polegar do `/m`. Fica fixa no rodapé, respeitando a área segura do
 * aparelho (o `viewportFit: "cover"` do root layout é o que dá valor a
 * `env(safe-area-inset-bottom)`).
 *
 * Diferente da `BottomNav` do app de desktop, esta não tem botão de menu: o
 * mapa completo é uma tela (`/m/mais`), não uma gaveta — gaveta em cima de
 * barra fixa é dois níveis de sobreposição no mesmo canto do polegar.
 */
export function MobileTabBar({
  acessos,
  toggles,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
}) {
  const pathname = usePathname();
  const { contar } = useAlerts();

  const abas = React.useMemo(() => abasMobile(acessos, toggles), [acessos, toggles]);

  if (abas.length === 0) return null;

  return (
    <nav
      aria-label="Navegação"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      <div className="flex items-stretch">
        {abas.map((aba) => (
          <Aba
            key={aba.href}
            aba={aba}
            // "/m" é prefixo de todas as outras: sem igualdade exata, Início
            // ficaria aceso na tela inteira do app.
            ativo={aba.href === "/m" ? pathname === "/m" : navMatches(pathname, aba.href)}
            alertas={contar(aba.href)}
          />
        ))}
      </div>
    </nav>
  );
}

function Aba({
  aba,
  ativo,
  alertas,
}: {
  aba: MobileTab;
  ativo: boolean;
  alertas: number;
}) {
  const Icone = aba.icon;

  return (
    <Link
      href={aba.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
        ativo ? "text-brand" : "text-muted",
      )}
    >
      {ativo && !aba.destaque && (
        <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand" aria-hidden />
      )}

      <span
        className={cn(
          "relative grid place-items-center",
          // O alvo de destaque sobe e vira cápsula: o polegar acha sem olhar.
          aba.destaque &&
            "-mt-5 h-12 w-12 rounded-full bg-brand text-on-brand shadow-[var(--shadow-1)]",
        )}
      >
        <Icone size={aba.destaque ? 22 : 20} />
        {alertas > 0 && (
          <span
            className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface"
            aria-label={`${alertas} ${alertas === 1 ? "alerta" : "alertas"}`}
          />
        )}
      </span>

      <span className="text-[11px] leading-none font-medium">{aba.label}</span>
    </Link>
  );
}
