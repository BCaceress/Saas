"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { fmtData, fmtDataCompleta } from "@/lib/periodo";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { detalheDia, type DetalheDia } from "./actions";
import type { PontoFinanceiro } from "../relatorios/_data";

type Metrica = "receita" | "pedidos" | "lucro" | "ticket";

const METRICAS: { id: Metrica; label: string }[] = [
  { id: "receita", label: "Receita" },
  { id: "pedidos", label: "Pedidos" },
  { id: "lucro", label: "Lucro" },
  { id: "ticket", label: "Ticket médio" },
];

/**
 * Gráfico principal com troca de métrica sem sair da tela: as 4 séries já
 * vêm calculadas do servidor (`serieFinanceiraDiaria`); a troca é só estado
 * local, sem refetch. Clicar num ponto abre o drill-down do dia (categorias +
 * horário de pico), buscado sob demanda — não pré-carregamos 30 dias de
 * detalhe por dia à toa.
 */
export function TrendChart({
  serie,
  periodoLabel,
  semVendas,
}: {
  serie: PontoFinanceiro[];
  periodoLabel: string;
  semVendas: boolean;
}) {
  const [metrica, setMetrica] = useState<Metrica>("receita");
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheDia | null>(null);
  const [carregando, startTransition] = useTransition();

  const formato = metrica === "pedidos" ? (v: number) => v.toLocaleString("pt-BR") : brl;
  const pontos = serie.map((p) => ({
    data: fmtData(new Date(`${p.data}T00:00:00`)),
    valor: metrica === "receita" ? p.receita : metrica === "lucro" ? p.lucro : metrica === "ticket" ? p.ticket : p.numVendas,
  }));

  function selecionar(index: number) {
    if (selecionado === index) {
      setSelecionado(null);
      setDetalhe(null);
      return;
    }
    setSelecionado(index);
    setDetalhe(null);
    startTransition(async () => {
      const d = await detalheDia(serie[index].data);
      setDetalhe(d);
    });
  }

  return (
    <ChartCard
      title="Tendência"
      subtitle={periodoLabel}
      action={
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface-2 p-1 print:hidden">
          {METRICAS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetrica(m.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                metrica === m.id ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      {semVendas ? (
        <ChartEmpty />
      ) : (
        <div key={metrica} className="animate-[trend-fade_250ms_ease-out]">
          <LineChart pontos={pontos} formato={formato} altura={150} onPointClick={selecionar} indiceSelecionado={selecionado} />
        </div>
      )}

      {selecionado != null && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2/60 p-3 print:hidden">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">{fmtDataCompleta(new Date(`${serie[selecionado].data}T00:00:00`))}</p>
            <button type="button" onClick={() => selecionar(selecionado)} aria-label="Fechar" className="text-faint hover:text-ink">
              <X size={13} />
            </button>
          </div>
          {carregando ? (
            <p className="text-xs text-muted">Carregando…</p>
          ) : detalhe && (detalhe.categorias.length > 0 || detalhe.picoHora) ? (
            <div className="flex flex-col gap-2">
              {detalhe.categorias.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {detalhe.categorias.map((c) => (
                    <li key={c.categoria} className="flex items-center justify-between text-xs">
                      <span className="text-ink-2">{c.categoria}</span>
                      <span className="font-mono tabular-nums text-faint">{brl(c.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {detalhe.picoHora && <p className="text-xs text-faint">Pico de vendas às {detalhe.picoHora}.</p>}
            </div>
          ) : (
            <p className="text-xs text-muted">Sem vendas nesse dia.</p>
          )}
        </div>
      )}
      <style>{`
        @keyframes trend-fade { from { opacity: 0 } to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[trend-fade_250ms_ease-out\\] { animation: none !important }
        }
      `}</style>
    </ChartCard>
  );
}
