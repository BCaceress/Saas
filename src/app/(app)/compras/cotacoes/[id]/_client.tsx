"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, CheckCheck, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CotacaoDetalhe,
  CotacaoStatus,
  FornecedorOpcao,
  ProdutoOpcao,
} from "../_types";
import {
  cancelarCotacaoAction,
  encerrarCotacaoAction,
  reabrirCotacaoAction,
} from "../actions";
import { ItensCotacao } from "./_itens";
import { ConvitesCotacao } from "./_convites";
import { ComparativoCotacao } from "./_comparativo";

// ── Cotação, tela inteira ───────────────────────────────────
// Três momentos, três painéis: o que eu quero (itens), a quem eu perguntei
// (fornecedores) e o que voltou (comparativo). A cotação anda por eles em
// ordem, então o painel aberto por padrão é o do momento em que ela está.

const STATUS: Record<CotacaoStatus, { label: string; classe: string }> = {
  RASCUNHO: { label: "Rascunho", classe: "bg-surface-2 text-muted" },
  ABERTA: { label: "Aberta", classe: "bg-brand-soft text-brand" },
  ENCERRADA: { label: "Encerrada", classe: "bg-accent-soft text-accent" },
  DECIDIDA: { label: "Virou pedido", classe: "bg-ok-soft text-ok" },
  CANCELADA: { label: "Cancelada", classe: "bg-surface-2 text-faint" },
};

type Painel = "itens" | "fornecedores" | "comparativo";

export function CotacaoDetalheClient({
  cotacao,
  produtos,
  fornecedores,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
  podePedir: boolean;
}) {
  const temResposta = cotacao.convites.some((c) => c.status === "RESPONDIDA");
  const [painel, setPainel] = useState<Painel>(
    temResposta ? "comparativo" : cotacao.status === "RASCUNHO" ? "itens" : "fornecedores",
  );

  const fechada = cotacao.status === "DECIDIDA" || cotacao.status === "CANCELADA";
  const editavel = podePedir && !fechada;

  const PAINEIS: { id: Painel; label: string; contador: number }[] = [
    { id: "itens", label: "Itens", contador: cotacao.itens.length },
    { id: "fornecedores", label: "Fornecedores", contador: cotacao.convites.length },
    {
      id: "comparativo",
      label: "Comparativo",
      contador: cotacao.convites.filter((c) => c.status === "RESPONDIDA").length,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Cabecalho cotacao={cotacao} podePedir={podePedir} />

      <div className="flex items-center gap-1 overflow-x-auto border-b border-line">
        {PAINEIS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPainel(p.id)}
            aria-current={painel === p.id ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors",
              painel === p.id
                ? "border-b-2 border-brand text-brand"
                : "text-muted hover:text-ink",
            )}
          >
            {p.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                painel === p.id ? "bg-brand-soft text-brand" : "bg-surface-2 text-faint",
              )}
            >
              {p.contador}
            </span>
          </button>
        ))}
      </div>

      {painel === "itens" && (
        <ItensCotacao cotacao={cotacao} produtos={produtos} editavel={editavel} />
      )}
      {painel === "fornecedores" && (
        <ConvitesCotacao
          cotacao={cotacao}
          fornecedores={fornecedores}
          editavel={editavel}
          onVerComparativo={() => setPainel("comparativo")}
        />
      )}
      {painel === "comparativo" && (
        <ComparativoCotacao cotacao={cotacao} podePedir={podePedir} />
      )}
    </div>
  );
}

// ── Cabeçalho da cotação ────────────────────────────────────

function Cabecalho({
  cotacao,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível concluir.");
      }
    });
  }

  const prazo = cotacao.prazoResposta
    ? new Date(cotacao.prazoResposta).toLocaleDateString("pt-BR")
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/compras/cotacoes"
            aria-label="Voltar para as cotações"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft size={17} />
          </Link>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] font-semibold text-muted">
                {cotacao.numero}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  STATUS[cotacao.status].classe,
                )}
              >
                {STATUS[cotacao.status].label}
              </span>
            </div>
            <h2 className="truncate font-display text-[19px] font-semibold leading-tight text-ink">
              {cotacao.titulo}
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              Entrega em {cotacao.siteNome}
              {prazo && ` · resposta até ${prazo}`}
            </p>
          </div>
        </div>

        {podePedir && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {cotacao.status === "ABERTA" && (
              <button
                type="button"
                onClick={() => rodar(() => encerrarCotacaoAction(cotacao.id))}
                disabled={pendente}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Lock size={14} />
                Encerrar
              </button>
            )}
            {cotacao.status === "ENCERRADA" && (
              <button
                type="button"
                onClick={() => rodar(() => reabrirCotacaoAction(cotacao.id))}
                disabled={pendente}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Unlock size={14} />
                Reabrir
              </button>
            )}
            {(cotacao.status === "RASCUNHO" ||
              cotacao.status === "ABERTA" ||
              cotacao.status === "ENCERRADA") && (
              <button
                type="button"
                onClick={() => rodar(() => cancelarCotacaoAction(cotacao.id))}
                disabled={pendente}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                <Ban size={14} />
                Cancelar
              </button>
            )}
            {cotacao.status === "DECIDIDA" && (
              <Link
                href="/compras/pedidos"
                className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                <CheckCheck size={14} />
                Ver pedidos gerados
              </Link>
            )}
          </div>
        )}
      </div>

      {cotacao.observacao && (
        <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-ink-2">
          {cotacao.observacao}
        </p>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}
    </div>
  );
}
