"use client";

import { useState } from "react";
import { Inbox, Send } from "lucide-react";
import type { ConviteCotacao, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import { ItensCotacao } from "./_itens";
import { ConvitesCotacao } from "./_convites";
import { ComparativoCotacao } from "./_comparativo";

// ── Acompanhamento da cotação ───────────────────────────────
// Dois momentos, duas telas enxutas — a fase vem do status:
//
//   ABERTA      → RECEBENDO: faixa de fornecedores + tabela SÓ LEITURA. Nada
//                 de escolha nem estratégia: o trabalho é esperar e cobrar.
//   ENCERRADA   → DECIDINDO ("Em decisão"): os links estão fechados, a tabela
//                 vira seleção, "Como comprar" aparece e o rodapé conclui.
//   DECIDIDA /  → leitura, como em RECEBENDO.
//   CANCELADA
//
// O botão "Decidir compra" do cabeçalho é a passagem de um para o outro.
// Chip e coluna compartilham o destaque: passar o mouse num acende o outro.

export type FaseCotacao = "recebendo" | "decidindo";

export function AcompanhamentoCotacao({
  referencias,
  cotacao,
  fornecedores,
  resumo,
  editavel,
  podePedir,
  podeConvidar,
  podeRemover,
  itensEditaveis,
  itensTravados,
  usaMinimo,
  onCobrar,
}: {
  /** Último preço de cada fornecedor por produto (variação no tooltip). */
  referencias: Record<string, number>;
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  resumo: ResumoCotacao;
  editavel: boolean;
  podePedir: boolean;
  podeConvidar: boolean;
  podeRemover: boolean;
  itensEditaveis: boolean;
  itensTravados: string | null;
  usaMinimo: boolean;
  /** Cobrar quem não respondeu abre a central de envio, que mora na página. */
  onCobrar: (alvos: ConviteCotacao[]) => void;
}) {
  const [destaque, setDestaque] = useState<string | null>(null);
  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA");
  const aguardando = cotacao.convites.filter((c) => c.status === "ENVIADA");
  const recusados = cotacao.convites.filter((c) => c.status === "RECUSADA");
  const fase: FaseCotacao = cotacao.status === "ENCERRADA" ? "decidindo" : "recebendo";

  return (
    <div className="flex flex-col gap-3">
      <ConvitesCotacao
        cotacao={cotacao}
        fornecedores={fornecedores}
        editavel={editavel}
        podeConvidar={podeConvidar}
        podeRemover={podeRemover}
        variante="chips"
        destaque={destaque}
        onDestaque={setDestaque}
      />

      {respondidos.length === 0 ? (
        <SemRespostas
          cotacao={cotacao}
          enviados={aguardando.length}
          recusados={recusados.length}
          itensEditaveis={itensEditaveis}
          itensTravados={itensTravados}
          usaMinimo={usaMinimo}
          onCobrar={
            podePedir && cotacao.status === "ABERTA" ? () => onCobrar(aguardando) : undefined
          }
        />
      ) : (
        <ComparativoCotacao
          cotacao={cotacao}
          resumo={resumo}
          podePedir={podePedir && fase === "decidindo"}
          referencias={referencias}
          fase={fase}
          destaque={destaque}
          onDestaque={setDestaque}
        />
      )}
    </div>
  );
}

// ── Ainda sem proposta ──────────────────────────────────────
// O comparativo vazio não é uma tabela sem linhas: é um momento com uma ação
// própria. Mostrar a matriz em branco faria o operador achar que a tela
// quebrou — e não diria o que fazer enquanto ninguém responde.

function SemRespostas({
  cotacao,
  enviados,
  recusados,
  itensEditaveis,
  itensTravados,
  usaMinimo,
  onCobrar,
}: {
  cotacao: CotacaoDetalhe;
  enviados: number;
  recusados: number;
  itensEditaveis: boolean;
  itensTravados: string | null;
  usaMinimo: boolean;
  onCobrar?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-line bg-surface px-6 py-8 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted">
          <Inbox size={20} />
        </span>
        <p className="font-display text-[15px] font-semibold text-ink">
          Nenhuma proposta ainda
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted">
          {enviados > 0
            ? `${enviados} ${enviados === 1 ? "fornecedor recebeu" : "fornecedores receberam"} a lista e ainda ${enviados === 1 ? "não respondeu" : "não responderam"}. O comparativo aparece aqui assim que o primeiro preço chegar.`
            : recusados > 0
              ? "Quem foi convidado recusou cotar. Convide outro fornecedor para a disputa começar."
              : "Assim que alguém responder, o comparativo de preços aparece aqui."}
        </p>
        {onCobrar && enviados > 0 && (
          <button
            type="button"
            onClick={onCobrar}
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Send size={14} />
            Cobrar quem está devendo
          </button>
        )}
      </div>

      {/* A lista COMPLETA, e editável enquanto a régua deixar.
          Este é o único momento em que ela não está na tela: sem resposta não
          há tabela. E é justamente quando ainda dá para mexer nela — a lista
          congela na primeira proposta, que é quando o comparativo assume o
          papel de mostrá-la. */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
          O que foi perguntado
        </p>
        <ItensCotacao
          cotacao={cotacao}
          editavel={itensEditaveis}
          travado={itensTravados}
          usaMinimo={usaMinimo}
        />
      </div>
    </div>
  );
}
