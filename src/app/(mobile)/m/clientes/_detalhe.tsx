"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveRestore,
  Cake,
  CalendarCheck,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Repeat,
  Send,
  Star,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { maskPhone } from "@/lib/masks";
import {
  tierFromGasto,
  statusCliente,
  fmtData,
  fmtDataUTC,
  fmtDiasAtras,
  SEXO_LABEL,
} from "@/lib/customers";
import type { TierThresholds } from "@/lib/customers";
import { diasDeCalendario } from "@/lib/datas";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  getCustomerInsights,
  sendCoupon,
  setCustomerActive,
} from "@/app/(app)/clientes/actions";
import type {
  CustomerRow,
  CustomerInsights,
  CouponReasonUI,
} from "@/app/(app)/clientes/_types";

const STATUS_TOM = {
  ok: "text-ok",
  warn: "text-warn",
  muted: "text-muted",
  faint: "text-faint",
} as const;

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

/** "Hoje" / "Ontem" / "dd/mm" para os agrupamentos de compras. */
function fmtGrupoData(iso: string): string {
  // Dias de calendário (ver `lib/datas`) — por horas decorridas, a compra das
  // 20h de ontem aparecia sob "Hoje".
  const dias = diasDeCalendario(iso) ?? 0;
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return fmtData(iso).slice(0, 5);
}

/** wa.me exige DDI; o cadastro guarda só DDD+número. */
function linkWhatsApp(whatsapp: string): string {
  return `https://wa.me/${whatsapp.length <= 11 ? `55${whatsapp}` : whatsapp}`;
}

/**
 * Ficha do cliente no celular.
 *
 * Mesmo conteúdo do `CustomerSidePanel` do desktop — inclusive a mesma
 * `getCustomerInsights` — em painel que sobe de baixo. A diferença que importa:
 * aqui WhatsApp e telefone são links nativos, porque o aparelho que mostra a
 * ficha é o mesmo que faz a chamada.
 */
export function DetalheCliente({
  cliente,
  diasRisco,
  tierThresholds,
  podeEditar,
  onFechar,
  onEditar,
}: {
  cliente: CustomerRow;
  diasRisco: number;
  tierThresholds: TierThresholds;
  podeEditar: boolean;
  onFechar: () => void;
  onEditar: () => void;
}) {
  const router = useRouter();
  const [insights, setInsights] = React.useState<CustomerInsights | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [alternando, setAlternando] = React.useState(false);

  React.useEffect(() => {
    let vivo = true;
    getCustomerInsights(cliente.id)
      .then((d) => {
        if (vivo) setInsights(d);
      })
      .catch(() => {
        if (vivo) toast.error("Não foi possível carregar o histórico.");
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [cliente.id]);

  const totalGasto = insights?.totalGasto ?? cliente.totalGasto;
  const tier = tierFromGasto(totalGasto, tierThresholds);
  const aniv = aniversarioProximo(cliente.dataNascimento);
  const emRisco =
    insights?.diasSemComprar != null &&
    insights.visitas > 0 &&
    insights.diasSemComprar >= diasRisco;
  const status = statusCliente(
    {
      diasSemComprar: insights?.diasSemComprar ?? null,
      visitasMes: insights?.visitasMes ?? 0,
    },
    diasRisco,
  );

  const freqLabel =
    insights?.frequenciaMediaDias == null
      ? "—"
      : insights.frequenciaMediaDias <= 1
        ? "Todo dia"
        : `A cada ${insights.frequenciaMediaDias} dias`;

  async function alternarAtivo() {
    setAlternando(true);
    try {
      await setCustomerActive(cliente.id, !cliente.ativo);
      toast.success(cliente.ativo ? "Cliente inativado." : "Cliente reativado.");
      router.refresh();
      onFechar();
    } catch (e) {
      toast.error(
        "Não foi possível concluir",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setAlternando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={cliente.nome}
      // O painel abre com o que a lista já sabia e busca o resto. Sem dizer
      // isso, quem toca num cliente vê números parados e acha que são finais.
      descricao={
        carregando ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
            Carregando ficha…
          </span>
        ) : (
          `Cliente desde ${fmtData(cliente.createdAt)}`
        )
      }
      rodape={
        podeEditar && (
          // Sem "Inativar": no celular a ficha se abre com o dedo em movimento e
          // arquivar cliente por engano é caro. Reativar continua aqui — é o que
          // tira alguém do filtro "Inativos", e errar nele não custa nada.
          <div className="flex gap-2">
            {!cliente.ativo && (
              <Button
                variant="secondary"
                onClick={alternarAtivo}
                disabled={alternando}
                className="shrink-0 gap-1.5"
                size="lg"
              >
                <ArchiveRestore className="h-4 w-4" aria-hidden />
                Reativar
              </Button>
            )}
            <Button onClick={onEditar} className="flex-1 gap-1.5" size="lg">
              <Pencil className="h-4 w-4" aria-hidden /> Editar
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 pb-2">
        {/* Identificação */}
        <div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className={cn("flex items-center gap-0.5", tier.text)} aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  size={11}
                  className={i < tier.estrelas ? "fill-current" : "opacity-25"}
                />
              ))}
            </span>
            <span className={cn("font-semibold", tier.text)}>{tier.label}</span>
            <span className="text-faint" aria-hidden>
              ·
            </span>
            <span className={cn("font-medium", STATUS_TOM[status.tone])}>
              {status.label}
            </span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {cliente.whatsapp && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" aria-hidden /> {maskPhone(cliente.whatsapp)}
              </span>
            )}
            {cliente.sexo && <span>{SEXO_LABEL[cliente.sexo]}</span>}
            {cliente.dataNascimento && (
              <span className="flex items-center gap-1">
                <Cake className="h-3 w-3" aria-hidden />{" "}
                {fmtDataUTC(cliente.dataNascimento)}
              </span>
            )}
          </p>
        </div>

        {/* Falar com o cliente — o telefone está na mão, então é um toque. */}
        {cliente.whatsapp && (
          <div className="grid grid-cols-2 gap-2">
            <a
              href={linkWhatsApp(cliente.whatsapp)}
              target="_blank"
              rel="noopener"
              className="tap flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line-button bg-surface text-[13px] font-medium text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
            </a>
            <a
              href={`tel:+55${cliente.whatsapp}`}
              className="tap flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line-button bg-surface text-[13px] font-medium text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Phone className="h-4 w-4" aria-hidden /> Ligar
            </a>
          </div>
        )}

        {/* Cupom: aniversário e retorno */}
        {podeEditar && (aniv || emRisco) && (
          <div className="space-y-2">
            {aniv && (
              <CartaoCupom
                customerId={cliente.id}
                tipo="ANIVERSARIO"
                tom="accent"
                titulo={aniv === "hoje" ? "Faz aniversário hoje" : "Faz aniversário amanhã"}
                sub="Bom momento para um cupom de presente."
              />
            )}
            {emRisco && (
              <CartaoCupom
                customerId={cliente.id}
                tipo="RISCO"
                tom="warn"
                titulo={`Sem comprar há ${insights?.diasSemComprar} dias`}
                sub="Um cupom de retorno costuma trazer de volta."
              />
            )}
          </div>
        )}

        {/* Indicadores — bloco único com divisores, não cards soltos */}
        <div className="rounded-[var(--radius-m)] border border-line bg-surface-2/60">
          <div className="grid grid-cols-2 divide-x divide-line">
            <Indicador
              icone={<CalendarCheck className="h-3.5 w-3.5" aria-hidden />}
              rotulo="Última compra"
              carregando={carregando}
              valor={fmtDiasAtras(insights?.ultimaCompra ?? cliente.ultimaCompra)}
              sub={
                insights?.valorUltimaCompra != null
                  ? brl(insights.valorUltimaCompra)
                  : undefined
              }
            />
            <Indicador
              icone={<Wallet className="h-3.5 w-3.5" aria-hidden />}
              rotulo="Gasto este mês"
              carregando={carregando}
              valor={brl(insights?.gastoMes ?? 0)}
              mono
              sub={
                insights
                  ? `${insights.visitasMes} ${insights.visitasMes === 1 ? "visita" : "visitas"}`
                  : undefined
              }
            />
          </div>
          <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
            <Indicador
              icone={<Wallet className="h-3.5 w-3.5" aria-hidden />}
              rotulo="Total gasto"
              carregando={carregando}
              valor={brl(totalGasto)}
              mono
              sub={
                insights
                  ? `${insights.visitas} ${insights.visitas === 1 ? "compra" : "compras"}`
                  : undefined
              }
            />
            <Indicador
              icone={<Repeat className="h-3.5 w-3.5" aria-hidden />}
              rotulo="Frequência"
              carregando={carregando}
              valor={freqLabel}
              sub={
                insights && insights.ticketMedio > 0
                  ? `ticket ${brl(insights.ticketMedio)}`
                  : undefined
              }
            />
          </div>
        </div>

        {/* Histórico */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">
            Comprados recentemente
          </h3>
          {carregando ? (
            // Esqueleto com a altura de três linhas de item: quando o histórico
            // chega, o painel não pula sob o dedo de quem já está lendo.
            <div
              className="animate-pulse space-y-2 border-t border-line pt-2.5"
              aria-busy="true"
              aria-label="Carregando histórico do cliente"
            >
              {[3, 4, 5].map((n) => (
                <div key={n} className="flex items-center justify-between gap-3">
                  <span
                    className="h-3.5 rounded-md bg-surface-2"
                    style={{ width: `${n * 12}%` }}
                  />
                  <span className="h-3.5 w-8 shrink-0 rounded-full bg-surface-2" />
                </div>
              ))}
            </div>
          ) : insights && insights.comprasRecentes.length > 0 ? (
            <div className="divide-y divide-line border-t border-line">
              {insights.comprasRecentes.map((grupo) => (
                <div key={grupo.data} className="py-2.5">
                  <p className="mb-1 text-[11px] font-medium text-faint">
                    {fmtGrupoData(grupo.data)}
                  </p>
                  <ul className="space-y-1.5">
                    {grupo.itens.map((item) => (
                      <li
                        key={item.nome}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0 truncate text-[13px] text-ink-2">
                          {item.nome}
                        </span>
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
              Sem compras registradas. Identifique o cliente no caixa para começar a
              acompanhar.
            </p>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
  sub,
  mono,
  carregando,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  sub?: string;
  mono?: boolean;
  /** Barras no lugar do valor — reticências não se leem como "carregando". */
  carregando?: boolean;
}) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
        {icone} {rotulo}
      </div>
      {carregando ? (
        <div className="animate-pulse" aria-hidden>
          <div className="mt-1.5 h-4 w-20 rounded-md bg-surface-2" />
          <div className="mt-1.5 h-3 w-12 rounded-md bg-surface-2" />
        </div>
      ) : (
        <>
          <div
            className={cn("mt-1 text-[15px] font-semibold text-ink", mono && "font-mono tnum")}
          >
            {valor}
          </div>
          {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
        </>
      )}
    </div>
  );
}

const TOM_CUPOM = {
  accent: { fundo: "bg-accent-soft", tinta: "text-accent" },
  warn: { fundo: "bg-warn-soft", tinta: "text-warn" },
} as const;

function CartaoCupom({
  customerId,
  tipo,
  tom,
  titulo,
  sub,
}: {
  customerId: string;
  tipo: CouponReasonUI;
  tom: keyof typeof TOM_CUPOM;
  titulo: string;
  sub: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  const [enviado, setEnviado] = React.useState(false);
  const t = TOM_CUPOM[tom];

  async function enviar() {
    setEnviando(true);
    try {
      const { waLink } = await sendCoupon(customerId, tipo);
      setEnviado(true);
      if (waLink) {
        window.open(waLink, "_blank", "noopener");
        toast.success("Cupom pronto", "Abrimos o WhatsApp com a mensagem.");
      } else {
        toast.info("Cupom registrado", "Cadastre um WhatsApp para disparar a mensagem.");
      }
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível enviar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={cn("rounded-[var(--radius-m)] p-3.5", t.fundo)}>
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 shrink-0", t.tinta)} aria-hidden>
          {tipo === "ANIVERSARIO" ? (
            <Cake className="h-4 w-4" />
          ) : (
            <TriangleAlert className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">{titulo}</p>
          <p className="mt-0.5 text-[12px] text-muted">{sub}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={enviar}
        disabled={enviando || enviado}
        className="tap mt-2.5 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-surface/80 text-[13px] font-semibold text-ink disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <Send className="h-3.5 w-3.5" aria-hidden />
        {enviado ? "Cupom enviado" : enviando ? "Enviando…" : "Enviar cupom"}
      </button>
    </div>
  );
}
