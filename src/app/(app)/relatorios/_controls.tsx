"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReportFilters } from "@/components/app/report-filters";

const TABS = [
  { tipo: "vendas", label: "Vendas" },
  { tipo: "margem", label: "Margem" },
  { tipo: "estoque", label: "Estoque" },
  { tipo: "perdas", label: "Perdas" },
  { tipo: "compras", label: "Compras" },
  { tipo: "producao", label: "Produção" },
  { tipo: "pagamentos", label: "Pagamentos" },
  { tipo: "abc", label: "Curva ABC" },
  { tipo: "fiscal", label: "Fiscal" },
  { tipo: "documentos", label: "Documentos" },
];

const COM_EXPORT = new Set(["vendas", "margem", "estoque", "perdas", "compras", "producao", "pagamentos", "abc"]);
/** Abas que NÃO são dashboards de dados — sem CSV/PDF de tela no header. */
const SEM_EXPORT_TELA = new Set(["documentos"]);

type SiteRow = { id: string; nome: string; tipo: string };

/** Filtros globais — vão no slot `actions` do PageHeader (linha do título). */
export function RelatoriosFiltros({
  sites,
  activeSiteId,
  multiSite,
}: {
  sites: SiteRow[];
  activeSiteId: string | null;
  multiSite: boolean;
}) {
  const pathname = usePathname();
  const tipoAtual = TABS.find((t) => pathname.startsWith(`/relatorios/${t.tipo}`))?.tipo;

  return (
    <ReportFilters
      sites={sites}
      activeSiteId={activeSiteId}
      multiSite={multiSite}
      exportTipo={tipoAtual && COM_EXPORT.has(tipoAtual) ? tipoAtual : undefined}
      hideExport={!!tipoAtual && SEM_EXPORT_TELA.has(tipoAtual)}
    />
  );
}

/** Abas de navegação — vão abaixo do header, em linha própria. */
export function RelatoriosTabs() {
  const pathname = usePathname();
  const tipoAtual = TABS.find((t) => pathname.startsWith(`/relatorios/${t.tipo}`))?.tipo;

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = tipoAtual === t.tipo;
        return (
          <Link
            key={t.tipo}
            href={`/relatorios/${t.tipo}`}
            className={cn(
              "shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors",
              active ? "border-b-2 border-brand text-brand" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
