"use client";

import { brl } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { ProdutoVendaAgg } from "../_data";

const colunas: Coluna<ProdutoVendaAgg>[] = [
  { key: "nome", header: "Produto", cell: (r) => <span className="font-medium text-ink">{r.nome}</span>, sort: (r) => r.nome },
  { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs text-faint">{r.sku}</span> },
  { key: "qtd", header: "Qtd", align: "right", cell: (r) => r.quantidade.toLocaleString("pt-BR"), sort: (r) => r.quantidade },
  { key: "receita", header: "Faturamento", align: "right", cell: (r) => brl(r.receita), sort: (r) => r.receita },
];

export function TabelaVendas({ linhas }: { linhas: ProdutoVendaAgg[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "receita", dir: "desc" }} />;
}
