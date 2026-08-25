"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  Sparkles,
  TrendingDown,
} from "lucide-react";
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

/**
 * A leitura, sem moldura própria.
 *
 * Morava num cartão separado, logo abaixo do totalizador — duas caixas
 * dizendo a mesma coisa em duas linguagens, uma em número e outra em frase.
 * Agora ela é o rodapé do cartão dos números, que é onde a legenda pertence.
 */
export function LeituraDaCotacao({ resumo }: { resumo: ResumoCotacao }) {
  /**
   * Aberta por padrão, mas recolhível.
   *
   * Ela responde a pergunta da PRIMEIRA leitura ("o que esses números
   * dizem?") — e quem já leu vai voltar à tela dez vezes para mexer na
   * escolha, com o texto empurrando a tabela para baixo em todas elas.
   */
  const [aberta, setAberta] = useState(true);

  if (resumo.itens.length === 0) return null;

  return (
    <section
      aria-label="Leitura da cotação"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
    >
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} />
          Leitura da cotação
          {/* Recolhida, o número que mais importa continua à vista: sem ele o
              cabeçalho viraria uma linha que não diz nada. */}
          {!aberta && (
            <span className="ml-1 normal-case tracking-normal text-muted">
              {resumo.itens.length}{" "}
              {resumo.itens.length === 1 ? "observação" : "observações"}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {resumo.economia > 0 && (
            <span className="text-[12px] text-muted">
              Melhor contra pior proposta completa:{" "}
              <span className="font-mono font-semibold text-accent">
                {fmtMoney(resumo.economia)}
              </span>
            </span>
          )}
          <ChevronDown
            size={15}
            className={cn("shrink-0 text-muted transition-transform", aberta && "rotate-180")}
          />
        </span>
      </button>

      {aberta && (
        <ul className="flex flex-col gap-1 border-t border-line px-4 py-2.5">
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
    </section>
  );
}
