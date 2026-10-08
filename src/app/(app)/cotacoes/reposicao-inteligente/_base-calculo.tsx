"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COBERTURAS_MOVIMENTACAO,
  PERIODOS_MOVIMENTACAO,
  type BaseSugestao,
  type EstoquePolicy,
} from "@/lib/estoque-estrategia";
import { escolhaParaParams, type EscolhaReposicao } from "./_url";

// ── Base de cálculo da reposição ──────────────────────────────
// Diferente dos filtros (que só escondem cards), isto refaz a conta no
// servidor: muda a janela de movimentação, muda a lista inteira. Fica acima
// dos filtros e grava na URL, então F5 e link compartilhado mantêm a escolha.

const BASES: { id: BaseSugestao; label: string; icon: React.ElementType }[] = [
  { id: "metas", label: "Minhas metas", icon: Target },
  { id: "movimentacao", label: "Movimentação", icon: CalendarRange },
];

const dias = (n: number) => `${n} dias`;

export function BaseCalculo({
  escolha,
  policyEmpresa,
}: {
  escolha: EscolhaReposicao;
  /** Estratégia configurada pela empresa — rotula a opção "Minhas metas". */
  policyEmpresa: EstoquePolicy;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, startTransition] = useTransition();

  const ir = (patch: Partial<EscolhaReposicao>) => {
    const sp = escolhaParaParams({ ...escolha, ...patch });
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const mov = escolha.base === "movimentacao";
  const cobertura = escolha.coberturaDias ?? escolha.janelaDias;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div
          role="radiogroup"
          aria-label="Base de cálculo da sugestão"
          className="flex rounded-xl bg-surface-2 p-1"
        >
          {BASES.map((b) => {
            const ativo = escolha.base === b.id;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => !ativo && ir({ base: b.id })}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                  ativo ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <b.icon size={13} />
                {b.label}
              </button>
            );
          })}
        </div>

        {mov ? (
          <>
            <label className="flex items-center gap-2 text-xs text-muted">
              Vendas dos últimos
              <select
                value={escolha.janelaDias}
                onChange={(e) => ir({ janelaDias: Number(e.target.value) })}
                className="h-9 rounded-xl border border-line bg-surface px-2.5 font-mono text-xs font-semibold text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
              >
                {PERIODOS_MOVIMENTACAO.map((d) => (
                  <option key={d} value={d}>
                    {dias(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              Comprar para cobrir
              <select
                value={escolha.coberturaDias ?? ""}
                onChange={(e) => ir({ coberturaDias: e.target.value ? Number(e.target.value) : null })}
                className="h-9 rounded-xl border border-line bg-surface px-2.5 font-mono text-xs font-semibold text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
              >
                <option value="">o mesmo período</option>
                {COBERTURAS_MOVIMENTACAO.map((d) => (
                  <option key={d} value={d}>
                    {dias(d)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="text-xs text-muted">
            {policyEmpresa.usaGiro
              ? `Giro dos últimos ${policyEmpresa.periodoMediaDias} dias, cobrindo ${policyEmpresa.diasCobertura} dias de venda.`
              : policyEmpresa.usaIdeal
                ? "Estoque mínimo e ideal cadastrados em cada produto."
                : "Estoque mínimo cadastrado em cada produto."}
          </p>
        )}

        {pendente && <Loader2 size={14} className="animate-spin text-brand motion-reduce:animate-none" />}
      </div>

      {mov && (
        <p className="text-xs text-muted">
          Sugestão ={" "}
          <span className="font-medium text-ink">
            {cobertura === escolha.janelaDias
              ? `o que saiu em ${dias(escolha.janelaDias)}`
              : `a média diária de ${dias(escolha.janelaDias)} × ${dias(cobertura)}`}
          </span>{" "}
          − estoque atual − o que já está a caminho. Mínimo e ideal não entram nesta conta.
        </p>
      )}
    </div>
  );
}
