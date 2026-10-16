import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/misc";

/** Um recebimento com a conferência aberta — o que o cartão precisa mostrar. */
export type ConferenciaAberta = {
  id: string;
  numero: string;
  fornecedor: string;
  /** "NF 1234/1" ou o número do pedido. */
  documento: string | null;
  itens: number;
  contados: number;
  /** Há quanto tempo a carga espera ("há 25 min"), da chegada ou da abertura. */
  espera: string;
};

/** "agora", "há 25 min", "há 3 h", "há 2 dias" — calculado no servidor. */
export function haQuanto(desde: Date, agora: number): string {
  const min = Math.max(0, Math.round((agora - desde.getTime()) / 60_000));
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/**
 * As cargas que já estão na doca — XML importado, avulso salvo ou pedido com
 * a conferência começada. Vêm antes dos pedidos: é o trabalho de agora, e o
 * celular é onde ele acontece.
 */
export function ConferenciasAbertas({ conferencias }: { conferencias: ConferenciaAberta[] }) {
  if (conferencias.length === 0) return null;
  return (
    <section aria-labelledby="conferencias-abertas" className="mb-5">
      <h2
        id="conferencias-abertas"
        className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase"
      >
        Conferências abertas
      </h2>
      <ul className="space-y-2">
        {conferencias.map((c) => {
          const pct = c.itens > 0 ? Math.round((c.contados / c.itens) * 100) : 0;
          return (
            <li key={c.id}>
              <Link
                href={`/m/receber/conferencia/${c.id}`}
                className="block rounded-[var(--radius-m)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                    <ClipboardCheck className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{c.fornecedor}</span>
                    <span className="block truncate text-xs text-muted">
                      <span className="font-mono">{c.numero}</span>
                      {c.documento && (
                        <>
                          {" · "}
                          <span className="font-mono">{c.documento}</span>
                        </>
                      )}
                      {" · "}
                      {c.espera}
                    </span>
                    {/* O medidor de quanto já foi contado: a pergunta de quem
                        chega para ajudar é "falta muito?". */}
                    <span
                      className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={c.itens}
                      aria-valuenow={c.contados}
                      aria-label={`${c.contados} de ${c.itens} itens contados`}
                    >
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[12px] text-muted">
                    {c.contados}/{c.itens}
                  </span>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
