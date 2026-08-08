"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";
import { navMatches, type NavToggles } from "@/components/app/nav-config";
import { abasMobile, type MobileTab } from "@/components/mobile/nav";
import { NovaOperacaoSheet } from "@/components/mobile/nova-operacao";
import type { Acesso } from "@/lib/permissoes";

/**
 * Barra de polegar do `/m`. Fica fixa no rodapé, respeitando a área segura do
 * aparelho (o `viewportFit: "cover"` do root layout é o que dá valor a
 * `env(safe-area-inset-bottom)`).
 *
 * Diferente da `BottomNav` do app de desktop, esta não tem botão de menu: o
 * mapa completo é uma tela (`/m/mais`), não uma gaveta — gaveta em cima de
 * barra fixa é dois níveis de sobreposição no mesmo canto do polegar.
 *
 * A exceção é o alvo do meio, que abre a folha "Nova operação". Ali a
 * sobreposição é o ponto: é uma decisão de "o que vou fazer agora", tomada de
 * qualquer tela, e que precisa voltar para onde a pessoa estava se ela desistir.
 */
export function MobileTabBar({
  acessos,
  toggles,
  multiSite,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
  /** Mais de um local ativo — a folha esconde transferência sem isso. */
  multiSite: boolean;
}) {
  const pathname = usePathname();
  const { contar } = useAlerts();
  const [operacoes, setOperacoes] = React.useState(false);

  const abas = React.useMemo(() => abasMobile(acessos, toggles), [acessos, toggles]);

  if (abas.length === 0) return null;

  return (
    <>
      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] print:hidden"
      >
        {/* Barra "flutuante": descolada da borda, com sombra própria — em vez de
            uma faixa grudada no rodapé, lê como um bloco de app por cima do
            conteúdo. */}
        <div className="flex items-stretch rounded-full border border-line bg-surface/95 px-2 shadow-[var(--shadow-2)] backdrop-blur">
          {abas.map((aba) => (
            <Aba
              key={aba.href}
              aba={aba}
              // "/m" é prefixo de todas as outras: sem igualdade exata, Início
              // ficaria aceso na tela inteira do app.
              ativo={aba.href === "/m" ? pathname === "/m" : navMatches(pathname, aba.href)}
              alertas={contar(aba.href)}
              onAbrirOperacoes={aba.abreOperacoes ? () => setOperacoes(true) : undefined}
            />
          ))}
        </div>
      </nav>

      <NovaOperacaoSheet
        open={operacoes}
        onClose={() => setOperacoes(false)}
        acessos={acessos}
        toggles={toggles}
        multiSite={multiSite}
      />
    </>
  );
}

const CLASSE_ABA =
  "tap relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]";

function Aba({
  aba,
  ativo,
  alertas,
  onAbrirOperacoes,
}: {
  aba: MobileTab;
  ativo: boolean;
  alertas: number;
  /** Presente = a aba abre a folha de operações em vez de navegar. */
  onAbrirOperacoes?: () => void;
}) {
  const miolo = <Miolo aba={aba} ativo={ativo} alertas={alertas} />;
  const classe = cn(CLASSE_ABA, ativo ? "text-brand" : "text-muted");

  if (onAbrirOperacoes) {
    return (
      <button
        type="button"
        onClick={onAbrirOperacoes}
        aria-haspopup="dialog"
        aria-label="Nova operação"
        className={cn(classe, "cursor-pointer")}
      >
        {miolo}
      </button>
    );
  }

  return (
    <Link href={aba.href} aria-current={ativo ? "page" : undefined} className={classe}>
      {miolo}
    </Link>
  );
}

function Miolo({
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
    <>
      <span
        className={cn(
          "relative grid place-items-center transition-colors",
          // Aba comum: o estado ativo é uma pastilha atrás do ícone — mais
          // legível de relance que o filete no topo, e não some no dedo.
          !aba.destaque && "h-8 w-12 rounded-full",
          !aba.destaque && ativo && "bg-brand-soft",
          // O alvo de destaque sobe e vira botão flutuante: o polegar acha sem
          // olhar. A elevação é a única sombra forte da tela — de propósito.
          aba.destaque &&
            "-mt-6 h-14 w-14 rounded-full bg-brand text-on-brand shadow-[var(--shadow-2)] ring-4 ring-surface",
        )}
      >
        <Icone size={aba.destaque ? 26 : 22} strokeWidth={ativo && !aba.destaque ? 2.4 : 2} />
        {alertas > 0 && (
          <span
            className="absolute top-0.5 right-2 h-2 w-2 rounded-full bg-danger ring-2 ring-surface"
            aria-label={`${alertas} ${alertas === 1 ? "alerta" : "alertas"}`}
          />
        )}
      </span>

      <span className={cn("text-[11px] leading-none", ativo ? "font-semibold" : "font-medium")}>
        {aba.label}
      </span>
    </>
  );
}
