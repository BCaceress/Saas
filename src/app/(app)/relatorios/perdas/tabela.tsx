"use client";

import { brl } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { PerdaRow } from "../_data";

const colunas: Coluna<PerdaRow>[] = [
  { key: "nome", header: "Produto", cell: (r) => <span className="font-medium text-ink">{r.nome}</span>, sort: (r) => r.nome },
  { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs text-faint">{r.sku}</span> },
  { key: "qtd", header: "Quantidade", align: "right", cell: (r) => r.quantidade.toLocaleString("pt-BR"), sort: (r) => r.quantidade },
  { key: "custo", header: "Custo da perda", align: "right", cell: (r) => brl(r.custo), sort: (r) => r.custo },
];

export function TabelaPerdas({ linhas }: { linhas: PerdaRow[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "custo", dir: "desc" }} />;
}
