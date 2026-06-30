"use client";

import { brl } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { CompraProdutoAgg } from "../_data";

const colunas: Coluna<CompraProdutoAgg>[] = [
  { key: "nome", header: "Produto", cell: (r) => <span className="font-medium text-ink">{r.nome}</span>, sort: (r) => r.nome },
  { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs text-faint">{r.sku}</span> },
  { key: "qtd", header: "Qtd (un)", align: "right", cell: (r) => r.quantidade.toLocaleString("pt-BR"), sort: (r) => r.quantidade },
  { key: "custoMedio", header: "Custo un.", align: "right", cell: (r) => brl(r.custoMedioCompra), sort: (r) => r.custoMedioCompra },
  { key: "total", header: "Total", align: "right", cell: (r) => brl(r.total), sort: (r) => r.total },
];

export function TabelaCompras({ linhas }: { linhas: CompraProdutoAgg[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "total", dir: "desc" }} />;
}
