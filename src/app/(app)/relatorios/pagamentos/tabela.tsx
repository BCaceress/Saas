"use client";

import { brl } from "@/lib/utils";
import { fmtDataCompleta } from "@/lib/periodo";
import { ReportTable, type Coluna } from "@/components/charts/report-table";
import type { FechamentoCaixaRow } from "../_data";

const colunas: Coluna<FechamentoCaixaRow>[] = [
  { key: "fechadaEm", header: "Fechado em", cell: (r) => (r.fechadaEm ? fmtDataCompleta(r.fechadaEm) : "—"), sort: (r) => r.fechadaEm?.getTime() ?? 0 },
  { key: "site", header: "Site", cell: (r) => r.siteNome, sort: (r) => r.siteNome },
  { key: "esperado", header: "Esperado", align: "right", cell: (r) => brl(r.esperado), sort: (r) => r.esperado },
  { key: "contado", header: "Contado", align: "right", cell: (r) => brl(r.contado ?? 0), sort: (r) => r.contado ?? 0 },
  {
    key: "quebra",
    header: "Quebra",
    align: "right",
    cell: (r) => (
      <span className={r.quebra == null ? "text-faint" : r.quebra < 0 ? "text-danger" : r.quebra > 0 ? "text-ok" : "text-ink-2"}>
        {r.quebra == null ? "—" : brl(r.quebra)}
      </span>
    ),
    sort: (r) => r.quebra ?? 0,
  },
];

export function TabelaPagamentos({ linhas }: { linhas: FechamentoCaixaRow[] }) {
  return <ReportTable colunas={colunas} linhas={linhas} ordemInicial={{ key: "fechadaEm", dir: "desc" }} />;
}
