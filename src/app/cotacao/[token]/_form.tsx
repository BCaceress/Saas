"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Ban,
  Barcode,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  Send,
  Store,
  TagIcon,
  ThumbsDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mascaraMoeda, paraMascara, paraNumero } from "@/lib/moeda";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { rotuloPreco, rotuloPrecoCurto } from "@/lib/compras/rotulo-preco";
import { MAX_FAIXAS_ITEM } from "@/lib/compras/escalas";
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
//  · Disponibilidade é SIM ou NÃO. "Tenho menos" saiu: era um terceiro alvo em
//    toda linha para um caso raro, e a quantidade parcial que ele abria quase
//    nunca era digitada. Quem só tem parte escreve no recado do rodapé, e o
//    comprador resolve por telefone — como já resolvia.
//  · A quantidade PEDIDA é o dado mais lido da tela (é o que ele precifica),
//    então é o maior tipo do cartão — SEMPRE com a embalagem junto ("3 ×
//    Caixa (12 un.)"), e o campo de preço se chama pelo que está sendo pedido:
//    "Preço da caixa (12 un.)", não "Preço unitário". Preço de fardo e preço
//    de unidade não são o mesmo número, e o rótulo é o que evita a troca.
//  · O EAN da unidade vai na linha do produto: nome de bebida muda de loja
//    para loja, código de barras não — é por ele que o vendedor acha o item
//    no catálogo dele.
//  · PROMOÇÃO POR VOLUME ("a partir de 10 caixas, R$ 41") só aparece quando o
//    comprador pediu, e mesmo aí nasce RECOLHIDA, atrás de um link. É a tabela
//    que o vendedor já tem na cabeça e hoje manda por WhatsApp; oferecer o
//    campo é de graça para ele e vale muito para o outro lado. O que não pode
//    é custar um toque a quem não tem promoção — daí ficar fechada.
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

type Situacao = "tem" | "nao";

/** Uma linha de promoção enquanto está sendo digitada (texto, não número). */
type FaixaForm = { qtd: string; preco: string };

type LinhaForm = {
  itemId: string;
  situacao: Situacao;
  preco: string;
  /** Vazio na maioria das respostas — só quem tem tabela por volume preenche. */
  faixas: FaixaForm[];
};

/** Spinner do botão em trabalho — o retorno imediato de que o toque pegou. */
function Girando({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />;
}

export function RespostaFornecedor({ cotacao }: { cotacao: CotacaoPublica }) {
  const [pendente, startTransition] = useTransition();
  /** Qual botão está trabalhando — sem isto, enviar apagava o botão de recusar. */
  const [acao, setAcao] = useState<"enviar" | "recusar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  /** Já mandou alguma resposta — na carga ou agora, nesta mesma sessão. */
  const [jaRespondeu, setJaRespondeu] = useState(cotacao.respondida);
  const [recusando, setRecusando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");

  // O estado inicial é lazy: o Map das respostas anteriores é montado UMA vez,
  // na primeira renderização. Como useMemo, ele era recalculado a cada tecla
  // digitada para ninguém ler.
  const [linhas, setLinhas] = useState<LinhaForm[]>(() => {
    const respostaPorItem = new Map(cotacao.respostas.map((r) => [r.quotationItemId, r]));
    return cotacao.itens.map((i) => {
      const r = respostaPorItem.get(i.id);
      return {
        itemId: i.id,
        situacao: (r ? (r.disponivel ? "tem" : "nao") : "tem") as Situacao,
        preco: r ? paraMascara(r.precoUnitario) : "",
        faixas: (r?.faixas ?? []).map((f) => ({
          qtd: String(f.quantidadeMinima).replace(".", ","),
          preco: paraMascara(f.precoUnitario),
        })),
      };
    });
  });

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

  const aoTabularPreco = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, indice: number) => {
      if (e.key !== "Tab") return;
      const alvo = camposPreco.current[indice + (e.shiftKey ? -1 : 1)];
      if (!alvo) return; // primeiro/último: deixa o Tab seguir seu caminho normal
      e.preventDefault();
      alvo.focus();
      alvo.select();
    },
    [],
  );

  const registrarCampoPreco = useCallback((indice: number, el: HTMLInputElement | null) => {
    camposPreco.current[indice] = el;
  }, []);

  // Identidade estável (só `setLinhas` por dentro): é o que permite os cartões e
  // as linhas serem `memo`. Sem isso, cada tecla digitada num preço re-renderiza
  // os 30 cartões E as 30 linhas da grade — no Android de vendedor, isso é o
  // atraso entre apertar o número e ele aparecer.
  const alterar = useCallback((itemId: string, campo: Partial<LinhaForm>) => {
    setLinhas((atual) => atual.map((l) => (l.itemId === itemId ? { ...l, ...campo } : l)));
  }, []);

  function totalDaLinha(item: ItemPublico): number {
    const linha = porItem.get(item.id);
    if (!linha || linha.situacao === "nao") return 0;
    const preco = paraNumero(linha.preco);
    if (preco === null) return 0;
    return preco * item.quantidade;
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
    if (pendente) return; // toque duplo no celular não vira dois envios
    setErro(null);
    // O modal NÃO fecha aqui. Fechar antes da resposta deixava a página
    // exatamente como estava, sem nada se mexendo — é o que dava a sensação de
    // ter travado. Ele fica, com o botão girando, e só sai com o resultado.
    setAcao("enviar");
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
            // "Tenho menos" saiu da tela: quem responde pelo link atende o
            // pedido inteiro ou não atende. Parcial continua existindo no
            // banco — é o operador que registra, quando o vendedor avisa.
            quantidadeOfertada: null,
            // Linha pela metade some aqui em vez de virar erro de formulário:
            // o servidor ainda peneira (`normalizarFaixas`), e travar o envio
            // por uma faixa que o vendedor começou e desistiu é o caminho mais
            // curto para ele fechar a página.
            faixas: l.faixas.flatMap((f) => {
              const qtd = paraNumero(f.qtd);
              const p = paraNumero(f.preco);
              return qtd !== null && qtd > 0 && p !== null && p > 0
                ? [{ quantidadeMinima: qtd, precoUnitario: p }]
                : [];
            }),
          };
        }),
      });
      setAcao(null);
      setConfirmando(false);
      if (r.ok) {
        setJaRespondeu(true);
        setEnviado(true);
      } else setErro(r.erro);
    });
  }

  function recusar() {
    if (pendente) return;
    setErro(null);
    setAcao("recusar");
    startTransition(async () => {
      const r = await recusarPeloLinkAction({ token: cotacao.token, motivo: motivo || null });
      setAcao(null);
      if (r.ok) setEnviado(true);
      else setErro(r.erro);
    });
  }

  if (enviado) {
    return (
      <main className="fade-up mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="pop-in flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
        <h1 className="font-display text-xl font-semibold text-ink">Resposta enviada</h1>
        <p className="text-sm leading-relaxed text-muted">
          A {cotacao.empresa} já recebeu sua proposta da cotação {cotacao.numero}. Pode fechar
          esta página — enquanto a cotação estiver aberta, este mesmo link continua valendo para
          corrigir o que precisar.
        </p>
        {/* Errar um preço e não ter como voltar é o que faz o fornecedor
            telefonar. O caminho de volta fica aqui, não escondido no link. */}
        <button
          type="button"
          onClick={() => setEnviado(false)}
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Corrigir resposta
        </button>
      </main>
    );
  }

  const prazo = faltam(cotacao.prazoResposta);

  return (
    <main className="mx-auto max-w-[88rem] px-4 pt-5 pb-44 sm:px-6 md:pb-32">
      <Cabecalho
        cotacao={cotacao}
        jaRespondeu={jaRespondeu}
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
            pedeEscala={cotacao.pedeEscala}
            onAlterar={alterar}
          />
        ))}
      </section>

      {/* Computador: grade com foto — aqui a comparação entre linhas ajuda. */}
      <section className="mt-6 hidden md:block">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line">
          {/* O cabeçalho fala genérico ("Preço pedido") porque o rótulo exato
              muda de linha para linha — caixa numa, unidade na outra. O nome
              certo mora dentro da célula, colado no campo que ele preenche. */}
          <div className="grid grid-cols-[minmax(0,1fr)_12rem_13rem_9rem] gap-4 border-b border-line bg-surface-2 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            <span>Produto</span>
            <span>Quantidade pedida</span>
            <span className="text-right">Preço pedido</span>
            <span className="text-right">Tem?</span>
          </div>
          <ul className="divide-y divide-line">
            {cotacao.itens.map((item, indice) => (
              <LinhaItem
                key={item.id}
                item={item}
                indice={indice}
                linha={porItem.get(item.id)!}
                pedeEscala={cotacao.pedeEscala}
                onAlterar={alterar}
                onRegistrarPreco={registrarCampoPreco}
                onTabPreco={aoTabularPreco}
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
              <Button
                variant="secondary"
                size="sm"
                className="tap"
                onClick={() => setRecusando(false)}
                disabled={pendente}
              >
                Voltar
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="tap"
                onClick={recusar}
                disabled={pendente}
                aria-busy={acao === "recusar"}
              >
                {acao === "recusar" ? <Girando /> : null}
                {acao === "recusar" ? "Registrando…" : "Confirmar recusa"}
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
          enviando={acao === "enviar"}
          onVoltar={() => setConfirmando(false)}
          onEnviar={enviar}
        />
      )}

      {/* Barra fixa: o total e o botão acompanham a rolagem — em lista de 30
          itens, botão no rodapé é botão que ninguém acha. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-lg font-semibold text-ink">{fmtMoeda(total)}</p>
            <p className="text-xs text-muted">
              {faltantes > 0
                ? `${faltantes} ${faltantes === 1 ? "item ainda sem resposta" : "itens ainda sem resposta"}`
                : "Tudo respondido"}
            </p>
          </div>
          <Button
            onClick={revisar}
            disabled={pendente}
            size="lg"
            className="tap"
            aria-busy={acao === "enviar"}
          >
            {acao === "enviar" ? <Girando /> : <Send className="size-4" aria-hidden />}
            {acao === "enviar" ? "Enviando…" : jaRespondeu ? "Reenviar" : "Enviar cotação"}
          </Button>
        </div>
        {erro && (
          <p className="mx-auto max-w-[88rem] px-4 pb-3 text-sm text-danger sm:px-6" role="alert">
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
  jaRespondeu,
  prazo,
  respondidos,
  totalLinhas,
  progresso,
}: {
  cotacao: CotacaoPublica;
  jaRespondeu: boolean;
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
              width={28}
              height={28}
              decoding="async"
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
          Olá, {primeiroNome(cotacao.contato) ?? cotacao.fornecedor}. Informe seus
          preços abaixo.
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
        {/* Andamento é conferência de escritório: no celular ele empurra a
            primeira linha para fora da tela sem ajudar quem só quer digitar. */}
        <span className="hidden shrink-0 text-[13px] font-medium text-muted tabular-nums md:inline">
          {respondidos} de {totalLinhas} respondidos
        </span>
      </div>

      <div
        className="hidden h-1.5 overflow-hidden rounded-full bg-surface-2 md:block"
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

      {jaRespondeu && (
        <p className="text-xs text-ok">
          Você já respondeu — pode ajustar o que quiser e enviar de novo.
        </p>
      )}
    </header>
  );
}

// ── Disponibilidade ─────────────────────────────────────────
// UM interruptor, não três alvos: ter o produto é o caso normal, e o normal
// não merece um botão em toda linha. Só a exceção — "não tenho" — pede toque,
// e ela é reversível no mesmo lugar.

function NaoTenho({
  marcado,
  onAlternar,
  descricao,
  className,
}: {
  marcado: boolean;
  onAlternar: () => void;
  descricao: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      aria-label={`Não tenho ${descricao}`}
      onClick={onAlternar}
      className={cn(
        "tap inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors",
        "focus-visible:ring-1 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        marcado
          ? "border-line-strong bg-surface-2 text-ink-2"
          : "border-line-strong bg-surface text-muted hover:text-ink",
        className,
      )}
    >
      <Ban className="size-4 shrink-0" aria-hidden />
      {marcado ? "Não tenho" : "Não tenho"}
    </button>
  );
}

/** "3 × Caixa (12 un.)" · "2,5 kg" · "12 un" — o número nunca sai sozinho. */
function quantidadePedida(item: ItemPublico): { numero: string; unidade: string } {
  const emb = item.embalagem;
  if (emb.fator > 1) return { numero: `${fmtQtd(item.quantidade)} ×`, unidade: emb.label };
  return {
    numero: fmtQtd(item.quantidade),
    unidade: emb.label === "un" && item.quantidade !== 1 ? "unidades" : emb.label,
  };
}

/** Código de barras da linha — a única forma de o vendedor conferir o item. */
function Codigos({ item, className }: { item: ItemPublico; className?: string }) {
  if (!item.ean && !item.eanEmbalagem) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint", className)}>
      <Barcode className="size-3.5 shrink-0" aria-hidden />
      {item.ean && (
        <span className="font-mono">
          <span className="font-sans">un.</span> {item.ean}
        </span>
      )}
      {item.eanEmbalagem && (
        <span className="font-mono">
          <span className="font-sans">{item.embalagem.nome.toLowerCase()}</span>{" "}
          {item.eanEmbalagem}
        </span>
      )}
    </p>
  );
}

// ── Promoção por volume ─────────────────────────────────────
// Nasce fechada, atrás de um link discreto: a tabela por volume é do vendedor
// que TEM tabela, e cobrar um toque de quem não tem seria pagar caro por um
// campo opcional. Aberta, são duas caixas por linha — "a partir de N" e o
// preço — porque é assim que ele já fala no telefone.

const Escala = memo(function Escala({
  item,
  faixas,
  onFaixas,
}: {
  item: ItemPublico;
  faixas: FaixaForm[];
  onFaixas: (f: FaixaForm[]) => void;
}) {
  const [aberto, setAberto] = useState(faixas.length > 0);
  const unidade = item.embalagem.fator > 1 ? item.embalagem.nome.toLowerCase() : "un";

  function alterar(indice: number, campo: Partial<FaixaForm>) {
    onFaixas(faixas.map((f, i) => (i === indice ? { ...f, ...campo } : f)));
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          if (faixas.length === 0) onFaixas([{ qtd: "", preco: "" }]);
        }}
        className="tap mt-2.5 inline-flex items-center gap-1.5 text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        <TagIcon className="size-3.5" aria-hidden />
        Tem preço melhor por volume?
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2/60 p-3">
      <p className="text-[13px] font-medium text-ink">Preço melhor por volume</p>
      <p className="mt-0.5 text-[12px] text-muted">
        Se levar mais sai mais barato, diga a partir de quanto. Opcional.
      </p>

      <ul className="mt-2.5 flex flex-col gap-2">
        {faixas.map((f, i) => (
          <li key={i} className="flex items-end gap-2">
            <Field
              label="A partir de"
              htmlFor={`faixa-qtd-${item.id}-${i}`}
              className="w-[7.5rem] shrink-0"
            >
              <div className="relative">
                <Input
                  id={`faixa-qtd-${item.id}-${i}`}
                  inputMode="decimal"
                  placeholder={fmtQtd(item.quantidade * 2)}
                  value={f.qtd}
                  onChange={(e) => alterar(i, { qtd: e.target.value })}
                  className="pr-10 font-mono text-base md:text-sm"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-faint"
                >
                  {unidade}
                </span>
              </div>
            </Field>
            <Field
              label={rotuloPrecoCurto(item.embalagem)}
              htmlFor={`faixa-preco-${item.id}-${i}`}
              className="min-w-0 flex-1"
            >
              <CampoPreco
                id={`faixa-preco-${item.id}-${i}`}
                valor={f.preco}
                onValor={(v) => alterar(i, { preco: v })}
              />
            </Field>
            <button
              type="button"
              aria-label={`Tirar a faixa ${i + 1}`}
              onClick={() => {
                const restantes = faixas.filter((_, x) => x !== i);
                onFaixas(restantes);
                if (restantes.length === 0) setAberto(false);
              }}
              className="tap grid size-11 shrink-0 place-items-center rounded-[var(--radius)] border border-line-strong bg-surface text-muted transition-colors hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {faixas.length < MAX_FAIXAS_ITEM && (
        <button
          type="button"
          onClick={() => onFaixas([...faixas, { qtd: "", preco: "" }])}
          className="tap mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand"
        >
          <Plus className="size-3.5" aria-hidden />
          Outra faixa
        </button>
      )}
    </div>
  );
});

// ── Cartão (celular) ────────────────────────────────────────

const CartaoItem = memo(function CartaoItem({
  item,
  linha,
  pedeEscala,
  onAlterar,
}: {
  item: ItemPublico;
  linha: LinhaForm;
  /** A cotação aceita promoção por volume? Só então o bloco existe. */
  pedeEscala: boolean;
  onAlterar: (itemId: string, campo: Partial<LinhaForm>) => void;
}) {
  const indisponivel = linha.situacao === "nao";
  const pedida = quantidadePedida(item);
  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border bg-surface p-4 transition-colors",
        indisponivel ? "border-line bg-surface-2/60" : "border-line",
      )}
    >
      <h2 className="text-[15px] font-semibold text-ink">{item.descricao}</h2>
      {item.observacao && <p className="mt-0.5 text-[12px] text-muted">{item.observacao}</p>}
      <Codigos item={item} className="mt-1" />

      {/* A quantidade pedida é o dado que ele lê para formar o preço — e a
          embalagem anda colada nela, porque "3" e "3 caixas de 12" são
          pedidos diferentes. */}
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <Package className="size-4 shrink-0 self-center text-faint" aria-hidden />
        <span className="font-display text-xl font-semibold text-ink">{pedida.numero}</span>
        <span className="text-sm text-muted">{pedida.unidade}</span>
      </p>

      {/* No celular só existe UMA coisa a fazer: digitar o preço — e o rótulo
          dele diz de QUÊ é o preço. A exceção ("não tenho") sai do caminho e
          fica ao lado, num alvo só. */}
      <div className="mt-3 flex items-end gap-2">
        {!indisponivel && (
          <Field
            label={rotuloPreco(item.embalagem)}
            htmlFor={`preco-${item.id}`}
            className="min-w-0 flex-1"
          >
            <CampoPreco
              id={`preco-${item.id}`}
              valor={linha.preco}
              onValor={(v) => onAlterar(item.id, { preco: v })}
            />
          </Field>
        )}
        <NaoTenho
          marcado={indisponivel}
          descricao={item.descricao}
          onAlternar={() => onAlterar(item.id, { situacao: indisponivel ? "tem" : "nao" })}
          className={indisponivel ? "w-full" : "shrink-0"}
        />
      </div>

      {pedeEscala && !indisponivel && (
        <Escala
          item={item}
          faixas={linha.faixas}
          onFaixas={(faixas) => onAlterar(item.id, { faixas })}
        />
      )}

      {indisponivel && (
        <p className="mt-3 text-[13px] text-muted">
          Marcado como indisponível — o comprador vê que este item não foi cotado. Toque de
          novo para voltar atrás.
        </p>
      )}
    </article>
  );
});

// ── Linha (computador) ──────────────────────────────────────

const LinhaItem = memo(function LinhaItem({
  item,
  indice,
  linha,
  pedeEscala,
  onAlterar,
  onRegistrarPreco,
  onTabPreco,
}: {
  item: ItemPublico;
  indice: number;
  linha: LinhaForm;
  pedeEscala: boolean;
  onAlterar: (itemId: string, campo: Partial<LinhaForm>) => void;
  onRegistrarPreco: (indice: number, el: HTMLInputElement | null) => void;
  onTabPreco: (e: React.KeyboardEvent<HTMLInputElement>, indice: number) => void;
}) {
  const indisponivel = linha.situacao === "nao";
  const pedida = quantidadePedida(item);
  return (
    <li
      className={cn(
        // A escala é uma segunda faixa da MESMA linha (`grid-rows` implícito):
        // fosse um `<li>` à parte, o zebrado e a borda separariam a promoção do
        // produto a que ela pertence.
        "grid grid-cols-[minmax(0,1fr)_12rem_13rem_9rem] items-center gap-x-4 px-4 py-3",
        indisponivel && "bg-surface-2/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {item.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imagemUrl}
            alt=""
            width={48}
            height={48}
            // Lista de 30 produtos são 30 imagens: só carrega o que entra na
            // tela, e a decodificação sai da thread que atende a digitação.
            loading="lazy"
            decoding="async"
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
          <Codigos item={item} />
        </div>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-lg font-semibold text-ink">{pedida.numero}</span>
        <span className="text-[13px] text-muted">{pedida.unidade}</span>
      </p>

      {/* O rótulo por linha é o que impede preço de caixa entrar como preço de
          unidade — na grade ele fica acima do campo, curto (sem o fator, que
          já está escrito na coluna da quantidade ao lado). */}
      <div className="text-right">
        {indisponivel ? (
          <span className="text-[13px] text-faint">não cotado</span>
        ) : (
          <>
            <span className="mb-1 block text-[11px] font-medium text-muted">
              {rotuloPrecoCurto(item.embalagem)}
            </span>
            <CampoPreco
              ref={(el) => onRegistrarPreco(indice, el)}
              rotulo={`${rotuloPreco(item.embalagem)} de ${item.descricao}`}
              valor={linha.preco}
              onValor={(v) => onAlterar(item.id, { preco: v })}
              onKeyDown={(e) => onTabPreco(e, indice)}
              alinharDireita
            />
          </>
        )}
      </div>

      <div className="flex justify-end">
        <NaoTenho
          marcado={indisponivel}
          descricao={item.descricao}
          onAlternar={() => onAlterar(item.id, { situacao: indisponivel ? "tem" : "nao" })}
        />
      </div>

      {pedeEscala && !indisponivel && (
        <div className="col-span-4">
          <Escala
            item={item}
            faixas={linha.faixas}
            onFaixas={(faixas) => onAlterar(item.id, { faixas })}
          />
        </div>
      )}
    </li>
  );
});

// ── Confirmação ─────────────────────────────────────────────

function ConfirmarEnvio({
  empresa,
  total,
  faltantes,
  enviando,
  onVoltar,
  onEnviar,
}: {
  empresa: string;
  total: number;
  faltantes: number;
  enviando: boolean;
  onVoltar: () => void;
  onEnviar: () => void;
}) {
  const confirmarRef = useRef<HTMLButtonElement>(null);

  // Esc fecha, a página atrás para de rolar e o foco cai no botão que ele veio
  // apertar — no celular isso significa que o Enter do teclado já confirma.
  useEffect(() => {
    confirmarRef.current?.focus();
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, []);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape" && !enviando) onVoltar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [enviando, onVoltar]);

  return (
    <div
      className="veu-in fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      // Tocar fora fecha — menos durante o envio, que é quando fechar sozinho
      // faria o fornecedor achar que perdeu a proposta.
      onClick={() => {
        if (!enviando) onVoltar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-titulo"
        aria-busy={enviando}
        onClick={(e) => e.stopPropagation()}
        className="folha-in w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 sm:rounded-[var(--radius-xl)]"
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
          <Button variant="secondary" className="tap" onClick={onVoltar} disabled={enviando}>
            Voltar
          </Button>
          <Button ref={confirmarRef} className="tap" onClick={onEnviar} disabled={enviando}>
            {enviando ? <Girando /> : <Send className="size-4" aria-hidden />}
            {enviando ? "Enviando…" : "Confirmar e enviar"}
          </Button>
        </div>
        {/* Um envio pode levar um segundo em rede de rua. O fio abaixo do botão
            mantém alguma coisa se mexendo — é o que separa "está indo" de
            "travou" na cabeça de quem está esperando. */}
        {enviando && (
          <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full w-1/3 rounded-full bg-brand" style={{ animation: "envio-fio 1s ease-in-out infinite" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Primeiro nome de quem recebeu o link — "Olá, João" é mais gente que "Olá, AMBEV". */
function primeiroNome(nome: string | null): string | null {
  const limpo = nome?.trim();
  return limpo ? limpo.split(/\s+/)[0] : null;
}
