"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ChevronDown,
  CheckCircle2,
  Circle,
  Eye,
  MoreVertical,
  RotateCcw,
  Send,
  Trash2,
  Users,
  Mail,
  Copy,
  Link as LinkIcon,
  X,
  ThumbsDown,
  PencilLine,
  Layers,
  Loader2,
  Plus,
  Share2,
  Undo2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { mascaraMoeda, paraMascara, paraNumero } from "@/lib/moeda";
import { MAX_FAIXAS_ITEM } from "@/lib/compras/escalas";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import {
  EstadoVazio,
  SupplierAvatar,
  fmtMoney,
  fmtQtd,
  fmtQuando,
  unidadeDaQtd,
} from "../_catalogo/ui";
import { Thumb } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import { ContatoSheet } from "@/components/app/contato-fornecedor";
import { IconeWhatsApp } from "@/components/app/icone-whatsapp";
import { EnvioSheet } from "./_envio";
import type { Envio } from "../_compra-actions";
import {
  convidarFornecedoresAction,
  desfazerRecusaAction,
  mensagemDoConviteAction,
  linkDoConviteAction,
  recusarConviteAction,
  registrarRespostaAction,
  removerConviteAction,
} from "../_compra-actions";

// ── Fornecedores convidados ─────────────────────────────────
// Enviar aqui é dar o recado pronto ao operador: sem gateway de mensageria,
// o sistema monta a mensagem e abre o WhatsApp. A mensagem leva o LINK de
// resposta — o fornecedor preenche os preços lá e a proposta entra sozinha.
// "Registrar resposta" continua existindo para quem responde por áudio, foto
// ou telefone: o link é o caminho curto, não uma exigência.

const STATUS: Record<
  ConviteCotacao["status"],
  { label: string; classe: string }
> = {
  PENDENTE: { label: "Não enviado", classe: "bg-surface-2 text-muted" },
  ENVIADA: { label: "Aguardando", classe: "bg-brand-soft text-brand" },
  RESPONDIDA: { label: "Respondeu", classe: "bg-ok-soft text-ok" },
  RECUSADA: { label: "Recusou", classe: "bg-surface-2 text-faint" },
};

/**
 * "Abriu o link e não respondeu" é um estado próprio — e o mais acionável de
 * todos: quem abriu está avaliando (cobre amanhã), quem não abriu talvez nem
 * tenha recebido a mensagem (reenvie hoje).
 */
function rotulo(c: ConviteCotacao): { label: string; classe: string } {
  if (c.status === "ENVIADA" && c.abertoEm) {
    return { label: "Visualizou", classe: "bg-accent-soft text-accent" };
  }
  return STATUS[c.status];
}

export function ConvitesCotacao({
  cotacao,
  fornecedores,
  editavel,
  podeConvidar,
  podeRemover,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  /** Cotação viva e a pessoa pode comprar: enviar, cobrar, registrar resposta. */
  editavel: boolean;
  /** Chamar mais um para a disputa — vale mesmo depois de respostas chegarem. */
  podeConvidar: boolean;
  /** Tirar alguém da cotação — só em rascunho, antes de o convite existir lá fora. */
  podeRemover: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [respondendo, setRespondendo] = useState<ConviteCotacao | null>(null);
  /** Convite aberto no painel lateral — a ficha de quem é e o que já foi mandado. */
  const [ficha, setFicha] = useState<ConviteCotacao | null>(null);
  /**
   * A faixa nasce FECHADA. Depois do primeiro dia, quem responde já respondeu:
   * o comprador volta a esta tela para mexer na escolha, não para reler a fila
   * de convidados. A linha do cabeçalho ("1 de 4 responderam") é o que ele
   * precisa em 90% das visitas — e as ações de cobrança continuam à vista,
   * fora do que recolhe.
   */
  const [aberto, setAberto] = useState(false);
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);
  const [textoCopiado, setTextoCopiado] = useState<string | null>(null);
  /**
   * Folha de conferência aberta: quem recebe, em qual fornecedor, por onde.
   *
   * Guarda os convites, não um booleano: a mesma folha serve ao "enviar para
   * os 5 pendentes" da barra e ao "enviar a mensagem" de UM fornecedor que
   * entrou depois que os outros já receberam.
   */
  const [enviando, setEnviando] = useState<ConviteCotacao[] | null>(null);
  /** Convite específico em reenvio, ou "todos" para os que não responderam. */
  const [reenviando, setReenviando] = useState<ConviteCotacao | "todos" | null>(null);

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

  const jaConvidados = new Set(cotacao.convites.map((c) => c.supplierId));
  const disponiveis = fornecedores.filter((f) => !jaConvidados.has(f.id));
  const pendentes = cotacao.convites.filter((c) => c.status === "PENDENTE");
  /** Já receberam e não devolveram nada — o alvo natural do reenvio. */
  const aguardando = cotacao.convites.filter((c) => c.status === "ENVIADA");
  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA");
  /** Sem ninguém convidado não há o que recolher: o vazio é a mensagem. */
  const mostrarLista = aberto || cotacao.convites.length === 0;

  return (
    <section
      aria-label="Fornecedores da cotação"
      className="rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3"
    >
      {/* Título e ações de CONJUNTO na mesma linha: mandar para quem não
          recebeu, cobrar quem não voltou, chamar mais um. Por fornecedor,
          tudo está no menu da linha. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={mostrarLista}
          disabled={cotacao.convites.length === 0}
          className="flex cursor-pointer items-center gap-2 text-left transition-colors hover:text-ink disabled:cursor-default"
        >
          <ChevronDown
            size={14}
            className={cn(
              "shrink-0 text-muted transition-transform",
              mostrarLista && "rotate-180",
              cotacao.convites.length === 0 && "invisible",
            )}
            aria-hidden
          />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Fornecedores
          </span>
          {cotacao.convites.length > 0 && (
            <span className="text-[12px] text-muted">
              {respondidos.length} de {cotacao.convites.length}{" "}
              {respondidos.length === 1 ? "respondeu" : "responderam"}
              {aguardando.length > 0 && ` · ${aguardando.length} aguardando`}
            </span>
          )}
        </button>

        {editavel && cotacao.convites.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {aguardando.length > 0 && (
              <button
                type="button"
                onClick={() => setReenviando("todos")}
                className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-brand underline-offset-4 transition-colors hover:underline"
              >
                <RotateCcw size={13} />
                Cobrar {aguardando.length}
              </button>
            )}

            {pendentes.length > 0 && cotacao.itens.length > 0 && (
              <button
                type="button"
                onClick={() => setEnviando(pendentes)}
                disabled={pendente}
                className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-brand underline-offset-4 transition-colors hover:underline disabled:opacity-50"
              >
                <Send size={13} />
                Enviar para {pendentes.length}
              </button>
            )}

            {podeConvidar && (
              <button
                type="button"
                onClick={() => setConvidando(true)}
                disabled={disponiveis.length === 0}
                className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserPlus size={13} />
                {disponiveis.length === 0 ? "Todos convidados" : "Adicionar"}
              </button>
            )}
          </div>
        )}
      </div>

      {erro && <p className="mt-2 text-[13px] text-danger">{erro}</p>}

      {cotacao.convites.length === 0 ? (
        <div className="mt-2">
          <EstadoVazio
            icon={<Users size={20} />}
            titulo="Nenhum fornecedor na cotação"
            descricao="Escolha os fornecedores que vão receber a lista. Quanto mais gente na disputa, melhor o preço."
            acao={
              podeConvidar ? (
                <button
                  type="button"
                  onClick={() => setConvidando(true)}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  Adicionar fornecedores
                </button>
              ) : undefined
            }
          />
        </div>
      ) : !mostrarLista ? null : (
        // UMA LINHA por convidado, em colunas: com seis fornecedores, uma
        // pilha vertical de seis linhas empurra a matriz para baixo da dobra.
        //
        // O TOTAL não aparece aqui de propósito: ele é o cabeçalho da coluna
        // do fornecedor na matriz, logo abaixo. Esta faixa responde "quem já
        // voltou e o que fazer com quem não voltou"; a matriz responde "por
        // quanto". O resto — contato, condições, trilha de envio — mora na
        // ficha lateral, atrás do nome.
        <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {cotacao.convites.map((c) => {
            const respondeu = c.status === "RESPONDIDA";
            const visualizou = c.status === "ENVIADA" && !!c.abertoEm;
            const Icone = respondeu
              ? CheckCircle2
              : c.status === "RECUSADA"
                ? Ban
                : visualizou
                  ? Eye
                  : Circle;
            return (
              <li key={c.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0 sm:[&:nth-last-child(-n+1)]:border-b-0">
                <Icone
                  size={14}
                  className={cn(
                    "shrink-0",
                    respondeu ? "text-ok" : visualizou ? "text-accent" : "text-faint",
                  )}
                  aria-hidden
                />

                {/* O nome é a porta da ficha: histórico de envios, contato e
                    condições do cadastro não cabem na linha e não são a
                    decisão — mas são o que se procura quando alguém some. */}
                <button
                  type="button"
                  onClick={() => setFicha(c)}
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] underline-offset-4 transition-colors hover:underline",
                    respondeu ? "font-medium text-ink" : "text-ink-2",
                  )}
                >
                  {c.supplierNome}
                </button>

                {/* O contexto que a matriz NÃO dá: cobertura de quem respondeu,
                    e há quanto tempo a bola está com quem não respondeu — que é
                    o que decide entre cobrar hoje ou esperar. */}
                <span className="shrink-0 text-[12px] text-muted">
                  {respondeu
                    ? `${c.itensAtendidos}/${cotacao.itens.length} itens`
                    : c.status === "RECUSADA"
                      ? "não vai cotar"
                      : c.status === "PENDENTE"
                        ? "não enviado"
                        : visualizou
                          ? `viu ${fmtQuando(c.abertoEm)}`
                          : `enviado ${fmtQuando(c.enviadaEm)}`}
                </span>

                {editavel && (
                  <Menu
                    trigger={
                      <button
                        type="button"
                        aria-label={`Ações de ${c.supplierNome}`}
                        aria-haspopup="menu"
                        className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <MoreVertical size={15} />
                      </button>
                    }
                  >
                    {cotacao.itens.length > 0 && (
                      <MenuItem icon={<PencilLine size={14} />} onClick={() => setRespondendo(c)}>
                        {respondeu ? "Corrigir preços" : "Registrar resposta"}
                      </MenuItem>
                    )}

                    {c.status === "ENVIADA" && (
                      <MenuItem icon={<RotateCcw size={14} />} onClick={() => setReenviando(c)}>
                        Reenviar
                      </MenuItem>
                    )}

                    {c.status === "PENDENTE" && cotacao.itens.length > 0 && (
                      <MenuItem
                        icon={<Send size={14} />}
                        disabled={pendente}
                        onClick={() => setEnviando([c])}
                      >
                        Enviar a mensagem
                      </MenuItem>
                    )}

                    {/* O texto pronto, com o link dentro — para colar numa
                        conversa que já começou. */}
                    {c.status !== "RECUSADA" && (
                      <MenuItem
                        icon={<Copy size={14} />}
                        disabled={pendente}
                        onClick={() =>
                          rodar(async () => {
                            const { mensagem } = await mensagemDoConviteAction(c.id);
                            if (!(await copiarTexto(mensagem))) {
                              throw new Error("O navegador bloqueou a cópia. Tente pelo WhatsApp.");
                            }
                            setTextoCopiado(c.id);
                          })
                        }
                      >
                        {textoCopiado === c.id ? "Mensagem copiada" : "Copiar mensagem"}
                      </MenuItem>
                    )}

                    {c.status !== "RECUSADA" && (
                      <MenuItem
                        icon={<LinkIcon size={14} />}
                        disabled={pendente}
                        onClick={() =>
                          rodar(async () => {
                            const { url } = await linkDoConviteAction(c.id);
                            if (!(await copiarTexto(url))) {
                              throw new Error(
                                "O navegador bloqueou a cópia. Abra o link e copie da barra de endereço.",
                              );
                            }
                            setLinkCopiado(c.id);
                          })
                        }
                      >
                        {linkCopiado === c.id ? "Link copiado" : "Copiar link"}
                      </MenuItem>
                    )}

                    {(c.status === "ENVIADA" || c.status === "PENDENTE") && (
                      <MenuItem
                        icon={<ThumbsDown size={14} />}
                        disabled={pendente}
                        onClick={() => rodar(() => recusarConviteAction(c.id))}
                      >
                        {'Marcar "Não vai cotar"'}
                      </MenuItem>
                    )}

                    {/* Recusa é o que o COMPRADOR ouviu, e quem digita erra de
                        linha. Voltar atrás devolve o fornecedor à disputa sem
                        perder a trilha de envio nem trocar o link que já está
                        na conversa dele. */}
                    {c.status === "RECUSADA" && (
                      <MenuItem
                        icon={<Undo2 size={14} />}
                        disabled={pendente}
                        onClick={() => rodar(() => desfazerRecusaAction(c.id))}
                      >
                        {'Desfazer "Não vai cotar"'}
                      </MenuItem>
                    )}

                    {podeRemover && (
                      <MenuItem
                        danger
                        icon={<Trash2 size={14} />}
                        disabled={pendente}
                        onClick={() => rodar(() => removerConviteAction(c.id))}
                      >
                        Remover da cotação
                      </MenuItem>
                    )}
                  </Menu>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {ficha && (
        <FichaFornecedor
          convite={ficha}
          totalItens={cotacao.itens.length}
          onFechar={() => setFicha(null)}
        />
      )}

      {convidando && (
        <ConvidarSheet
          disponiveis={disponiveis}
          pendente={pendente}
          onFechar={() => setConvidando(false)}
          onConfirmar={(ids) =>
            rodar(async () => {
              await convidarFornecedoresAction({ quotationId: cotacao.id, supplierIds: ids });
              setConvidando(false);
            })
          }
        />
      )}

      {respondendo && (
        <RespostaSheet
          convite={respondendo}
          numero={cotacao.numero}
          itens={cotacao.itens}
          pedeEscala={cotacao.pedeEscala}
          pendente={pendente}
          onFechar={() => setRespondendo(null)}
          onSalvar={(payload) =>
            rodar(async () => {
              await registrarRespostaAction(payload);
              setRespondendo(null);
            })
          }
        />
      )}

      {enviando && enviando.length > 0 && (
        <EnvioSheet
          alvos={enviando}
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setEnviando(null)}
          onConcluir={() => setEnviando(null)}
        />
      )}

      {reenviando && (
        <EnvioSheet
          alvos={reenviando === "todos" ? aguardando : [reenviando]}
          reenvio
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setReenviando(null)}
          onConcluir={() => setReenviando(null)}
        />
      )}

      {envios && <EnviosSheet envios={envios} onFechar={() => setEnvios(null)} />}
    </section>
  );
}

// ── Ficha do fornecedor ─────────────────────────────────────
// O que saiu da linha, atrás do nome: quem é o contato, o que a proposta dele
// diz, e a trilha inteira de envios com data e hora. É a tela que responde
// "por que este aqui não respondeu?" — e a resposta quase sempre é que a
// mensagem foi para o número errado, ou nunca saiu.

function FichaFornecedor({
  convite: c,
  totalItens,
  onFechar,
}: {
  convite: ConviteCotacao;
  totalItens: number;
  onFechar: () => void;
}) {
  const contatoDoConvite = c.contatoId
    ? (c.contatos.find((x) => x.id === c.contatoId) ?? null)
    : null;
  const respondeu = c.status === "RESPONDIDA";

  return (
    <Sheet open onClose={onFechar} title={c.supplierNome} description={rotulo(c).label} width="md">
      <div className="flex flex-col gap-5">
        {/* A logo é o reconhecimento antes da leitura — o comprador sabe de
            quem é a ficha antes de ler o nome no cabeçalho. Sem logo no
            cadastro, o avatar cai nas iniciais. */}
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{c.supplierNome}</p>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {[c.supplierPraca, rotulo(c).label].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        {/* Quem recebe. Sem isto, "não respondeu" é um mistério: a cotação
            pode ter ido para o e-mail de um vendedor que saiu da empresa. */}
        <Bloco titulo="Contato">
          {c.contatos.length === 0 && !c.telefone && !c.email ? (
            <p className="text-[13px] text-muted">
              Nenhum contato cadastrado — a mensagem sai no telefone da empresa.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.contatos.map((x) => (
                <li key={x.id} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-medium text-ink">{x.nome}</span>
                      {x.cargo && <span className="text-[11px] text-faint">{x.cargo}</span>}
                      {contatoDoConvite?.id === x.id && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                          desta cotação
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                      {x.telefone && <span className="font-mono">{x.telefone}</span>}
                      {x.email && <span className="truncate">{x.email}</span>}
                    </span>
                  </span>
                </li>
              ))}
              {c.contatos.length === 0 && (
                <li className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                  {c.telefone && <span className="font-mono">{c.telefone}</span>}
                  {c.email && <span className="truncate">{c.email}</span>}
                </li>
              )}
            </ul>
          )}
        </Bloco>

        {/* O que o cadastro promete — o que faz a proposta caber ou não. */}
        {(c.supplierPraca || c.supplierPedidoMinimo !== null || c.supplierPrazoPagamentoDias !== null) && (
          <Bloco titulo="Cadastro">
            <dl className="flex flex-col gap-1 text-[13px]">
              {c.supplierPraca && <Linha rotulo="Praça" valor={c.supplierPraca} />}
              {c.supplierPedidoMinimo !== null && (
                <Linha rotulo="Pedido mínimo" valor={fmtMoney(c.supplierPedidoMinimo)} />
              )}
              {c.supplierPrazoPagamentoDias !== null && (
                <Linha rotulo="Prazo de pagamento" valor={`${c.supplierPrazoPagamentoDias} dias`} />
              )}
            </dl>
          </Bloco>
        )}

        {respondeu && (
          <Bloco titulo="Proposta">
            <dl className="flex flex-col gap-1 text-[13px]">
              <Linha rotulo="Total" valor={fmtMoney(c.total)} />
              <Linha rotulo="Itens atendidos" valor={`${c.itensAtendidos} de ${totalItens}`} />
              {c.prazoEntregaDias !== null && (
                <Linha rotulo="Entrega" valor={`${c.prazoEntregaDias} dias`} />
              )}
              {c.condicaoPagamento && (
                <Linha rotulo="Pagamento" valor={c.condicaoPagamento} />
              )}
              {c.frete ? <Linha rotulo="Frete" valor={fmtMoney(c.frete)} /> : null}
              <Linha rotulo="Respondeu" valor={fmtDataHora(c.respondidaEm)} />
            </dl>
            <OrigemDaResposta origem={c.origemResposta} />
            {c.observacao && (
              <p className="mt-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
                {c.observacao}
              </p>
            )}
          </Bloco>
        )}

        {c.status === "RECUSADA" && c.observacao && (
          <Bloco titulo="Motivo da recusa">
            <p className="text-[13px] text-ink-2">{c.observacao}</p>
          </Bloco>
        )}

        {/* A trilha, do mais novo para o mais velho: canal, para quem, quando —
            e o que a Meta devolveu, quando o disparo foi automático. */}
        <Bloco titulo={`Envios (${c.envios.length})`}>
          {c.envios.length === 0 ? (
            <p className="text-[13px] text-muted">
              {c.status === "PENDENTE"
                ? "Ainda não foi enviado — a lista não saiu para este fornecedor."
                : "Marcado como enviado sem passar pela central de envio."}
            </p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {c.envios.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  {e.canal === "WHATSAPP" ? (
                    <IconeWhatsApp size={13} className="mt-0.5 shrink-0 text-whatsapp" />
                  ) : (
                    <Mail size={13} className="mt-0.5 shrink-0 text-info" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] text-ink">
                        {e.contatoNome ?? e.destino ?? "sem contato"}
                      </span>
                      {e.reenvio && <span className="text-[11px] text-faint">reenvio</span>}
                      {e.automatico && e.sucesso && e.status && (
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            e.status === "LIDA"
                              ? "text-brand"
                              : e.status === "ENTREGUE"
                                ? "text-ok"
                                : "text-faint",
                          )}
                        >
                          {e.status === "LIDA"
                            ? "lida"
                            : e.status === "ENTREGUE"
                              ? "entregue"
                              : "enviada"}
                        </span>
                      )}
                      {!e.sucesso && <span className="text-[11px] text-accent">falhou</span>}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {fmtDataHora(e.enviadoEm)}
                      {e.destino && e.contatoNome ? ` · ${e.destino}` : ""}
                      {e.copias ? ` · cópia: ${e.copias}` : ""}
                    </span>
                    {e.erro && <span className="mt-0.5 block text-[11px] text-danger">{e.erro}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Bloco>
      </div>
    </Sheet>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Linha({ rotulo: r, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{r}</dt>
      <dd className="text-right font-medium text-ink">{valor}</dd>
    </div>
  );
}

/** Data COM hora: no histórico de envio, "ontem" não diz se deu tempo de responder. */
function fmtDataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── De onde veio o preço ────────────────────────────────────
// Proposta preenchida pelo FORNECEDOR na tela pública e proposta DIGITADA
// pelo comprador (a partir de um áudio, uma foto, um telefonema) valem coisas
// diferentes na hora de decidir: a segunda passou por uma transcrição, e não
// tem o fornecedor por trás dela se o preço for contestado depois.
//
// A régua é o link: respondido lá fora = dele. Sem isso, alguém digitou aqui.

function OrigemDaResposta({ origem }: { origem: "link" | "manual" | null }) {
  if (!origem) return null;
  const doLink = origem === "link";
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-1 text-[11px]",
        doLink ? "text-muted" : "text-accent",
      )}
      title={
        doLink
          ? "O fornecedor preencheu os preços no link que recebeu."
          : "Os preços foram digitados aqui dentro, não pelo fornecedor."
      }
    >
      {doLink ? <LinkIcon size={10} className="shrink-0" /> : <PencilLine size={10} className="shrink-0" />}
      {doLink ? "Preenchido pelo fornecedor" : "Digitado manualmente"}
    </p>
  );
}

// ── Convidar ────────────────────────────────────────────────

function ConvidarSheet({
  disponiveis,
  pendente,
  onFechar,
  onConfirmar,
}: {
  disponiveis: FornecedorOpcao[];
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: (ids: string[]) => void;
}) {
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState("");

  // Quem já entregou itens desta lista vem primeiro: o histórico das notas
  // sabe quem vende o quê melhor do que a memória de quem está comprando.
  const visiveis = disponiveis
    .filter((f) => f.nome.toLowerCase().includes(busca.trim().toLowerCase()))
    .sort((a, b) => b.jaForneceu - a.jaForneceu || a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <Modal titulo="Adicionar fornecedores" onFechar={onFechar}>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar fornecedor"
        className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
      />

      <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-[var(--radius)] border border-line">
        {visiveis.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] text-muted">
            Todos os fornecedores ativos já estão na cotação.
          </li>
        )}
        {visiveis.map((f) => {
          const marcado = selecionados.includes(f.id);
          return (
            <li key={f.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() =>
                    setSelecionados((s) =>
                      marcado ? s.filter((x) => x !== f.id) : [...s, f.id],
                    )
                  }
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                <SupplierAvatar nome={f.nome} logoUrl={f.logoUrl} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{f.nome}</span>
                  {f.jaForneceu > 0 && (
                    <span className="block text-[11px] text-brand">
                      já forneceu {f.jaForneceu}{" "}
                      {f.jaForneceu === 1 ? "item desta lista" : "itens desta lista"}
                      {f.ultimaCompraEm ? ` · última compra: ${fmtQuando(f.ultimaCompraEm).toLowerCase()}` : ""}
                    </span>
                  )}
                  {!f.telefone && (
                    <span className="block text-[11px] text-faint">
                      sem WhatsApp cadastrado — a mensagem sai só para copiar
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onConfirmar(selecionados)}
          disabled={pendente || selecionados.length === 0}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          Adicionar {selecionados.length > 0 && `(${selecionados.length})`}
        </button>
      </div>
    </Modal>
  );
}

// ── Fornecedores dentro da revisão ──────────────────────────
// A coluna estreita (30%) ao lado dos itens. Aqui não se envia, não se cobra e
// não se registra resposta: a pergunta é só "quem vai receber esta lista?".
// Cada linha responde com o nome fantasia, a praça e as condições do cadastro
// — e o que não cabe nessa pergunta ficou no passo "Fornecedores".

export function FornecedoresDaCotacaoCard({
  cotacao,
  fornecedores,
  podeConvidar,
  podeRemover,
  alerta,
  onEscolherFornecedor,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  podeConvidar: boolean;
  podeRemover: boolean;
  /** Validação da revisão ("Selecione pelo menos um fornecedor."). */
  alerta?: string | null;
  /**
   * A folha de escolher fornecedor vai abrir. A página usa isso para recolher
   * as condições — o painel cobre a tela e o card atrás dele não serve a
   * ninguém.
   */
  onEscolherFornecedor?: () => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  /** Fornecedor que vai ganhar um contato agora, sem sair da revisão. */
  const [cadastrandoContato, setCadastrandoContato] = useState<ConviteCotacao | null>(null);
  /**
   * Tirar da cotação sai na hora e a faixa de "Desfazer" segura o erro.
   *
   * O modal que perguntava antes custava dois cliques e uma leitura para uma
   * ação que, desfeita, é um convite novo — e a lista aqui é montada
   * escolhendo e desescolhendo fornecedor. `saindo` esconde a linha antes de
   * o servidor responder; `desfazivel` guarda quem saiu para poder voltar.
   */
  const [saindo, setSaindo] = useState<string[]>([]);
  const [desfazivel, setDesfazivel] = useState<ConviteCotacao | null>(null);

  const convites = cotacao.convites.filter((c) => !saindo.includes(c.id));
  const jaConvidados = new Set(convites.map((c) => c.supplierId));
  const disponiveis = fornecedores.filter((f) => !jaConvidados.has(f.id));

  function tirar(c: ConviteCotacao) {
    setSaindo((atual) => [...atual, c.id]);
    setDesfazivel(c);
    rodar(() => removerConviteAction(c.id));
  }

  /** Convida de novo quem acabou de sair — o convite é novo, o efeito é voltar. */
  function devolver() {
    const alvo = desfazivel;
    if (!alvo) return;
    setDesfazivel(null);
    rodar(() =>
      convidarFornecedoresAction({ quotationId: cotacao.id, supplierIds: [alvo.supplierId] }),
    );
  }

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

  return (
    <section
      aria-labelledby="revisao-fornecedores-titulo"
      aria-busy={pendente || undefined}
      // Sem esmaecer o card: `opacity` cria contexto de empilhamento e muda o
      // bloco de contenção — o modal de confirmação e a folha de contato, que
      // são `fixed` e nascem aqui dentro, ficariam presos e apagados junto.
      className={cn(
        "flex flex-col rounded-[var(--radius-lg)] border bg-surface",
        alerta ? "border-danger" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3
            id="revisao-fornecedores-titulo"
            className="font-display text-[15px] font-semibold text-ink"
          >
            Fornecedores
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            {convites.length}{" "}
            {convites.length === 1 ? "selecionado" : "selecionados"}
            {pendente && (
              <span aria-live="polite" className="flex items-center gap-1 text-faint">
                <Loader2 size={11} aria-hidden className="motion-safe:animate-spin" />
                salvando…
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {alerta && <p className="text-[13px] font-medium text-danger">{alerta}</p>}
        {erro && <p className="text-[13px] text-danger">{erro}</p>}

        {/* A rede de segurança da remoção: quem saiu, e o caminho de volta. */}
        {desfazivel && (
          <p
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2"
          >
            <Undo2 size={13} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-ink">{desfazivel.supplierNome}</span> saiu da
              cotação.
            </span>
            <button
              type="button"
              onClick={devolver}
              className="shrink-0 cursor-pointer font-medium text-brand underline-offset-2 hover:underline"
            >
              Desfazer
            </button>
            <button
              type="button"
              onClick={() => setDesfazivel(null)}
              aria-label="Dispensar aviso"
              className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <X size={12} />
            </button>
          </p>
        )}

        {convites.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted">
            Nenhum fornecedor na cotação. Escolha de quem você quer o preço.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
            {convites.map((c) => {
              // A cotação vai para uma PESSOA. Sem telefone nem e-mail de
              // ninguém, este fornecedor não recebe nada — e o lugar de dizer
              // isso é a linha dele, não um aviso no rodapé que não diz qual.
              const semContato =
                c.status === "PENDENTE" &&
                !c.contatos.some((x) => x.telefone?.trim() || x.email?.trim());
              return (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-[var(--radius)] border px-3 py-2.5",
                    semContato ? "border-accent/50 bg-accent-soft" : "border-line bg-surface-2",
                  )}
                >
                  <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{c.supplierNome}</p>
                    {/* Praça em vez do contato: o comprador reconhece o
                        distribuidor pela cidade — é o que separa dois nomes
                        parecidos e o que explica frete e prazo. Quem recebe a
                        mensagem é decidido na folha de envio. */}
                    <p className="truncate text-[12px] text-muted">
                      {c.supplierPraca ?? "sem endereço no cadastro"}
                    </p>
                    {semContato && (
                      <button
                        type="button"
                        onClick={() => setCadastrandoContato(c)}
                        className="mt-1 flex cursor-pointer items-center gap-1 text-[12px] font-medium text-accent underline-offset-2 hover:underline"
                      >
                        <UserPlus size={12} />
                        Sem contato — cadastrar vendedor
                      </button>
                    )}
                    {/* Condições do cadastro: pedido mínimo e prazo, numa
                        linha só. É o que o comprador confere antes de mandar a
                        lista — quem não atende esse tamanho de compra ou esse
                        prazo se descobre aqui, não pela resposta que não vem. */}
                    {(c.supplierPedidoMinimo !== null ||
                      c.supplierPrazoPagamentoDias !== null) && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                        {c.supplierPedidoMinimo !== null && (
                          <span title="Valor mínimo de pedido exigido pelo fornecedor">
                            pedido mín. {fmtMoney(c.supplierPedidoMinimo)}
                          </span>
                        )}
                        {c.supplierPrazoPagamentoDias !== null && (
                          <span title="Prazo de pagamento negociado com o fornecedor">
                            paga em {c.supplierPrazoPagamentoDias} dias
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {podeRemover && (
                    <button
                      type="button"
                      onClick={() => tirar(c)}
                      disabled={pendente}
                      aria-label={`Tirar ${c.supplierNome} da cotação`}
                      title="Tirar da cotação"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              );
            })}
            </ul>
          </>
        )}

        {podeConvidar && (
          <button
            type="button"
            onClick={() => {
              onEscolherFornecedor?.();
              setConvidando(true);
            }}
            disabled={disponiveis.length === 0}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UserPlus size={14} />
            {disponiveis.length === 0 ? "Todos já estão na cotação" : "Adicionar fornecedor"}
          </button>
        )}
      </div>

      <ContatoSheet
        aberto={cadastrandoContato !== null}
        supplierId={cadastrandoContato?.supplierId ?? ""}
        primeiro={cadastrandoContato?.contatos.length === 0}
        onFechar={() => setCadastrandoContato(null)}
        onSalvo={() => {
          setCadastrandoContato(null);
          router.refresh();
        }}
      />

      {convidando && (
        <ConvidarSheet
          disponiveis={disponiveis}
          pendente={pendente}
          onFechar={() => setConvidando(false)}
          onConfirmar={(ids) => {
            setConvidando(false);
            rodar(() =>
              convidarFornecedoresAction({ quotationId: cotacao.id, supplierIds: ids }),
            );
          }}
        />
      )}
    </section>
  );
}

// ── Registrar resposta ──────────────────────────────────────
// Quem digita aqui é o operador com o fornecedor no telefone (ou um PDF na
// tela), e a régua é a velocidade: a mão fica no teclado, o Tab pula de preço
// em preço, e o único gesto além de digitar é marcar o que ele não tem.
//
// UMA REGRA, e ela é o modelo mental inteiro da tela:
//
//     preço digitado  →  o fornecedor tem o item, e ele entra no total
//     "Não tem" marcado  →  preço bloqueado, fora do total, item respondido
//
// Não existe "Tem", não existe "Parcial", não existe terceiro estado. Cada
// status a mais é uma pergunta a mais por linha, e são dezenas de linhas.

/** Uma faixa de volume enquanto está sendo digitada (texto, não número). */
type FaixaResposta = { qtd: string; preco: string };

type LinhaResposta = {
  quotationItemId: string;
  /** Texto mascarado do preço unitário. Vazio = ainda não respondido. */
  preco: string;
  /** O fornecedor não tem este item — preço bloqueado e fora do total. */
  naoTem: boolean;
  /**
   * Promoção por volume que ele ditou ("de 10 pra cima é 41"). Vazia na
   * maioria das linhas — e a coluna que a abre só existe quando a cotação
   * pediu escala.
   */
  faixas: FaixaResposta[];
};

/** Respondido = tem preço, ou foi marcado como indisponível. Nada mais. */
function respondida(l: LinhaResposta): boolean {
  if (l.naoTem) return true;
  const preco = paraNumero(l.preco);
  return preco !== null && preco > 0;
}

function RespostaSheet({
  convite,
  numero,
  itens,
  pedeEscala,
  pendente,
  onFechar,
  onSalvar,
}: {
  convite: ConviteCotacao;
  /** Número da cotação — identifica o documento que está sendo respondido. */
  numero: string;
  itens: CotacaoDetalhe["itens"];
  /** A cotação pede promoção por volume — só então a coluna de faixas existe. */
  pedeEscala: boolean;
  pendente: boolean;
  onFechar: () => void;
  onSalvar: (payload: {
    conviteId: string;
    prazoEntregaDias: number | null;
    condicaoPagamento: string | null;
    frete: number | null;
    observacao: string | null;
    itens: {
      quotationItemId: string;
      disponivel: boolean;
      precoUnitario: number;
      quantidadeOfertada: number | null;
      faixas: { quantidadeMinima: number; precoUnitario: number }[];
    }[];
  }) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaResposta[]>(() =>
    itens.map((i) => {
      const anterior = convite.respostas.find((r) => r.quotationItemId === i.id);
      return {
        quotationItemId: i.id,
        preco: anterior?.disponivel ? paraMascara(anterior.precoUnitario) : "",
        naoTem: anterior ? !anterior.disponivel : false,
        faixas: (anterior?.faixas ?? []).map((f) => ({
          qtd: String(f.quantidadeMinima).replace(".", ","),
          preco: paraMascara(f.precoUnitario),
        })),
      };
    }),
  );
  const [prazo, setPrazo] = useState(
    convite.prazoEntregaDias === null ? "" : String(convite.prazoEntregaDias),
  );
  const [condicao, setCondicao] = useState(convite.condicaoPagamento ?? "");
  const [frete, setFrete] = useState(
    convite.frete === null ? "" : paraMascara(convite.frete),
  );
  const [observacao, setObservacao] = useState(convite.observacao ?? "");
  /** Salvar com itens em branco pergunta uma vez, e só uma. */
  const [confirmarVazios, setConfirmarVazios] = useState(false);

  // Tab pula de preço em preço, saltando o que está bloqueado: sem isto ele
  // cai no checkbox da linha seguinte, e uma lista de 30 itens vira 90
  // tabulações.
  const camposPreco = useRef<(HTMLInputElement | null)[]>([]);
  function aoTabular(e: React.KeyboardEvent<HTMLInputElement>, indice: number) {
    if (e.key !== "Tab") return;
    const passo = e.shiftKey ? -1 : 1;
    for (let i = indice + passo; i >= 0 && i < itens.length; i += passo) {
      const alvo = camposPreco.current[i];
      if (!alvo || alvo.disabled) continue;
      e.preventDefault();
      alvo.focus();
      alvo.select();
      return;
    }
  }

  // A mão já chega no teclado: o primeiro preço recebe o foco sozinho.
  useEffect(() => {
    const primeiro = camposPreco.current.find((c) => c && !c.disabled);
    primeiro?.focus();
  }, []);

  function atualizar(id: string, patch: Partial<LinhaResposta>) {
    setLinhas((ls) => ls.map((l) => (l.quotationItemId === id ? { ...l, ...patch } : l)));
  }

  /**
   * Marcar "Não tem" APAGA o preço na hora. Deixar o número escondido atrás de
   * um campo bloqueado é a receita para ele voltar sozinho quando o operador
   * desmarcar sem querer — e aí o comparativo cobra um preço que ninguém deu.
   */
  function alternarNaoTem(id: string, marcado: boolean) {
    atualizar(id, marcado ? { naoTem: true, preco: "", faixas: [] } : { naoTem: false });
  }

  // Quais itens estão com o bloco de faixas aberto. Já nasce aberto no que veio
  // com promoção gravada: reabrir para conferir o que já existe é o motivo
  // mais comum de voltar nesta tela.
  const [escalaAberta, setEscalaAberta] = useState<Set<string>>(
    () => new Set(linhas.filter((l) => l.faixas.length > 0).map((l) => l.quotationItemId)),
  );

  function alternarEscala(id: string) {
    const proxima = new Set(escalaAberta);
    if (proxima.has(id)) proxima.delete(id);
    else {
      proxima.add(id);
      // Abrir com uma linha em branco poupa o segundo clique — quem abriu já
      // decidiu que tem faixa para digitar. Fora do updater de propósito:
      // atualizar estado dentro de outro updater roda duas vezes em StrictMode.
      const l = linhas.find((x) => x.quotationItemId === id);
      if (l && l.faixas.length === 0) atualizar(id, { faixas: [{ qtd: "", preco: "" }] });
    }
    setEscalaAberta(proxima);
  }

  function alterarFaixa(id: string, indice: number, campo: Partial<FaixaResposta>) {
    const l = linhas.find((x) => x.quotationItemId === id);
    if (!l) return;
    atualizar(id, {
      faixas: l.faixas.map((f, i) => (i === indice ? { ...f, ...campo } : f)),
    });
  }

  /** Total da linha: quantidade pedida × preço. Indisponível não soma. */
  function totalDaLinha(indice: number, l: LinhaResposta): number | null {
    if (l.naoTem) return null;
    const preco = paraNumero(l.preco);
    if (preco === null || preco <= 0) return null;
    return preco * (itens[indice]?.quantidade ?? 0);
  }

  const totalItens = linhas.reduce((acc, l, i) => acc + (totalDaLinha(i, l) ?? 0), 0);
  const valorFrete = paraNumero(frete) ?? 0;
  // O frete entra no total da proposta porque é o que a compra vai custar — e
  // é assim que ela aparece no cartão do fornecedor e no comparativo. Quando
  // existe, a tela abre a conta em vez de deixar a diferença sem explicação.
  const total = totalItens + valorFrete;

  const respondidos = linhas.filter(respondida).length;
  const pendentes = linhas.length - respondidos;
  const disponiveis = linhas.filter((l) => !l.naoTem && respondida(l)).length;
  const semDisponibilidade = linhas.filter((l) => l.naoTem).length;
  const completo = pendentes === 0 && linhas.length > 0;

  function salvar() {
    onSalvar({
      conviteId: convite.id,
      prazoEntregaDias: prazo ? Number(prazo) : null,
      condicaoPagamento: condicao.trim() || null,
      frete: paraNumero(frete),
      observacao: observacao.trim() || null,
      // Item em branco NÃO vira linha: gravá-lo como indisponível diria que o
      // fornecedor recusou algo sobre o que ele nunca falou — e reabrir esta
      // tela mostraria a caixa "Não tem" marcada por conta própria.
      itens: linhas.filter(respondida).map((l) => {
        const preco = paraNumero(l.preco);
        const disponivel = !l.naoTem && preco !== null && preco > 0;
        return {
          quotationItemId: l.quotationItemId,
          disponivel,
          precoUnitario: disponivel ? preco! : 0,
          // A resposta não fatia quantidade: ele tem pelo preço, ou não tem.
          quantidadeOfertada: null,
          // Faixa pela metade some em silêncio: o operador está transcrevendo,
          // não preenchendo formulário, e travar o salvamento por uma linha
          // esquecida perderia a resposta inteira. O servidor ainda peneira.
          faixas: disponivel
            ? l.faixas.flatMap((f) => {
                const qtd = paraNumero(f.qtd);
                const p = paraNumero(f.preco);
                return qtd !== null && qtd > 0 && p !== null && p > 0
                  ? [{ quantidadeMinima: qtd, precoUnitario: p }]
                  : [];
              })
            : [],
        };
      }),
    });
  }

  const colunas = pedeEscala ? 6 : 5;

  return (
    <Modal
      titulo={`Resposta de ${convite.supplierNome}`}
      subtitulo={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="font-mono font-semibold text-muted">{numero}</span>
          <span>·</span>
          <span>
            {itens.length} {itens.length === 1 ? "item" : "itens"}
          </span>
        </span>
      }
      descricao='Informe os preços recebidos do fornecedor. Para produtos que ele não possui, marque "Não tem".'
      acessorio={<Contador respondidos={respondidos} total={linhas.length} />}
      largura="max-w-5xl"
      onFechar={onFechar}
      rodape={
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Contador respondidos={respondidos} total={linhas.length} />
            <p className="text-[12px] text-muted">
              Total da proposta{" "}
              <span className="font-mono text-[17px] font-semibold tabular-nums text-ink">
                {fmtMoney(total)}
              </span>
              {valorFrete > 0 && (
                <span className="ml-1.5 text-[11px] text-faint">
                  {fmtMoney(totalItens)} em itens + {fmtMoney(valorFrete)} de frete
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {confirmarVazios && (
              <p className="text-[12px] text-accent">
                {pendentes} {pendentes === 1 ? "item sem resposta" : "itens sem resposta"}. Salvar
                mesmo assim?
              </p>
            )}
            <button
              type="button"
              onClick={confirmarVazios ? () => setConfirmarVazios(false) : onFechar}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              {confirmarVazios ? "Voltar e preencher" : "Cancelar"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (pendentes > 0 && !confirmarVazios) {
                  setConfirmarVazios(true);
                  return;
                }
                salvar();
              }}
              disabled={pendente}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              {pendente
                ? "Salvando…"
                : confirmarVazios
                  ? "Salvar mesmo assim"
                  : "Salvar resposta"}
            </button>
          </div>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <SupplierAvatar
            nome={convite.supplierNome}
            logoUrl={convite.supplierLogoUrl}
            size={32}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {convite.supplierNome}
            </span>
            {(disponiveis > 0 || semDisponibilidade > 0) && (
              <span className="block text-[11px] text-muted">
                {disponiveis} {disponiveis === 1 ? "item disponível" : "itens disponíveis"}
                {semDisponibilidade > 0 && ` · ${semDisponibilidade} sem disponibilidade`}
              </span>
            )}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-faint">
            Total da proposta
          </span>
          <span className="block font-mono text-[19px] font-semibold tabular-nums text-ink">
            {fmtMoney(total)}
          </span>
        </span>
      </div>

      {/* Rolagem própria, e não a do modal: com trinta itens o cabeçalho
          da tabela precisa continuar grudado no topo enquanto a lista corre. */}
      <div className="max-h-[48vh] overflow-auto rounded-[var(--radius)] border border-line">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Produto</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Pedido</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Preço unit.</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Total</th>
              <th className="w-32 px-3 py-2 text-left font-medium">Disponibilidade</th>
              {pedeEscala && <th className="w-28 px-3 py-2 text-right font-medium">Volume</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {itens.map((item, i) => {
              const l = linhas[i];
              const linhaTotal = totalDaLinha(i, l);
              const escalaLigada = pedeEscala && !l.naoTem && escalaAberta.has(item.id);
              return (
                <Fragment key={item.id}>
                  <tr className={cn(l.naoTem && "bg-surface-2/50")}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Thumb url={item.imagemUrl} nome={item.descricao} size={32} />
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "text-[14px] font-medium leading-snug",
                              l.naoTem ? "text-muted" : "text-ink",
                            )}
                          >
                            {item.descricao}
                          </p>
                          {item.sku && (
                            <p className="font-mono text-[11px] text-faint">{item.sku}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Número sem unidade não diz se são duas garrafas ou duas
                        caixas de doze — e é o preço disso que está sendo
                        digitado na coluna ao lado. */}
                    <td className="px-3 py-2 text-right">
                      <span className="block font-mono text-[14px] font-semibold tabular-nums text-ink">
                        {fmtQtd(item.quantidade)}
                      </span>
                      <span className="block text-[11px] text-faint">
                        {unidadeDaQtd(item.quantidade, item.embalagemNome)}
                      </span>
                    </td>

                    <td className="px-3 py-2 text-right">
                      <div className="relative">
                        <span
                          aria-hidden
                          className={cn(
                            "pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px]",
                            l.naoTem ? "text-faint/50" : "text-faint",
                          )}
                        >
                          R$
                        </span>
                        <input
                          ref={(el) => {
                            camposPreco.current[i] = el;
                          }}
                          value={l.naoTem ? "" : l.preco}
                          disabled={l.naoTem}
                          onChange={(e) =>
                            atualizar(item.id, { preco: mascaraMoeda(e.target.value) })
                          }
                          onKeyDown={(e) => aoTabular(e, i)}
                          onFocus={(e) => e.currentTarget.select()}
                          inputMode="decimal"
                          placeholder={l.naoTem ? "—" : "0,00"}
                          aria-label={`Preço de ${item.descricao}`}
                          className={cn(
                            "w-full rounded-[var(--radius)] border py-1.5 pl-7 pr-2 text-right font-mono text-[13px] tabular-nums",
                            l.naoTem
                              ? "cursor-not-allowed border-dashed border-line bg-surface-2 text-faint placeholder:text-faint"
                              : "border-line bg-surface text-ink",
                          )}
                        />
                      </div>
                    </td>

                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono text-[13px] tabular-nums",
                        linhaTotal === null ? "text-faint" : "font-semibold text-ink",
                      )}
                    >
                      {linhaTotal === null ? "—" : fmtMoney(linhaTotal)}
                    </td>

                    {/* Uma caixa, não um seletor de três estados: a única coisa
                        que o preço não consegue dizer sozinho é "ele não tem". */}
                    <td className="px-3 py-2">
                      <label
                        className={cn(
                          "inline-flex cursor-pointer select-none items-center gap-2 rounded-full px-2 py-1 text-[12px] font-medium transition-colors",
                          l.naoTem
                            ? "bg-surface-2 text-ink-2"
                            : "text-muted hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={l.naoTem}
                          onChange={(e) => alternarNaoTem(item.id, e.target.checked)}
                          className="h-3.5 w-3.5 shrink-0 accent-[var(--brand)]"
                        />
                        Não tem
                      </label>
                    </td>

                    {pedeEscala && (
                      <td className="px-3 py-2 text-right">
                        {l.naoTem ? (
                          <span className="text-[12px] text-faint">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => alternarEscala(item.id)}
                            aria-expanded={escalaAberta.has(item.id)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                              l.faixas.length > 0
                                ? "border-transparent bg-accent-soft text-accent"
                                : "border-line text-muted hover:text-ink",
                            )}
                          >
                            <Layers size={12} />
                            {l.faixas.length > 0
                              ? `${l.faixas.length} faixa${l.faixas.length > 1 ? "s" : ""}`
                              : "faixa"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>

                  {/* As faixas ficam numa segunda linha da MESMA tabela, não num
                      modal: quem transcreve um telefonema vai e volta entre o
                      preço e a promoção do mesmo produto, e abrir uma janela por
                      item quebraria a digitação em série. */}
                  {escalaLigada && (
                    <tr className="bg-surface-2/40">
                      <td colSpan={colunas} className="px-3 pb-3 pt-0">
                        <div className="rounded-[var(--radius)] border border-dashed border-line-strong bg-surface p-2.5">
                          <p className="text-[12px] text-muted">
                            Preço melhor por volume de{" "}
                            <span className="font-medium text-ink">{item.descricao}</span> — a
                            quantidade é na mesma embalagem do pedido
                            {item.embalagemNome ? ` (${item.embalagemNome})` : ""}.
                          </p>

                          <ul className="mt-2 flex flex-col gap-1.5">
                            {l.faixas.map((f, fi) => (
                              <li key={fi} className="flex items-center gap-2">
                                <span className="text-[12px] text-muted">A partir de</span>
                                <input
                                  value={f.qtd}
                                  onChange={(e) =>
                                    alterarFaixa(item.id, fi, { qtd: e.target.value })
                                  }
                                  inputMode="decimal"
                                  placeholder={fmtQtd(item.quantidade * 2)}
                                  aria-label={`Quantidade da faixa ${fi + 1} de ${item.descricao}`}
                                  className="w-24 rounded-[var(--radius)] border border-line bg-surface px-2 py-1 text-right font-mono text-[13px] tabular-nums text-ink"
                                />
                                <span className="text-[12px] text-muted">sai a</span>
                                <div className="relative w-32">
                                  <span
                                    aria-hidden
                                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-faint"
                                  >
                                    R$
                                  </span>
                                  <input
                                    value={f.preco}
                                    onChange={(e) =>
                                      alterarFaixa(item.id, fi, {
                                        preco: mascaraMoeda(e.target.value),
                                      })
                                    }
                                    inputMode="decimal"
                                    placeholder="0,00"
                                    aria-label={`Preço da faixa ${fi + 1} de ${item.descricao}`}
                                    className="w-full rounded-[var(--radius)] border border-line bg-surface py-1 pl-7 pr-2 text-right font-mono text-[13px] tabular-nums text-ink"
                                  />
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Tirar a faixa ${fi + 1} de ${item.descricao}`}
                                  onClick={() =>
                                    atualizar(item.id, {
                                      faixas: l.faixas.filter((_, x) => x !== fi),
                                    })
                                  }
                                  className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                                >
                                  <X size={14} />
                                </button>
                              </li>
                            ))}
                          </ul>

                          {l.faixas.length < MAX_FAIXAS_ITEM && (
                            <button
                              type="button"
                              onClick={() =>
                                atualizar(item.id, {
                                  faixas: [...l.faixas, { qtd: "", preco: "" }],
                                })
                              }
                              className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand"
                            >
                              <Plus size={12} />
                              Outra faixa
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!completo && pendentes > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          {pendentes}{" "}
          {pendentes === 1 ? "item aguardando preenchimento" : "itens aguardando preenchimento"}.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Prazo de entrega</span>
          <div className="relative">
            <input
              value={prazo}
              onChange={(e) => setPrazo(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              placeholder="0"
              className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-3 pr-12 text-sm text-ink"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint"
            >
              dias
            </span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Condição de pagamento</span>
          <input
            value={condicao}
            onChange={(e) => setCondicao(e.target.value)}
            placeholder="Ex.: 28 dias"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Frete</span>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-faint"
            >
              R$
            </span>
            <input
              value={frete}
              onChange={(e) => setFrete(mascaraMoeda(e.target.value))}
              inputMode="decimal"
              placeholder="0,00"
              className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-9 pr-3 text-right font-mono text-sm tabular-nums text-ink"
            />
          </div>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[12px] font-medium text-ink-2">
          Observações do fornecedor <span className="text-faint">(opcional)</span>
        </span>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex.: pedido mínimo de 5 caixas, entrega às terças…"
          className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>
    </Modal>
  );
}

/** "4 de 6 itens respondidos" — vira ✓ quando fecha, sem virar etapa. */
function Contador({ respondidos, total }: { respondidos: number; total: number }) {
  const completo = total > 0 && respondidos === total;
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums",
        completo ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted",
      )}
    >
      {completo && <Check size={12} />}
      {respondidos} de {total} itens respondidos
    </span>
  );
}

// ── Reenvio ─────────────────────────────────────────────────
// ── Mensagens prontas ───────────────────────────────────────

export function EnviosSheet({ envios, onFechar }: { envios: Envio[]; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<Envio | null>(null);
  // A bandeja do celular resolve o contato que existe na AGENDA e não no
  // cadastro: o operador escolhe a pessoa dentro do próprio WhatsApp. Só
  // existe em contexto seguro (e quase só no celular), e o servidor não tem
  // como saber — daí a leitura por store externo, que devolve false na
  // renderização do servidor e a verdade no cliente, sem erro de hidratação.
  const podeCompartilhar = useSyncExternalStore(
    () => () => {},
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  return (
    <>
      <Modal
        titulo="Mensagem pronta"
        descricao="O link onde o fornecedor preenche os preços é o mesmo em qualquer canal — sem cadastro, direto do celular dele. O que foi por e-mail já saiu; o resto é só disparar."
        onFechar={onFechar}
      >
        <ul className="flex flex-col gap-2">
          {envios.map((e) => (
            <li
              key={e.conviteId}
              className="flex flex-col gap-2 rounded-[var(--radius)] border border-line px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{e.fornecedor}</span>
                  {e.contato ? (
                    <span className="block truncate text-[12px] text-muted">
                      para {e.contato.nome}
                    </span>
                  ) : e.avulso ? (
                    <span className="block truncate text-[12px] text-muted">
                      para {e.avulso.nome || e.avulso.telefone || e.avulso.email} · fora do cadastro
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void copiarTexto(e.mensagem).then((ok) => setCopiado(ok ? e.conviteId : null));
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  <Copy size={13} />
                  {copiado === e.conviteId ? "Copiado" : "Copiar"}
                </button>
                {podeCompartilhar && (
                  <button
                    type="button"
                    onClick={() => {
                      // Cancelar a bandeja rejeita a promessa — não é erro.
                      void navigator.share({ text: e.mensagem }).catch(() => {});
                    }}
                    title="Escolher o contato na agenda do celular"
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                  >
                    <Share2 size={13} />
                    Compartilhar
                  </button>
                )}
                {e.waLink && (
                  <a
                    href={e.waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                  >
                    <IconeWhatsApp size={13} />
                    WhatsApp
                  </a>
                )}
              </div>

              {e.email.estado !== "nao-pedido" && (
                <p
                  className={cn(
                    "text-[12px]",
                    e.email.estado === "enviado" ? "text-ok" : "text-accent",
                  )}
                >
                  {e.email.estado === "enviado"
                    ? `E-mail enviado para ${e.email.endereco}`
                    : e.email.estado === "sem-endereco"
                      ? "Sem e-mail cadastrado — mande o link pelo WhatsApp ou copie acima."
                      : "Não consegui enviar o e-mail. O link acima continua valendo."}
                </p>
              )}

              {e.avulso && !e.contato && (
                <button
                  type="button"
                  onClick={() => setSalvando(e)}
                  className="flex items-center gap-1.5 self-start rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
                >
                  <UserPlus size={12} />
                  Salvar como contato de {e.fornecedor}
                </button>
              )}

              {e.link && (
                <button
                  type="button"
                  onClick={() => {
                    void copiarTexto(e.link!).then((ok) => setLinkCopiado(ok ? e.conviteId : null));
                  }}
                  title={e.link}
                  className="flex items-center gap-1.5 self-start rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-ink"
                >
                  <LinkIcon size={12} />
                  {linkCopiado === e.conviteId ? "Link copiado" : "Copiar só o link"}
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Fechar
          </button>
        </div>
      </Modal>

      {salvando && (
        <ContatoSheet
          aberto
          supplierId={salvando.supplierId}
          inicial={{
            nome: salvando.avulso?.nome ?? "",
            telefone: salvando.avulso?.telefone ?? "",
            email: salvando.avulso?.email ?? "",
          }}
          onFechar={() => setSalvando(null)}
          onSalvo={() => setSalvando(null)}
        />
      )}
    </>
  );
}

// ── Casca de modal ──────────────────────────────────────────

function Modal({
  titulo,
  subtitulo,
  descricao,
  acessorio,
  rodape,
  largura = "max-w-lg",
  onFechar,
  children,
}: {
  titulo: string;
  /** Linha de identificação abaixo do título — número do documento, contagem. */
  subtitulo?: React.ReactNode;
  descricao?: string;
  /** Canto direito do cabeçalho: contadores e estados que mudam enquanto digita. */
  acessorio?: React.ReactNode;
  /**
   * Rodapé que não rola com o conteúdo. Com ele o corpo ganha altura máxima e
   * rolagem própria — numa lista de trinta itens o botão de salvar não pode
   * ficar a trinta linhas de distância.
   */
  rodape?: React.ReactNode;
  largura?: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          "flex max-h-[92vh] w-full flex-col rounded-t-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-float)] sm:max-h-[90vh] sm:rounded-[var(--radius-xl)]",
          largura,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-semibold text-ink">{titulo}</h2>
            {subtitulo && <div className="mt-0.5 text-[12px] text-muted">{subtitulo}</div>}
            {descricao && <p className="mt-1 text-[13px] text-muted">{descricao}</p>}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {acessorio}
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {rodape && (
          <div className="shrink-0 border-t border-line bg-surface-2 px-5 py-3.5">{rodape}</div>
        )}
      </div>
    </div>
  );
}

