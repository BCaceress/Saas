"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navTabs, navMatches } from "@/components/app/nav-config";

// Cabeçalho único do módulo de Cotações. Todas as telas são o mesmo assunto
// visto de ângulos diferentes — do painel ao histórico de preço —, então a
// barra de abas vive aqui e nenhuma tela repete cabeçalho próprio.
//
// As abas SÃO a gaveta "Cotações" do menu lateral: mesma lista, mesma ordem,
// mesma frase de apoio, lidas de `nav-config`. Pedidos e Recebimentos saíram
// daqui — cada um já é módulo irmão, com seu próprio cabeçalho.

const ABAS = navTabs("/cotacoes");

export function CotacoesHeader() {
  const pathname = usePathname();

  // Telas com cabeçalho próprio (`semAbas`) — a barra só atrapalharia.
  const ativa = ABAS.filter((a) => navMatches(pathname, a.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

  if (ativa?.semAbas) return null;

  const visiveis = ABAS.filter((a) => !a.semAbas && !a.ocultoNoMenu);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Cotações"
        icon={navIcon("/cotacoes")}
        description={ativa?.descricao}
        innerClassName="max-w-none"
        className={visiveis.length > 0 ? "pb-3" : undefined}
      />

      {visiveis.length > 0 && (
        <nav
          aria-label="Seções de compras"
          className="flex items-center gap-1 overflow-x-auto border-b border-line"
        >
          {visiveis.map((aba) => (
            <Link
              key={aba.href}
              href={aba.href}
              aria-current={aba.href === ativa?.href ? "page" : undefined}
              className={cn(
                "shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors",
                aba.href === ativa?.href
                  ? "border-b-2 border-brand text-brand"
                  : "text-muted hover:text-ink",
              )}
            >
              {aba.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
