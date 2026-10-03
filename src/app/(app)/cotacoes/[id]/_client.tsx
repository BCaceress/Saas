"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CalendarClock,
  CheckCheck,
  Copy,
  Gavel,
  History,
  MoreHorizontal,
  Repeat,
  Send,
  Trash2,
  Undo2,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import type { CotacaoAnterior, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import {
  cancelarCotacaoAction,
  descartarSeVaziaAction,
  duplicarCotacaoAction,
  encerrarCotacaoAction,
  excluirCotacaoAction,
  reabrirCotacaoAction,
} from "../_compra-actions";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import { regrasDaCotacao } from "@/lib/compras/cotacao-regras";
import { EnviosSheet } from "./_convites";
import { EnvioSheet } from "./_envio";
import { AcompanhamentoCotacao } from "./_acompanhamento";
import { RevisarCotacao } from "./_revisar";
import type { PedidoDaCotacao } from "@/lib/compras/cotacao-economia";
import type { Envio } from "../_compra-actions";
import { statusVisivel } from "../_status";
import type { EventoCotacao } from "@/lib/compras/cotacao-linha-do-tempo";
import { HistoricoSheet } from "./_linha-do-tempo";
import { TrilhaEtapas } from "./_trilha";
import { etapasDaCotacao } from "../_etapas";
import { EnvioPedidoSheet } from "@/components/app/envio-pedido";
import { descreverRecorrencia, RecorrenciaSheet } from "./_recorrencia";

// ── Cotação, tela inteira ───────────────────────────────────
// A tela tem duas caras, porque o trabalho é outro antes e depois do envio.
//
// RASCUNHO → TELA ÚNICA. Montar a cotação é uma coisa só: as condições, a
// lista e quem recebe cabem juntas e se conferem umas contra as outras. O
// trilho de três passos que existia aqui obrigava o operador a guardar de
// cabeça o que tinha visto no passo anterior para decidir no seguinte.
//
// Enviada em diante → ACOMPANHAMENTO. Também uma tela só, mas com outro
// centro: o comparativo, que é a razão de a cotação existir e que antes ficava
// escondido atrás de uma aba, valendo o mesmo que a lista de produtos.

export function CotacaoDetalheClient({
  cotacao,
  fornecedores,
  sites,
  resumo,
  referencias,
  linhaDoTempo,
  pedidos,
  anterior,
  podePedir,
  usaMinimo,
}: {
  cotacao: CotacaoDetalhe;
  /** Último preço de cada fornecedor por produto (▲▼ do comparativo). */
  referencias: Record<string, number>;
  /** Tudo o que aconteceu com a cotação, mais recente primeiro. */
  linhaDoTempo: EventoCotacao[];
  fornecedores: FornecedorOpcao[];
  /** Lojas ativas: com uma só, o nome dela não informa nada e some da tela. */
  sites: { id: string; nome: string }[];
  resumo: ResumoCotacao;
  /** Pedidos que a cotação virou. Vazio até ela ser decidida. */
  pedidos: PedidoDaCotacao[];
  /** Molde para o estado vazio da lista. Null quando não há histórico. */
  anterior: CotacaoAnterior | null;
  podePedir: boolean;
  usaMinimo: boolean;
}) {
  const rascunho = cotacao.status === "RASCUNHO";
  /**
   * Central de envio, aberta a partir da revisão.
   *
   * Mora AQUI, e não dentro da revisão, porque o primeiro envio confirmado
   * muda a cotação de RASCUNHO para ABERTA — a revisão desmonta e a página
   * troca para as abas. Com o painel lá dentro, ele sumia no meio da fila,
   * com metade dos fornecedores por mandar.
   *
   * Os alvos são congelados na abertura pelo mesmo motivo: depois do primeiro
   * "marcar como enviado" eles deixam de estar PENDENTE, e recalcular a lista
   * esvaziaria o painel a cada confirmação.
   */
  const [enviando, setEnviando] = useState<
    { alvos: CotacaoDetalhe["convites"]; reenvio: boolean } | null
  >(null);
  // Cobrar quem não respondeu sai do comparativo, mas a folha com as mensagens
  // prontas é a mesma da aba de fornecedores — ela mora aqui, acima das abas.
  const [envios, setEnvios] = useState<Envio[] | null>(null);

  // Mesma régua que as Server Actions aplicam (`lib/compras/cotacao-regras`):
  // depois da primeira resposta a LISTA congela — mudar o que foi perguntado
  // invalidaria a proposta que já chegou. Fornecedor novo ainda entra; sair da
  // cotação, só antes de ela ter sido enviada.
  const regras = regrasDaCotacao(cotacao.status, cotacao.convites);
  const editavel = podePedir && !regras.fechada;

  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        cotacao={cotacao}
        podePedir={podePedir}
        multiSite={sites.length > 1}
        rascunho={rascunho}
        pedidos={pedidos}
        linhaDoTempo={linhaDoTempo}
      />

      {pedidos.length > 0 && (
        <VirouPedido pedidos={pedidos} concluida={cotacao.status === "DECIDIDA"} />
      )}

      {rascunho ? (
        <RevisarCotacao
          cotacao={cotacao}
          fornecedores={fornecedores}
          sites={sites}
          editavel={editavel}
          podeConvidar={editavel && regras.convidar.pode}
          podeRemover={editavel && regras.desconvidar.pode}
          itensEditaveis={editavel && regras.itens.pode}
          itensTravados={editavel && !regras.itens.pode ? regras.itens.motivo : null}
          usaMinimo={usaMinimo}
          anterior={anterior}
          onEnviar={(alvos) => setEnviando({ alvos, reenvio: false })}
        />
      ) : (
        <AcompanhamentoCotacao
          referencias={referencias}
          cotacao={cotacao}
          fornecedores={fornecedores}
          resumo={resumo}
          editavel={editavel}
          podePedir={podePedir}
          podeConvidar={editavel && regras.convidar.pode}
          podeRemover={editavel && regras.desconvidar.pode}
          itensEditaveis={editavel && regras.itens.pode}
          itensTravados={editavel && !regras.itens.pode ? regras.itens.motivo : null}
          usaMinimo={usaMinimo}
          onCobrar={(alvos) => setEnviando({ alvos, reenvio: true })}
        />
      )}

      {enviando && (
        <EnvioSheet
          alvos={enviando.alvos}
          reenvio={enviando.reenvio}
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setEnviando(null)}
          onConcluir={() => setEnviando(null)}
        />
      )}

      {envios && <EnviosSheet envios={envios} onFechar={() => setEnvios(null)} />}
    </div>
  );
}

// ── Compra definida: os pedidos que nasceram daqui ──────────
// Primeira coisa da tela, em todas as abas: quem abre uma cotação concluída
// está atrás de uma pergunta só — "em que pedido isso foi parar, e ele já
// saiu?". As duas metades da resposta ficam na mesma linha: o número do pedido
// e o estado dele.
//
// O aviso de que NADA foi enviado é o ponto do painel. O erro caro deste fluxo
// é o operador achar que concluir a cotação avisou o fornecedor, ficar
// esperando a mercadoria e descobrir na sexta que o pedido dormiu em rascunho.
// Por isso o recado aparece enquanto existir rascunho, e some sozinho quando
// todo mundo já foi enviado.

/** Como o rascunho se distingue do que já saiu, sem abrir o pedido. */
const ROTULO_PEDIDO: Record<string, { label: string; classe: string }> = {
  RASCUNHO: { label: "Rascunho", classe: "bg-surface-2 text-muted" },
  ENVIADO: { label: "Enviado", classe: "bg-brand-soft text-brand" },
  AGUARDANDO: { label: "Confirmado", classe: "bg-accent-soft text-accent" },
  EM_TRANSITO: { label: "Em trânsito", classe: "bg-accent-soft text-accent" },
  RECEBIDO_PARCIAL: { label: "Recebido em parte", classe: "bg-accent-soft text-accent" },
  RECEBIDO: { label: "Concluído", classe: "bg-ok-soft text-ok" },
  CANCELADO: { label: "Cancelado", classe: "bg-surface-2 text-faint" },
};

const money = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function VirouPedido({
  pedidos,
  concluida,
}: {
  pedidos: PedidoDaCotacao[];
  /** Falso quando a cotação foi reaberta e os pedidos ficaram para trás. */
  concluida: boolean;
}) {
  const rascunhos = pedidos.filter((p) => p.status === "RASCUNHO");
  const [enviando, setEnviando] = useState<string[] | null>(null);

  // Uma linha por pedido: número, estado, fornecedor, valor e a ação. O que
  // antes era um painel verde de 150px vira uma lista que cabe no olhar.
  return (
    <section id="pedidos-gerados" aria-label="Pedidos gerados por esta cotação">
      {!concluida && (
        <p className="mb-1.5 text-[12px] text-accent">
          Cotação reaberta — {pedidos.length === 1 ? "o pedido abaixo continua" : "os pedidos abaixo continuam"}{" "}
          valendo e não mudam com o que você alterar aqui.
        </p>
      )}
      <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface">
        {pedidos.map((p) => {
          const rotulo = ROTULO_PEDIDO[p.status] ?? { label: p.status, classe: "bg-surface-2 text-muted" };
          const rascunho = p.status === "RASCUNHO";
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <CheckCheck size={15} className={cn("shrink-0", rascunho ? "text-accent" : "text-ok")} aria-hidden />
              <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  rascunho ? "bg-accent-soft text-accent" : rotulo.classe,
                )}
              >
                {rascunho ? "Não enviado" : rotulo.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                {p.supplierNome} · {p.itens} {p.itens === 1 ? "item" : "itens"} ·{" "}
                <span className="font-mono tabular-nums text-ink-2">{money(p.valorTotal)}</span>
              </span>
              {rascunho && (
                <button
                  type="button"
                  onClick={() => setEnviando([p.id])}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  <Send size={12} className="shrink-0" />
                  Enviar
                </button>
              )}
              <Link
                href={`/pedidos?pedido=${p.id}`}
                className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {rascunho ? "Revisar" : "Ver"}
                <ArrowUpRight size={12} className="shrink-0" />
              </Link>
            </li>
          );
        })}
        {rascunhos.length > 1 && (
          <li className="flex justify-end px-3 py-1.5">
            <button
              type="button"
              onClick={() => setEnviando(rascunhos.map((p) => p.id))}
              className="text-[12px] font-semibold text-brand underline-offset-4 hover:underline"
            >
              Enviar os {rascunhos.length} pedidos
            </button>
          </li>
        )}
      </ul>

      {enviando && <EnvioPedidoSheet pedidoIds={enviando} onFechar={() => setEnviando(null)} />}
    </section>
  );
}

// ── Cabeçalho da compra ─────────────────────────────────────

function Cabecalho({
  cotacao,
  podePedir,
  multiSite,
  rascunho,
  pedidos,
  linhaDoTempo,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
  multiSite: boolean;
  /** Eventos da gaveta "Histórico". */
  linhaDoTempo: EventoCotacao[];
  /**
   * Em rascunho o cabeçalho da PÁGINA é este, e só este. O nome, a loja e o
   * prazo que ele mostraria são campos editáveis logo abaixo — repetir aqui
   * dava dois títulos empilhados dizendo a mesma coisa, um deles desatualizado
   * enquanto a pessoa digita.
   */
  rascunho: boolean;
  /** Pedidos já gerados — o que a reabertura precisa avisar antes de rodar. */
  pedidos: PedidoDaCotacao[];
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Encerrar, reabrir e cancelar mudam o que o FORNECEDOR vê do outro lado —
   * encerrar fecha o link no meio do preenchimento dele, cancelar mata a
   * cotação inteira. Clique solto em botão de barra não pode disparar isso.
   */
  const [confirmar, setConfirmar] = useState<
    null | "encerrar" | "reabrir" | "cancelar" | "excluir" | "duplicar"
  >(null);
  const [repetindo, setRepetindo] = useState(false);
  const [historico, setHistorico] = useState(false);
  const podeRepetir =
    cotacao.status !== "CANCELADA" && cotacao.itens.length > 0 && cotacao.convites.length > 0;

  const concluida = cotacao.status === "DECIDIDA";
  const recebendo = cotacao.status === "ABERTA";
  const emDecisao = cotacao.status === "ENCERRADA";
  const respondidosN = cotacao.convites.filter((c) => c.status === "RESPONDIDA").length;
  /** Convidados que ainda podem responder — o que "decidir agora" corta. */
  const faltam = cotacao.convites.filter(
    (c) => c.status === "ENVIADA" || c.status === "PENDENTE",
  ).length;
  const rascunhosPendurados = pedidos.filter((p) => p.status === "RASCUNHO");
  const pedidosVivos = pedidos.filter((p) => p.status !== "CANCELADO");

  /**
   * O que a reabertura precisa dizer, e que muda conforme o que já existe.
   *
   * Sem pedido é uma volta barata: a cotação só volta a aceitar resposta. COM
   * pedido é outra conversa — o pedido não acompanha a mudança, e o operador
   * precisa saber disso ANTES, porque quase sempre o que ele queria era editar
   * o pedido (comprar 8 em vez de 10), não refazer a negociação.
   */
  const textoReabrir = concluida
    ? [
        "A cotação volta para o estado de conversa e os fornecedores podem responder de novo.",
        pedidosVivos.length > 0
          ? `Esta cotação já ${pedidosVivos.length === 1 ? "gerou o pedido" : "gerou os pedidos"} ${pedidosVivos.map((p) => p.numero).join(", ")}. ${pedidosVivos.length === 1 ? "Ele continua valendo e NÃO será atualizado" : "Eles continuam valendo e NÃO serão atualizados"} automaticamente com o que você mudar aqui.`
          : null,
        rascunhosPendurados.length > 0
          ? "Se o que você quer é só mudar quantidade, preço ou itens da compra, o lugar é o rascunho do pedido — não a cotação."
          : null,
        "Nenhuma resposta de fornecedor é apagada.",
      ]
        .filter(Boolean)
        .join(" ")
    : "Os fornecedores voltam a poder responder pelos links que já receberam. As respostas que já entraram continuam valendo.";

  const CONFIRMACOES = {
    /**
     * Rascunho não se cancela: apaga.
     *
     * Cancelar existe para deixar rastro de uma promessa feita a fornecedor —
     * e rascunho nunca saiu daqui. Deixar uma linha "Cancelada" na lista por
     * uma cotação que ninguém do lado de fora viu só suja o histórico que o
     * comprador usa para achar as de verdade.
     */
    excluir: {
      titulo: "Excluir o rascunho",
      texto:
        "A cotação é apagada de vez, com a lista de produtos e os fornecedores escolhidos. Nenhum fornecedor foi avisado dela, então não fica rastro — e isso não se desfaz.",
      acao: "Excluir rascunho",
      perigo: true,
      executar: () => excluirCotacaoAction(cotacao.id),
    },
    encerrar: {
      titulo: "Decidir a compra agora?",
      texto: `${faltam} ${faltam === 1 ? "fornecedor ainda não respondeu" : "fornecedores ainda não responderam"}. Ao decidir, os links fecham e ninguém mais manda proposta. Se mudar de ideia, dá para voltar a receber.`,
      acao: "Decidir agora",
      perigo: false,
      executar: () => encerrarCotacaoAction(cotacao.id),
    },
    reabrir: {
      titulo: concluida ? "Reabrir esta cotação?" : "Voltar a receber propostas?",
      texto: concluida
        ? textoReabrir
        : "Os links voltam a aceitar proposta e a tabela volta a ser só de leitura. As escolhas que você marcou não são guardadas.",
      acao: concluida ? "Reabrir cotação" : "Voltar a receber",
      perigo: false,
      executar: () => reabrirCotacaoAction(cotacao.id),
    },
    /**
     * O caminho honesto para "quero cotar outra lista": em vez de mexer numa
     * negociação já respondida, pergunta de novo. Copia a PERGUNTA, nunca as
     * respostas — quem faz isso é `duplicarCotacaoAction`.
     */
    duplicar: {
      titulo: "Duplicar a cotação",
      texto:
        "Uma cotação nova nasce em rascunho com os mesmos produtos e os mesmos fornecedores. Os preços não vêm junto — cada rodada tem os seus. Esta cotação e os pedidos dela ficam como estão.",
      acao: "Duplicar",
      perigo: false,
      executar: async () => {
        const nova = await duplicarCotacaoAction(cotacao.id);
        router.push(`/cotacoes/${nova.id}`);
      },
    },
    cancelar: {
      titulo: "Cancelar a cotação",
      texto:
        "A cotação sai do fluxo e os links deixam de funcionar. O histórico e as respostas ficam guardados, mas ela não vira pedido — e isso não se desfaz.",
      acao: "Cancelar cotação",
      perigo: true,
      executar: () => cancelarCotacaoAction(cotacao.id),
    },
  } as const;

  function rodar(fn: () => Promise<unknown>, sair = false) {
    setErro(null);
    startTransition(async () => {
      try {
        await fn();
        setConfirmar(null);
        // Apagou: não há para onde recarregar — a cotação não existe mais.
        if (sair) router.push("/cotacoes");
        else router.refresh();
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
  const vazia =
    cotacao.status === "RASCUNHO" &&
    cotacao.itens.length === 0 &&
    cotacao.convites.length === 0;
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
          {/* Sair de um rascunho que ninguém preencheu APAGA o rascunho: um
              toque em "Nova cotação" que não virou nada não deveria virar linha
              na lista de amanhã. */}
          {vazia ? (
            <button
              type="button"
              onClick={() => {
                void descartarSeVaziaAction(cotacao.id).finally(() => {
                  router.push("/cotacoes");
                });
              }}
              aria-label="Voltar para as cotações"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ArrowLeft size={17} />
            </button>
          ) : (
            <Link
              href="/cotacoes"
              aria-label="Voltar para as cotações"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ArrowLeft size={17} />
            </Link>
          )}

          <div className="min-w-0">
            {/* Em rascunho o número entra no próprio título e o badge de status
                vive no card de baixo, alinhado ao "Cotação de compra" — a
                sobrancelha aqui era uma terceira linha para duas informações
                que cabem onde já se está olhando. */}
            {!rascunho && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-semibold text-muted">
                  {cotacao.numero}
                </span>
                {/* A trilha diz o andamento; o selo só aparece quando a
                    cotação saiu do caminho (cancelada). */}
                {cotacao.status === "CANCELADA" && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      rotulo.classe,
                    )}
                  >
                    {rotulo.label}
                  </span>
                )}
              </div>
            )}
            <h2 className="truncate font-display text-[19px] font-semibold leading-tight text-ink">
              {rascunho ? (
                <>
                  Revisão da cotação{" "}
                  <span className="font-mono text-[15px] font-semibold text-muted">
                    ({cotacao.numero})
                  </span>
                </>
              ) : (
                cotacao.titulo
              )}
            </h2>

            {rascunho ? (
              <p className="mt-0.5 truncate text-[13px] text-muted">
                {cotacao.geradaPorRecorrencia ? (
                  <span className="inline-flex items-center gap-1 text-brand">
                    <Repeat size={13} className="shrink-0" />
                    Montada pela repetição programada — confira as quantidades e envie.
                  </span>
                ) : (
                  "Confira as informações, itens e fornecedores antes de criar a cotação."
                )}
              </p>
            ) : (
              /* Andamento e prazo são as duas perguntas do topo — "quanto já
                 voltou" e "quanto tempo resta". Ficavam numa frase corrida com
                 a loja, todas no mesmo cinza: o prazo vencido lia igual ao
                 nome da filial. Agora o andamento tem barra e o prazo tem cor
                 quando vira ação. */
              <>
              {cotacao.status !== "CANCELADA" && (
                <div className="mt-2">
                  <TrilhaEtapas
                    etapas={etapasDaCotacao(cotacao.status, cotacao.convites, pedidos)}
                  />
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">

                {/* Prazo só importa enquanto os links aceitam proposta. */}
                {prazo && recebendo && (
                  <span
                    className={cn(
                      "flex items-center gap-1.5",
                      diasAte(cotacao.prazoResposta) !== null &&
                        diasAte(cotacao.prazoResposta)! < 0
                        ? "text-danger"
                        : diasAte(cotacao.prazoResposta) !== null &&
                            diasAte(cotacao.prazoResposta)! <= 1
                          ? "text-accent"
                          : undefined,
                    )}
                  >
                    <CalendarClock size={13} className="shrink-0" />
                    {rotuloPrazo(prazo, diasAte(cotacao.prazoResposta))}
                  </span>
                )}

                {multiSite && <span>Entrega em {cotacao.siteNome}</span>}

                {cotacao.recorrencia && (
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      cotacao.recorrencia.ativo ? "text-brand" : "text-faint",
                    )}
                  >
                    <Repeat size={13} className="shrink-0" />
                    {cotacao.recorrencia.ativo
                      ? `Repete ${descreverRecorrencia(cotacao.recorrencia)}`
                      : "Repetição pausada"}
                  </span>
                )}
                {cotacao.geradaPorRecorrencia && (
                  <span className="flex items-center gap-1">
                    <Repeat size={13} className="shrink-0" />
                    Montada pela repetição
                  </span>
                )}
              </div>
              </>
            )}
          </div>
        </div>

        {/* ENCERRAR, REABRIR e CANCELAR não são o objetivo de quem abre esta
            tela — são mudanças de estado, e como botões no topo competiam com a
            decisão de compra, que é a ação de verdade e mora no rodapé da
            comparação. Foram para o menu. O único botão que sobra é o da
            cotação já concluída, quando o trabalho aqui acabou e o próximo
            passo é o pedido. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!rascunho && linhaDoTempo.length > 0 && (
            <button
              type="button"
              onClick={() => setHistorico(true)}
              className="flex h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <History size={15} />
              Histórico
            </button>
          )}
        {podePedir && cotacao.status !== "CANCELADA" && (
          <>
            {/* Concluída, o próximo passo não está mais nesta tela: está no
                pedido em rascunho, logo abaixo. O botão do topo só empurra o
                olho para lá — mandar para /pedidos, como antes, jogava o
                operador numa lista de vinte pedidos para achar os dois dele. */}
            {/* A passagem entre os dois momentos da tela. "Decidir" fecha as
                respostas (pergunta antes só se ainda falta alguém); "Voltar a
                receber" reabre. */}
            {recebendo && (
              <button
                type="button"
                disabled={pendente || respondidosN === 0}
                title={respondidosN === 0 ? "Espere a primeira proposta para decidir." : undefined}
                onClick={() =>
                  faltam > 0
                    ? setConfirmar("encerrar")
                    : rodar(() => encerrarCotacaoAction(cotacao.id))
                }
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40",
                  respondidosN > 0 && faltam === 0 && "ring-4 ring-brand/20",
                )}
              >
                <Gavel size={15} />
                Decidir compra
              </button>
            )}
            {emDecisao && (
              <button
                type="button"
                disabled={pendente}
                onClick={() => setConfirmar("reabrir")}
                className="flex h-10 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <Undo2 size={15} />
                Voltar a receber
              </button>
            )}

            <Menu
              trigger={
                <button
                  type="button"
                  aria-label="Mais ações da cotação"
                  aria-haspopup="menu"
                  disabled={pendente}
                  className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                >
                  <MoreHorizontal size={17} />
                </button>
              }
            >
              {/* Numa cotação concluída NÃO existe "editar": existe reabrir, e
                  o rótulo diz que é mudança de estado. Editar direto deixaria
                  a decisão registrada e a pergunta mudando por baixo dela. */}
              {concluida && (
                <MenuItem icon={<Unlock size={14} />} onClick={() => setConfirmar("reabrir")}>
                  Reabrir cotação
                </MenuItem>
              )}
              {podeRepetir && (
                <MenuItem icon={<Repeat size={14} />} onClick={() => setRepetindo(true)}>
                  {cotacao.recorrencia ? "Ajustar repetição" : "Repetir toda semana"}
                </MenuItem>
              )}
              {!rascunho && (
                <MenuItem icon={<Copy size={14} />} onClick={() => setConfirmar("duplicar")}>
                  Duplicar cotação
                </MenuItem>
              )}
              {/* Rascunho apaga; enviada em diante, cancela. São ações
                  diferentes e o rótulo diz qual é — "Cancelar" numa cotação
                  que nunca saiu prometia um rastro que não faz falta. E
                  concluída não cancela: o pedido já existe do lado de fora,
                  então o caminho é reabrir ou cancelar o pedido. */}
              {!concluida && (
                <MenuItem
                  danger
                  icon={rascunho ? <Trash2 size={14} /> : <Ban size={14} />}
                  onClick={() => setConfirmar(rascunho ? "excluir" : "cancelar")}
                >
                  {rascunho ? "Excluir rascunho" : "Cancelar cotação"}
                </MenuItem>
              )}
            </Menu>
          </>
        )}
        </div>
      </div>

      {/* Em rascunho o recado é campo editável na tela — mostrá-lo aqui também
          era o mesmo texto duas vezes, e o de cima congelado. */}
      {cotacao.observacao && !rascunho && (
        <p className="truncate pl-[52px] text-[12px] text-muted" title={cotacao.observacao}>
          Recado aos fornecedores: {cotacao.observacao}
        </p>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {historico && (
        <HistoricoSheet
          numero={cotacao.numero}
          eventos={linhaDoTempo}
          onFechar={() => setHistorico(false)}
        />
      )}

      {repetindo && (
        <RecorrenciaSheet
          quotationId={cotacao.id}
          atual={cotacao.recorrencia}
          onFechar={() => setRepetindo(false)}
        />
      )}

      {confirmar && (
        <ConfirmarAcao
          titulo={CONFIRMACOES[confirmar].titulo}
          texto={CONFIRMACOES[confirmar].texto}
          acao={CONFIRMACOES[confirmar].acao}
          perigo={CONFIRMACOES[confirmar].perigo}
          pendente={pendente}
          onFechar={() => setConfirmar(null)}
          onConfirmar={() =>
            rodar(CONFIRMACOES[confirmar].executar, confirmar === "excluir")
          }
        />
      )}
    </div>
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

/** "faltam 3 dias" diz mais que a data — a data sozinha vira conta de cabeça. */
function rotuloPrazo(data: string, dias: number | null): string {
  if (dias === null) return `Resposta até ${data}`;
  if (dias < 0) return `Prazo venceu em ${data}`;
  if (dias === 0) return `Responder até hoje (${data})`;
  if (dias === 1) return `Responder até amanhã (${data})`;
  return `Resposta até ${data} · faltam ${dias} dias`;
}

// ── Confirmação de mudança de estado ────────────────────────

function ConfirmarAcao({
  titulo,
  texto,
  acao,
  perigo,
  pendente,
  onFechar,
  onConfirmar,
}: {
  titulo: string;
  texto: string;
  acao: string;
  perigo: boolean;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-acao-titulo"
        className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
      >
        <h2
          id="confirmar-acao-titulo"
          className="font-display text-[17px] font-semibold text-ink"
        >
          {titulo}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{texto}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={pendente}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold text-on-brand transition-colors disabled:opacity-50",
              perigo ? "bg-danger hover:opacity-90" : "bg-brand hover:bg-brand-strong",
            )}
          >
            {pendente ? "Um instante…" : acao}
          </button>
        </div>
      </div>
    </div>
  );
}
