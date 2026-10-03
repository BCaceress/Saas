"use client";

import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { EventoCotacao, TomEvento } from "@/lib/compras/cotacao-linha-do-tempo";

// ── Histórico da cotação ────────────────────────────────────
// "Quando mandei? Ele abriu? O pedido saiu? Chegou pelo preço combinado?" —
// consulta, não trabalho. Por isso mora numa gaveta lateral, aberta pelo
// cabeçalho, e não no fim da página disputando espaço com a decisão.

const PONTO: Record<TomEvento, string> = {
  neutro: "bg-line-strong",
  marca: "bg-brand",
  ok: "bg-ok",
  alerta: "bg-accent",
  perigo: "bg-danger",
};

const TEXTO: Record<TomEvento, string> = {
  neutro: "text-muted",
  marca: "text-muted",
  ok: "text-ok",
  alerta: "text-accent",
  perigo: "text-danger",
};

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoricoSheet({
  numero,
  eventos,
  onFechar,
}: {
  numero: string;
  eventos: EventoCotacao[];
  onFechar: () => void;
}) {
  return (
    <Sheet
      open
      onClose={onFechar}
      title="Histórico"
      description={`Tudo o que aconteceu com a cotação ${numero}, do mais recente ao mais antigo.`}
      width="md"
    >
      {eventos.length === 0 ? (
        <p className="text-[13px] text-muted">Nada registrado ainda.</p>
      ) : (
        <ol className="flex flex-col">
          {eventos.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* O fio liga os pontos; some no último para a lista não parecer cortada. */}
              {i < eventos.length - 1 && (
                <span aria-hidden className="absolute top-3 bottom-0 left-[4px] w-px bg-line" />
              )}
              <span
                aria-hidden
                className={cn("mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full", PONTO[e.tom])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{e.titulo}</p>
                {e.detalhe && <p className={cn("text-[12px]", TEXTO[e.tom])}>{e.detalhe}</p>}
                <time dateTime={e.em} className="font-mono text-[11px] tabular-nums text-faint">
                  {quando(e.em)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
