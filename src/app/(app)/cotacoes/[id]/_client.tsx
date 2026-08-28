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
  Lock,
  MoreHorizontal,
  Trash2,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import type { CotacaoAnterior, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import {
  cancelarCotacaoAction,
  descartarSeVaziaAction,
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
import { andamento, statusVisivel } from "../_status";

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
  pedidos,
  anterior,
  podePedir,
  usaMinimo,
}: {
  cotacao: CotacaoDetalhe;
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
      />

      {pedidos.length > 0 && <VirouPedido pedidos={pedidos} />}

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

// ── A cotação virou pedido ──────────────────────────────────
// Primeira coisa da tela depois das abas, e em todas elas: quem abre uma
// cotação decidida está atrás de uma pergunta só — "em que pedido isso foi
// parar?". O número do pedido é a resposta, então ele é o que está em
// destaque, não o aviso em volta.

function VirouPedido({ pedidos }: { pedidos: PedidoDaCotacao[] }) {
  return (
    <section
      aria-label="Pedidos gerados por esta cotação"
      className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-ok/40 bg-ok-soft px-4 py-3"
    >
      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ok">
        <CheckCheck size={15} className="mt-0.5 shrink-0" />
        <span>
          Esta cotação já virou {pedidos.length === 1 ? "pedido de compra" : "pedidos de compra"}.
          Acompanhe o resto em Pedidos.
        </span>
      </p>
      <ul className="flex flex-wrap gap-2">
        {pedidos.map((p) => (
          <li key={p.id}>
            <Link
              href={`/pedidos?pedido=${p.id}`}
              className="flex items-center gap-2 rounded-full border border-ok/30 bg-surface px-3 py-1.5 transition-colors hover:bg-surface-2"
            >
              <span className="font-mono text-[14px] font-semibold text-ink">{p.numero}</span>
              <span className="max-w-[12rem] truncate text-[12px] text-muted">
                {p.supplierNome}
              </span>
              <ArrowUpRight size={13} className="shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Cabeçalho da compra ─────────────────────────────────────

function Cabecalho({
  cotacao,
  podePedir,
  multiSite,
  rascunho,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
  multiSite: boolean;
  /**
   * Em rascunho o cabeçalho da PÁGINA é este, e só este. O nome, a loja e o
   * prazo que ele mostraria são campos editáveis logo abaixo — repetir aqui
   * dava dois títulos empilhados dizendo a mesma coisa, um deles desatualizado
   * enquanto a pessoa digita.
   */
  rascunho: boolean;
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
    null | "encerrar" | "reabrir" | "cancelar" | "excluir"
  >(null);

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
      titulo: "Encerrar a cotação",
      texto:
        "Os links param de aceitar resposta na hora — quem estiver preenchendo perde o que digitou. Você continua podendo comparar e gerar pedidos, e dá para reabrir depois.",
      acao: "Encerrar",
      perigo: false,
      executar: () => encerrarCotacaoAction(cotacao.id),
    },
    reabrir: {
      titulo: "Reabrir a cotação",
      texto:
        "Os fornecedores voltam a poder responder pelos links que já receberam. As respostas que já entraram continuam valendo.",
      acao: "Reabrir",
      perigo: false,
      executar: () => reabrirCotacaoAction(cotacao.id),
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
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    rotulo.classe,
                  )}
                >
                  {rotulo.label}
                </span>
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
                Confira as informações, itens e fornecedores antes de criar a cotação.
              </p>
            ) : (
              /* Andamento e prazo são as duas perguntas do topo — "quanto já
                 voltou" e "quanto tempo resta". Ficavam numa frase corrida com
                 a loja, todas no mesmo cinza: o prazo vencido lia igual ao
                 nome da filial. Agora o andamento tem barra e o prazo tem cor
                 quando vira ação. */
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
                {cotacao.convites.length > 0 && (
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-1 w-16 overflow-hidden rounded-full bg-surface-2"
                    >
                      <span
                        className="block h-full rounded-full bg-ok transition-[width]"
                        style={{
                          width: `${Math.round((respondidos / cotacao.convites.length) * 100)}%`,
                        }}
                      />
                    </span>
                    {andamento(cotacao.convites.length, respondidos)}
                  </span>
                )}

                {prazo && (
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
              </div>
            )}
          </div>
        </div>

        {/* ENCERRAR e CANCELAR não são o objetivo de quem abre esta tela — são
            saídas de emergência, e como botões no topo competiam com a decisão
            de compra, que é a ação de verdade e mora no rodapé da comparação.
            Foram para o menu. O único botão que sobra é o da cotação já
            decidida, quando o trabalho aqui acabou e o próximo passo é o
            pedido. */}
        {podePedir && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {cotacao.status === "DECIDIDA" && (
              <Link
                href="/pedidos"
                className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                <CheckCheck size={14} />
                Ver pedidos gerados
              </Link>
            )}

            {(cotacao.status === "RASCUNHO" ||
              cotacao.status === "ABERTA" ||
              cotacao.status === "ENCERRADA") && (
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
                {cotacao.status === "ABERTA" && (
                  <MenuItem icon={<Lock size={14} />} onClick={() => setConfirmar("encerrar")}>
                    Encerrar cotação
                  </MenuItem>
                )}
                {cotacao.status === "ENCERRADA" && (
                  <MenuItem icon={<Unlock size={14} />} onClick={() => setConfirmar("reabrir")}>
                    Reabrir cotação
                  </MenuItem>
                )}
                {/* Rascunho apaga; enviada em diante, cancela. São ações
                    diferentes e o rótulo diz qual é — "Cancelar" numa cotação
                    que nunca saiu prometia um rastro que não faz falta. */}
                <MenuItem
                  danger
                  icon={rascunho ? <Trash2 size={14} /> : <Ban size={14} />}
                  onClick={() => setConfirmar(rascunho ? "excluir" : "cancelar")}
                >
                  {rascunho ? "Excluir rascunho" : "Cancelar cotação"}
                </MenuItem>
              </Menu>
            )}
          </div>
        )}
      </div>

      {/* Em rascunho o recado é campo editável na tela — mostrá-lo aqui também
          era o mesmo texto duas vezes, e o de cima congelado. */}
      {cotacao.observacao && !rascunho && (
        <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2 text-[13px] text-ink-2">
          {cotacao.observacao}
        </p>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

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
