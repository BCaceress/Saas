"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Unlock, ArrowDownCircle, ArrowUpCircle, Lock } from "lucide-react";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import type { FechamentoReport } from "@/lib/caixa";
import { abrirCaixaAction, movimentarCaixaAction, fecharCaixaAction } from "./actions";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const selectCls =
  "rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const inputCls =
  "rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

type Aberta = { id: string; abertaEm: Date; valorAbertura: number };

export function CaixaClient({
  sites,
  defaultSiteId,
  aberta,
  relatorio,
}: {
  sites: { id: string; nome: string }[];
  defaultSiteId: string | null;
  aberta: Aberta | null;
  relatorio: FechamentoReport | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // abrir
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [valorAbertura, setValorAbertura] = useState("");

  // movimentos
  const [movValor, setMovValor] = useState("");
  const [movMotivo, setMovMotivo] = useState("");

  // fechamento
  const [contado, setContado] = useState("");
  const [reportZ, setReportZ] = useState<FechamentoReport | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro.");
      }
    });
  }

  if (reportZ) {
    return <Relatorio z report={reportZ} onClose={() => { setReportZ(null); router.refresh(); }} />;
  }

  if (!aberta) {
    return (
      <div className="max-w-md">
        <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Unlock size={16} /> Abrir caixa
          </span>
          {sites.length > 1 && (
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={selectCls}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">Fundo de troco</label>
            <input
              type="number" min={0} step="0.01" value={valorAbertura}
              onChange={(e) => setValorAbertura(e.target.value)}
              placeholder="0,00" className={inputCls}
            />
          </div>
          {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
          <button
            onClick={() => run(async () => { await abrirCaixaAction({ siteId, valorAbertura: parseFloat(valorAbertura) || 0 }); })}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
            Abrir caixa
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* Relatório X (parcial) */}
      {relatorio && <Relatorio report={relatorio} />}

      {/* Ações */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Movimentar gaveta</p>
          <input
            type="number" min={0} step="0.01" value={movValor}
            onChange={(e) => setMovValor(e.target.value)} placeholder="Valor" className={inputCls}
          />
          <input
            value={movMotivo} onChange={(e) => setMovMotivo(e.target.value)}
            placeholder="Motivo" className={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => run(async () => {
                await movimentarCaixaAction({ cashSessionId: aberta.id, tipo: "SANGRIA", valor: parseFloat(movValor) || 0, motivo: movMotivo });
                setMovValor(""); setMovMotivo("");
              })}
              disabled={pending}
              className="flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              <ArrowDownCircle size={15} /> Sangria
            </button>
            <button
              onClick={() => run(async () => {
                await movimentarCaixaAction({ cashSessionId: aberta.id, tipo: "SUPRIMENTO", valor: parseFloat(movValor) || 0, motivo: movMotivo });
                setMovValor(""); setMovMotivo("");
              })}
              disabled={pending}
              className="flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              <ArrowUpCircle size={15} /> Suprimento
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Fechar caixa</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">Valor contado na gaveta</label>
            <input
              type="number" min={0} step="0.01" value={contado}
              onChange={(e) => setContado(e.target.value)} placeholder="0,00" className={inputCls}
            />
          </div>
          {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}
          <button
            onClick={() => run(async () => {
              const r = await fecharCaixaAction({ cashSessionId: aberta.id, valorFechamento: parseFloat(contado) || 0 });
              setReportZ(r);
            })}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            Fechar caixa (Z)
          </button>
        </div>
      </div>
    </div>
  );
}

function Relatorio({ report, z, onClose }: { report: FechamentoReport; z?: boolean; onClose?: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold text-ink">
          {z ? "Fechamento (Z)" : "Resumo do turno (X)"}
        </p>
        {onClose && <button onClick={onClose} className="text-sm text-brand hover:underline">Concluir</button>}
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        <Linha label="Fundo de abertura" valor={report.valorAbertura} />
        <Linha label="Suprimentos" valor={report.suprimentos} />
        <Linha label="Sangrias" valor={-report.sangrias} />
        <Linha label="Vendas em dinheiro" valor={report.vendasDinheiro} />
        <div className="my-1 border-t border-line" />
        <Linha label="Esperado na gaveta" valor={report.esperadoDinheiro} forte />
        {report.contado != null && <Linha label="Contado" valor={report.contado} forte />}
        {report.quebra != null && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm font-semibold text-ink">Quebra de caixa</span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${Math.abs(report.quebra) < 0.005 ? "text-ok" : "text-danger"}`}>
              {brl(report.quebra)}
            </span>
          </div>
        )}
      </dl>

      <div className="mt-2 border-t border-line pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Por método · {report.numVendas} {report.numVendas === 1 ? "venda" : "vendas"}
        </p>
        {Object.keys(report.totalPorMetodo).length === 0 ? (
          <p className="text-sm text-muted">Nenhuma venda no turno.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {Object.entries(report.totalPorMetodo).map(([m, v]) => (
              <div key={m} className="flex items-center justify-between text-sm">
                <span className="text-ink">{PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m}</span>
                <span className="font-mono tabular-nums text-ink">{brl(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Linha({ label, valor, forte }: { label: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={forte ? "text-sm font-semibold text-ink" : "text-sm text-muted"}>{label}</span>
      <span className={`font-mono tabular-nums ${forte ? "text-sm font-semibold text-ink" : "text-sm text-ink"}`}>
        {brl(valor)}
      </span>
    </div>
  );
}
