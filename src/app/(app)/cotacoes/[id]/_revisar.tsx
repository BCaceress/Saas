"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Layers,
  Package,
  Pencil,
  Send,
  Store,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CotacaoDetalhe } from "../_compra-types";
import { editarCotacaoAction, type Envio } from "../_compra-actions";
import { SupplierAvatar } from "../_ui";
import { EnviosSheet } from "./_convites";
import { EnvioSheet } from "./_envio";

// ── Revisar e enviar ────────────────────────────────────────
// Último passo do rascunho e o único lugar onde os dados de cabeçalho são
// pedidos: nome, loja, prazo e recado. Vêm depois da lista de propósito — na
// hora de revisar o operador já sabe o que está comprando e de quem, então
// nomear a cotação e escolher o prazo deixa de ser adivinhação.
//
// A conferência é a mesma folha que o fornecedor vai receber: itens com
// quantidade, quem recebe, até quando. Nada de números de preço aqui — preço
// é o que ainda não existe.

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** `2026-08-22` a partir do ISO guardado — o input date só entende esse formato. */
function paraInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}

export function RevisarCotacao({
  cotacao,
  sites,
  editavel,
  onIrPara,
}: {
  cotacao: CotacaoDetalhe;
  sites: { id: string; nome: string }[];
  editavel: boolean;
  onIrPara: (passo: "itens" | "fornecedores") => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  /** Folha de conferência do envio: quem recebe em cada fornecedor e por onde. */
  const [enviando, setEnviando] = useState(false);

  const [form, setForm] = useState({
    titulo: cotacao.titulo,
    siteId: cotacao.siteId,
    prazoResposta: paraInput(cotacao.prazoResposta),
    observacao: cotacao.observacao ?? "",
    pedeEscala: cotacao.pedeEscala,
  });

  const sujo =
    form.titulo !== cotacao.titulo ||
    form.siteId !== cotacao.siteId ||
    form.prazoResposta !== paraInput(cotacao.prazoResposta) ||
    form.observacao !== (cotacao.observacao ?? "") ||
    form.pedeEscala !== cotacao.pedeEscala;

  const pendentes = cotacao.convites.filter((c) => c.status === "PENDENTE");
  const semItens = cotacao.itens.length === 0;
  const semFornecedores = cotacao.convites.length === 0;
  const podeEnviar = editavel && !semItens && !semFornecedores && pendentes.length > 0;

  async function salvarAjustes() {
    await editarCotacaoAction({
      id: cotacao.id,
      titulo: form.titulo.trim(),
      siteId: form.siteId,
      prazoResposta: form.prazoResposta || null,
      observacao: form.observacao.trim() || null,
      pedeEscala: form.pedeEscala,
    });
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      try {
        await salvarAjustes();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  function abrirEnvio() {
    setErro(null);
    startTransition(async () => {
      try {
        // Salva antes de abrir a conferência: o prazo que o fornecedor vê é o
        // que está na tela, não o que sobrou do rascunho.
        if (sujo) await salvarAjustes();
        setEnviando(true);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar a cotação.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Ajustes do cabeçalho */}
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h3 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-ink">
          <Pencil size={15} className="text-muted" />
          Dados da cotação
        </h3>

        <div className="mt-3 flex flex-col gap-3">
          {/* Nome e prazo dividem a linha: o nome é o campo largo (uma frase),
              o prazo é só uma data — meia tela para cada desperdiçava o topo. */}
          <div
            className={cn(
              "grid gap-3",
              sites.length > 1 ? "sm:grid-cols-[2fr_1fr_1fr]" : "sm:grid-cols-[2fr_1fr]",
            )}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-2">Nome</span>
              <input
                value={form.titulo}
                onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                disabled={!editavel}
                placeholder="Ex.: Reposição de cervejas — agosto"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
              />
            </label>

            <label className={cn("flex flex-col gap-1", sites.length <= 1 && "hidden")}>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <Store size={12} className="text-faint" />
                Entregar em
              </span>
              <select
                value={form.siteId}
                onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
                disabled={!editavel}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                <CalendarClock size={12} className="text-faint" />
                Responder até
              </span>
              <input
                type="date"
                value={form.prazoResposta}
                onChange={(e) => setForm((f) => ({ ...f, prazoResposta: e.target.value }))}
                disabled={!editavel}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">
              Recado ao fornecedor <span className="text-faint">(opcional)</span>
            </span>
            <textarea
              value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
              disabled={!editavel}
              rows={2}
              placeholder="Ex.: entrega só de manhã, pagamento em 28 dias"
              className="resize-none rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
            />
          </label>

          {/* A chave da escala. Fica aqui, no cabeçalho, porque vale para a
              cotação inteira e muda o que o FORNECEDOR vê: ligada, cada item
              ganha um campo opcional de "a partir de N, R$ X". Desligada — o
              padrão — a tela dele continua com um preço por item, que é o
              piso do que um vendedor responde no meio do dia. */}
          <button
            type="button"
            role="switch"
            aria-checked={form.pedeEscala}
            disabled={!editavel}
            onClick={() => setForm((f) => ({ ...f, pedeEscala: !f.pedeEscala }))}
            className={cn(
              "flex items-start gap-2.5 rounded-[var(--radius)] border p-3 text-left transition-colors disabled:opacity-60",
              form.pedeEscala
                ? "border-brand bg-brand-soft"
                : "border-line bg-surface hover:bg-surface-2",
            )}
          >
            <Layers
              size={15}
              className={cn("mt-0.5 shrink-0", form.pedeEscala ? "text-brand" : "text-faint")}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">
                Perguntar preço por volume
              </span>
              <span className="block text-[12px] text-muted">
                O fornecedor pode informar faixas &mdash; &ldquo;a partir de 10 caixas, R$ 41&rdquo;. No
                comparativo, a lente &ldquo;Melhor oportunidade&rdquo; mostra quanto cada
                promoção economiza e quantos dias de estoque ela cria.
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "ml-auto mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                form.pedeEscala ? "bg-brand" : "bg-line-strong",
              )}
            >
              <span
                className={cn(
                  "block size-4 rounded-full bg-surface transition-transform",
                  form.pedeEscala && "translate-x-4",
                )}
              />
            </span>
          </button>

          {sujo && editavel && (
            <button
              type="button"
              onClick={salvar}
              disabled={pendente || form.titulo.trim().length < 3}
              className="self-start rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {pendente ? "Salvando…" : "Salvar alterações"}
            </button>
          )}
        </div>
      </section>

      {/* Conferência */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco
          icone={<Package size={15} />}
          titulo={`${cotacao.itens.length} ${cotacao.itens.length === 1 ? "produto" : "produtos"}`}
          vazio={semItens ? "Nenhum produto na lista." : null}
          acao={editavel ? { label: "Editar produtos", onClick: () => onIrPara("itens") } : null}
        >
          <ul className="divide-y divide-line">
            {cotacao.itens.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.descricao}</span>
                <span className="shrink-0 font-mono text-[13px] tabular-nums text-muted">
                  {fmtQtd(i.quantidade)}
                  {i.embalagemNome ? ` ${i.embalagemNome}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>

        <Bloco
          icone={<Users size={15} />}
          titulo={`${cotacao.convites.length} ${cotacao.convites.length === 1 ? "fornecedor" : "fornecedores"}`}
          vazio={semFornecedores ? "Nenhum fornecedor escolhido ainda." : null}
          acao={
            editavel
              ? { label: "Editar fornecedores", onClick: () => onIrPara("fornecedores") }
              : null
          }
        >
          <ul className="divide-y divide-line">
            {cotacao.convites.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={24} />
                  <span className="truncate text-[13px] text-ink">{c.supplierNome}</span>
                </span>
                <span className="shrink-0 truncate text-[11px] text-faint">
                  {c.status !== "PENDENTE"
                    ? "já recebeu"
                    : (destinatarioDoConvite(c) ?? "sem contato")}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      </div>

      {cotacao.convites.some(
        (c) => c.status === "PENDENTE" && c.contatos.length === 0 && !c.telefone && !c.email,
      ) && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-[12px] text-ink-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent" />
          Tem fornecedor sem telefone nem e-mail cadastrado. A cotação é enviada do mesmo
          jeito — a mensagem sai pronta para você copiar e mandar pelo canal que usar com ele.
        </p>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3">
        <p className="text-[13px] text-muted">
          {semItens
            ? "Adicione ao menos um produto para enviar."
            : semFornecedores
              ? "Convide ao menos um fornecedor para enviar."
              : pendentes.length === 0
                ? "Todos os fornecedores já receberam esta cotação."
                : `${pendentes.length} ${pendentes.length === 1 ? "fornecedor recebe" : "fornecedores recebem"} o link agora.`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={abrirEnvio}
          disabled={!podeEnviar || pendente}
          className={cn(
            "flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50",
          )}
        >
          <Send size={15} />
          {pendente ? "Enviando…" : "Enviar cotação"}
        </button>
        </div>
      </div>

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

      {envios && <EnviosSheet envios={envios} onFechar={() => setEnvios(null)} />}
    </div>
  );
}

/** Quem recebe hoje: o contato escolhido, o principal, ou o telefone da empresa. */
function destinatarioDoConvite(c: {
  contatoId: string | null;
  contatos: { id: string; nome: string; principal: boolean }[];
  telefone: string | null;
  email: string | null;
}): string | null {
  const contato =
    c.contatos.find((x) => x.id === c.contatoId) ??
    c.contatos.find((x) => x.principal) ??
    c.contatos[0];
  if (contato) return contato.nome;
  return c.telefone || c.email ? "contato geral" : null;
}

function Bloco({
  icone,
  titulo,
  vazio,
  acao,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  vazio: string | null;
  acao: { label: string; onClick: () => void } | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-ink">
          <span className="text-muted">{icone}</span>
          {titulo}
        </h3>
        {acao && (
          <button
            type="button"
            onClick={acao.onClick}
            className="rounded-full px-2.5 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
          >
            {acao.label}
          </button>
        )}
      </div>
      {vazio ? <p className="mt-2 text-[13px] text-muted">{vazio}</p> : <div className="mt-1">{children}</div>}
    </section>
  );
}
