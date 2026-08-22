"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  HandCoins,
  Loader2,
  Check,
  TriangleAlert,
  CalendarClock,
  Clock,
  Ban,
  Plus,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Modal } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid } from "../../cotacoes/_catalogo/ui";
import { fmtMoney } from "../../cotacoes/_catalogo/format";
import {
  criarTituloReceberAction,
  receberTituloAction,
  cancelarTituloReceberAction,
} from "./actions";
import type { ResumoRecebiveis } from "@/lib/financeiro/contas-receber";

// ============================================================
// Contas a receber. Espelho de Contas a pagar de propósito: quem aprendeu uma
// tela sabe a outra, e o fluxo de caixa lê as duas com a mesma régua.
// ============================================================

export type RecebivelRow = {
  id: string;
  descricao: string;
  clienteNome: string | null;
  parcela: string | null;
  numeroDocumento: string | null;
  vencimento: Date;
  valor: number;
  valorRecebido: number;
  saldo: number;
  status: "ABERTO" | "RECEBIDO" | "CANCELADO";
  origem: string;
  diasParaVencer: number;
};

const FILTROS = [
  { value: "ABERTO", label: "Em aberto" },
  { value: "VENCIDO", label: "Vencidos" },
  { value: "RECEBIDO", label: "Recebidos" },
  { value: "CANCELADO", label: "Cancelados" },
] as const;

const ORIGEM_LABEL: Record<string, string> = {
  MANUAL: "Lançamento manual",
  VENDA_PRAZO: "Venda a prazo",
  COMODATO: "Comodato",
  OUTRO: "Outro",
};

const campo =
  "w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const rotulo = "text-xs font-semibold uppercase tracking-wide text-faint";

function prazo(t: RecebivelRow): { texto: string; tom: "danger" | "accent" | "muted" } {
  if (t.status === "RECEBIDO") return { texto: "Recebido", tom: "muted" };
  if (t.status === "CANCELADO") return { texto: "Cancelado", tom: "muted" };
  if (t.diasParaVencer < 0) {
    const d = Math.abs(t.diasParaVencer);
    return { texto: `Atrasado há ${d} ${d === 1 ? "dia" : "dias"}`, tom: "danger" };
  }
  if (t.diasParaVencer === 0) return { texto: "Vence hoje", tom: "accent" };
  if (t.diasParaVencer === 1) return { texto: "Vence amanhã", tom: "accent" };
  return { texto: `Em ${t.diasParaVencer} dias`, tom: "muted" };
}

export function ContasAReceberView({
  titulos,
  resumo,
  status,
  podeBaixar,
}: {
  titulos: RecebivelRow[];
  resumo: ResumoRecebiveis;
  status: string;
  podeBaixar: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [recebendo, setRecebendo] = useState<RecebivelRow | null>(null);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function navegar(valor: string) {
    const q = new URLSearchParams(params.toString());
    q.set("status", valor);
    router.push(`/financeiro/contas-a-receber?${q.toString()}`);
  }

  function cancelar(t: RecebivelRow) {
    const motivo = window.prompt(`Por que "${t.descricao}" não será recebido?`);
    if (!motivo?.trim()) return;
    setErro(null);
    startTransition(async () => {
      try {
        await cancelarTituloReceberAction({ tituloId: t.id, motivo });
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Contas a receber"
        icon={navIcon("/financeiro/contas-a-receber")}
        description="O que entra: venda a prazo, comodato faturado, aluguel de espaço."
        actions={
          podeBaixar ? (
            <Button size="sm" onClick={() => setNovo(true)}>
              <Plus size={15} />
              Novo título
            </Button>
          ) : undefined
        }
      />

      <MetricaGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          label="Atrasado"
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
          label="Total a receber"
          valor={fmtMoney(resumo.aberto.valor)}
          sub={`${resumo.aberto.qtd} ${resumo.aberto.qtd === 1 ? "título" : "títulos"}`}
          icon={<HandCoins size={12} />}
        />
      </MetricaGrid>

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => navegar(f.value)}
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
      </div>

      {erro && (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {erro}
        </p>
      )}

      {titulos.length === 0 ? (
        <EstadoVazio
          icon={<HandCoins size={20} />}
          titulo="Nenhum título nesta visão"
          descricao="Lance aqui o que a loja tem a receber — venda faturada para empresa, aluguel de espaço de geladeira, comodato. É o que faz o fluxo de caixa mostrar as duas pontas."
          acao={
            podeBaixar ? (
              <Button size="sm" variant="secondary" onClick={() => setNovo(true)}>
                Lançar título
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <ul className="divide-y divide-line">
            {titulos.map((t) => {
              const p = prazo(t);
              const atrasado = t.status === "ABERTO" && t.diasParaVencer < 0;
              return (
                <li
                  key={t.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
                    atrasado && "bg-danger/5",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {t.clienteNome ?? t.descricao}
                      </span>
                      {t.parcela && <Badge>Parcela {t.parcela}</Badge>}
                      {t.origem !== "MANUAL" && <Badge>{ORIGEM_LABEL[t.origem] ?? t.origem}</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {t.clienteNome ? t.descricao : ORIGEM_LABEL[t.origem] ?? t.origem}
                      {t.numeroDocumento && ` · ${t.numeroDocumento}`}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-[15px] font-semibold text-ink">
                      {fmtMoney(t.saldo > 0 ? t.saldo : t.valor)}
                    </p>
                    <p
                      className={cn(
                        "text-[11px]",
                        p.tom === "danger"
                          ? "font-medium text-danger"
                          : p.tom === "accent"
                            ? "font-medium text-accent"
                            : "text-muted",
                      )}
                    >
                      {t.vencimento.toLocaleDateString("pt-BR")} · {p.texto}
                    </p>
                    {t.valorRecebido > 0 && t.status === "ABERTO" && (
                      <p className="text-[11px] text-muted">
                        {fmtMoney(t.valorRecebido)} já recebido de {fmtMoney(t.valor)}
                      </p>
                    )}
                  </div>

                  {podeBaixar && t.status === "ABERTO" && (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => setRecebendo(t)}>
                        <Check size={14} />
                        Receber
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

      {recebendo && (
        <RecebimentoModal
          titulo={recebendo}
          onClose={() => setRecebendo(null)}
          onDone={() => {
            setRecebendo(null);
            router.refresh();
          }}
        />
      )}

      {novo && (
        <NovoTituloModal
          onClose={() => setNovo(false)}
          onDone={() => {
            setNovo(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RecebimentoModal({
  titulo,
  onClose,
  onDone,
}: {
  titulo: RecebivelRow;
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
    if (numero <= 0) return setErro("Informe o valor recebido.");
    startTransition(async () => {
      try {
        await receberTituloAction({
          tituloId: titulo.id,
          valorRecebido: parcial ? numero : null,
          recebidoEm: data,
        });
        onDone();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao registrar recebimento.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar recebimento"
      description={`${titulo.clienteNome ?? "Sem cliente"} · ${titulo.descricao}`}
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
            <label className={rotulo}>Valor recebido</label>
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              className={campo}
            />
            <p className="text-[11px] text-muted">Saldo: {fmtMoney(titulo.saldo)}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Data do recebimento</label>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className={campo}
            />
          </div>
        </div>
        {parcial && (
          <p className="rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-xs text-accent">
            Recebimento parcial: o título fica em aberto com saldo de{" "}
            {fmtMoney(titulo.saldo - numero)}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function NovoTituloModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hoje);
  const [parcelas, setParcelas] = useState("1");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numero = Number(valor.replace(",", ".")) || 0;
  const nParcelas = Math.max(1, Math.min(36, Number(parcelas) || 1));

  function submit() {
    setErro(null);
    if (descricao.trim().length < 3) return setErro("Diga do que é este recebimento.");
    if (numero <= 0) return setErro("Informe o valor.");
    startTransition(async () => {
      try {
        await criarTituloReceberAction({
          descricao,
          valor: numero,
          vencimento,
          parcelas: nParcelas,
          numeroDocumento: numeroDocumento || null,
        });
        onDone();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao lançar o título.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo título a receber"
      description="O que a loja tem para receber, e quando."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={pending} onClick={submit}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Lançar
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

        <div className="flex flex-col gap-1.5">
          <label className={rotulo}>Do que se trata</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: Faturamento mensal — Padaria do Zé"
            className={campo}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Valor total</label>
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className={campo}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Primeiro vencimento</label>
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className={campo}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Parcelas</label>
            <input
              type="number"
              min={1}
              max={36}
              value={parcelas}
              onChange={(e) => setParcelas(e.target.value)}
              className={campo}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Documento (opcional)</label>
            <input
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
              placeholder="Ex: NF 1234"
              className={campo}
            />
          </div>
        </div>

        {nParcelas > 1 && numero > 0 && (
          <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-faint" />
            {nParcelas} parcelas de aproximadamente {fmtMoney(numero / nParcelas)}, uma por mês a
            partir de {new Date(`${vencimento}T12:00:00`).toLocaleDateString("pt-BR")}.
          </p>
        )}
      </div>
    </Modal>
  );
}
