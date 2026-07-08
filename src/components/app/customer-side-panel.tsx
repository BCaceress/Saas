"use client";

import { useEffect, useState, useTransition } from "react";
import {
  User, Pencil, Star, ShoppingBag, Wallet, Receipt, CalendarCheck,
  Gift, Cake, AlertTriangle, Send, Phone, History,
} from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { maskPhone } from "@/lib/masks";
import { tierFromGasto, fmtData, fmtDataUTC, fmtDiasAtras, SEXO_LABEL } from "@/lib/customers";
import { getCustomerInsights, sendCoupon } from "@/app/(app)/clientes/actions";
import type { CustomerRow, CustomerInsights, CouponReasonUI } from "@/app/(app)/clientes/_types";

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

/** Painel de resumo do cliente — não é formulário. Usado em /clientes e na busca global. */
export function CustomerSidePanel({
  customer, diasRisco, onClose, onEdit,
}: {
  customer: CustomerRow;
  diasRisco: number;
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
  const tier = tierFromGasto(totalGasto);
  const aniv = aniversarioProximo(customer.dataNascimento);
  const emRisco =
    insights?.diasSemComprar != null &&
    insights.visitas > 0 &&
    insights.diasSemComprar >= diasRisco;

  const iniciais = customer.nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Sheet
      open
      onClose={onClose}
      title={customer.nome}
      description={`Cliente desde ${fmtData(customer.createdAt)}`}
      width="md"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Fechar</Button>
          <Button onClick={onEdit} className="flex-1 gap-1.5"><Pencil size={14} /> Editar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Identificação + tier */}
        <div className="flex items-center gap-3">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand text-lg font-semibold text-on-brand">
            {iniciais || <User size={22} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", tier.soft, tier.text)}>
              <span className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={12} className={cn(i < tier.estrelas ? "fill-current" : "opacity-30")} />
                ))}
              </span>
              {tier.label}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
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

        {/* Métricas */}
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={<CalendarCheck size={14} />} label="Última compra"
            value={loading ? "…" : fmtDiasAtras(insights?.ultimaCompra ?? customer.ultimaCompra)} />
          <Stat icon={<Wallet size={14} />} label="Total gasto"
            value={loading ? "…" : brl(totalGasto)} mono />
          <Stat icon={<Receipt size={14} />} label="Ticket médio"
            value={loading ? "…" : brl(insights?.ticketMedio ?? 0)} mono />
          <Stat icon={<ShoppingBag size={14} />} label="Visitas este mês"
            value={loading ? "…" : String(insights?.visitasMes ?? 0)} mono />
          <Stat icon={<History size={14} />} label="Visitas totais"
            value={loading ? "…" : String(insights?.visitas ?? 0)} mono />
        </div>

        {/* Histórico — produtos favoritos */}
        <div className="rounded-[var(--radius-lg)] border border-line p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
            <History size={13} /> Últimos produtos
          </h3>
          {loading ? (
            <p className="text-[13px] text-muted">Carregando histórico…</p>
          ) : insights && insights.produtosFavoritos.length > 0 ? (
            <ul className="space-y-2">
              {insights.produtosFavoritos.map((p) => (
                <li key={p.nome} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] text-ink-2">{p.nome}</span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-medium text-muted tnum">
                    {p.vezes}x
                  </span>
                </li>
              ))}
            </ul>
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

function Stat({
  icon, label, value, mono,
}: {
  icon: React.ReactNode; label: string; value: string; mono?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        {icon} {label}
      </div>
      <div className={cn(
        "mt-1 text-lg font-semibold text-ink",
        mono && "font-mono tnum",
      )}>
        {value}
      </div>
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
