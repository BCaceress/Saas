"use client";

import { forwardRef, useMemo, useRef, useState, useTransition } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Package,
  Send,
  Store,
  ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mascaraMoeda, paraMascara, paraNumero } from "@/lib/moeda";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import type { CotacaoPublica, ItemPublico } from "@/lib/compras/cotacao-link";
import { recusarPeloLinkAction, responderPeloLinkAction } from "./actions";

// ============================================================
// Tela do FORNECEDOR — a única do sistema com público de fora.
//
// Quem abre isto não é cliente do NoHub: é um vendedor no meio do dia, com o
// celular numa mão. Ele não vai aprender nada, não vai criar conta e não vai
// perguntar o que um campo significa — se travar, responde por WhatsApp e a
// cotação volta a ser texto solto. Daí as regras da tela:
//
//  · UM campo obrigatório: o preço do que ele diz ter. Marca e observação por
//    item saíram — eram três toques por produto que ninguém preenchia.
//  · Disponibilidade é ESCOLHA, não digitação: "tenho", "tenho menos", "não
//    tenho". A quantidade parcial só aparece quando ele diz que tem menos.
//  · A quantidade PEDIDA é o dado mais lido da tela (é o que ele precifica),
//    então é o maior tipo do cartão — com a unidade junto, porque preço de
//    fardo e preço de unidade não são o mesmo número.
//  · Celular e computador são layouts diferentes de verdade: no telefone, um
//    cartão por produto; na mesa, uma grade com foto, onde a comparação entre
//    as linhas é o que ajuda.
// ============================================================

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });

/** Campo de dinheiro: R$ fixo à esquerda, máscara no que o dedo digita. */
const CampoPreco = forwardRef<
  HTMLInputElement,
  {
    id?: string;
    valor: string;
    onValor: (v: string) => void;
    rotulo?: string;
    alinharDireita?: boolean;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  }
>(function CampoPreco({ id, valor, onValor, rotulo, alinharDireita, onKeyDown }, ref) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-faint"
      >
        R$
      </span>
      <Input
        id={id}
        ref={ref}
        aria-label={rotulo}
        inputMode="decimal"
        placeholder="0,00"
        value={valor}
        onChange={(e) => onValor(mascaraMoeda(e.target.value))}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "pl-9 font-mono text-base md:text-sm",
          alinharDireita && "text-right",
        )}
      />
    </div>
  );
});

/** Dias que faltam para o prazo — vira a etiqueta de urgência do cabeçalho. */
function faltam(iso: string | null): { texto: string; urgente: boolean } | null {
  if (!iso) return null;
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return { texto: "prazo vencido", urgente: true };
  if (dias === 0) return { texto: "último dia", urgente: true };
  if (dias === 1) return { texto: "falta 1 dia", urgente: true };
  return { texto: `faltam ${dias} dias`, urgente: dias <= 2 };
}

type Situacao = "tem" | "parcial" | "nao";

type LinhaForm = {
  itemId: string;
  situacao: Situacao;
  preco: string;
  /** Só vale em "parcial": quanto ele consegue atender. */
  qtd: string;
};

export function RespostaFornecedor({ cotacao }: { cotacao: CotacaoPublica }) {
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const respostaPorItem = useMemo(
    () => new Map(cotacao.respostas.map((r) => [r.quotationItemId, r])),
    [cotacao.respostas],
  );

  const [linhas, setLinhas] = useState<LinhaForm[]>(() =>
    cotacao.itens.map((i) => {
      const r = respostaPorItem.get(i.id);
      const parcial =
        r?.disponivel === true &&
        r.quantidadeOfertada !== null &&
        r.quantidadeOfertada < i.quantidade;
      return {
        itemId: i.id,
        situacao: r ? (r.disponivel ? (parcial ? "parcial" : "tem") : "nao") : "tem",
        preco: r ? paraMascara(r.precoUnitario) : "",
        qtd: parcial ? String(r!.quantidadeOfertada).replace(".", ",") : "",
      };
    }),
  );

  const [prazoEntrega, setPrazoEntrega] = useState(
    cotacao.cabecalho.prazoEntregaDias === null ? "" : String(cotacao.cabecalho.prazoEntregaDias),
  );
  const [condicao, setCondicao] = useState(cotacao.cabecalho.condicaoPagamento ?? "");
  const [frete, setFrete] = useState(
    cotacao.cabecalho.frete === null ? "" : paraMascara(cotacao.cabecalho.frete),
  );
  const [observacao, setObservacao] = useState(cotacao.cabecalho.observacao ?? "");

  const porItem = useMemo(
    () => new Map(linhas.map((l) => [l.itemId, l])),
    [linhas],
  );

  // Na mesa, quem digita uma lista de 30 preços usa Tab — e o Tab natural cai
  // nos botões de disponibilidade da linha seguinte, o que faz a digitação
  // parar a cada item. Aqui ele pula direto para o próximo preço.
  const camposPreco = useRef<(HTMLInputElement | null)[]>([]);

  function aoTabularPreco(e: React.KeyboardEvent<HTMLInputElement>, indice: number) {
    if (e.key !== "Tab") return;
    const alvo = camposPreco.current[indice + (e.shiftKey ? -1 : 1)];
    if (!alvo) return; // primeiro/último: deixa o Tab seguir seu caminho normal
    e.preventDefault();
    alvo.focus();
    alvo.select();
  }

  function alterar(itemId: string, campo: Partial<LinhaForm>) {
    setLinhas((atual) => atual.map((l) => (l.itemId === itemId ? { ...l, ...campo } : l)));
  }

  /** Quantidade que ele realmente atende — base do total daquela linha. */
  function quantidadeEfetiva(item: ItemPublico, linha: LinhaForm): number {
    if (linha.situacao === "nao") return 0;
    if (linha.situacao === "parcial") return paraNumero(linha.qtd) ?? 0;
    return item.quantidade;
  }

  function totalDaLinha(item: ItemPublico): number {
    const linha = porItem.get(item.id);
    if (!linha) return 0;
    const preco = paraNumero(linha.preco);
    if (preco === null) return 0;
    return preco * quantidadeEfetiva(item, linha);
  }

  const totalItens = cotacao.itens.reduce((acc, i) => acc + totalDaLinha(i), 0);
  const total = totalItens + (paraNumero(frete) ?? 0);

  // Respondido = ele disse alguma coisa sobre o item: preço, ou "não tenho".
  const respondidos = linhas.filter(
    (l) => l.situacao === "nao" || paraNumero(l.preco) !== null,
  ).length;
  const faltantes = linhas.length - respondidos;
  const progresso = linhas.length === 0 ? 0 : Math.round((respondidos / linhas.length) * 100);

  /** Abre a confirmação — só depois de checar o que impediria o envio. */
  function revisar() {
    setErro(null);
    const semPreco = linhas.filter((l) => l.situacao !== "nao" && paraNumero(l.preco) === null);
    if (semPreco.length === linhas.length) {
      setErro("Preencha ao menos um preço, ou marque os itens que você não tem.");
      return;
    }
    setConfirmando(true);
  }

  function enviar() {
    setErro(null);
    setConfirmando(false);
    startTransition(async () => {
      const r = await responderPeloLinkAction({
        token: cotacao.token,
        prazoEntregaDias: prazoEntrega ? Number(prazoEntrega) : null,
        condicaoPagamento: condicao || null,
        frete: paraNumero(frete),
        observacao: observacao || null,
        itens: linhas.map((l) => {
          const preco = paraNumero(l.preco);
          return {
            quotationItemId: l.itemId,
            // Item sem preço vira "não tenho" — resposta pela metade trava o
            // comparador do outro lado, e silêncio não é informação.
            disponivel: l.situacao !== "nao" && preco !== null,
            precoUnitario: preco ?? 0,
            quantidadeOfertada: l.situacao === "parcial" ? paraNumero(l.qtd) : null,
          };
        }),
      });
      if (r.ok) setEnviado(true);
      else setErro(r.erro);
    });
  }

  function recusar() {
    setErro(null);
    startTransition(async () => {
      const r = await recusarPeloLinkAction({ token: cotacao.token, motivo: motivo || null });
      if (r.ok) setEnviado(true);
      else setErro(r.erro);
    });
  }

  if (enviado) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
        <h1 className="font-display text-xl font-semibold text-ink">Resposta enviada</h1>
        <p className="text-sm leading-relaxed text-muted">
          A {cotacao.empresa} já recebeu sua proposta da cotação {cotacao.numero}. Pode fechar
          esta página — se precisar corrigir algo, é só abrir o link de novo.
        </p>
      </main>
    );
  }

  const prazo = faltam(cotacao.prazoResposta);

  return (
    <main className="mx-auto max-w-5xl px-4 pt-5 pb-44 sm:px-6 md:pb-32">
      <Cabecalho
        cotacao={cotacao}
        prazo={prazo}
        respondidos={respondidos}
        totalLinhas={linhas.length}
        progresso={progresso}
      />

      {/* Celular: um cartão por produto. */}
      <section className="mt-5 flex flex-col gap-3 md:hidden">
        {cotacao.itens.map((item) => (
          <CartaoItem
            key={item.id}
            item={item}
            linha={porItem.get(item.id)!}
            onAlterar={(campo) => alterar(item.id, campo)}
          />
        ))}
      </section>

      {/* Computador: grade com foto — aqui a comparação entre linhas ajuda. */}
      <section className="mt-6 hidden md:block">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_11rem_15rem_9rem] gap-4 border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            <span>Produto</span>
            <span>Quantidade pedida</span>
            <span>Você tem?</span>
            <span className="text-right">Preço unitário</span>
          </div>
          <ul className="divide-y divide-line">
            {cotacao.itens.map((item, indice) => (
              <LinhaItem
                key={item.id}
                item={item}
                linha={porItem.get(item.id)!}
                onAlterar={(campo) => alterar(item.id, campo)}
                refPreco={(el) => {
                  camposPreco.current[indice] = el;
                }}
                onKeyDownPreco={(e) => aoTabularPreco(e, indice)}
              />
            ))}
          </ul>
        </div>
      </section>

      {/* Condições da proposta inteira */}
      <section className="mt-6 rounded-[var(--radius-lg)] border border-line p-4 sm:p-5">
        <h2 className="font-display text-base font-semibold text-ink">Condições da proposta</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Valem para a cotação toda. Deixe em branco o que não se aplica.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Entrega em (dias)" htmlFor="prazo">
            <Input
              id="prazo"
              inputMode="numeric"
              placeholder="0"
              value={prazoEntrega}
              onChange={(e) => setPrazoEntrega(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className="text-base md:text-sm"
            />
          </Field>
          <Field label="Pagamento" htmlFor="condicao">
            <Input
              id="condicao"
              placeholder="28 dias"
              value={condicao}
              onChange={(e) => setCondicao(e.target.value)}
              className="text-base md:text-sm"
            />
          </Field>
          <Field label="Frete" htmlFor="frete">
            <CampoPreco id="frete" valor={frete} onValor={setFrete} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Recado para o comprador" htmlFor="obs">
            <Textarea
              id="obs"
              rows={3}
              placeholder="Opcional: pedido mínimo, promoção, prazo especial…"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="text-base md:text-sm"
            />
          </Field>
        </div>
      </section>

      {/* Recusa: quem não vai cotar avisa em um toque, e o comprador para de esperar. */}
      <section className="pt-5">
        {recusando ? (
          <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface-2 p-4">
            <p className="text-sm text-ink-2">Não vai cotar desta vez?</p>
            <Input
              placeholder="Motivo (opcional)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="text-base md:text-sm"
            />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRecusando(false)}>
                Voltar
              </Button>
              <Button variant="danger" size="sm" onClick={recusar} disabled={pendente}>
                Confirmar recusa
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRecusando(true)}
            className="inline-flex items-center gap-1.5 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            <ThumbsDown className="size-3.5" aria-hidden />
            Não vou cotar desta vez
          </button>
        )}
      </section>

      {confirmando && (
        <ConfirmarEnvio
          empresa={cotacao.empresa}
          total={total}
          faltantes={faltantes}
          pendente={pendente}
          onVoltar={() => setConfirmando(false)}
          onEnviar={enviar}
        />
      )}

      {/* Barra fixa: o total e o botão acompanham a rolagem — em lista de 30
          itens, botão no rodapé é botão que ninguém acha. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-lg font-semibold text-ink">{fmtMoeda(total)}</p>
            <p className="text-xs text-muted">
              {faltantes > 0
                ? `${faltantes} ${faltantes === 1 ? "item ainda sem resposta" : "itens ainda sem resposta"}`
                : "Tudo respondido"}
            </p>
          </div>
          <Button onClick={revisar} disabled={pendente} size="lg">
            <Send className="size-4" aria-hidden />
            {pendente ? "Enviando…" : cotacao.respondida ? "Reenviar" : "Enviar cotação"}
          </Button>
        </div>
        {erro && (
          <p className="mx-auto max-w-5xl px-4 pb-3 text-sm text-danger sm:px-6" role="alert">
            {erro}
          </p>
        )}
      </div>
    </main>
  );
}

// ── Cabeçalho ───────────────────────────────────────────────
// Quem pede, o que pede, até quando — e o quanto já foi respondido. A barra de
// progresso existe porque a dúvida do fornecedor no meio de uma lista de 30 é
// sempre "falta muito?".

function Cabecalho({
  cotacao,
  prazo,
  respondidos,
  totalLinhas,
  progresso,
}: {
  cotacao: CotacaoPublica;
  prazo: { texto: string; urgente: boolean } | null;
  respondidos: number;
  totalLinhas: number;
  progresso: number;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {cotacao.empresaLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cotacao.empresaLogoUrl}
              alt=""
              className="size-7 shrink-0 rounded-md border border-line bg-surface object-contain p-0.5"
            />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
              <Store className="size-3.5" aria-hidden />
            </span>
          )}
          <span className="truncate text-sm font-semibold text-ink">{cotacao.empresa}</span>
        </span>
        <span className="font-mono text-[12px] text-muted">{cotacao.numero}</span>
      </div>

      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{cotacao.titulo}</h1>
        <p className="mt-1 text-sm text-muted">
          Olá, {cotacao.fornecedor}. Informe seus preços abaixo.
          {/* A promessa de "sem cadastro" tranquiliza quem abre no computador e
              tem tempo de ler; no celular ela empurra a lista para baixo. */}
          <span className="hidden md:inline"> Sem cadastro e sem senha.</span>
        </p>
      </div>

      {/* Prazo e andamento dividem a linha: são as duas perguntas de quem
          abre a página ("até quando?" e "falta muito?"), e juntas ocupam uma
          faixa em vez de duas. A urgência continua na cor, não em mais texto. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {cotacao.prazoResposta ? (
          <p
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium",
              prazo?.urgente ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2",
            )}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            Responder até {fmtData(cotacao.prazoResposta)}
          </p>
        ) : (
          <span />
        )}
        <span className="shrink-0 text-[13px] font-medium text-muted tabular-nums">
          {respondidos} de {totalLinhas} respondidos
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={progresso}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Itens respondidos"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            progresso === 100 ? "bg-ok" : "bg-brand",
          )}
          style={{ width: `${progresso}%` }}
        />
      </div>

      {cotacao.observacao && (
        <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
          {cotacao.observacao}
        </p>
      )}

      {cotacao.respondida && (
        <p className="text-xs text-ok">
          Você já respondeu — pode ajustar o que quiser e enviar de novo.
        </p>
      )}
    </header>
  );
}

// ── Escolha de disponibilidade ──────────────────────────────
// Três alvos grandes no lugar de um interruptor: "tenho menos" era invisível
// quando morava dentro de um campo de quantidade que o fornecedor tinha de
// adivinhar que existia.

const OPCOES: { id: Situacao; label: string; curto: string }[] = [
  { id: "tem", label: "Tenho tudo", curto: "Tenho" },
  { id: "parcial", label: "Tenho menos", curto: "Menos" },
  { id: "nao", label: "Não tenho", curto: "Não" },
];

function Disponibilidade({
  valor,
  onEscolher,
  compacto = false,
}: {
  valor: Situacao;
  onEscolher: (s: Situacao) => void;
  compacto?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Você tem este produto?"
      className="flex gap-1 rounded-full border border-line bg-surface-2 p-1"
    >
      {OPCOES.map((o) => {
        const ativo = valor === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onEscolher(o.id)}
            className={cn(
              "min-h-9 flex-1 rounded-full px-2 text-[13px] font-medium transition-colors",
              "focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
              ativo
                ? o.id === "nao"
                  ? "bg-surface text-muted shadow-[var(--shadow-m)]"
                  : "bg-brand text-on-brand"
                : "text-muted hover:text-ink",
            )}
          >
            {compacto ? o.curto : o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Cartão (celular) ────────────────────────────────────────

function CartaoItem({
  item,
  linha,
  onAlterar,
}: {
  item: ItemPublico;
  linha: LinhaForm;
  onAlterar: (campo: Partial<LinhaForm>) => void;
}) {
  const indisponivel = linha.situacao === "nao";
  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border bg-surface p-4 transition-colors",
        indisponivel ? "border-line bg-surface-2/60" : "border-line",
      )}
    >
      <h2 className="text-[15px] font-semibold text-ink">{item.descricao}</h2>
      {item.observacao && <p className="mt-0.5 text-[12px] text-muted">{item.observacao}</p>}

      {/* A quantidade pedida é o dado que ele lê para formar o preço. */}
      <p className="mt-2 flex items-baseline gap-1.5">
        <Package className="size-4 shrink-0 self-center text-faint" aria-hidden />
        <span className="font-display text-xl font-semibold text-ink">
          {fmtQtd(item.quantidade)}
        </span>
        <span className="text-sm text-muted">
          {item.unidade ?? (item.quantidade === 1 ? "unidade" : "unidades")}
        </span>
      </p>

      <div className="mt-3">
        <Disponibilidade valor={linha.situacao} onEscolher={(s) => onAlterar({ situacao: s })} />
      </div>

      {!indisponivel && (
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Field label="Preço unitário" htmlFor={`preco-${item.id}`}>
            <CampoPreco
              id={`preco-${item.id}`}
              valor={linha.preco}
              onValor={(v) => onAlterar({ preco: v })}
            />
          </Field>
          {linha.situacao === "parcial" && (
            <Field label="Quanto você tem" htmlFor={`qtd-${item.id}`}>
              <Input
                id={`qtd-${item.id}`}
                inputMode="decimal"
                placeholder={fmtQtd(item.quantidade)}
                value={linha.qtd}
                onChange={(e) => onAlterar({ qtd: e.target.value })}
                className="font-mono text-base md:text-sm"
              />
            </Field>
          )}
        </div>
      )}

      {indisponivel && (
        <p className="mt-3 text-[13px] text-muted">
          Marcado como indisponível — o comprador vê que este item não foi cotado.
        </p>
      )}
    </article>
  );
}

// ── Linha (computador) ──────────────────────────────────────

function LinhaItem({
  item,
  linha,
  onAlterar,
  refPreco,
  onKeyDownPreco,
}: {
  item: ItemPublico;
  linha: LinhaForm;
  onAlterar: (campo: Partial<LinhaForm>) => void;
  refPreco: (el: HTMLInputElement | null) => void;
  onKeyDownPreco: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const indisponivel = linha.situacao === "nao";
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_11rem_15rem_9rem] items-center gap-4 px-4 py-3",
        indisponivel && "bg-surface-2/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {item.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imagemUrl}
            alt=""
            className="size-12 shrink-0 rounded-lg border border-line bg-surface object-cover"
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-faint">
            <Package className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{item.descricao}</p>
          {item.observacao && (
            <p className="truncate text-[12px] text-muted">{item.observacao}</p>
          )}
        </div>
      </div>

      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-lg font-semibold text-ink">
          {fmtQtd(item.quantidade)}
        </span>
        <span className="text-[13px] text-muted">
          {item.unidade ?? (item.quantidade === 1 ? "unidade" : "unidades")}
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <Disponibilidade
          valor={linha.situacao}
          onEscolher={(s) => onAlterar({ situacao: s })}
          compacto
        />
        {linha.situacao === "parcial" && (
          <Input
            aria-label={`Quanto você tem de ${item.descricao}`}
            inputMode="decimal"
            placeholder={`tenho ${fmtQtd(item.quantidade)}`}
            value={linha.qtd}
            onChange={(e) => onAlterar({ qtd: e.target.value })}
            className="font-mono text-base md:text-sm"
          />
        )}
      </div>

      <div className="text-right">
        {indisponivel ? (
          <span className="text-[13px] text-faint">não cotado</span>
        ) : (
          <>
            <CampoPreco
              ref={refPreco}
              rotulo={`Preço unitário de ${item.descricao}`}
              valor={linha.preco}
              onValor={(v) => onAlterar({ preco: v })}
              onKeyDown={onKeyDownPreco}
              alinharDireita
            />
          </>
        )}
      </div>
    </li>
  );
}

// ── Confirmação ─────────────────────────────────────────────

function ConfirmarEnvio({
  empresa,
  total,
  faltantes,
  pendente,
  onVoltar,
  onEnviar,
}: {
  empresa: string;
  total: number;
  faltantes: number;
  pendente: boolean;
  onVoltar: () => void;
  onEnviar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 sm:rounded-[var(--radius-xl)]"
      >
        <h2 id="confirmar-titulo" className="font-display text-lg font-semibold text-ink">
          Confirmar envio
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Você está enviando sua cotação para a {empresa}. Os preços informados ficam
          registrados nesta solicitação — dá para abrir o link de novo e corrigir enquanto a
          cotação estiver aberta.
        </p>
        <p className="mt-3 font-mono text-lg font-semibold text-ink">{fmtMoeda(total)}</p>
        <p className="text-xs text-muted">
          {faltantes > 0
            ? `${faltantes} ${faltantes === 1 ? "item vai sem resposta" : "itens vão sem resposta"}`
            : "Todos os itens respondidos"}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onVoltar}>
            Voltar
          </Button>
          <Button onClick={onEnviar} disabled={pendente}>
            <Send className="size-4" aria-hidden />
            {pendente ? "Enviando…" : "Confirmar e enviar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
