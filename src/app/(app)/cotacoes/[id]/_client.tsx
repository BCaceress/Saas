"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Check, CheckCheck, Lock, Tag, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CotacaoDetalhe, FornecedorOpcao, ProdutoOpcao } from "../_compra-types";
import {
  cancelarCotacaoAction,
  encerrarCotacaoAction,
  reabrirCotacaoAction,
} from "../_compra-actions";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import { ItensCotacao } from "./_itens";
import { ConvitesCotacao } from "./_convites";
import { ComparativoCotacao } from "./_comparativo";
import { ResumoCotacaoPainel } from "./_resumo";
import { CotarCatalogo } from "./_cotar";
import { RevisarCotacao } from "./_revisar";
import { andamento, statusVisivel } from "../_status";

// ── Cotação, tela inteira ───────────────────────────────────
// A tela tem duas caras, porque o trabalho é outro antes e depois do envio.
//
// RASCUNHO → TRILHO de três passos (produtos → fornecedores → revisar e
// enviar). Enquanto a cotação está sendo montada existe uma ordem certa, e
// abas soltas obrigam o operador a descobrir sozinho qual vem primeiro.
//
// Enviada em diante → ABAS. A ordem já não manda: ele volta no que precisar,
// e o painel que abre por padrão é o do momento em que a cotação está.
//
// "Preços do catálogo" (cotar) fica fora do trilho de propósito: é atalho de
// quem já tem tabela do fornecedor, não etapa de todo mundo.

type Painel = "itens" | "cotar" | "fornecedores" | "revisar" | "comparativo";

const PASSOS: { id: Painel; label: string }[] = [
  { id: "itens", label: "Produtos" },
  { id: "fornecedores", label: "Fornecedores" },
  { id: "revisar", label: "Revisar e enviar" },
];

export function CotacaoDetalheClient({
  cotacao,
  produtos,
  fornecedores,
  sites,
  resumo,
  podePedir,
  usaMinimo,
}: {
  cotacao: CotacaoDetalhe;
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
  sites: { id: string; nome: string }[];
  resumo: ResumoCotacao;
  podePedir: boolean;
  usaMinimo: boolean;
}) {
  const rascunho = cotacao.status === "RASCUNHO";
  const temResposta = cotacao.convites.some((c) => c.status === "RESPONDIDA");
  const [painel, setPainel] = useState<Painel>(
    temResposta ? "comparativo" : rascunho ? "itens" : "fornecedores",
  );

  const fechada = cotacao.status === "DECIDIDA" || cotacao.status === "CANCELADA";
  const editavel = podePedir && !fechada;

  const PAINEIS: { id: Painel; label: string; contador: number }[] = [
    { id: "itens", label: "Itens", contador: cotacao.itens.length },
    { id: "cotar", label: "Cotar", contador: cotacao.itens.filter((i) => i.productId).length },
    { id: "fornecedores", label: "Fornecedores", contador: cotacao.convites.length },
    {
      id: "comparativo",
      label: "Comparativo",
      contador: cotacao.convites.filter((c) => c.status === "RESPONDIDA").length,
    },
  ];

  // Passo concluído = tem o que ele pede. É o que acende o ✓ no trilho e o
  // que libera o "Continuar" — sem isso o operador chega na revisão com uma
  // cotação vazia e só descobre lá.
  const feito: Record<Painel, boolean> = {
    itens: cotacao.itens.length > 0,
    fornecedores: cotacao.convites.length > 0,
    revisar: false,
    cotar: false,
    comparativo: false,
  };

  return (
    <div className="flex flex-col gap-5">
      <Cabecalho cotacao={cotacao} podePedir={podePedir} />

      {rascunho ? (
        <Trilho
          atual={painel}
          feito={feito}
          onIr={setPainel}
          onCatalogo={() => setPainel("cotar")}
          noCatalogo={painel === "cotar"}
        />
      ) : (
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
      )}

      {painel === "itens" && (
        <ItensCotacao
          cotacao={cotacao}
          produtos={produtos}
          editavel={editavel}
          usaMinimo={usaMinimo}
        />
      )}
      {painel === "cotar" && <CotarCatalogo cotacao={cotacao} editavel={editavel} />}
      {painel === "revisar" && (
        <RevisarCotacao
          cotacao={cotacao}
          sites={sites}
          editavel={editavel}
          onIrPara={setPainel}
        />
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
        <>
          {/* Antes da tabela: a leitura vem primeiro, os números confirmam. */}
          <ResumoCotacaoPainel resumo={resumo} />
          <ComparativoCotacao cotacao={cotacao} podePedir={podePedir} />
        </>
      )}

      {rascunho && painel !== "cotar" && (
        <Navegacao atual={painel} feito={feito} onIr={setPainel} />
      )}
    </div>
  );
}

// ── Trilho do rascunho ──────────────────────────────────────

function Trilho({
  atual,
  feito,
  onIr,
  onCatalogo,
  noCatalogo,
}: {
  atual: Painel;
  feito: Record<Painel, boolean>;
  onIr: (p: Painel) => void;
  onCatalogo: () => void;
  noCatalogo: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {PASSOS.map((p, i) => {
          const ativo = atual === p.id;
          const concluido = feito[p.id];
          return (
            <li key={p.id} className="flex items-center">
              {i > 0 && <span aria-hidden className="mx-1 h-px w-4 bg-line sm:w-6" />}
              <button
                type="button"
                onClick={() => onIr(p.id)}
                aria-current={ativo ? "step" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors",
                  ativo ? "bg-brand-soft text-brand" : "text-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold",
                    ativo
                      ? "bg-brand text-on-brand"
                      : concluido
                        ? "bg-ok-soft text-ok"
                        : "bg-surface-2 text-faint",
                  )}
                >
                  {concluido && !ativo ? <Check size={13} /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{p.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={onCatalogo}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
          noCatalogo ? "bg-accent-soft text-accent" : "text-muted hover:text-ink",
        )}
      >
        <Tag size={14} />
        Preços do catálogo
      </button>
    </div>
  );
}

/** Rodapé do trilho: avança e volta sem obrigar a mirar no passo certo. */
function Navegacao({
  atual,
  feito,
  onIr,
}: {
  atual: Painel;
  feito: Record<Painel, boolean>;
  onIr: (p: Painel) => void;
}) {
  const i = PASSOS.findIndex((p) => p.id === atual);
  if (i === -1) return null;
  const anterior = PASSOS[i - 1];
  const proximo = PASSOS[i + 1];
  if (!proximo) return null;

  const bloqueio = !feito[atual]
    ? atual === "itens"
      ? "Adicione ao menos um produto para continuar."
      : "Convide ao menos um fornecedor para continuar."
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      {anterior ? (
        <button
          type="button"
          onClick={() => onIr(anterior.id)}
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Voltar
        </button>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-3">
        {bloqueio && <span className="text-[12px] text-muted">{bloqueio}</span>}
        <button
          type="button"
          onClick={() => onIr(proximo.id)}
          disabled={!!bloqueio}
          className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

// ── Cabeçalho da compra ─────────────────────────────────────

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

  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA").length;
  const recusados = cotacao.convites.filter((c) => c.status === "RECUSADA").length;
  const rotulo = statusVisivel(
    cotacao.status,
    cotacao.convites.length,
    respondidos,
    recusados,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/cotacoes"
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
                  rotulo.classe,
                )}
              >
                {rotulo.label}
              </span>
            </div>
            <h2 className="truncate font-display text-[19px] font-semibold leading-tight text-ink">
              {cotacao.titulo}
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              Entrega em {cotacao.siteNome}
              {prazo && ` · resposta até ${prazo}`}
              {cotacao.status === "ABERTA" &&
                ` · ${andamento(cotacao.convites.length, respondidos)}`}
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
                href="/pedidos"
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
