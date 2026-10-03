"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { RecorrenciaCotacao } from "../_compra-types";
import { definirRecorrenciaAction, removerRecorrenciaAction } from "../_compra-actions";

// ── Repetir esta cotação ────────────────────────────────────
// A compra de bebida se repete toda semana. Em vez de duplicar à mão, a
// cotação vira molde e o sistema monta o rascunho nos dias marcados, às 7h.
// Nunca envia sozinho: quem manda para os fornecedores continua sendo o
// comprador, depois de revisar.

const DIAS = [
  { n: 1, curto: "Seg", nome: "segunda" },
  { n: 2, curto: "Ter", nome: "terça" },
  { n: 3, curto: "Qua", nome: "quarta" },
  { n: 4, curto: "Qui", nome: "quinta" },
  { n: 5, curto: "Sex", nome: "sexta" },
  { n: 6, curto: "Sáb", nome: "sábado" },
  { n: 0, curto: "Dom", nome: "domingo" },
];

/** "toda segunda e quinta" — o resumo que vai no cabeçalho da cotação. */
export function descreverRecorrencia(r: RecorrenciaCotacao): string {
  const nomes = DIAS.filter((d) => r.diasSemana.includes(d.n)).map((d) => d.nome);
  if (nomes.length === 7) return "todo dia";
  const lista =
    nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
  const prefixo = r.diasSemana.every((d) => d === 0 || d === 6) ? "todo" : "toda";
  return `${prefixo} ${lista}`;
}

export function RecorrenciaSheet({
  quotationId,
  atual,
  onFechar,
}: {
  quotationId: string;
  atual: RecorrenciaCotacao | null;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [dias, setDias] = useState<number[]>(atual?.diasSemana ?? [1]);
  const [modo, setModo] = useState<"FIXA" | "REPOSICAO">(atual?.modoQuantidade ?? "FIXA");
  const [ativo, setAtivo] = useState(atual?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function alternarDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
  }

  function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
        onFechar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onFechar}
      title="Repetir esta cotação"
      description="O sistema monta um rascunho com esta lista e estes fornecedores nos dias marcados, às 7h. Você revisa e envia."
      width="md"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {atual ? (
            <button
              type="button"
              disabled={pendente}
              onClick={() => rodar(() => removerRecorrenciaAction(quotationId))}
              className="text-sm font-medium text-danger underline-offset-4 hover:underline disabled:opacity-50"
            >
              Parar de repetir
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pendente || dias.length === 0}
              onClick={() =>
                rodar(() =>
                  definirRecorrenciaAction({ quotationId, diasSemana: dias, modoQuantidade: modo, ativo }),
                )
              }
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
            >
              {pendente ? "Salvando…" : atual ? "Salvar repetição" : "Programar repetição"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset>
          <legend className="text-[13px] font-medium text-ink">Em quais dias</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIAS.map((d) => {
              const marcado = dias.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  aria-pressed={marcado}
                  aria-label={d.nome}
                  onClick={() => alternarDia(d.n)}
                  className={cn(
                    "min-h-11 min-w-12 rounded-full border px-3 text-sm font-medium transition-colors",
                    marcado
                      ? "border-transparent bg-brand text-on-brand"
                      : "border-line bg-surface text-ink hover:bg-surface-2",
                  )}
                >
                  {d.curto}
                </button>
              );
            })}
          </div>
          {dias.length === 0 && (
            <p className="mt-1.5 text-[12px] text-accent">Escolha ao menos um dia.</p>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-medium text-ink">Quantidades</legend>
          <div role="radiogroup" className="mt-2 flex flex-col gap-2">
            {(
              [
                {
                  id: "FIXA",
                  titulo: "As mesmas desta cotação",
                  texto: "Toda vez com a lista e as quantidades de hoje.",
                },
                {
                  id: "REPOSICAO",
                  titulo: "Pelo estoque do dia",
                  texto:
                    "Recalcula pela estratégia de estoque da empresa e deixa de fora o que não precisa comprar. Se nada faltar, nenhum rascunho é criado.",
                },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={modo === o.id}
                onClick={() => setModo(o.id)}
                className={cn(
                  "flex items-start gap-2.5 rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors",
                  modo === o.id
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface hover:bg-surface-2",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    modo === o.id ? "border-brand" : "border-line-strong",
                  )}
                >
                  {modo === o.id && <span className="h-2 w-2 rounded-full bg-brand" />}
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-ink">{o.titulo}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">{o.texto}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {atual && (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Repetição ligada
            <span className="text-[12px] text-muted">— desligue para pausar sem perder a programação</span>
          </label>
        )}

        <p className="flex items-start gap-2 rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
          <Repeat size={14} className="mt-0.5 shrink-0" aria-hidden />
          Se o rascunho anterior ainda não foi enviado, o sistema não cria outro por cima — ele
          espera você revisar o que já está lá.
        </p>

        {erro && (
          <p role="alert" className="text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Sheet>
  );
}
