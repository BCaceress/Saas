"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wallet,
  Loader2,
  Check,
  TriangleAlert,
  CalendarClock,
  FileText,
  Ban,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Modal } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid } from "../../cotacoes/_catalogo/ui";
import { fmtMoney } from "../../cotacoes/_catalogo/format";
import { pagarTituloAction, cancelarTituloAction } from "./actions";
import type { TituloRow, ResumoTitulos } from "./_data";

// ============================================================
// Contas a pagar.
//
// A ordem da tela é a ordem da urgência: vencido primeiro, depois hoje, depois
// o resto. Não há totalizador geral no topo — o que importa é o que vence, não
// o quanto se deve no universo.
// ============================================================

const FILTROS = [
  { value: "ABERTO", label: "Em aberto" },
  { value: "VENCIDO", label: "Vencidos" },
  { value: "PAGO", label: "Pagos" },
  { value: "CANCELADO", label: "Cancelados" },
] as const;

function prazoLabel(t: TituloRow): { texto: string; tom: "danger" | "accent" | "muted" } {
  if (t.status === "PAGO") return { texto: "Pago", tom: "muted" };
  if (t.status === "CANCELADO") return { texto: "Cancelado", tom: "muted" };
  if (t.diasParaVencer < 0) {
    const d = Math.abs(t.diasParaVencer);
    return { texto: `Vencido há ${d} ${d === 1 ? "dia" : "dias"}`, tom: "danger" };
  }
  if (t.diasParaVencer === 0) return { texto: "Vence hoje", tom: "accent" };
  if (t.diasParaVencer === 1) return { texto: "Vence amanhã", tom: "accent" };
  return { texto: `Em ${t.diasParaVencer} dias`, tom: "muted" };
}

export function ContasAPagarView({
  titulos,
  resumo,
  fornecedores,
  status,
  fornecedorId,
  podePagar,
}: {
  titulos: TituloRow[];
  resumo: ResumoTitulos;
  fornecedores: { id: string; nome: string }[];
  status: string;
  fornecedorId: string | null;
  podePagar: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pagando, setPagando] = useState<TituloRow | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function navegar(patch: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`/financeiro/contas-a-pagar?${q.toString()}`);
  }

  function cancelar(t: TituloRow) {
    const motivo = window.prompt(`Por que o título ${t.numeroDocumento ?? ""} não deve ser pago?`);
    if (!motivo?.trim()) return;
    setErro(null);
    startTransition(async () => {
      try {
        await cancelarTituloAction({ tituloId: t.id, motivo });
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Contas a pagar"
        icon={navIcon("/financeiro/contas-a-pagar")}
        description="O que a loja deve aos fornecedores. Cada título nasce da nota que trouxe a mercadoria."
      />

      <MetricaGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          label="Vencido"
          valor={fmtMoney(resumo.vencido.valor)}
          sub={`${resumo.vencido.qtd} ${resumo.vencido.qtd === 1 ? "título" : "títulos"}`}
          tom={resumo.vencido.valor > 0 ? "accent" : "ink"}
          icon={<TriangleAlert size={12} />}
        />
        <Metrica
          label="Vence hoje"
          valor={fmtMoney(resumo.hoje.valor)}
          sub={`${resumo.hoje.qtd} ${resumo.hoje.qtd === 1 ? "título" : "títulos"}`}
          icon={<Clock size={12} />}
        />
        <Metrica
          label="Próximos 7 dias"
          valor={fmtMoney(resumo.semana.valor)}
          sub={`${resumo.semana.qtd} ${resumo.semana.qtd === 1 ? "título" : "títulos"}`}
          icon={<CalendarClock size={12} />}
        />
        <Metrica
          label="Total em aberto"
          valor={fmtMoney(resumo.aberto.valor)}
          sub={`${resumo.aberto.qtd} ${resumo.aberto.qtd === 1 ? "título" : "títulos"}`}
          icon={<Wallet size={12} />}
        />
      </MetricaGrid>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => navegar({ status: f.value })}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              status === f.value
                ? "border-brand bg-brand text-on-brand"
                : "border-line bg-surface text-ink-2 hover:bg-surface-2",
            )}
          >
            {f.label}
          </button>
        ))}

        {fornecedores.length > 0 && (
          <select
            value={fornecedorId ?? ""}
            onChange={(e) => navegar({ fornecedor: e.target.value || null })}
            className="ml-auto rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink focus-visible:border-brand focus-visible:outline-none"
          >
            <option value="">Todos os fornecedores</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        )}
      </div>

      {erro && (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {erro}
        </p>
      )}

      {titulos.length === 0 ? (
        <EstadoVazio
          icon={<Wallet size={20} />}
          titulo="Nenhum título nesta visão"
          descricao="Os títulos nascem sozinhos quando uma nota de entrada é recebida: uma linha por parcela do boleto. Receba uma nota em Pedidos para ver o financeiro se formar."
          acao={
            <Link href="/pedidos">
              <Button size="sm" variant="secondary">Ir para pedidos</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <ul className="divide-y divide-line">
            {titulos.map((t) => {
              const prazo = prazoLabel(t);
              return (
                <li
                  key={t.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
                    t.vencido && "bg-danger/5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {t.supplierNome}
                      </span>
                      {t.parcela && (
                        <Badge>Parcela {t.parcela}</Badge>
                      )}
                      {t.estimado && (
                        <Badge tone="accent" title="Vencimento derivado do prazo do fornecedor">
                          Vencimento estimado
                        </Badge>
                      )}
                      {t.pedidoNumero && (
                        <Link
                          href={`/pedidos?pedido=${t.pedidoId}`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted transition-colors hover:text-brand"
                        >
                          <FileText size={11} />
                          {t.pedidoNumero}
                        </Link>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted">{t.descricao}</p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-[15px] font-semibold text-ink">
                      {fmtMoney(t.saldo > 0 ? t.saldo : t.valor)}
                    </p>
                    <p
                      className={cn(
                        "text-[11px]",
                        prazo.tom === "danger"
                          ? "font-medium text-danger"
                          : prazo.tom === "accent"
                            ? "font-medium text-accent"
                            : "text-muted",
                      )}
                    >
                      {t.vencimento.toLocaleDateString("pt-BR")} · {prazo.texto}
                    </p>
                    {t.valorPago > 0 && t.status === "ABERTO" && (
                      <p className="text-[11px] text-muted">
                        {fmtMoney(t.valorPago)} já abatido de {fmtMoney(t.valor)}
                      </p>
                    )}
                  </div>

                  {podePagar && t.status === "ABERTO" && (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => setPagando(t)}>
                        <Check size={14} />
                        Pagar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        aria-label="Cancelar título"
                        onClick={() => cancelar(t)}
                      >
                        <Ban size={14} />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pagando && (
        <PagamentoModal
          titulo={pagando}
          onClose={() => setPagando(null)}
          onDone={() => {
            setPagando(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PagamentoModal({
  titulo,
  onClose,
  onDone,
}: {
  titulo: TituloRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [valor, setValor] = useState(titulo.saldo.toFixed(2));
  const [data, setData] = useState(hoje);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numero = Number(valor.replace(",", ".")) || 0;
  const parcial = numero > 0 && numero < titulo.saldo - 0.005;

  function submit() {
    setErro(null);
    if (numero <= 0) return setErro("Informe o valor pago.");
    startTransition(async () => {
      try {
        await pagarTituloAction({
          tituloId: titulo.id,
          // Quitação total manda null: o servidor calcula o saldo exato e evita
          // um centavo de diferença deixar o título aberto para sempre.
          valorPago: parcial ? numero : null,
          pagoEm: data,
        });
        onDone();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao registrar pagamento.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar pagamento"
      description={`${titulo.supplierNome} · ${titulo.descricao}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={pending} onClick={submit}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {parcial ? "Registrar parcial" : "Quitar título"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && (
          <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {erro}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Valor pago
            </label>
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <p className="text-[11px] text-muted">Saldo do título: {fmtMoney(titulo.saldo)}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Data do pagamento
            </label>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </div>

        {parcial && (
          <p className="rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-xs text-accent">
            Pagamento parcial: o título continua em aberto com saldo de{" "}
            {fmtMoney(titulo.saldo - numero)}.
          </p>
        )}
      </div>
    </Modal>
  );
}
