import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { cn } from "@/lib/utils";
import type { SituacaoFiscal } from "./_data";

/** Certificado A1 vale 1 ano — um mês de antecedência dá tempo de renovar. */
const AVISO_CERTIFICADO_DIAS = 30;

type Metrica = {
  label: string;
  valor: number;
  href: string;
  tone?: "danger" | "warn";
};

/**
 * Situação fiscal do período. A pergunta que este bloco responde é "tem nota
 * travada?" — venda feita com documento rejeitado é o pior modo de falha do
 * módulo, porque não aparece em lugar nenhum até o contador reclamar.
 */
export function FiscalStatus({ s, periodoLabel }: { s: SituacaoFiscal; periodoLabel: string }) {
  const metricas: Metrica[] = [
    { label: "Autorizadas", valor: s.autorizadas, href: "/fiscal/notas-emitidas" },
    {
      label: "Na fila",
      valor: s.emAndamento,
      href: "/fiscal/notas-emitidas",
      tone: s.emAndamento > 0 ? "warn" : undefined,
    },
    {
      label: "Travadas",
      valor: s.travadas,
      href: "/fiscal/notas-emitidas",
      tone: s.travadas > 0 ? "danger" : undefined,
    },
    {
      label: "Entradas a conciliar",
      valor: s.entradasPendentes,
      href: "/fiscal/notas-recebidas",
      tone: s.entradasPendentes > 0 ? "warn" : undefined,
    },
  ];

  const certificadoVencendo =
    s.certificadoDias != null && s.certificadoDias <= AVISO_CERTIFICADO_DIAS;

  return (
    <ChartCard title="Situação fiscal" subtitle={periodoLabel}>
      <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-l border-line sm:grid-cols-4 sm:divide-y-0">
        {metricas.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="group px-3 py-3 transition-colors hover:bg-surface-2"
          >
            <p
              className={cn(
                "font-mono text-2xl font-semibold tabular-nums",
                m.tone === "danger" && "text-danger",
                m.tone === "warn" && "text-warn",
                !m.tone && "text-ink",
              )}
            >
              {m.valor}
            </p>
            <p className="mt-0.5 text-xs text-muted group-hover:text-ink-2">{m.label}</p>
          </Link>
        ))}
      </div>

      {s.travadas > 0 && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <span>
            {s.travadas} nota(s) rejeitada(s) pela SEFAZ. A venda aconteceu e o documento não
            saiu —{" "}
            <Link href="/fiscal/notas-emitidas" className="font-medium text-brand hover:underline">
              veja o motivo e reemita
            </Link>
            .
          </span>
        </p>
      )}

      {certificadoVencendo && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-warn" />
          <span>
            {(s.certificadoDias as number) <= 0
              ? "O certificado digital venceu"
              : `O certificado digital vence em ${s.certificadoDias} dia(s)`}
            {s.certificadoLoja ? ` (${s.certificadoLoja})` : ""}. Sem ele a loja para de emitir —{" "}
            <Link
              href="/configuracoes/fiscal"
              className="font-medium text-brand hover:underline"
            >
              renove em Configurações
            </Link>
            .
          </span>
        </p>
      )}
    </ChartCard>
  );
}
