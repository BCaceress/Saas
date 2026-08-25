"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  MoreVertical,
  RotateCcw,
  Send,
  Trash2,
  Users,
  MessageCircle,
  Mail,
  Copy,
  Link as LinkIcon,
  X,
  ThumbsDown,
  PencilLine,
  Layers,
  Plus,
  Share2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { mascaraMoeda, paraMascara, paraNumero } from "@/lib/moeda";
import { MAX_FAIXAS_ITEM } from "@/lib/compras/escalas";
import { Menu, MenuItem } from "@/components/ui/menu";
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
import { EnvioSheet } from "./_envio";
import type { Envio } from "../_compra-actions";
import {
  convidarFornecedoresAction,
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
  onVerComparativo,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  /** Cotação viva e a pessoa pode comprar: enviar, cobrar, registrar resposta. */
  editavel: boolean;
  /** Chamar mais um para a disputa — vale mesmo depois de respostas chegarem. */
  podeConvidar: boolean;
  /** Tirar alguém da cotação — só em rascunho, antes de o convite existir lá fora. */
  podeRemover: boolean;
  onVerComparativo: () => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [respondendo, setRespondendo] = useState<ConviteCotacao | null>(null);
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);
  const [textoCopiado, setTextoCopiado] = useState<string | null>(null);
  /** Folha de conferência aberta: quem recebe, em qual fornecedor, por onde. */
  const [enviando, setEnviando] = useState(false);
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

  return (
    <div className="flex flex-col gap-4">
      {editavel && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
          {podeConvidar && (
            <button
              type="button"
              onClick={() => setConvidando(true)}
              disabled={disponiveis.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <Users size={15} />
              Convidar fornecedores
            </button>
          )}

          {aguardando.length > 0 && (
            <button
              type="button"
              onClick={() => setReenviando("todos")}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <RotateCcw size={15} />
              Reenviar aos {aguardando.length} pendentes
            </button>
          )}
          </div>

          {pendentes.length > 0 && cotacao.itens.length > 0 && (
            <button
              type="button"
              onClick={() => setEnviando(true)}
              disabled={pendente}
              className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              <Send size={15} />
              Enviar para {pendentes.length}{" "}
              {pendentes.length === 1 ? "fornecedor" : "fornecedores"}
            </button>
          )}
        </div>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {cotacao.convites.length === 0 ? (
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
                Convidar fornecedores
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {cotacao.convites.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4"
            >
              <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={38} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{c.supplierNome}</p>
                  {/* Etiqueta encostada na direita: em cartão de largura fixa
                      ela vira coluna, e o olho varre uma coluna de estados
                      sem reler nome por nome. */}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      rotulo(c).classe,
                    )}
                  >
                    {rotulo(c).label}
                  </span>
                </div>

                <p className="mt-0.5 text-[12px] text-muted">
                  {c.status === "RESPONDIDA"
                    ? `Respondeu ${fmtQuando(c.respondidaEm)} · ${c.itensAtendidos} de ${cotacao.itens.length} itens`
                    : c.status === "ENVIADA"
                      ? c.abertoEm
                        ? `Abriu o link ${fmtQuando(c.abertoEm)} · ainda não respondeu`
                        : `Enviado ${fmtQuando(c.enviadaEm)} · ainda não abriu`
                      : c.status === "RECUSADA"
                        ? (c.observacao ?? "Não vai cotar")
                        : "Ainda não recebeu a lista"}
                </p>

                {c.envios.length > 0 && <HistoricoEnvios envios={c.envios} />}

                {c.status === "RESPONDIDA" && (
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[12px] text-muted">
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                      {fmtMoney(c.total)}
                    </span>
                    {c.prazoEntregaDias !== null && <span>entrega em {c.prazoEntregaDias}d</span>}
                    {c.condicaoPagamento && <span>{c.condicaoPagamento}</span>}
                    {c.frete ? <span>frete {fmtMoney(c.frete)}</span> : null}
                  </p>
                )}

                {editavel && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
                    {/* Uma ação principal por cartão. Cinco botões iguais
                        obrigavam a ler todos antes de agir; aqui a ação que
                        move a cotação adiante é a única com peso visual, o
                        apoio fica em contorno e o resto some no menu. */}
                    {c.status === "RESPONDIDA" ? (
                      <button
                        type="button"
                        onClick={onVerComparativo}
                        className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                      >
                        Ver no comparativo
                      </button>
                    ) : (
                      cotacao.itens.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setRespondendo(c)}
                          className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                        >
                          <PencilLine size={13} />
                          Registrar resposta
                        </button>
                      )
                    )}

                    {c.status === "RESPONDIDA" && (
                      <button
                        type="button"
                        onClick={() => setRespondendo(c)}
                        className="rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                      >
                        Corrigir preços
                      </button>
                    )}

                    {c.status === "ENVIADA" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setReenviando(c)}
                          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                        >
                          <RotateCcw size={13} />
                          Reenviar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            rodar(async () => {
                              const { mensagem } = await mensagemDoConviteAction(c.id);
                              if (!(await copiarTexto(mensagem))) {
                                throw new Error(
                                  "O navegador bloqueou a cópia. Tente pelo WhatsApp.",
                                );
                              }
                              setTextoCopiado(c.id);
                            })
                          }
                          disabled={pendente}
                          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                        >
                          <Copy size={13} />
                          {textoCopiado === c.id ? "Mensagem copiada" : "Copiar mensagem"}
                        </button>
                      </>
                    )}

                    <Menu
                      trigger={
                        <button
                          type="button"
                          aria-label={`Mais ações de ${c.supplierNome}`}
                          aria-haspopup="menu"
                          className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <MoreVertical size={15} />
                        </button>
                      }
                    >
                      {/* Só o endereço, sem o texto em volta: serve para colar
                          numa conversa que já começou. O caminho normal é o
                          botão "Copiar mensagem", que leva o link dentro. */}
                      {c.status === "ENVIADA" && (
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
                      {c.status === "ENVIADA" && (
                        <MenuItem
                          icon={<ThumbsDown size={14} />}
                          disabled={pendente}
                          onClick={() => rodar(() => recusarConviteAction(c.id))}
                        >
                          {'Marcar "Não vai cotar"'}
                        </MenuItem>
                      )}
                      {/* Sair da cotação só antes do envio: depois disso o
                          fornecedor já foi incomodado, e apagar o convite some
                          com o link que ele pode estar preenchendo agora. */}
                      {podeRemover && c.status !== "RESPONDIDA" && (
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
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
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

      {enviando && (
        <EnvioSheet
          cotacaoId={cotacao.id}
          alvos={pendentes}
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setEnviando(false)}
          onEnviado={(r) => {
            setEnviando(false);
            setEnvios(r);
          }}
        />
      )}

      {reenviando && (
        <EnvioSheet
          cotacaoId={cotacao.id}
          alvos={reenviando === "todos" ? aguardando : [reenviando]}
          reenvio
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setReenviando(null)}
          onEnviado={(r) => {
            setReenviando(null);
            setEnvios(r);
          }}
        />
      )}

      {envios && <EnviosSheet envios={envios} onFechar={() => setEnvios(null)} />}
    </div>
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
    <Modal titulo="Convidar fornecedores" onFechar={onFechar}>
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
          Convidar {selecionados.length > 0 && `(${selecionados.length})`}
        </button>
      </div>
    </Modal>
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
                    <MessageCircle size={13} />
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

// ── Histórico de envio ──────────────────────────────────────
// "Mandei pro João ou pra Maria?" é a pergunta de três dias depois. Duas
// linhas no cartão respondem sem abrir nada — o resto fica no "mais".

function HistoricoEnvios({
  envios,
}: {
  envios: ConviteCotacao["envios"];
}) {
  const [todos, setTodos] = useState(false);
  const visiveis = todos ? envios : envios.slice(0, 2);

  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {visiveis.map((e) => (
        <li key={e.id} className="flex items-center gap-1.5 text-[11px] text-muted">
          {e.canal === "WHATSAPP" ? (
            <MessageCircle size={11} className="shrink-0 text-faint" />
          ) : (
            <Mail size={11} className="shrink-0 text-faint" />
          )}
          <span className="truncate">
            {e.contatoNome ?? e.destino ?? "sem contato"}
            {e.reenvio && " · reenvio"}
          </span>
          {!e.sucesso && <span className="shrink-0 text-accent">falhou</span>}
        </li>
      ))}
      {envios.length > 2 && (
        <li>
          <button
            type="button"
            onClick={() => setTodos((v) => !v)}
            className="text-[11px] font-medium text-brand transition-colors hover:underline"
          >
            {todos ? "ver menos" : `ver os ${envios.length} envios`}
          </button>
        </li>
      )}
    </ul>
  );
}

