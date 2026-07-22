"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusFiscalVendaAction } from "./actions";
import type { StatusFiscalVenda } from "@/lib/fiscal/emissao";

// ============================================================
// Situação da NFC-e da última venda. Fica de canto, sem modal e sem bloquear
// nada: a venda já está paga: a nota é assunto paralelo. Cada poll também
// EMPURRA a transmissão no servidor (ver statusFiscalDaVenda).
// ============================================================

const INTERVALO_MS = 2_500;
/** ~50s de acompanhamento. Depois disso, o job da fila assume. */
const MAX_TENTATIVAS = 20;

const EM_ANDAMENTO = ["PENDENTE", "PROCESSANDO"];

export function NotaFiscalChip({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const [info, setInfo] = useState<StatusFiscalVenda>(null);
  const [desistiu, setDesistiu] = useState(false);

  useEffect(() => {
    let vivo = true;
    let tentativas = 0;
    let timer: number | undefined;

    async function consultar() {
      if (!vivo) return;
      try {
        const r = await statusFiscalVendaAction(saleId);
        if (!vivo) return;
        setInfo(r);
        // Estado final: para de perguntar.
        if (r && !EM_ANDAMENTO.includes(r.status)) return;
      } catch {
        // Sem rede agora — o job da fila resolve depois.
      }
      tentativas++;
      if (tentativas >= MAX_TENTATIVAS) {
        setDesistiu(true);
        return;
      }
      timer = window.setTimeout(consultar, INTERVALO_MS);
    }

    consultar();
    return () => {
      vivo = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [saleId]);

  // Venda sem documento fiscal (módulo desligado, produto sem NCM…): nada a
  // mostrar aqui — o erro fica registrado no histórico fiscal.
  if (!info) return null;

  const visual = (() => {
    if (info.status === "AUTORIZADO") {
      return {
        tone: "ok" as const,
        icon: <CheckCircle2 size={15} />,
        titulo: `NFC-e ${info.numero}/${info.serie} autorizada`,
        detalhe: info.protocolo ? `Protocolo ${info.protocolo}` : null,
      };
    }
    if (info.status === "REJEITADO" || info.status === "DENEGADO") {
      return {
        tone: "danger" as const,
        icon: <AlertTriangle size={15} />,
        titulo: `NFC-e ${info.numero}/${info.serie} rejeitada`,
        detalhe: info.motivo ?? "Confira a classificação fiscal dos produtos.",
      };
    }
    if (info.status === "CONTINGENCIA" || desistiu) {
      return {
        tone: "warn" as const,
        icon: <WifiOff size={15} />,
        titulo: "Nota em contingência",
        detalhe: "A venda está registrada. A transmissão continua em segundo plano.",
      };
    }
    return {
      tone: "brand" as const,
      icon: <Loader2 size={15} className="animate-spin" />,
      titulo: "Emitindo NFC-e…",
      detalhe: "A venda já está concluída.",
    };
  })();

  const cls = {
    ok: "border-ok/30 bg-ok-soft text-ok",
    danger: "border-danger/30 bg-danger-soft text-danger",
    warn: "border-warn/30 bg-warn-soft text-warn",
    brand: "border-brand/30 bg-brand-soft text-brand-strong",
  }[visual.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 shadow-[var(--shadow-float)]",
        cls,
      )}
    >
      <span className="mt-0.5 shrink-0">{visual.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{visual.titulo}</p>
        {visual.detalhe && <p className="mt-0.5 text-xs opacity-80">{visual.detalhe}</p>}
        {info.status === "AUTORIZADO" && info.urlConsulta && (
          <a
            href={info.urlConsulta}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-medium underline"
          >
            Consultar na SEFAZ
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso da nota"
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
