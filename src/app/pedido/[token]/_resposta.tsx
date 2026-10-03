"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Barcode, CheckCircle2, Gift, Loader2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { PedidoPublico } from "@/lib/compras/pedido-link";
import { confirmarPedidoAction, contestarPedidoAction } from "./actions";

// ============================================================
// Pedido, visto pelo fornecedor. A pergunta é uma só — "consegue entregar
// isto?" — e a tela tem duas respostas: confirmar (com a data) ou apontar o
// problema. O pedido inteiro fica à vista antes das duas, porque confirmar
// sem ler é o erro que esta tela existe para evitar.
// ============================================================

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const data = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });

/** yyyy-mm-dd de uma data ISO, para o campo de data. */
const paraCampo = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function RespostaPedido({ pedido }: { pedido: PedidoPublico }) {
  const [previsao, setPrevisao] = useState(paraCampo(pedido.previsaoEntrega));
  const [modo, setModo] = useState<"inicio" | "problema">("inicio");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<"confirmado" | "contestado" | null>(null);
  const [pendente, startTransition] = useTransition();
  const hoje = new Date().toISOString().slice(0, 10);

  function confirmar() {
    if (pendente) return;
    setErro(null);
    startTransition(async () => {
      const r = await confirmarPedidoAction({ token: pedido.token, previsaoEntrega: previsao || null });
      if (r.ok) setFeito("confirmado");
      else setErro(r.erro);
    });
  }

  function contestar() {
    if (pendente) return;
    setErro(null);
    startTransition(async () => {
      const r = await contestarPedidoAction({ token: pedido.token, motivo });
      if (r.ok) setFeito("contestado");
      else setErro(r.erro);
    });
  }

  if (feito) {
    return (
      <main className="fade-up mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <span
          className={cn(
            "pop-in flex size-14 items-center justify-center rounded-full",
            feito === "confirmado" ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent",
          )}
        >
          {feito === "confirmado" ? (
            <CheckCircle2 className="size-7" aria-hidden />
          ) : (
            <AlertTriangle className="size-7" aria-hidden />
          )}
        </span>
        <h1 className="font-display text-xl font-semibold text-ink">
          {feito === "confirmado" ? "Pedido confirmado" : "Recado enviado"}
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          {feito === "confirmado"
            ? `A ${pedido.empresa} já sabe que o pedido ${pedido.numero} está confirmado${previsao ? ` para ${data(`${previsao}T12:00:00Z`)}` : ""}. Pode fechar esta página.`
            : `A ${pedido.empresa} recebeu o que você apontou no pedido ${pedido.numero} e vai falar com você.`}
        </p>
        <button
          type="button"
          onClick={() => setFeito(null)}
          className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Voltar ao pedido
        </button>
      </main>
    );
  }

  const confirmado = !!pedido.confirmadoEm && !pedido.contestadoEm;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-48 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-line-strong pb-5">
        <span className="flex min-w-0 items-center gap-3">
          {pedido.empresaLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pedido.empresaLogoUrl}
              alt=""
              width={56}
              height={56}
              className="size-12 shrink-0 rounded-lg border border-line-strong bg-surface object-contain p-1 sm:size-14"
            />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-2 text-muted sm:size-14">
              <Store className="size-6" aria-hidden />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-xl font-semibold text-ink sm:text-2xl">
              {pedido.empresa}
            </span>
            {(pedido.empresaCnpj || pedido.empresaEndereco) && (
              <span className="mt-0.5 block truncate text-[11px] text-faint">
                {pedido.empresaCnpj && <span className="font-mono">CNPJ {pedido.empresaCnpj}</span>}
                {pedido.empresaCnpj && pedido.empresaEndereco && " · "}
                {pedido.empresaEndereco}
              </span>
            )}
          </span>
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
            Pedido <span className="font-mono">{pedido.numero}</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Olá, {pedido.fornecedor}. Confira os itens e confirme se consegue entregar em{" "}
            <span className="font-medium text-ink-2">{pedido.entregaEm}</span>.
          </p>
        </div>

        {confirmado && (
          <p className="rounded-[var(--radius)] bg-ok-soft px-3 py-2 text-sm text-ok">
            Você já confirmou este pedido. Pode ajustar a data de entrega e confirmar de novo.
          </p>
        )}
        {pedido.contestadoEm && (
          <p className="rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-sm text-accent">
            Você apontou um problema: “{pedido.contestacao}”. O comprador vai ajustar o pedido com você.
          </p>
        )}
      </header>

      <section aria-label="Itens do pedido" className="mt-5">
        <ul className="divide-y divide-line-strong overflow-hidden rounded-[var(--radius-lg)] border border-line-strong">
          {pedido.itens.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium leading-snug text-ink">{i.nome}</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  <span className="font-mono font-semibold">{qtd(i.quantidade)} ×</span> {i.embalagem}
                </p>
                {i.ean && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                    <Barcode className="size-3.5 shrink-0" aria-hidden />
                    <span className="font-mono">{i.ean}</span>
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {i.bonificacao ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
                    <Gift className="size-3" aria-hidden />
                    bonificação
                  </span>
                ) : (
                  <>
                    <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                      {brl(i.preco * i.quantidade)}
                    </p>
                    <p className="font-mono text-[12px] tabular-nums text-muted">{brl(i.preco)} cada</p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-baseline justify-between px-1">
          <span className="text-sm text-muted">Total do pedido</span>
          <span className="font-mono text-xl font-semibold tabular-nums text-ink">{brl(pedido.total)}</span>
        </p>
        {pedido.observacao && (
          <p className="mt-3 whitespace-pre-line rounded-[var(--radius)] border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
            {pedido.observacao}
          </p>
        )}
      </section>

      {modo === "problema" && (
        <section className="mt-5 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-accent/40 p-4">
          <label htmlFor="motivo" className="text-sm font-medium text-ink">
            O que não dá para atender?
          </label>
          <Textarea
            id="motivo"
            rows={3}
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: Brahma lata sem estoque até sexta; o preço da Skol mudou para R$ 44,90."
            className="text-base md:text-sm"
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="tap" onClick={() => setModo("inicio")} disabled={pendente}>
              Voltar
            </Button>
            <Button size="sm" className="tap" onClick={contestar} disabled={pendente || motivo.trim().length < 3}>
              {pendente ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Enviar ao comprador
            </Button>
          </div>
        </section>
      )}

      {/* Barra fixa: a data e o botão acompanham a rolagem. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line-strong bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-medium text-ink-2">
              Previsão de entrega
              <Input
                type="date"
                min={hoje}
                value={previsao}
                onChange={(e) => setPrevisao(e.target.value)}
                className="text-base md:text-sm"
              />
            </label>
            <Button size="lg" className="tap" onClick={confirmar} disabled={pendente} aria-busy={pendente}>
              {pendente ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              {confirmado ? "Confirmar de novo" : "Confirmar pedido"}
            </Button>
          </div>
          {modo === "inicio" && (
            <button
              type="button"
              onClick={() => setModo("problema")}
              className="self-start text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Tem algum problema com este pedido?
            </button>
          )}
          {erro && (
            <p role="alert" className="text-sm text-danger">
              {erro}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
