"use client";

import { useState, useTransition } from "react";
import { CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { brl, cn } from "@/lib/utils";
import {
  assinarAction,
  cancelarAssinaturaAction,
  conferirPagamentoAction,
  trocarPlanoAction,
  alternarAddonAction,
} from "./actions";
import type { SubscriptionStatus, TenantStatus } from "@/generated/prisma";

// ============================================================
// Bloco de assinatura da tela de Plano. Uma pergunta por vez: quanto custa
// hoje, em que pé está a cobrança e qual é o próximo passo. Tudo o mais
// (comparar planos) já está na página.
// ============================================================

const ROTULO: Record<SubscriptionStatus, { texto: string; tom: "ok" | "brand" | "warn" | "danger" }> =
  {
    ATIVA: { texto: "Assinatura ativa", tom: "ok" },
    PENDENTE: { texto: "Aguardando pagamento", tom: "warn" },
    INADIMPLENTE: { texto: "Pagamento pendente", tom: "danger" },
    CANCELADA: { texto: "Cancelada", tom: "danger" },
  };

const data = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : null;

export type AssinaturaResumo = {
  status: SubscriptionStatus;
  valorMensal: number | null;
  proximaCobranca: string | null;
  ultimaCobranca: string | null;
  checkoutUrl: string | null;
} | null;

export function PainelAssinatura({
  assinatura,
  preco,
  statusTenant,
  trialAte,
}: {
  assinatura: AssinaturaResumo;
  preco: number;
  statusTenant: TenantStatus;
  trialAte: string | null;
}) {
  const [pendente, iniciar] = useTransition();
  const [acao, setAcao] = useState<"assinar" | "conferir" | "cancelar" | null>(null);

  const rodar = (qual: typeof acao, fn: () => Promise<void>) => {
    setAcao(qual);
    iniciar(async () => {
      try {
        await fn();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
      } finally {
        setAcao(null);
      }
    });
  };

  const assinar = () =>
    rodar("assinar", async () => {
      const url = await assinarAction();
      // Nova aba: o lojista volta para cá e confere sem perder a tela.
      window.open(url, "_blank", "noopener,noreferrer");
      toast.info("Checkout aberto em outra aba", "Depois de pagar, volte e clique em Já paguei.");
    });

  const conferir = () =>
    rodar("conferir", async () => {
      const { status } = await conferirPagamentoAction();
      if (status === "ATIVA") toast.success("Pagamento confirmado", "Acesso liberado.");
      else toast.info("Ainda não consta pagamento", "O Mercado Pago pode levar alguns minutos.");
    });

  const cancelar = () =>
    rodar("cancelar", async () => {
      if (!confirm("Cancelar a assinatura? O acesso continua até o fim do período já pago.")) return;
      await cancelarAssinaturaAction();
      toast.success("Assinatura cancelada");
    });

  const suspenso = statusTenant === "SUSPENDED" || statusTenant === "CANCELED";
  const rotulo = assinatura ? ROTULO[assinatura.status] : null;
  const proxima = data(assinatura?.proximaCobranca ?? null);

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[var(--radius-lg)] border bg-surface p-5",
        suspenso ? "border-danger/40" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-brand" aria-hidden />
            <h2 className="font-display text-base font-semibold text-ink">Assinatura</h2>
            {rotulo && <Badge tone={rotulo.tom}>{rotulo.texto}</Badge>}
            {!assinatura && statusTenant === "TRIAL" && <Badge tone="brand">Em teste</Badge>}
          </div>

          <p className="text-sm text-muted">
            {suspenso
              ? "Acesso somente leitura até o pagamento ser confirmado."
              : statusTenant === "TRIAL" && trialAte
                ? `Teste liberado até ${data(trialAte)}.`
                : proxima
                  ? `Próxima cobrança em ${proxima}.`
                  : "Ative a assinatura para manter o acesso depois do teste."}
          </p>
        </div>

        <div className="text-right">
          <p className="font-mono text-2xl text-ink">{brl(preco)}</p>
          <p className="text-xs text-muted">por mês, no total</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(!assinatura || assinatura.status !== "ATIVA") && (
          <Button onClick={assinar} disabled={pendente}>
            {pendente && acao === "assinar" ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <ExternalLink size={15} aria-hidden />
            )}
            {assinatura?.status === "INADIMPLENTE" ? "Regularizar pagamento" : "Assinar agora"}
          </Button>
        )}

        {assinatura && assinatura.status !== "ATIVA" && (
          <Button variant="secondary" onClick={conferir} disabled={pendente}>
            {pendente && acao === "conferir" ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={15} aria-hidden />
            )}
            Já paguei
          </Button>
        )}

        {assinatura?.status === "ATIVA" && (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm text-ok">
              <ShieldCheck size={15} aria-hidden />
              Cobrança automática no Mercado Pago
            </span>
            <Button variant="ghost" onClick={cancelar} disabled={pendente} className="ml-auto">
              {pendente && acao === "cancelar" ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <XCircle size={15} aria-hidden />
              )}
              Cancelar assinatura
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Botão de troca de plano — usado dentro de cada card da comparação. */
export function BotaoPlano({
  plano,
  rotulo,
  variant = "primary",
}: {
  plano: "PRATA" | "OURO" | "DIAMANTE";
  rotulo: string;
  variant?: "primary" | "secondary";
}) {
  const [pendente, iniciar] = useTransition();

  return (
    <Button
      variant={variant}
      className="mt-auto w-full"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          try {
            await trocarPlanoAction({ plano });
            toast.success("Plano alterado", "Confirme a assinatura para valer a partir do próximo ciclo.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Não foi possível trocar de plano.");
          }
        })
      }
    >
      {pendente && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {rotulo}
    </Button>
  );
}

/** Contrata/remove um add-on. Quantidade só aparece para loja extra. */
export function BotaoAddon({
  slug,
  contratado,
  quantidade,
  bloqueado,
}: {
  slug: "fiscal" | "autoatendimento" | "loja-extra" | "copiloto-ia";
  contratado: boolean;
  quantidade?: number;
  bloqueado?: boolean;
}) {
  const [pendente, iniciar] = useTransition();
  const [qtd, setQtd] = useState(quantidade && quantidade > 0 ? quantidade : 1);

  const alternar = (contratar: boolean) =>
    iniciar(async () => {
      try {
        await alternarAddonAction({ slug, contratar, quantidade: qtd });
        toast.success(contratar ? "Add-on contratado" : "Add-on removido");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível alterar o add-on.");
      }
    });

  if (bloqueado) return null;

  return (
    <div className="mt-auto flex items-center gap-2">
      {slug === "loja-extra" && (
        <input
          type="number"
          min={1}
          max={50}
          value={qtd}
          onChange={(e) => setQtd(Math.max(1, Number(e.target.value) || 1))}
          aria-label="Quantidade de lojas extras"
          className="h-10 w-16 rounded-[var(--radius)] border border-line bg-surface px-2 text-center font-mono text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      )}
      <Button
        variant={contratado ? "ghost" : "secondary"}
        size="sm"
        disabled={pendente}
        onClick={() => alternar(!contratado)}
      >
        {pendente && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {contratado ? "Remover" : "Contratar"}
      </Button>
    </div>
  );
}
