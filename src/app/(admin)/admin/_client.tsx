"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarPlus, ExternalLink, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { brl, cn } from "@/lib/utils";
import {
  adminAssinaturaManualAction,
  adminEstenderTrialAction,
  adminTrocarPlanoAction,
  adminTrocarStatusAction,
} from "./actions";
import type { Plan, SubscriptionStatus, TenantStatus } from "@/generated/prisma";

export type LinhaTenant = {
  id: string;
  nome: string;
  subdomain: string;
  plano: Plan;
  status: TenantStatus;
  trialAte: string | null;
  criadoEm: string;
  email: string | null;
  usuarios: number;
  produtos: number;
  assinatura: {
    status: SubscriptionStatus;
    gateway: string | null;
    valor: number | null;
    proximaCobranca: string | null;
  } | null;
  precoTabela: number;
};

const STATUS: Record<TenantStatus, { texto: string; tom: "ok" | "brand" | "warn" | "danger" }> = {
  ACTIVE: { texto: "Ativo", tom: "ok" },
  TRIAL: { texto: "Teste", tom: "brand" },
  SUSPENDED: { texto: "Suspenso", tom: "danger" },
  CANCELED: { texto: "Cancelado", tom: "danger" },
};

const dia = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

const dominio = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000";

export function TabelaTenants({
  linhas,
  planos,
}: {
  linhas: LinhaTenant[];
  planos: { id: Plan; nome: string }[];
}) {
  const [busca, setBusca] = useState("");
  const [pendente, iniciar] = useTransition();
  const [alvo, setAlvo] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return linhas;
    return linhas.filter(
      (l) =>
        l.nome.toLowerCase().includes(q) ||
        l.subdomain.includes(q) ||
        (l.email ?? "").toLowerCase().includes(q),
    );
  }, [linhas, busca]);

  const rodar = (id: string, fn: () => Promise<unknown>, sucesso: string) => {
    setAlvo(id);
    iniciar(async () => {
      try {
        await fn();
        toast.success(sucesso);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
      } finally {
        setAlvo(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, subdomínio ou e-mail"
          aria-label="Buscar loja"
          className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>

      {/* Tabela rola sozinha no mobile — a página nunca rola na horizontal. */}
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-3 font-medium">Loja</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Assinatura</th>
              <th className="px-4 py-3 font-medium">Uso</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtradas.map((l) => {
              const ocupado = pendente && alvo === l.id;
              return (
                <tr key={l.id} className={cn("align-top", ocupado && "opacity-60")}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{l.nome}</span>
                      <a
                        href={`https://${l.subdomain}.${dominio}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
                      >
                        {l.subdomain}
                        <ExternalLink size={11} aria-hidden />
                      </a>
                      <span className="text-xs text-muted">{l.email ?? "sem e-mail de contato"}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={STATUS[l.status].tom}>{STATUS[l.status].texto}</Badge>
                      {l.status === "TRIAL" && (
                        <span className="text-xs text-muted">até {dia(l.trialAte)}</span>
                      )}
                      <span className="text-xs text-faint">desde {dia(l.criadoEm)}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <select
                      value={l.plano}
                      disabled={pendente}
                      aria-label={`Plano de ${l.nome}`}
                      onChange={(e) =>
                        rodar(
                          l.id,
                          () =>
                            adminTrocarPlanoAction({ tenantId: l.id, plano: e.target.value as Plan }),
                          "Plano alterado",
                        )
                      }
                      className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none"
                    >
                      {planos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 font-mono text-xs text-muted">{brl(l.precoTabela)}/mês</p>
                  </td>

                  <td className="px-4 py-3">
                    {l.assinatura ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="text-ink">{l.assinatura.status}</span>
                        <span className="text-muted">{l.assinatura.gateway ?? "—"}</span>
                        {l.assinatura.proximaCobranca && (
                          <span className="text-faint">
                            próx. {dia(l.assinatura.proximaCobranca)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-faint">sem assinatura</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col text-xs text-muted">
                      <span>{l.usuarios} usuários</span>
                      <span>{l.produtos} produtos</span>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pendente}
                        onClick={() =>
                          rodar(
                            l.id,
                            () => adminEstenderTrialAction({ tenantId: l.id, dias: 14 }),
                            "Teste estendido em 14 dias",
                          )
                        }
                      >
                        {ocupado ? (
                          <Loader2 size={13} className="animate-spin" aria-hidden />
                        ) : (
                          <CalendarPlus size={13} aria-hidden />
                        )}
                        +14d
                      </Button>

                      {l.status === "SUSPENDED" ? (
                        <Button
                          size="sm"
                          disabled={pendente}
                          onClick={() =>
                            rodar(
                              l.id,
                              () => adminTrocarStatusAction({ tenantId: l.id, status: "ACTIVE" }),
                              "Acesso liberado",
                            )
                          }
                        >
                          Liberar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pendente}
                          onClick={() =>
                            rodar(
                              l.id,
                              () => adminTrocarStatusAction({ tenantId: l.id, status: "SUSPENDED" }),
                              "Loja suspensa",
                            )
                          }
                        >
                          Suspender
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendente}
                        onClick={() =>
                          rodar(
                            l.id,
                            () =>
                              adminAssinaturaManualAction({
                                tenantId: l.id,
                                ativar: l.assinatura?.gateway !== "manual",
                              }),
                            l.assinatura?.gateway === "manual"
                              ? "Assinatura manual encerrada"
                              : "Assinatura manual ativada",
                          )
                        }
                      >
                        {l.assinatura?.gateway === "manual" ? "Encerrar manual" : "Cobrança manual"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtradas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                  Nenhuma loja encontrada para “{busca}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
