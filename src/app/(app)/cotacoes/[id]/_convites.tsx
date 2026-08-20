"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RotateCcw,
  Send,
  Trash2,
  Users,
  MessageCircle,
  Copy,
  Link as LinkIcon,
  X,
  ThumbsDown,
  PencilLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { mascaraMoeda, paraMascara, paraNumero } from "@/lib/moeda";
import { EstadoVazio, SupplierAvatar, fmtMoney, fmtQtd, fmtQuando } from "../_catalogo/ui";
import { Thumb } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, FornecedorOpcao } from "../_compra-types";
import { CanalPicker, type Canal } from "./_canal";
import type { EmailEnvio } from "../_compra-actions";
import {
  convidarFornecedoresAction,
  mensagemDoConviteAction,
  enviarCotacaoAction,
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

export type Envio = {
  conviteId: string;
  fornecedor: string;
  mensagem: string;
  /** Endereço público onde o fornecedor preenche os preços (um por convite). */
  link: string | null;
  waLink: string | null;
  /** O que aconteceu com o canal de e-mail neste envio. */
  email: EmailEnvio;
};

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
  const [canais, setCanais] = useState<Canal[]>(["whatsapp"]);
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
            <div className="flex flex-wrap items-center gap-3">
            <CanalPicker
              canais={canais}
              onChange={setCanais}
              semEmail={pendentes.every((c) => !c.email)}
            />
            <button
              type="button"
              onClick={() =>
                rodar(async () => {
                  const r = await enviarCotacaoAction({ quotationId: cotacao.id, canais });
                  setEnvios(r);
                })
              }
              disabled={pendente}
              className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              <Send size={15} />
              Enviar para {pendentes.length}{" "}
              {pendentes.length === 1 ? "fornecedor" : "fornecedores"}
            </button>
            </div>
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
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {cotacao.convites.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4"
            >
              <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={38} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{c.supplierNome}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
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
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {c.status !== "RESPONDIDA" && cotacao.itens.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setRespondendo(c)}
                        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                      >
                        <PencilLine size={13} />
                        Registrar resposta
                      </button>
                    )}
                    {c.status === "RESPONDIDA" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRespondendo(c)}
                          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                        >
                          Corrigir preços
                        </button>
                        <button
                          type="button"
                          onClick={onVerComparativo}
                          className="rounded-full px-3 py-1.5 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
                        >
                          Ver no comparativo
                        </button>
                      </>
                    )}
                    {c.status === "ENVIADA" && (
                      <button
                        type="button"
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
                        disabled={pendente}
                        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                      >
                        <LinkIcon size={13} />
                        {linkCopiado === c.id ? "Link copiado" : "Copiar link"}
                      </button>
                    )}
                    {/* O texto inteiro, com o link dentro: o operador manda
                        pelo canal que ele já usa com aquele vendedor — outro
                        número de WhatsApp, e-mail pessoal, o que for. */}
                    {c.status === "ENVIADA" && (
                      <button
                        type="button"
                        onClick={() =>
                          rodar(async () => {
                            const { mensagem } = await mensagemDoConviteAction(c.id);
                            if (!(await copiarTexto(mensagem))) {
                              throw new Error("O navegador bloqueou a cópia. Tente pelo WhatsApp.");
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
                    )}
                    {c.status === "ENVIADA" && (
                      <button
                        type="button"
                        onClick={() => setReenviando(c)}
                        className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
                      >
                        <RotateCcw size={13} />
                        Reenviar
                      </button>
                    )}
                    {c.status === "ENVIADA" && (
                      <button
                        type="button"
                        onClick={() => rodar(() => recusarConviteAction(c.id))}
                        disabled={pendente}
                        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
                      >
                        <ThumbsDown size={13} />
                        Não vai cotar
                      </button>
                    )}
                    {/* Sair da cotação só antes do envio: depois disso o
                        fornecedor já foi incomodado, e apagar o convite some
                        com o link que ele pode estar preenchendo agora. */}
                    {podeRemover && c.status !== "RESPONDIDA" && (
                      <button
                        type="button"
                        onClick={() => rodar(() => removerConviteAction(c.id))}
                        disabled={pendente}
                        aria-label={`Remover ${c.supplierNome}`}
                        className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
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
          itens={cotacao.itens}
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

      {reenviando && (
        <ReenviarSheet
          alvo={reenviando}
          prazoAtual={cotacao.prazoResposta}
          pendente={pendente}
          onFechar={() => setReenviando(null)}
          onConfirmar={(prazo, canaisEscolhidos) =>
            rodar(async () => {
              const r = await enviarCotacaoAction({
                quotationId: cotacao.id,
                conviteIds: reenviando === "todos" ? undefined : [reenviando.id],
                canais: canaisEscolhidos,
                reenviar: true,
                prazoResposta: prazo,
              });
              setReenviando(null);
              setEnvios(r);
            })
          }
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

  const visiveis = disponiveis.filter((f) =>
    f.nome.toLowerCase().includes(busca.trim().toLowerCase()),
  );

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
// em preço e nada é obrigatório além do preço do que ele tem.
//
// Os mesmos três estados da tela pública — tem tudo, tem menos, não tem —
// porque a resposta é a mesma coisa; muda só quem está com o teclado. Marca
// saiu: era campo que ninguém preenchia e que empurrava o preço para fora da
// vista em tela estreita.

type Situacao = "tem" | "parcial" | "nao";

type LinhaResposta = {
  quotationItemId: string;
  situacao: Situacao;
  preco: string;
  /** Só vale em "parcial": quanto ele consegue atender. */
  quantidade: string;
};

const SITUACOES: { id: Situacao; label: string }[] = [
  { id: "tem", label: "Tem" },
  { id: "parcial", label: "Menos" },
  { id: "nao", label: "Não tem" },
];

function RespostaSheet({
  convite,
  itens,
  pendente,
  onFechar,
  onSalvar,
}: {
  convite: ConviteCotacao;
  itens: CotacaoDetalhe["itens"];
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
    }[];
  }) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaResposta[]>(() =>
    itens.map((i) => {
      const anterior = convite.respostas.find((r) => r.quotationItemId === i.id);
      const parcial =
        anterior?.disponivel === true &&
        anterior.quantidadeOfertada !== null &&
        anterior.quantidadeOfertada < i.quantidade;
      return {
        quotationItemId: i.id,
        situacao: anterior ? (anterior.disponivel ? (parcial ? "parcial" : "tem") : "nao") : "tem",
        preco: anterior ? paraMascara(anterior.precoUnitario) : "",
        quantidade: parcial ? String(anterior!.quantidadeOfertada) : "",
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

  // Tab pula de preço em preço: sem isto ele cai nos botões de disponibilidade
  // da linha seguinte, e uma lista de 30 itens vira 90 tabulações.
  const camposPreco = useRef<(HTMLInputElement | null)[]>([]);
  function aoTabular(e: React.KeyboardEvent<HTMLInputElement>, indice: number) {
    if (e.key !== "Tab") return;
    const alvo = camposPreco.current[indice + (e.shiftKey ? -1 : 1)];
    if (!alvo) return;
    e.preventDefault();
    alvo.focus();
    alvo.select();
  }

  function atualizar(id: string, patch: Partial<LinhaResposta>) {
    setLinhas((ls) => ls.map((l) => (l.quotationItemId === id ? { ...l, ...patch } : l)));
  }

  /** Quanto ele atende de fato — base do total da linha. */
  function quantidadeEfetiva(indice: number, l: LinhaResposta): number {
    const pedida = itens[indice]?.quantidade ?? 0;
    if (l.situacao === "nao") return 0;
    if (l.situacao === "parcial") return paraNumero(l.quantidade) ?? 0;
    return pedida;
  }

  const totalItens = linhas.reduce((acc, l, i) => {
    const preco = paraNumero(l.preco);
    if (l.situacao === "nao" || preco === null) return acc;
    return acc + preco * quantidadeEfetiva(i, l);
  }, 0);
  const total = totalItens + (paraNumero(frete) ?? 0);

  const preenchidos = linhas.filter(
    (l) => l.situacao === "nao" || paraNumero(l.preco) !== null,
  ).length;

  return (
    <Modal
      titulo={`Resposta de ${convite.supplierNome}`}
      descricao="Digite o que ele mandou por telefone, áudio ou PDF. Só o preço do que ele tem é obrigatório."
      largura="max-w-5xl"
      onFechar={onFechar}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <SupplierAvatar
            nome={convite.supplierNome}
            logoUrl={convite.supplierLogoUrl}
            size={32}
          />
          <span className="text-sm font-medium text-ink">{convite.supplierNome}</span>
        </span>
        <span className="text-[13px] text-muted tabular-nums">
          {preenchidos} de {linhas.length} itens preenchidos
        </span>
      </div>

      <div className="max-h-[52vh] overflow-y-auto rounded-[var(--radius)] border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Produto</th>
              <th className="w-40 px-3 py-2 text-right font-medium">Pedido</th>
              <th className="w-56 px-3 py-2 text-left font-medium">Ele tem?</th>
              <th className="w-36 px-3 py-2 text-right font-medium">Preço unit.</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {itens.map((item, i) => {
              const l = linhas[i];
              const preco = paraNumero(l.preco);
              const indisponivel = l.situacao === "nao";
              const totalLinha =
                preco === null || indisponivel ? 0 : preco * quantidadeEfetiva(i, l);
              return (
                <tr key={item.id} className={cn(indisponivel && "bg-surface-2/50")}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Thumb url={item.imagemUrl} nome={item.descricao} size={32} />
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-[14px] font-medium leading-snug",
                            indisponivel ? "text-muted" : "text-ink",
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
                      caixas de doze — e é o preço disso que está sendo digitado. */}
                  <td className="px-3 py-2 text-right">
                    <span className="block font-mono text-[14px] font-semibold tabular-nums text-ink">
                      {fmtQtd(item.quantidade)}
                    </span>
                    <span className="block text-[11px] text-faint">
                      {item.embalagemNome ?? (item.quantidade === 1 ? "unidade" : "unidades")}
                    </span>
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1 rounded-full border border-line bg-surface-2 p-0.5">
                        {SITUACOES.map((o) => {
                          const ativo = l.situacao === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => atualizar(item.id, { situacao: o.id })}
                              aria-pressed={ativo}
                              className={cn(
                                "flex-1 rounded-full px-2 py-1 text-[12px] font-medium transition-colors",
                                ativo
                                  ? o.id === "nao"
                                    ? "bg-surface text-muted shadow-[var(--shadow-m)]"
                                    : "bg-brand text-on-brand"
                                  : "text-muted hover:text-ink",
                              )}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                      {l.situacao === "parcial" && (
                        <input
                          value={l.quantidade}
                          onChange={(e) => atualizar(item.id, { quantidade: e.target.value })}
                          inputMode="decimal"
                          placeholder={`tem ${fmtQtd(item.quantidade)}`}
                          aria-label={`Quanto ${convite.supplierNome} tem de ${item.descricao}`}
                          className="w-full rounded-[var(--radius)] border border-line bg-surface px-2 py-1 text-right font-mono text-[13px] tabular-nums text-ink"
                        />
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2 text-right">
                    {indisponivel ? (
                      <span className="text-[12px] text-faint">—</span>
                    ) : (
                      <div className="relative">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-faint"
                        >
                          R$
                        </span>
                        <input
                          ref={(el) => {
                            camposPreco.current[i] = el;
                          }}
                          value={l.preco}
                          onChange={(e) =>
                            atualizar(item.id, { preco: mascaraMoeda(e.target.value) })
                          }
                          onKeyDown={(e) => aoTabular(e, i)}
                          onFocus={(e) => e.currentTarget.select()}
                          inputMode="decimal"
                          placeholder="0,00"
                          aria-label={`Preço de ${item.descricao}`}
                          className="w-full rounded-[var(--radius)] border border-line bg-surface py-1 pl-7 pr-2 text-right font-mono text-[13px] tabular-nums text-ink"
                        />
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-muted">
                    {totalLinha > 0 ? fmtMoney(totalLinha) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Entrega em (dias)</span>
          <input
            value={prazo}
            onChange={(e) => setPrazo(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            placeholder="0"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
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
          Recado do fornecedor <span className="text-faint">(opcional)</span>
        </span>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex.: pedido mínimo de 5 caixas, entrega só às terças"
          className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[13px] text-muted">
          Total da proposta{" "}
          <span className="font-mono text-[17px] font-semibold tabular-nums text-ink">
            {fmtMoney(total)}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() =>
              onSalvar({
                conviteId: convite.id,
                prazoEntregaDias: prazo ? Number(prazo) : null,
                condicaoPagamento: condicao.trim() || null,
                frete: paraNumero(frete),
                observacao: observacao.trim() || null,
                itens: linhas.map((l) => {
                  const preco = paraNumero(l.preco);
                  return {
                    quotationItemId: l.quotationItemId,
                    disponivel: l.situacao !== "nao" && preco !== null,
                    precoUnitario: preco ?? 0,
                    quantidadeOfertada:
                      l.situacao === "parcial" ? paraNumero(l.quantidade) : null,
                  };
                }),
              })
            }
            disabled={pendente}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pendente ? "Salvando…" : "Salvar resposta"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Reenvio ─────────────────────────────────────────────────
// Reenviar não é só mandar de novo: quase sempre o prazo já passou, e mandar
// o mesmo prazo vencido é pedir para ser ignorado. Por isso a data vem junto.

function ReenviarSheet({
  alvo,
  prazoAtual,
  pendente,
  onFechar,
  onConfirmar,
}: {
  alvo: ConviteCotacao | "todos";
  prazoAtual: string | null;
  pendente: boolean;
  onFechar: () => void;
  onConfirmar: (prazo: string | null, canais: Canal[]) => void;
}) {
  const [prazo, setPrazo] = useState(
    prazoAtual ? new Date(prazoAtual).toISOString().slice(0, 10) : "",
  );
  const [canais, setCanais] = useState<Canal[]>(["whatsapp"]);
  const original = prazoAtual ? new Date(prazoAtual).toISOString().slice(0, 10) : "";
  const semEmail = alvo === "todos" ? false : !alvo.email;

  return (
    <Modal
      titulo={alvo === "todos" ? "Reenviar aos pendentes" : `Reenviar para ${alvo.supplierNome}`}
      descricao="O link antigo deixa de valer: quem já tinha a página aberta precisa do endereço novo."
      onFechar={onFechar}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Novo prazo de resposta</span>
          <input
            type="date"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <CanalPicker canais={canais} onChange={setCanais} semEmail={semEmail} />
      </div>

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
          onClick={() => onConfirmar(prazo && prazo !== original ? prazo : null, canais)}
          disabled={pendente}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pendente ? "Enviando…" : "Reenviar"}
        </button>
      </div>
    </Modal>
  );
}

// ── Mensagens prontas ───────────────────────────────────────

export function EnviosSheet({ envios, onFechar }: { envios: Envio[]; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);

  return (
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
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.fornecedor}</span>
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
  );
}

// ── Casca de modal ──────────────────────────────────────────

function Modal({
  titulo,
  descricao,
  largura = "max-w-lg",
  onFechar,
  children,
}: {
  titulo: string;
  descricao?: string;
  largura?: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          "w-full rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]",
          largura,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-semibold text-ink">{titulo}</h2>
            {descricao && <p className="mt-0.5 text-[13px] text-muted">{descricao}</p>}
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
