"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";

const ABAS = [
  { href: "/fiscal/notas-emitidas", label: "Notas emitidas" },
  { href: "/fiscal/notas-recebidas", label: "Notas recebidas" },
  { href: "/fiscal/eventos", label: "Eventos" },
];

export function FiscalHeader({ ambiente }: { ambiente: "PRODUCAO" | "HOMOLOGACAO" | null }) {
  const pathname = usePathname();

  return (
    <PageHeader
      title="Fiscal"
      icon={navIcon("/fiscal")}
      description="Notas emitidas e recebidas, eventos e histórico fiscal."
      innerClassName="max-w-none"
      badge={
        // Homologação emite sem valor fiscal. Se isso não estiver visível o
        // tempo todo, alguém vai "emitir" um mês inteiro e descobrir depois.
        ambiente === "HOMOLOGACAO" ? (
          <span className="rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
            Homologação — notas sem valor fiscal
          </span>
        ) : undefined
      }
    >
      <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
        {ABAS.map((aba) => {
          const ativa = pathname === aba.href || pathname.startsWith(aba.href + "/");
          return (
            <Link
              key={aba.href}
              href={aba.href}
              aria-current={ativa ? "page" : undefined}
              className={cn(
                "shrink-0 px-3.5 py-2.5 text-sm font-medium transition-colors",
                ativa ? "border-b-2 border-brand text-brand" : "text-muted hover:text-ink",
              )}
            >
              {aba.label}
            </Link>
          );
        })}
      </nav>
    </PageHeader>
  );
}
