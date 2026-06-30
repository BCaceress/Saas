"use client";

import { brl } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { ProdutoVendaAgg } from "../_data";

const colunas: Coluna<ProdutoVendaAgg>[] = [
  { key: "nome", header: "Produto", cell: (r) => <span className="font-medium text-ink">{r.nome}</span>, sort: (r) => r.nome },
  { key: "receita", header: "Receita", align: "right", cell: (r) => brl(r.receita), sort: (r) => r.receita },
  { key: "custo", header: "CMV", align: "right", cell: (r) => brl(r.custo), sort: (r) => r.custo },
  { key: "margem", header: "Margem", align: "right", cell: (r) => brl(r.margem), sort: (r) => r.margem },
  { key: "pct", header: "%", align: "right", cell: (r) => `${Math.round(r.margemPct)}%`, sort: (r) => r.margemPct },
];

export function TabelaMargem({ linhas }: { linhas: ProdutoVendaAgg[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "margem", dir: "desc" }} />;
}
