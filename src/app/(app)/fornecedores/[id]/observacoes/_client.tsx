"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, StickyNote, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { salvarObservacoesAction } from "../../actions";

// Aba Observações — o combinado que nenhum campo estruturado guarda:
// "entrega só às quartas", "aceita negociação acima de R$ 5.000". Fica ao lado
// do fornecedor, não num caderno.

const EXEMPLOS = [
  "Entrega apenas às quartas-feiras.",
  "Aceita negociação acima de R$ 5.000.",
  "Pedido precisa entrar até quinta para sair na semana.",
];

export function ObservacoesFornecedor({
  supplierId,
  observacoes,
  prazoPagamentoDias,
  podeEditar,
}: {
  supplierId: string;
  observacoes: string | null;
  prazoPagamentoDias: number | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(observacoes ?? "");
  const [prazo, setPrazo] = useState(prazoPagamentoDias != null ? String(prazoPagamentoDias) : "");
  const [pending, start] = useTransition();

  const sujo = texto !== (observacoes ?? "") || prazo !== (prazoPagamentoDias != null ? String(prazoPagamentoDias) : "");

  function salvar() {
    start(async () => {
      try {
        await salvarObservacoesAction({
          supplierId,
          observacoes: texto,
          prazoPagamentoDias: prazo ? Number(prazo) : null,
        });
        toast.success("Observações salvas", "Elas aparecem também no Resumo.");
        router.refresh();
      } catch (e) {
        toast.error("Não deu para salvar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-brand-soft text-brand">
            <StickyNote size={14} />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Anotações internas</h2>
            <p className="text-[11px] text-muted">
              Só a equipe vê. O fornecedor nunca recebe este texto.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <fieldset disabled={!podeEditar} className="flex flex-col gap-4">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={10}
              placeholder={EXEMPLOS.join("\n")}
              aria-label="Observações internas sobre o fornecedor"
            />

            {!texto && podeEditar && (
              <div className="flex flex-wrap gap-1.5">
                {EXEMPLOS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setTexto((t) => (t ? `${t}\n${ex}` : ex))}
                    className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[12px] text-muted transition-colors hover:border-brand hover:text-brand"
                  >
                    + {ex}
                  </button>
                ))}
              </div>
            )}

            <Field
              label="Prazo de pagamento (dias)"
              htmlFor="obs-prazo"
              hint="É a mesma condição do Resumo — alimenta o indicador financeiro."
              className="max-w-52"
            >
              <div className="relative">
                <CreditCard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <Input
                  id="obs-prazo"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="30"
                  className="pl-9 font-mono"
                />
              </div>
            </Field>
          </fieldset>
        </div>
      </section>

      {podeEditar && (
        <div
          className={cn(
            "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-3 transition-colors",
            sujo ? "border-brand bg-surface shadow-[var(--shadow-float)]" : "border-line bg-surface-2/70",
          )}
        >
          <p className="text-[12px] text-muted">{sujo ? "Há alterações não salvas." : "Tudo salvo."}</p>
          <Button onClick={salvar} disabled={!sujo || pending}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Salvar observações
          </Button>
        </div>
      )}
    </div>
  );
}
