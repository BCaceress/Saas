"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  FileQuestion,
  Clock,
  Send,
  TrendingDown,
  ChevronRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney } from "../_catalogo/ui";
import { criarCotacaoAction } from "./actions";
import type { CotacaoRow, CotacaoStatus, ResumoCotacoes } from "./_types";

// ── Lista de cotações ───────────────────────────────────────
// A cotação é uma pergunta que envelhece: o que importa na lista é quantos
// já responderam e quanto tempo resta. Por isso o progresso de respostas vem
// antes do valor — o valor só existe depois que alguém responde.

const STATUS: Record<CotacaoStatus, { label: string; classe: string }> = {
  RASCUNHO: { label: "Rascunho", classe: "bg-surface-2 text-muted" },
  ABERTA: { label: "Aberta", classe: "bg-brand-soft text-brand" },
  ENCERRADA: { label: "Encerrada", classe: "bg-accent-soft text-accent" },
  DECIDIDA: { label: "Virou pedido", classe: "bg-ok-soft text-ok" },
  CANCELADA: { label: "Cancelada", classe: "bg-surface-2 text-faint" },
};

const FILTROS: { id: "ativas" | "todas" | CotacaoStatus; label: string }[] = [
  { id: "ativas", label: "Ativas" },
  { id: "RASCUNHO", label: "Rascunhos" },
  { id: "ABERTA", label: "Abertas" },
  { id: "DECIDIDA", label: "Viraram pedido" },
  { id: "todas", label: "Todas" },
];

function prazoTexto(iso: string | null): { texto: string; urgente: boolean } | null {
  if (!iso) return null;
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (dias < 0) return { texto: "Prazo vencido", urgente: true };
  if (dias === 0) return { texto: "Vence hoje", urgente: true };
  if (dias === 1) return { texto: "Vence amanhã", urgente: true };
  return { texto: `Vence em ${dias} dias`, urgente: dias <= 2 };
}

export function ListaCotacoes({
  linhas,
  resumo,
  sites,
  podePedir,
}: {
  linhas: CotacaoRow[];
  resumo: ResumoCotacoes;
  sites: { id: string; nome: string }[];
  podePedir: boolean;
}) {
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("ativas");
  const [nova, setNova] = useState(false);

  const visiveis = linhas.filter((l) => {
    if (filtro === "todas") return true;
    if (filtro === "ativas") return l.status === "RASCUNHO" || l.status === "ABERTA";
    return l.status === filtro;
  });

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Cotações abertas"
          valor={String(resumo.abertas)}
          icon={<FileQuestion size={13} />}
          tom="brand"
        />
        <Metrica
          label="Aguardando resposta"
          valor={String(resumo.aguardandoResposta)}
          sub="convites enviados sem retorno"
          icon={<Send size={13} />}
        />
        <Metrica
          label="Prazo apertado"
          valor={String(resumo.prazoVencendo)}
          sub="vencem em até 2 dias"
          tom={resumo.prazoVencendo > 0 ? "accent" : "ink"}
          icon={<Clock size={13} />}
        />
        <Metrica
          label="Diferença em jogo"
          valor={fmtMoney(resumo.economiaPotencial)}
          sub="entre a melhor e a pior proposta"
          tom="ok"
          icon={<TrendingDown size={13} />}
        />
      </MetricaGrid>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                filtro === f.id
                  ? "bg-brand text-on-brand"
                  : "border border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {podePedir && (
          <button
            type="button"
            onClick={() => setNova(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Plus size={15} />
            Nova cotação
          </button>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EstadoVazio
          icon={<FileQuestion size={20} />}
          titulo="Nenhuma cotação por aqui"
          descricao="Monte a lista do que você precisa, escolha os fornecedores e deixe eles disputarem o preço."
          acao={
            podePedir ? (
              <button
                type="button"
                onClick={() => setNova(true)}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                Criar a primeira cotação
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((l) => {
            const prazo = l.status === "ABERTA" ? prazoTexto(l.prazoResposta) : null;
            const respondeuTudo =
              l.totalConvidados > 0 && l.totalRespondidos === l.totalConvidados;
            return (
              <li key={l.id}>
                <Link
                  href={`/compras/cotacoes/${l.id}`}
                  className="group flex items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-muted">
                        {l.numero}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          STATUS[l.status].classe,
                        )}
                      >
                        {STATUS[l.status].label}
                      </span>
                      {prazo && (
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            prazo.urgente ? "text-accent" : "text-faint",
                          )}
                        >
                          {prazo.texto}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-display text-[15px] font-semibold text-ink">
                      {l.titulo}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {l.totalItens} {l.totalItens === 1 ? "item" : "itens"} · {l.siteNome}
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <p
                      className={cn(
                        "font-mono text-[13px] font-semibold tabular-nums",
                        respondeuTudo ? "text-ok" : "text-ink",
                      )}
                    >
                      {l.totalRespondidos}/{l.totalConvidados}
                    </p>
                    <p className="text-[11px] text-faint">responderam</p>
                  </div>

                  <div className="hidden shrink-0 text-right md:block">
                    {l.melhorTotal === null ? (
                      <p className="text-[12px] text-faint">sem proposta cheia</p>
                    ) : (
                      <>
                        <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                          {fmtMoney(l.melhorTotal)}
                        </p>
                        <p className="text-[11px] text-faint">melhor proposta</p>
                      </>
                    )}
                  </div>

                  <ChevronRight
                    size={17}
                    className="shrink-0 text-faint transition-colors group-hover:text-brand"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {nova && <NovaCotacaoSheet sites={sites} onClose={() => setNova(false)} />}
    </div>
  );
}

// ── Nova cotação ────────────────────────────────────────────
// Só o essencial: nome, loja e prazo. Itens e fornecedores entram na tela da
// cotação, onde há espaço para trabalhar.

function NovaCotacaoSheet({
  sites,
  onClose,
}: {
  sites: { id: string; nome: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({
    titulo: "",
    siteId: sites[0]?.id ?? "",
    prazoResposta: "",
    observacao: "",
  });

  function salvar() {
    setErro(null);
    startTransition(async () => {
      try {
        const criada = await criarCotacaoAction({
          titulo: form.titulo,
          siteId: form.siteId,
          prazoResposta: form.prazoResposta || null,
          observacao: form.observacao || null,
        });
        router.push(`/compras/cotacoes/${criada.id}`);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível criar a cotação.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-cotacao-titulo"
        className="w-full max-w-lg rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="nova-cotacao-titulo"
              className="font-display text-[17px] font-semibold text-ink"
            >
              Nova cotação
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Dê um nome, escolha a loja e o prazo. Os itens entram na próxima tela.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">Nome da cotação</span>
            <input
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              placeholder="Ex.: Reposição de cervejas — agosto"
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-2">Loja de destino</span>
              <select
                value={form.siteId}
                onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-2">Responder até</span>
              <input
                type="date"
                value={form.prazoResposta}
                onChange={(e) => setForm((f) => ({ ...f, prazoResposta: e.target.value }))}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">
              Recado ao fornecedor <span className="text-faint">(opcional)</span>
            </span>
            <textarea
              value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
              rows={2}
              placeholder="Ex.: entrega só de manhã, pagamento em 28 dias"
              className="resize-none rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>

        {erro && <p className="mt-3 text-[13px] text-danger">{erro}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pendente || form.titulo.trim().length < 3 || !form.siteId}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pendente ? "Criando…" : "Criar cotação"}
          </button>
        </div>
      </div>
    </div>
  );
}
