import * as React from "react";
import Link from "next/link";
import { ChevronRight, ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — cabeçalho padrão de toda tela do app.
 *
 * Banda compacta de uma linha: breadcrumb opcional acima, depois
 * [voltar] [tile de ícone] título [badge] … [ações à direita]. Descrição entra
 * discreta abaixo, só quando necessária. O ícone é o MESMO do menu lateral
 * (fonte única: nav-config → `navIcon(href)`), num tile brand-soft que ancora
 * a identidade da tela. Chrome mínimo, baixa altura. Ações de formulário
 * (Salvar/Cancelar) NÃO ficam aqui: vão para um footer sticky na própria tela.
 *
 * Server Component (Link funciona direto). Acessibilidade: <header> semântico,
 * <h1> único por tela, breadcrumb como <nav aria-label> com aria-current na
 * página atual, foco visível herdado do globals.css. Ações quebram para a linha
 * de baixo quando falta largura.
 */

export type Crumb = {
  label: string;
  href?: string; // sem href = item atual (não navegável)
};

export interface PageHeaderProps {
  /** Título da página — vira o <h1>. */
  title: string;
  /** Linha de apoio: explica a tela em uma frase curta. */
  description?: string;
  /** Ícone da página — passe o mesmo do menu via `navIcon(href)` (nav-config),
   *  ou um Lucide direto em subpáginas. Renderiza como tile brand-soft. */
  icon?: LucideIcon;
  /** Trilha de navegação. O último item é tratado como página atual. */
  breadcrumbs?: Crumb[];
  /** Botão "voltar" à esquerda do título. */
  backHref?: string;
  /** Slot ao lado do título — badge de status, contador, etc. */
  badge?: React.ReactNode;
  /** Ações primárias/secundárias, alinhadas à direita. */
  actions?: React.ReactNode;
  /** Conteúdo extra logo abaixo (abas, filtros). Mantém o mesmo recuo. */
  children?: React.ReactNode;
  className?: string;
  /** Sobrescreve o container interno (largura/recuo). Ex.: "max-w-7xl",
   *  "max-w-none sm:px-8" para banda full-bleed. */
  innerClassName?: string;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  breadcrumbs,
  backHref,
  badge,
  actions,
  children,
  className,
  innerClassName,
}: PageHeaderProps) {
  return (
    <header className={cn("border-b border-line pb-4", className)}>
      <div
        className={cn(
          "mx-auto w-full max-w-6xl",
          innerClassName
        )}
      >
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumbs items={breadcrumbs} />
        )}

        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
          {/* Bloco identitário: voltar + ícone + título */}
          <div className="flex min-w-0 items-center gap-3">
            {backHref && (
              <Link
                href={backHref}
                aria-label="Voltar"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ArrowLeft size={17} />
              </Link>
            )}

            {Icon && (
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
              >
                <Icon size={19} />
              </span>
            )}

            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h1 className="truncate font-display text-[21px] font-semibold leading-tight tracking-tight text-ink">
                  {title}
                </h1>
                {badge}
              </div>
              {description && (
                <p className="mt-0.5 max-w-2xl truncate text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
          </div>

          {/* Ações — alinham à direita; quebram para nova linha se faltar espaço */}
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-center print:hidden">
              {actions}
            </div>
          )}
        </div>

        {children && <div className="mt-4">{children}</div>}
      </div>
    </header>
  );
}

function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Navegação estrutural" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="rounded-[4px] px-0.5 transition-colors hover:text-ink"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn("px-0.5", last && "font-medium text-ink-2")}
                  aria-current={last ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <ChevronRight
                  size={14}
                  className="text-faint"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
