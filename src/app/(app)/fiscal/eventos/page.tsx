import { Ban, FileCheck2, PencilLine, Scissors, ShieldAlert, WifiOff, Radio } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db, basePrisma, comTenant } from "@/lib/prisma";
import { Badge } from "@/components/ui/misc";
import { fmtMoney } from "../../compras/_ui";
import type { FiscalEventoTipo } from "@/generated/prisma";

export const metadata = { title: "Eventos fiscais — NoHub Market" };

const TIPO_UI: Record<
  FiscalEventoTipo,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "brand"; icon: React.ElementType }
> = {
  EMISSAO: { label: "Emissão", tone: "ok", icon: FileCheck2 },
  CANCELAMENTO: { label: "Cancelamento", tone: "neutral", icon: Ban },
  CARTA_CORRECAO: { label: "Carta de correção", tone: "brand", icon: PencilLine },
  INUTILIZACAO: { label: "Inutilização", tone: "neutral", icon: Scissors },
  REJEICAO: { label: "Rejeição", tone: "danger", icon: ShieldAlert },
  CONTINGENCIA: { label: "Contingência", tone: "warn", icon: WifiOff },
  MANIFESTACAO: { label: "Manifestação", tone: "brand", icon: Radio },
};

const dataHora = (d: Date) =>
  d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function EventosFiscaisPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const eventos = await db.fiscalEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        tipo: true,
        sequencia: true,
        motivo: true,
        protocolo: true,
        codigo: true,
        mensagem: true,
        serie: true,
        numeroInicial: true,
        numeroFinal: true,
        userId: true,
        createdAt: true,
        documentId: true,
        document: {
          select: { modelo: true, numero: true, serie: true, valorTotal: true, destNome: true },
        },
      },
    });

    // Quem fez. User é tabela de auth (fora do contexto de tenant) — por isso
    // basePrisma direto, numa consulta só.
    const userIds = [...new Set(eventos.map((e) => e.userId).filter(Boolean))] as string[];
    const users = userIds.length
      ? await basePrisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const porUser = new Map(users.map((u) => [u.id, u.name ?? u.email ?? "—"]));

    return (
      <>
        <p className="text-sm text-muted">
          Trilha completa e imutável do que aconteceu com cada documento — emissão, rejeição,
          cancelamento, correção, inutilização e contingência. Nada aqui é editado ou apagado.
        </p>

        {eventos.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-line bg-surface p-10 text-center">
            <FileCheck2 size={22} className="mx-auto text-faint" />
            <p className="mt-3 font-semibold text-ink">Nenhum evento ainda</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              O histórico se preenche sozinho conforme as notas são emitidas.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface">
            {eventos.map((e) => {
              const ui = TIPO_UI[e.tipo];
              const doc = e.document;
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 shrink-0 text-muted">
                    <ui.icon size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ui.tone}>{ui.label}</Badge>
                      {doc && (
                        <span className="font-mono text-xs text-ink-2">
                          {doc.modelo === "NFCE" ? "NFC-e" : "NF-e"} {doc.numero}/{doc.serie}
                        </span>
                      )}
                      {e.tipo === "INUTILIZACAO" && e.numeroInicial != null && (
                        <span className="font-mono text-xs text-ink-2">
                          série {e.serie} · {e.numeroInicial}–{e.numeroFinal}
                        </span>
                      )}
                      {e.sequencia != null && (
                        <span className="text-xs text-muted">sequência {e.sequencia}</span>
                      )}
                      {doc?.destNome && (
                        <span className="truncate text-xs text-muted">{doc.destNome}</span>
                      )}
                    </div>

                    {e.motivo && <p className="mt-1 text-sm text-ink-2">{e.motivo}</p>}
                    {e.mensagem && (
                      <p className="mt-0.5 text-xs text-muted">
                        {e.codigo ? `${e.codigo} · ` : ""}
                        {e.mensagem}
                      </p>
                    )}
                    {e.protocolo && (
                      <p className="mt-0.5 font-mono text-[11px] text-faint">
                        protocolo {e.protocolo}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted">{dataHora(e.createdAt)}</p>
                    {e.userId && (
                      <p className="text-[11px] text-faint">{porUser.get(e.userId) ?? "—"}</p>
                    )}
                    {doc && (
                      <p className="mt-0.5 font-mono text-[11px] text-faint">
                        {fmtMoney(Number(doc.valorTotal))}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </>
    );
  });
}
