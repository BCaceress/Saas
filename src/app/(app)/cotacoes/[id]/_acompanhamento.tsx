"use client";

import { useState } from "react";
import { CalendarClock, Clock, Inbox, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConviteCotacao, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import { ItensCotacao } from "./_itens";
import { ConvitesCotacao } from "./_convites";
import { ComparativoCotacao } from "./_comparativo";

// ── Acompanhamento da cotação ───────────────────────────────
// A tela depois do envio. Era três abas — Itens, Fornecedores, Comparativo —
// e o comparativo, que é a única razão de a cotação existir, ficava escondido
// atrás de um clique como se valesse o mesmo que a lista de produtos.
//
// Agora é uma tela só, na ordem da pergunta que o comprador faz ao abrir:
//
//   como está isso? → quanto custa de cada um? → quem falta responder?
//
// A lista de itens NÃO tem bloco próprio: o comparativo já é ela, linha por
// linha. Ela só reaparece antes da primeira resposta, dentro do estado vazio —
// que é quando não existe tabela e ainda dá para mexer no que foi perguntado.

export function AcompanhamentoCotacao({
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
  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA");
  const aguardando = cotacao.convites.filter((c) => c.status === "ENVIADA");
  const recusados = cotacao.convites.filter((c) => c.status === "RECUSADA");
  const decidida = cotacao.status === "DECIDIDA";
  const unidades = cotacao.itens.reduce((n, i) => n + i.quantidade, 0);

  return (
    <div className="flex flex-col gap-4">
      <Andamento
        respondidos={respondidos.length}
        aguardando={aguardando}
        recusados={recusados.length}
        totalItens={cotacao.itens.length}
        unidades={unidades}
        prazo={cotacao.prazoResposta}
        decidida={decidida}
        onCobrar={podePedir && !decidida ? () => onCobrar(aguardando) : undefined}
      />

      {/* 70/30 só a partir de `xl`. O comparativo é uma matriz de itens ×
          fornecedores: abaixo disso ele fica mais legível ocupando a largura
          inteira, com a coluna de acompanhamento embaixo. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-10">
        <div className="order-2 xl:order-1 xl:col-span-7">
          {respondidos.length === 0 ? (
            <SemRespostas
              cotacao={cotacao}
              enviados={aguardando.length}
              recusados={recusados.length}
              itensEditaveis={itensEditaveis}
              itensTravados={itensTravados}
              usaMinimo={usaMinimo}
              onCobrar={podePedir && !decidida ? () => onCobrar(aguardando) : undefined}
            />
          ) : (
            <ComparativoCotacao
              cotacao={cotacao}
              resumo={resumo}
              podePedir={podePedir}
            />
          )}
        </div>

        <div className="order-1 xl:order-2 xl:col-span-3">
          <ConvitesCotacao
            cotacao={cotacao}
            fornecedores={fornecedores}
            editavel={editavel}
            podeConvidar={podeConvidar}
            podeRemover={podeRemover}
            compacto
          />
        </div>
      </div>

      {/* A barra "Itens da cotação" que ficava aqui saiu: o comparativo JÁ é a
          lista de itens — foto, nome, SKU, quantidade e unidade, linha por
          linha. Ela abria uma segunda lista dos mesmos produtos.

          O único momento em que a lista faz falta é antes da primeira
          resposta, quando não existe tabela — e é exatamente onde ela está
          agora, dentro do estado vazio. O tamanho da compra ("5 itens · 8
          unidades") subiu para a faixa de andamento, que é o que ela de fato
          informava sem precisar abrir. */}
    </div>
  );
}

// ── Faixa de andamento ──────────────────────────────────────
// A linha que o comprador lê ao abrir a tela: quantos responderam, quantos
// faltam e quanto tempo resta. Ficava dentro do comparativo, misturada com a
// tabela; aqui ela é o cabeçalho do momento da cotação.
//
// Cobrar quem não respondeu sai daqui — e a compra pode estar sendo fechada
// antes de a melhor proposta chegar, então o aviso não pode ser mudo. Duas
// saídas, as duas legítimas: esperar, ou cobrar agora.

function Andamento({
  respondidos,
  aguardando,
  recusados,
  totalItens,
  unidades,
  prazo,
  decidida,
  onCobrar,
}: {
  respondidos: number;
  aguardando: ConviteCotacao[];
  recusados: number;
  /** O TAMANHO da compra — era o que a barra recolhida informava de fato. */
  totalItens: number;
  unidades: number;
  prazo: string | null;
  decidida: boolean;
  onCobrar?: () => void;
}) {
  /** O operador já disse que vai esperar — o convite para cobrar some. */
  const [quieto, setQuieto] = useState(false);
  const dias = diasAte(prazo);

  return (
    <section
      aria-label="Andamento da cotação"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-2.5"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
        <span className="font-semibold">
          {respondidos} {respondidos === 1 ? "proposta recebida" : "propostas recebidas"}
        </span>
        {aguardando.length > 0 && (
          <span className="text-[12px] text-muted">
            · {aguardando.length} {aguardando.length === 1 ? "aguardando" : "aguardando"}
          </span>
        )}
        {recusados > 0 && (
          <span className="text-[12px] text-muted">
            · {recusados} {recusados === 1 ? "recusou cotar" : "recusaram cotar"}
          </span>
        )}
        <span className="text-[12px] text-faint">
          · {totalItens} {totalItens === 1 ? "item" : "itens"} ·{" "}
          {unidades.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
          {unidades === 1 ? "unidade" : "unidades"}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {prazo && (
          <span
            className={cn(
              "flex items-center gap-1.5 text-[12px]",
              // Vencido ou vencendo hoje é informação de ação, não de leitura.
              dias !== null && dias < 0
                ? "text-danger"
                : dias !== null && dias <= 1
                  ? "text-accent"
                  : "text-muted",
            )}
          >
            <CalendarClock size={13} className="shrink-0" />
            {rotuloPrazo(prazo, dias)}
          </span>
        )}

        {/* Cobrar só faz sentido enquanto alguém deve resposta e a compra não
            foi fechada. Depois disso o botão seria um convite a incomodar
            fornecedor por nada. */}
        {onCobrar && aguardando.length > 0 && !decidida && !quieto && (
          <>
            <button
              type="button"
              onClick={onCobrar}
              className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <Send size={13} />
              Cobrar {aguardando.length}
            </button>
            <button
              type="button"
              onClick={() => setQuieto(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <Clock size={13} />
              Aguardar
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Dias inteiros até o prazo. Negativo = já passou. */
function diasAte(prazo: string | null): number | null {
  if (!prazo) return null;
  const alvo = new Date(prazo);
  const hoje = new Date();
  alvo.setHours(23, 59, 59, 999);
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 864e5) - 1;
}

function rotuloPrazo(prazo: string, dias: number | null): string {
  const data = new Date(prazo).toLocaleDateString("pt-BR");
  if (dias === null) return `Responder até ${data}`;
  if (dias < 0) return `Prazo venceu em ${data}`;
  if (dias === 0) return `Responder até hoje (${data})`;
  if (dias === 1) return `Responder até amanhã (${data})`;
  return `Responder até ${data} · faltam ${dias} dias`;
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
