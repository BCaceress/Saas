"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "../_catalogo/ui";
import type { ResumoCotacao, TomResumo } from "@/lib/compras/cotacao-resumo";

// ── Leitura da cotação ──────────────────────────────────────
// O comparativo mostra os números; isto diz o que eles significam. É a
// diferença entre "aqui estão 4 colunas de preço" e "a Ambev fecha mais barato,
// mas o frete come a vantagem".
//
// Era um CARTÃO, com moldura, cabeçalho e uma lista de parágrafos — um bloco do
// tamanho de meia tabela para um texto de apoio. Virou UMA LINHA, sem moldura,
// colada embaixo da matriz: a conclusão à vista, o resto atrás de um clique.
// Legenda de tabela não compete com a tabela.
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

export function LeituraDaCotacao({ resumo }: { resumo: ResumoCotacao }) {
  const [aberta, setAberta] = useState(false);

  const temCabecalho = resumo.melhorFornecedor !== null && resumo.melhorTotal !== null;
  if (!temCabecalho && resumo.itens.length === 0) return null;

  return (
    <div className="px-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        {temCabecalho && (
          <span>
            Melhor proposta completa:{" "}
            <span className="font-medium text-ink">{resumo.melhorFornecedor}</span>{" "}
            <span className="font-mono font-semibold tabular-nums text-ink">
              {fmtMoney(resumo.melhorTotal!)}
            </span>
          </span>
        )}

        {/* Zero não vira selo: dizer "economia de R$ 0,00" só ensina o operador
            a ignorar o rótulo. */}
        {resumo.economia > 0.005 && (
          <span>
            · economia de{" "}
            <span className="font-mono font-semibold tabular-nums text-ok">
              {fmtMoney(resumo.economia)}
            </span>{" "}
            contra a pior proposta completa
          </span>
        )}

        {resumo.itens.length > 0 && (
          <button
            type="button"
            onClick={() => setAberta((v) => !v)}
            aria-expanded={aberta}
            className="flex cursor-pointer items-center gap-1 font-medium text-brand underline-offset-4 hover:underline"
          >
            {aberta
              ? "ocultar leitura"
              : `${resumo.itens.length} ${resumo.itens.length === 1 ? "observação" : "observações"}`}
            <ChevronDown
              size={12}
              className={cn("transition-transform", aberta && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      </p>

      {aberta && (
        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-line pl-3">
          {resumo.itens.map((i) => {
            const tom = TOM[i.tom];
            const Icone = tom.icone;
            return (
              <li key={i.id} className="flex items-start gap-2">
                <Icone size={13} className={cn("mt-0.5 shrink-0", tom.classe)} />
                <p className="text-[12px] leading-relaxed text-ink-2">{i.texto}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
