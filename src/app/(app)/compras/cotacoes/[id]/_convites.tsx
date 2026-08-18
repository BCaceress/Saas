"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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
import { EstadoVazio, SupplierAvatar, fmtMoney, fmtQuando } from "../../_catalogo/ui";
import type { ConviteCotacao, CotacaoDetalhe, FornecedorOpcao } from "../_types";
import {
  convidarFornecedoresAction,
  enviarCotacaoAction,
  linkDoConviteAction,
  recusarConviteAction,
  registrarRespostaAction,
  removerConviteAction,
} from "../actions";

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

type Envio = {
  conviteId: string;
  fornecedor: string;
  mensagem: string;
  /** Endereço público onde o fornecedor preenche os preços (um por convite). */
  link: string | null;
  waLink: string | null;
};

export function ConvitesCotacao({
  cotacao,
  fornecedores,
  editavel,
  onVerComparativo,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  editavel: boolean;
  onVerComparativo: () => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [respondendo, setRespondendo] = useState<ConviteCotacao | null>(null);
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      {editavel && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setConvidando(true)}
            disabled={disponiveis.length === 0}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Users size={15} />
            Convidar fornecedores
          </button>

          {pendentes.length > 0 && cotacao.itens.length > 0 && (
            <button
              type="button"
              onClick={() =>
                rodar(async () => {
                  const r = await enviarCotacaoAction({ quotationId: cotacao.id });
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
          )}
        </div>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {cotacao.convites.length === 0 ? (
        <EstadoVazio
          icon={<Users size={20} />}
          titulo="Ninguém foi convidado ainda"
          descricao="Escolha os fornecedores que vão receber a lista. Quanto mais gente na disputa, melhor o preço."
          acao={
            editavel ? (
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
              <SupplierAvatar nome={c.supplierNome} size={38} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{c.supplierNome}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      STATUS[c.status].classe,
                    )}
                  >
                    {STATUS[c.status].label}
                  </span>
                </div>

                <p className="mt-0.5 text-[12px] text-muted">
                  {c.status === "RESPONDIDA"
                    ? `Respondeu ${fmtQuando(c.respondidaEm)} · ${c.itensAtendidos} de ${cotacao.itens.length} itens`
                    : c.status === "ENVIADA"
                      ? `Enviado ${fmtQuando(c.enviadaEm)}`
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
                            await navigator.clipboard.writeText(url);
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
                    {c.status !== "RESPONDIDA" && (
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

type LinhaResposta = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: string;
  marca: string;
};

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
      marca: string | null;
    }[];
  }) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaResposta[]>(() =>
    itens.map((i) => {
      const anterior = convite.respostas.find((r) => r.quotationItemId === i.id);
      return {
        quotationItemId: i.id,
        disponivel: anterior?.disponivel ?? true,
        precoUnitario: anterior ? String(anterior.precoUnitario) : "",
        marca: anterior?.marca ?? "",
      };
    }),
  );
  const [prazo, setPrazo] = useState(
    convite.prazoEntregaDias === null ? "" : String(convite.prazoEntregaDias),
  );
  const [condicao, setCondicao] = useState(convite.condicaoPagamento ?? "");
  const [frete, setFrete] = useState(convite.frete === null ? "" : String(convite.frete));
  const [observacao, setObservacao] = useState(convite.observacao ?? "");

  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  const total =
    linhas.reduce((acc, l, i) => {
      if (!l.disponivel) return acc;
      return acc + num(l.precoUnitario) * (itens[i]?.quantidade ?? 0);
    }, 0) + num(frete);

  function atualizar(id: string, patch: Partial<LinhaResposta>) {
    setLinhas((ls) => ls.map((l) => (l.quotationItemId === id ? { ...l, ...patch } : l)));
  }

  return (
    <Modal
      titulo={`Resposta de ${convite.supplierNome}`}
      descricao="Digite o que o fornecedor mandou. Item sem preço marque como indisponível."
      largura="max-w-3xl"
      onFechar={onFechar}
    >
      <div className="max-h-[45vh] overflow-y-auto rounded-[var(--radius)] border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qtd</th>
              <th className="px-3 py-2 text-right font-medium">Preço unit.</th>
              <th className="px-3 py-2 text-left font-medium">Marca</th>
              <th className="px-3 py-2 text-center font-medium">Tem?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {itens.map((item, i) => {
              const l = linhas[i];
              return (
                <tr key={item.id} className={cn(!l.disponivel && "opacity-50")}>
                  <td className="max-w-0 px-3 py-2">
                    <span className="block truncate text-ink">{item.descricao}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-muted">
                    {item.quantidade}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      value={l.precoUnitario}
                      onChange={(e) =>
                        atualizar(item.id, { precoUnitario: e.target.value })
                      }
                      disabled={!l.disponivel}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-24 rounded-[var(--radius)] border border-line bg-surface px-2 py-1 text-right font-mono text-[13px] tabular-nums text-ink disabled:bg-surface-2"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={l.marca}
                      onChange={(e) => atualizar(item.id, { marca: e.target.value })}
                      disabled={!l.disponivel}
                      placeholder="—"
                      className="w-28 rounded-[var(--radius)] border border-line bg-surface px-2 py-1 text-[13px] text-ink disabled:bg-surface-2"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={l.disponivel}
                      onChange={() => atualizar(item.id, { disponivel: !l.disponivel })}
                      aria-label={`${item.descricao} disponível`}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
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
            onChange={(e) => setPrazo(e.target.value)}
            inputMode="numeric"
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
          <input
            value={frete}
            onChange={(e) => setFrete(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-right font-mono text-sm tabular-nums text-ink"
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[12px] font-medium text-ink-2">
          Recado do fornecedor <span className="text-faint">(opcional)</span>
        </span>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
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
                frete: frete ? num(frete) : null,
                observacao: observacao.trim() || null,
                itens: linhas.map((l) => ({
                  quotationItemId: l.quotationItemId,
                  disponivel: l.disponivel,
                  precoUnitario: num(l.precoUnitario),
                  marca: l.marca.trim() || null,
                })),
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

// ── Mensagens prontas ───────────────────────────────────────

function EnviosSheet({ envios, onFechar }: { envios: Envio[]; onFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);

  return (
    <Modal
      titulo="Mensagem pronta"
      descricao="A mensagem já leva o link onde o fornecedor preenche os preços — sem cadastro, direto do celular dele. Mande pelo WhatsApp ou pelo canal que vocês usam."
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
                  void navigator.clipboard.writeText(e.mensagem);
                  setCopiado(e.conviteId);
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

            {e.link && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(e.link!);
                  setLinkCopiado(e.conviteId);
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
