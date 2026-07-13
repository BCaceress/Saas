"use client";

import { useEffect, useState, useTransition } from "react";
import {
  User, Pencil, Wallet, CalendarCheck, Repeat,
  Gift, Cake, AlertTriangle, Send, Phone, History, Star,
} from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { maskPhone } from "@/lib/masks";
import { tierFromGasto, statusCliente, fmtData, fmtDataUTC, fmtDiasAtras, SEXO_LABEL } from "@/lib/customers";
import type { TierThresholds } from "@/lib/customers";
import { getCustomerInsights, sendCoupon } from "@/app/(app)/clientes/actions";
import type { CustomerRow, CustomerInsights, CouponReasonUI } from "@/app/(app)/clientes/_types";

const STATUS_TONE = { ok: "text-ok", warn: "text-warn", muted: "text-muted", faint: "text-faint" } as const;

/** Aniversário hoje/amanhã a partir da data (ISO, UTC). */
function aniversarioProximo(iso: string | null): "hoje" | "amanha" | null {
  if (!iso) return null;
  const nasc = new Date(iso);
  const hoje = new Date();
  for (const [offset, quando] of [[0, "hoje"], [1, "amanha"]] as const) {
    const alvo = new Date(hoje);
    alvo.setDate(hoje.getDate() + offset);
    if (nasc.getUTCDate() === alvo.getDate() && nasc.getUTCMonth() === alvo.getMonth())
      return quando;
  }
  return null;
}

/** "Hoje" / "Ontem" / "dd/mm" para os agrupamentos de compras recentes. */
function fmtGrupoData(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return fmtData(iso).slice(0, 5);
}

/** Painel de resumo do cliente — não é formulário. Usado em /clientes e na busca global. */
export function CustomerSidePanel({
  customer, diasRisco, tierThresholds, onClose, onEdit,
}: {
  customer: CustomerRow;
  diasRisco: number;
  tierThresholds?: TierThresholds;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [insights, setInsights] = useState<CustomerInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    getCustomerInsights(customer.id)
      .then((d) => { if (vivo) setInsights(d); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [customer.id]);

  const totalGasto = insights?.totalGasto ?? customer.totalGasto;
  const tier = tierFromGasto(totalGasto, tierThresholds);
  const aniv = aniversarioProximo(customer.dataNascimento);
  const emRisco =
    insights?.diasSemComprar != null &&
    insights.visitas > 0 &&
    insights.diasSemComprar >= diasRisco;
  const status = statusCliente(
    { diasSemComprar: insights?.diasSemComprar ?? null, visitasMes: insights?.visitasMes ?? 0 },
    diasRisco,
  );

  const iniciais = customer.nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const temHistoricoMes = insights?.gastoMesAnterior != null;
  const gastoInsight = (() => {
    if (loading || !insights || !temHistoricoMes) return undefined;
    const anterior = insights.gastoMesAnterior!;
    if (anterior <= 0) return undefined;
    const pct = Math.round(((insights.gastoMes - anterior) / anterior) * 100);
    if (pct === 0) return undefined;
    return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs. mês anterior`, tone: pct > 0 ? "ok" : "warn" } as const;
  })();
  const freqLabel =
    insights?.frequenciaMediaDias == null
      ? "—"
      : insights.frequenciaMediaDias <= 1
        ? "Todo dia"
        : `A cada ${insights.frequenciaMediaDias} dias`;

  return (
    <Sheet
      open
      onClose={onClose}
      title={customer.nome}
      description={`Cliente desde ${fmtData(customer.createdAt)}`}
      width="md"
      footer={
        <Button onClick={onEdit} className="w-full gap-1.5"><Pencil size={14} /> Editar</Button>
      }
    >
      <div className="space-y-5">
        {/* Identificação */}
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-[15px] font-semibold text-on-brand">
            {iniciais || <User size={18} />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className={cn("flex items-center gap-0.5", tier.text)}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={11} className={i < tier.estrelas ? "fill-current" : "opacity-25"} />
                ))}
              </span>
              <span className={cn("font-semibold", tier.text)}>{tier.label}</span>
              <span className="text-faint">·</span>
              <span className={cn("font-medium", STATUS_TONE[status.tone])}>{status.label}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              {customer.whatsapp && (
                <span className="flex items-center gap-1"><Phone size={11} /> {maskPhone(customer.whatsapp)}</span>
              )}
              {customer.sexo && <span>{SEXO_LABEL[customer.sexo]}</span>}
              {customer.dataNascimento && (
                <span className="flex items-center gap-1"><Cake size={11} /> {fmtDataUTC(customer.dataNascimento)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Inteligência: risco / aniversário */}
        {(emRisco || aniv) && (
          <div className="space-y-2">
            {aniv && (
              <CouponCard
                customerId={customer.id}
                tipo="ANIVERSARIO"
                icon={<Cake size={15} />}
                tone="accent"
                titulo={aniv === "hoje" ? "Faz aniversário hoje" : "Faz aniversário amanhã"}
                sub="Ótimo momento para um cupom de presente."
              />
            )}
            {emRisco && (
              <CouponCard
                customerId={customer.id}
                tipo="RISCO"
                icon={<AlertTriangle size={15} />}
                tone="warn"
                titulo={`Cliente sem comprar há ${insights?.diasSemComprar} dias`}
                sub="Excelente para fidelização — envie um cupom de retorno."
              />
            )}
          </div>
        )}

        {/* Resumo — indicadores em bloco único */}
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-2/60">
          <div className="grid grid-cols-2">
            <StatCell
              className="border-r border-line"
              icon={<CalendarCheck size={13} />}
              label="Última compra"
              value={loading ? "…" : fmtDiasAtras(insights?.ultimaCompra ?? customer.ultimaCompra)}
              sub={!loading && insights?.valorUltimaCompra != null ? brl(insights.valorUltimaCompra) : undefined}
            />
            <StatCell
              icon={<Wallet size={13} />}
              label="Gasto este mês"
              value={loading ? "…" : brl(insights?.gastoMes ?? 0)}
              mono
              sub={!loading && insights ? `${insights.visitasMes} visita${insights.visitasMes === 1 ? "" : "s"}` : undefined}
              insight={gastoInsight}
            />
          </div>
          <div className="flex items-center justify-between border-t border-line px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
              <Repeat size={13} /> Frequência média
            </div>
            <div className="text-[13px] font-semibold text-ink">{loading ? "…" : freqLabel}</div>
          </div>
        </div>

        {/* Histórico — compras recentes */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <History size={12} /> Comprados recentemente
          </h3>
          {loading ? (
            <p className="text-[13px] text-muted">Carregando histórico…</p>
          ) : insights && insights.comprasRecentes.length > 0 ? (
            <div className="divide-y divide-line border-t border-line">
              {insights.comprasRecentes.map((grupo) => (
                <div key={grupo.data} className="py-2.5">
                  <p className="mb-1 text-[11px] font-medium text-faint">{fmtGrupoData(grupo.data)}</p>
                  <ul className="space-y-1.5">
                    {grupo.itens.map((item) => (
                      <li key={item.nome} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-[13px] text-ink-2">{item.nome}</span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-medium text-muted tnum">
                          {item.vezes}x
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              Sem compras registradas ainda. Identifique o cliente no PDV para começar a acompanhar.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function StatCell({
  icon, label, value, sub, insight, mono, className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  insight?: { text: string; tone: "ok" | "warn" };
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("p-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
        {icon} {label}
      </div>
      <div className={cn("mt-1 text-[15px] font-semibold text-ink", mono && "font-mono tnum")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
      {insight && (
        <div className={cn("mt-0.5 text-[11px] font-medium", insight.tone === "ok" ? "text-ok" : "text-warn")}>
          {insight.text}
        </div>
      )}
    </div>
  );
}

const TONE_MAP = {
  accent: { box: "bg-accent-soft", icon: "text-accent", btn: "primary" as const },
  warn: { box: "bg-warn-soft", icon: "text-warn", btn: "primary" as const },
};

function CouponCard({
  customerId, tipo, icon, tone, titulo, sub,
}: {
  customerId: string;
  tipo: CouponReasonUI;
  icon: React.ReactNode;
  tone: "accent" | "warn";
  titulo: string;
  sub: string;
}) {
  const [pending, start] = useTransition();
  const [enviado, setEnviado] = useState(false);
  const t = TONE_MAP[tone];

  function enviar() {
    start(async () => {
      try {
        const { waLink } = await sendCoupon(customerId, tipo);
        setEnviado(true);
        if (waLink) {
          window.open(waLink, "_blank", "noopener");
          toast.success("Cupom pronto", "Abrimos o WhatsApp com a mensagem.");
        } else {
          toast.info("Cupom registrado", "Cadastre um WhatsApp para disparar a mensagem.");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao enviar cupom.");
      }
    });
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-[var(--radius-lg)] p-3.5", t.box)}>
      <span className={cn("mt-0.5 shrink-0", t.icon)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5 text-[12px] text-muted">{sub}</p>
        <Button
          size="sm"
          variant={t.btn}
          onClick={enviar}
          disabled={pending || enviado}
          className="mt-2.5 gap-1.5"
        >
          <Send size={13} /> {enviado ? "Cupom enviado" : pending ? "Enviando…" : "Enviar cupom"}
        </Button>
      </div>
      <Gift size={16} className={cn("shrink-0", t.icon)} aria-hidden />
    </div>
  );
}
