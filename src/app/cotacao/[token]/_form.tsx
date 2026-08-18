"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Send, Store, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import type { CotacaoPublica } from "@/lib/compras/cotacao-link";
import { recusarPeloLinkAction, responderPeloLinkAction } from "./actions";

// ── Formulário do fornecedor ────────────────────────────────
// Regras que valem para tudo aqui: uma coluna, teclado numérico no que é
// número, e nenhum campo obrigatório além do preço do que ele marcar como
// disponível. Cada exigência a mais é um fornecedor a menos respondendo.

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });

/** Aceita "5,89" e "5.89" — o fornecedor digita como está acostumado. */
function paraNumero(texto: string): number | null {
  const limpo = texto.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type LinhaForm = {
  itemId: string;
  disponivel: boolean;
  preco: string;
  marca: string;
};

export function RespostaFornecedor({ cotacao }: { cotacao: CotacaoPublica }) {
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const respostaPorItem = useMemo(
    () => new Map(cotacao.respostas.map((r) => [r.quotationItemId, r])),
    [cotacao.respostas],
  );

  const [linhas, setLinhas] = useState<LinhaForm[]>(() =>
    cotacao.itens.map((i) => {
      const r = respostaPorItem.get(i.id);
      return {
        itemId: i.id,
        disponivel: r ? r.disponivel : true,
        preco: r && r.precoUnitario > 0 ? String(r.precoUnitario).replace(".", ",") : "",
        marca: r?.marca ?? "",
      };
    }),
  );

  const [prazoEntrega, setPrazoEntrega] = useState(
    cotacao.cabecalho.prazoEntregaDias === null ? "" : String(cotacao.cabecalho.prazoEntregaDias),
  );
  const [condicao, setCondicao] = useState(cotacao.cabecalho.condicaoPagamento ?? "");
  const [frete, setFrete] = useState(
    cotacao.cabecalho.frete === null ? "" : String(cotacao.cabecalho.frete).replace(".", ","),
  );
  const [observacao, setObservacao] = useState(cotacao.cabecalho.observacao ?? "");

  function alterar(itemId: string, campo: Partial<LinhaForm>) {
    setLinhas((atual) =>
      atual.map((l) => (l.itemId === itemId ? { ...l, ...campo } : l)),
    );
  }

  // Total do que ele já preencheu: o fornecedor confere a própria proposta
  // antes de mandar, e some a dúvida de "quanto isso deu no fim".
  const total = useMemo(() => {
    const qtdPorItem = new Map(cotacao.itens.map((i) => [i.id, i.quantidade]));
    const itens = linhas.reduce((acc, l) => {
      if (!l.disponivel) return acc;
      const preco = paraNumero(l.preco);
      if (preco === null) return acc;
      return acc + preco * (qtdPorItem.get(l.itemId) ?? 0);
    }, 0);
    return itens + (paraNumero(frete) ?? 0);
  }, [linhas, frete, cotacao.itens]);

  const preenchidos = linhas.filter((l) => !l.disponivel || paraNumero(l.preco) !== null).length;
  const faltam = linhas.length - preenchidos;

  function enviar() {
    setErro(null);
    const semPreco = linhas.filter((l) => l.disponivel && paraNumero(l.preco) === null);
    if (semPreco.length === linhas.length) {
      setErro("Preencha ao menos um preço, ou marque os itens que você não tem.");
      return;
    }
    startTransition(async () => {
      const r = await responderPeloLinkAction({
        token: cotacao.token,
        prazoEntregaDias: prazoEntrega ? Number(prazoEntrega) : null,
        condicaoPagamento: condicao || null,
        frete: paraNumero(frete),
        observacao: observacao || null,
        itens: linhas.map((l) => ({
          quotationItemId: l.itemId,
          // Item sem preço vira "não tenho" — resposta pela metade trava o
          // comparador do outro lado, e silêncio não é informação.
          disponivel: l.disponivel && paraNumero(l.preco) !== null,
          precoUnitario: paraNumero(l.preco) ?? 0,
          marca: l.marca || null,
        })),
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

  return (
    <main className="mx-auto max-w-2xl px-4 pb-40 pt-6 sm:px-6">
      {/* Cabeçalho: quem pede, o que pede e até quando. */}
      <header className="flex flex-col gap-2 border-b border-line pb-5">
        <span className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
          <Store className="size-3.5" aria-hidden />
          {cotacao.empresa}
        </span>
        <h1 className="font-display text-2xl font-semibold text-ink">{cotacao.titulo}</h1>
        <p className="text-sm text-muted">
          Cotação <span className="font-mono text-ink-2">{cotacao.numero}</span> para{" "}
          <span className="text-ink-2">{cotacao.fornecedor}</span>
          {cotacao.prazoResposta && <> · resposta até {fmtData(cotacao.prazoResposta)}</>}
        </p>
        {cotacao.observacao && (
          <p className="rounded-[var(--radius)] bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
            {cotacao.observacao}
          </p>
        )}
        {cotacao.respondida && (
          <p className="text-xs text-ok">
            Você já respondeu — pode ajustar o que quiser e enviar de novo.
          </p>
        )}
      </header>

      {/* Itens */}
      <section className="flex flex-col divide-y divide-line">
        {cotacao.itens.map((item) => {
          const linha = linhas.find((l) => l.itemId === item.id)!;
          return (
            <div key={item.id} className="flex flex-col gap-3 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{item.descricao}</p>
                  <p className="text-xs text-muted">
                    {fmtQtd(item.quantidade)}
                    {item.unidade ? ` × ${item.unidade}` : ""}
                    {item.observacao ? ` · ${item.observacao}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => alterar(item.id, { disponivel: !linha.disponivel })}
                  aria-pressed={!linha.disponivel}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
                    linha.disponivel
                      ? "border-line-button text-muted hover:bg-surface-2"
                      : "border-transparent bg-surface-2 text-faint",
                  )}
                >
                  {linha.disponivel ? "Não tenho" : "Não tenho ✓"}
                </button>
              </div>

              {linha.disponivel && (
                <div className="grid grid-cols-[1fr_1fr] gap-2.5">
                  <Field label="Preço unitário" htmlFor={`preco-${item.id}`}>
                    <Input
                      id={`preco-${item.id}`}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={linha.preco}
                      onChange={(e) => alterar(item.id, { preco: e.target.value })}
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Marca (se for outra)" htmlFor={`marca-${item.id}`}>
                    <Input
                      id={`marca-${item.id}`}
                      placeholder="opcional"
                      value={linha.marca}
                      onChange={(e) => alterar(item.id, { marca: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Condições da proposta inteira */}
      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <h2 className="font-display text-base font-semibold text-ink">Condições</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Entrega em (dias)" htmlFor="prazo">
            <Input
              id="prazo"
              inputMode="numeric"
              placeholder="0"
              value={prazoEntrega}
              onChange={(e) => setPrazoEntrega(e.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </Field>
          <Field label="Pagamento" htmlFor="condicao">
            <Input
              id="condicao"
              placeholder="28 dias"
              value={condicao}
              onChange={(e) => setCondicao(e.target.value)}
            />
          </Field>
          <Field label="Frete" htmlFor="frete">
            <Input
              id="frete"
              inputMode="decimal"
              placeholder="0,00"
              value={frete}
              onChange={(e) => setFrete(e.target.value)}
              className="font-mono"
            />
          </Field>
        </div>
        <Field label="Recado para o comprador" htmlFor="obs">
          <Textarea
            id="obs"
            rows={3}
            placeholder="Opcional: pedido mínimo, promoção, prazo especial…"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </Field>
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

      {/* Barra fixa: o total e o botão acompanham a rolagem — em lista de 30
          itens, botão no rodapé é botão que ninguém acha. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-lg font-semibold text-ink">{fmtMoeda(total)}</p>
            <p className="text-xs text-muted">
              {faltam > 0 ? `${faltam} item(s) sem preço` : "Tudo preenchido"}
            </p>
          </div>
          <Button onClick={enviar} disabled={pendente} size="lg">
            <Send className="size-4" aria-hidden />
            {pendente ? "Enviando…" : cotacao.respondida ? "Reenviar" : "Enviar resposta"}
          </Button>
        </div>
        {erro && (
          <p className="mx-auto max-w-2xl px-4 pb-3 text-sm text-danger sm:px-6" role="alert">
            {erro}
          </p>
        )}
      </div>
    </main>
  );
}
