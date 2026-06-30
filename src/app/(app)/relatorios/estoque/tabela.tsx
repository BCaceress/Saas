"use client";

import { brl } from "@/lib/utils";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { PosicaoEstoqueRow } from "../_data";

const colunas: Coluna<PosicaoEstoqueRow>[] = [
  { key: "nome", header: "Produto", cell: (r) => (<span className="font-medium text-ink">{r.nome}{r.abaixoMinimo && <span className="ml-2 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">baixo</span>}</span>), sort: (r) => r.nome },
  { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs text-faint">{r.sku}</span> },
  { key: "site", header: "Site", cell: (r) => r.siteNome, sort: (r) => r.siteNome },
  { key: "fechado", header: "Fechado", align: "right", cell: (r) => r.estoqueFechado.toLocaleString("pt-BR"), sort: (r) => r.estoqueFechado },
  { key: "custo", header: "Custo médio", align: "right", cell: (r) => brl(r.custoMedio ?? 0), sort: (r) => r.custoMedio ?? 0 },
  { key: "valor", header: "Valor", align: "right", cell: (r) => brl(r.valorEstoque), sort: (r) => r.valorEstoque },
];

export function TabelaEstoque({ linhas }: { linhas: PosicaoEstoqueRow[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "valor", dir: "desc" }} />;
}
