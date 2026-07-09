"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Unlock,
  Loader2,
  ArrowDownCircle,
  ArrowUpCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import { brl } from "@/lib/utils";
import {
  abrirCaixaAction,
  movimentarCaixaAction,
  fecharCaixaAction,
} from "@/app/(app)/vendas/caixa/actions";
import type { FechamentoReport } from "@/lib/caixa";
import type { PaymentMethod } from "@/generated/prisma";

export type CaixaInfo = {
  id: string;
  siteNome: string;
  abertaEm: Date;
  valorAbertura: number;
  relatorio: FechamentoReport | null;
};

const parseCentavos = (s: string) =>
  (parseInt(s.replace(/\D/g, "") || "0", 10) || 0) / 100;
const fmtCentavos = (s: string) => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const selectCls =
  "cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const inputCls =
  "rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

// ============================================================
// Sheet do Caixa — abertura / sangria / suprimento / fechamento.
// Reaproveitado no PDV (/vendas) e no aviso de logout com caixa aberto.
// ============================================================

export function CaixaSheet({
  open,
  onClose,
  sites,
  defaultSiteId,
  metodos,
  caixa,
  onChanged,
  fundoTrocoPadrao,
  limiteGaveta,
}: {
  open: boolean;
  onClose: () => void;
  sites: { id: string; nome: string }[];
  defaultSiteId: string | null;
  metodos: PaymentMethod[];
  caixa: CaixaInfo | null;
  onChanged?: () => void;
  /** Configurações → Caixa: sugestão de abertura e teto de dinheiro na gaveta. */
  fundoTrocoPadrao?: number | null;
  limiteGaveta?: number | null;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Caixa"
      description="Abertura, sangria, suprimento e fechamento do caixa do PDV."
    >
      <CaixaPanel
        sites={sites}
        siteId={siteId}
        setSiteId={setSiteId}
        metodos={metodos}
        caixa={caixa}
        onDone={onChanged ?? (() => router.refresh())}
        fundoTrocoPadrao={fundoTrocoPadrao}
        limiteGaveta={limiteGaveta}
      />
    </Sheet>
  );
}

function CaixaPanel({
  sites,
  siteId,
  setSiteId,
  metodos,
  caixa,
  onDone,
  fundoTrocoPadrao,
  limiteGaveta,
}: {
  sites: { id: string; nome: string }[];
  siteId: string;
  setSiteId: (id: string) => void;
  metodos: PaymentMethod[];
  caixa: CaixaInfo | null;
  onDone: () => void;
  fundoTrocoPadrao?: number | null;
  limiteGaveta?: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [valorAbertura, setValorAbertura] = useState(() =>
    fundoTrocoPadrao ? fmtCentavos(String(Math.round(fundoTrocoPadrao * 100))) : "",
  );
  const [mov, setMov] = useState<"SANGRIA" | "SUPRIMENTO" | null>(null);
  const [movValor, setMovValor] = useState("");
  const [movMotivo, setMovMotivo] = useState("");
  const [fechando, setFechando] = useState(false);
  const [contado, setContado] = useState("");

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro.");
      }
    });
  }

  const errBox = error && (
    <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );

  if (!caixa) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-warn-soft text-warn">
            <Lock size={20} />
          </span>
          <p className="text-sm font-semibold text-ink">Caixa fechado</p>
          <p className="text-xs text-muted">
            Informe o fundo de troco e abra o caixa para começar.
          </p>
        </div>
        {sites.length > 1 && (
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className={selectCls}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Fundo de troco
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={valorAbertura}
            onChange={(e) => setValorAbertura(fmtCentavos(e.target.value))}
            placeholder="0,00"
            className={inputCls}
          />
        </label>
        {errBox}
        <button
          onClick={() =>
            run(async () => {
              await abrirCaixaAction({
                siteId,
                valorAbertura: parseCentavos(valorAbertura),
              });
            })
          }
          disabled={pending}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Unlock size={14} />
          )}
          Abrir caixa
        </button>
      </div>
    );
  }

  const r = caixa.relatorio;
  const totalVendido = r
    ? Object.values(r.totalPorMetodo).reduce((s, v) => s + v, 0)
    : 0;
  const dinheiroEmCaixa = r?.esperadoDinheiro ?? caixa.valorAbertura;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-base font-semibold text-ink">
            {caixa.siteNome}
          </p>
          <Badge tone="ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aberto
          </Badge>
        </div>
        <p className="text-xs text-muted">
          Aberto em{" "}
          {caixa.abertaEm.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {r && ` · ${r.numVendas} ${r.numVendas === 1 ? "venda" : "vendas"}`}
        </p>

        <div className="rounded-[var(--radius)] border border-line">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Vendas no caixa
          </p>
          <div className="flex flex-col">
            {metodos.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between px-3 py-1.5 text-sm"
              >
                <span className="text-muted">{PAYMENT_METHOD_LABELS[m]}</span>
                <span className="font-mono tabular-nums text-ink">
                  {brl(r?.totalPorMetodo[m] ?? 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-sm">
              <span className="font-semibold text-ink">Total vendido</span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {brl(totalVendido)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[var(--radius)] bg-ok-soft px-3 py-2.5">
          <span className="text-sm font-semibold text-ok">
            Dinheiro em caixa
          </span>
          <span className="font-display text-lg font-bold tabular-nums text-ok">
            {brl(dinheiroEmCaixa)}
          </span>
        </div>
        <p className="text-[11px] text-muted">
          Abertura {brl(caixa.valorAbertura)} · + vendas em dinheiro · ±
          sangria/suprimento
        </p>
        {limiteGaveta != null && dinheiroEmCaixa > limiteGaveta && (
          <p className="rounded-[var(--radius)] bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
            Gaveta acima do limite de {brl(limiteGaveta)} — considere fazer uma
            sangria.
          </p>
        )}
      </div>

      {errBox}

      {mov && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            {mov === "SANGRIA" ? "Sangria — retirada" : "Suprimento — entrada"}
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={movValor}
            onChange={(e) => setMovValor(fmtCentavos(e.target.value))}
            placeholder="0,00"
            className={inputCls}
          />
          <input
            value={movMotivo}
            onChange={(e) => setMovMotivo(e.target.value)}
            placeholder="Motivo"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMov(null);
                setMovValor("");
                setMovMotivo("");
              }}
              className="flex-1 cursor-pointer rounded-full border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await movimentarCaixaAction({
                    cashSessionId: caixa.id,
                    tipo: mov,
                    valor: parseCentavos(movValor),
                    motivo: movMotivo,
                  });
                  setMov(null);
                  setMovValor("");
                  setMovMotivo("");
                })
              }
              disabled={pending}
              className="flex-1 cursor-pointer rounded-full bg-brand px-3 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {fechando && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            Fechar caixa
          </p>
          <label className="text-xs text-muted">Valor contado na gaveta</label>
          <input
            type="text"
            inputMode="numeric"
            value={contado}
            onChange={(e) => setContado(fmtCentavos(e.target.value))}
            placeholder="0,00"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setFechando(false);
                setContado("");
              }}
              className="flex-1 cursor-pointer rounded-full border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await fecharCaixaAction({
                    cashSessionId: caixa.id,
                    valorFechamento: parseCentavos(contado),
                  });
                  setFechando(false);
                  setContado("");
                })
              }
              disabled={pending}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-danger px-3 py-2 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Lock size={14} />
              )}
              Fechar caixa
            </button>
          </div>
        </div>
      )}

      {!mov && !fechando && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setMov("SANGRIA")}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <ArrowDownCircle size={15} className="text-danger" /> Sangria
          </button>
          <button
            onClick={() => setMov("SUPRIMENTO")}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <ArrowUpCircle size={15} className="text-ok" /> Suprimento
          </button>
          <button
            onClick={() => setFechando(true)}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-danger px-3 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90"
          >
            <Lock size={15} /> Fechar
          </button>
        </div>
      )}
    </div>
  );
}
