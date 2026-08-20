"use client";

import { AlertTriangle, CheckCircle2, Info, Sparkles, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "../_catalogo/ui";
import type { ResumoCotacao, TomResumo } from "@/lib/compras/cotacao-resumo";

// ── Resumo da cotação ───────────────────────────────────────
// O comparativo mostra os números; este painel diz o que eles significam. É a
// diferença entre "aqui estão 4 colunas de preço" e "a Ambev fecha mais barato,
// mas o frete come a vantagem".
//
// Todo texto sai do motor determinístico (lib/compras/cotacao-resumo) e cita um
// valor que veio do banco — nada aqui é gerado por LLM, de propósito: resumo de
// preço com número inventado vira compra errada.

const TOM: Record<TomResumo, { icone: typeof Info; classe: string }> = {
  sucesso: { icone: CheckCircle2, classe: "text-ok" },
  oportunidade: { icone: TrendingDown, classe: "text-accent" },
  alerta: { icone: AlertTriangle, classe: "text-warn" },
  info: { icone: Info, classe: "text-muted" },
};

export function ResumoCotacaoPainel({ resumo }: { resumo: ResumoCotacao }) {
  if (resumo.itens.length === 0) return null;

  return (
    <section
      aria-label="Resumo da cotação"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} />
          Leitura da cotação
        </span>
        {resumo.economia > 0 && (
          <span className="text-[12px] text-muted">
            Diferença entre a melhor e a pior proposta completa:{" "}
            <span className="font-mono font-semibold text-accent">
              {fmtMoney(resumo.economia)}
            </span>
          </span>
        )}
      </header>

      <ul className="flex flex-col divide-y divide-line">
        {resumo.itens.map((i) => {
          const tom = TOM[i.tom];
          const Icone = tom.icone;
          return (
            <li key={i.id} className="flex items-start gap-2.5 px-4 py-3">
              <Icone size={15} className={cn("mt-0.5 shrink-0", tom.classe)} />
              <p className="text-[13px] leading-relaxed text-ink-2">{i.texto}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
