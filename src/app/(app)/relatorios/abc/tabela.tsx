"use client";

import { brl, cn } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { ItemABC } from "../_data";

const BADGE: Record<"A" | "B" | "C", string> = {
  A: "bg-brand-soft text-brand",
  B: "bg-accent-soft text-accent",
  C: "bg-surface-2 text-faint",
};

const colunas: Coluna<ItemABC>[] = [
  { key: "classe", header: "Classe", cell: (r) => <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[r.classe])}>{r.classe}</span>, sort: (r) => r.classe },
  { key: "nome", header: "Produto", cell: (r) => <span className="font-medium text-ink">{r.nome}</span>, sort: (r) => r.nome },
  { key: "receita", header: "Faturamento", align: "right", cell: (r) => brl(r.receita), sort: (r) => r.receita },
  { key: "acum", header: "% acum.", align: "right", cell: (r) => `${Math.round(r.acumuladoPct)}%`, sort: (r) => r.acumuladoPct },
];

export function TabelaABC({ linhas }: { linhas: ItemABC[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "receita", dir: "desc" }} />;
}
