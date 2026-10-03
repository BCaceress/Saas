"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, Loader2, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { copiarTexto } from "@/lib/clipboard";
import { IconeWhatsApp } from "@/components/app/icone-whatsapp";
import {
  enviarPedidoAction,
  mensagemDoPedidoAction,
  prepararEnvioPedidosAction,
  type PedidoParaEnvio,
} from "@/app/(app)/pedidos/envio-actions";

// ── Envio de pedidos ao fornecedor ──────────────────────────
// Uma folha para um ou vários pedidos (a conclusão da cotação pode gerar
// três). Cada pedido escolhe quem recebe e por onde:
//
//   E-mail   → sai na hora pelo servidor; o pedido vira ENVIADO se o e-mail saiu.
//   WhatsApp → abre a conversa com a mensagem pronta; o operador volta e
//              confirma "já enviei". Só então vira ENVIADO.
//   Copiar   → mesma coisa, para qualquer outro canal.
//
// Fechar a folha no meio não perde nada: o que não foi enviado continua em
// rascunho, e a caixa de entrada de cotações cobra depois.

type Estado =
  | { fase: "pronto" }
  | { fase: "aguardando"; canal: "WHATSAPP" | "OUTRO" }
  | { fase: "enviado"; como: string }
  | { fase: "erro"; texto: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function urlWhatsApp(telefone: string, texto: string): string {
  const dig = telefone.replace(/\D/g, "");
  const fone = dig.length > 11 ? dig : `55${dig}`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

export function EnvioPedidoSheet({
  pedidoIds,
  titulo,
  descricao,
  onFechar,
}: {
  pedidoIds: string[];
  titulo?: string;
  descricao?: string;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [pedidos, setPedidos] = useState<PedidoParaEnvio[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const chave = pedidoIds.join(",");

  useEffect(() => {
    let vivo = true;
    prepararEnvioPedidosAction(chave.split(","))
      .then((r) => {
        if (vivo) setPedidos(r);
      })
      .catch((e) => {
        if (vivo) setErroCarga(e instanceof Error ? e.message : "Não foi possível abrir os pedidos.");
      });
    return () => {
      vivo = false;
    };
  }, [chave]);

  const enviados = pedidos
    ? pedidos.filter((p) => p.status !== "RASCUNHO" || estados[p.id]?.fase === "enviado").length
    : 0;
  const total = pedidos?.length ?? 0;

  function fechar() {
    if (enviados > 0) router.refresh();
    onFechar();
  }

  return (
    <Sheet
      open
      onClose={fechar}
      title={titulo ?? (pedidoIds.length === 1 ? "Enviar pedido" : "Enviar pedidos")}
      description={
        descricao ??
        "Escolha para quem vai e por onde. O pedido só conta como enviado depois que a mensagem sai."
      }
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">
            {total === 0
              ? " "
              : enviados === total
                ? total === 1
                  ? "Pedido enviado."
                  : "Todos os pedidos foram enviados."
                : `${enviados} de ${total} enviados · o resto continua em rascunho`}
          </p>
          <button
            type="button"
            onClick={fechar}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              enviados === total && total > 0
                ? "bg-brand text-on-brand hover:bg-brand-strong"
                : "border border-line text-ink hover:bg-surface-2",
            )}
          >
            {enviados === total && total > 0 ? "Concluir" : "Fechar e enviar depois"}
          </button>
        </div>
      }
    >
      {erroCarga && (
        <p role="alert" className="text-[13px] text-danger">
          {erroCarga}
        </p>
      )}
      {!pedidos && !erroCarga && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" /> Preparando as mensagens…
        </p>
      )}
      {pedidos && (
        <ul className="flex flex-col gap-3">
          {pedidos.map((p) => (
            <CartaoEnvio
              key={p.id}
              pedido={p}
              estado={estados[p.id] ?? { fase: "pronto" }}
              onEstado={(e) => setEstados((x) => ({ ...x, [p.id]: e }))}
            />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function CartaoEnvio({
  pedido,
  estado,
  onEstado,
}: {
  pedido: PedidoParaEnvio;
  estado: Estado;
  onEstado: (e: Estado) => void;
}) {
  const [contatoId, setContatoId] = useState<string | null>(pedido.contatoSugeridoId);
  const [mensagem, setMensagem] = useState(pedido.mensagem);
  const [copiado, setCopiado] = useState(false);
  const [pendente, startTransition] = useTransition();
  const contato = pedido.contatos.find((c) => c.id === contatoId) ?? null;
  const jaSaiu = pedido.status !== "RASCUNHO";

  function trocarContato(id: string | null) {
    setContatoId(id);
    const c = pedido.contatos.find((x) => x.id === id);
    if (!c) return;
    // A saudação leva o nome de quem recebe.
    startTransition(async () => {
      try {
        setMensagem(await mensagemDoPedidoAction(pedido.id, c.nome));
      } catch {
        // mantém a mensagem anterior
      }
    });
  }

  function registrar(canal: "EMAIL" | "WHATSAPP" | "OUTRO") {
    startTransition(async () => {
      const r = await enviarPedidoAction({ pedidoId: pedido.id, canal, contatoId });
      if (r.ok) {
        onEstado({
          fase: "enviado",
          como:
            canal === "EMAIL"
              ? `por e-mail para ${contato?.nome}`
              : canal === "WHATSAPP"
                ? `por WhatsApp para ${contato?.nome}`
                : `para ${contato?.nome}`,
        });
      } else {
        onEstado({ fase: "erro", texto: r.erro });
      }
    });
  }

  function abrirWhatsApp() {
    if (!contato?.telefone) return;
    window.open(urlWhatsApp(contato.telefone, mensagem), "_blank", "noopener");
    onEstado({ fase: "aguardando", canal: "WHATSAPP" });
  }

  async function copiar() {
    const ok = await copiarTexto(mensagem);
    setCopiado(ok);
    if (ok) onEstado({ fase: "aguardando", canal: "OUTRO" });
  }

  const enviado = estado.fase === "enviado";

  return (
    <li
      className={cn(
        "rounded-[var(--radius-lg)] border p-3.5",
        enviado || jaSaiu ? "border-ok/40 bg-ok-soft/40" : "border-line bg-surface",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {pedido.supplierLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pedido.supplierLogoUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-full border border-line bg-surface object-contain"
            />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-muted">
              {pedido.supplierNome.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{pedido.supplierNome}</p>
            <p className="text-[12px] text-muted">
              <span className="font-mono">{pedido.numero}</span> · {pedido.itens}{" "}
              {pedido.itens === 1 ? "item" : "itens"} ·{" "}
              <span className="font-mono tabular-nums">{brl(pedido.total)}</span>
            </p>
          </div>
        </div>
        {(enviado || jaSaiu) && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
            <CheckCircle2 size={14} /> Enviado
          </span>
        )}
      </div>

      {jaSaiu && !enviado && (
        <p className="mt-2 text-[12px] text-muted">Este pedido já tinha saído — nada a fazer aqui.</p>
      )}
      {enviado && <p className="mt-2 text-[12px] text-ok">Enviado {estado.como}.</p>}

      {!jaSaiu && !enviado && (
        <div className="mt-3 flex flex-col gap-3">
          {pedido.contatos.length === 0 ? (
            <p className="text-[12px] text-danger">
              Este fornecedor não tem telefone nem e-mail. Cadastre um contato na ficha do fornecedor
              para enviar — o pedido fica em rascunho até lá.
            </p>
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Para quem</legend>
              <div className="flex flex-wrap gap-1.5">
                {pedido.contatos.map((c) => (
                  <button
                    key={c.id ?? "empresa"}
                    type="button"
                    aria-pressed={contatoId === c.id}
                    onClick={() => trocarContato(c.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors",
                      contatoId === c.id
                        ? "border-transparent bg-brand text-on-brand"
                        : "border-line bg-surface text-ink hover:bg-surface-2",
                    )}
                  >
                    <span className="font-medium">{c.id === null ? `${c.nome} (geral)` : c.nome}</span>
                    <span className={cn("ml-1.5", contatoId === c.id ? "text-on-brand/80" : "text-faint")}>
                      {[c.telefone, c.email].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {contato && (
            <details className="rounded-[var(--radius)] border border-line bg-surface-2/60">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink-2">
                Ver a mensagem
              </summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 pb-3 font-sans text-[12px] leading-relaxed text-ink-2">
                {mensagem}
              </pre>
            </details>
          )}

          {estado.fase === "aguardando" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-brand/30 bg-brand-soft px-3 py-2">
              <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                {estado.canal === "WHATSAPP"
                  ? "Mandou a mensagem no WhatsApp?"
                  : "Colou e mandou a mensagem?"}
              </p>
              <button
                type="button"
                onClick={() => onEstado({ fase: "pronto" })}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink"
              >
                Ainda não
              </button>
              <button
                type="button"
                disabled={pendente}
                onClick={() => registrar(estado.canal)}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
              >
                {pendente ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Sim, já enviei
              </button>
            </div>
          ) : (
            contato && (
              <div className="flex flex-wrap gap-2">
                {contato.email && (
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={() => registrar("EMAIL")}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[13px] font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
                  >
                    {pendente ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                    Enviar por e-mail
                  </button>
                )}
                {contato.telefone && (
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={abrirWhatsApp}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50",
                      contato.email
                        ? "border border-line bg-surface text-ink hover:bg-surface-2"
                        : "bg-brand text-on-brand hover:bg-brand-strong",
                    )}
                  >
                    <IconeWhatsApp className="size-3.5" />
                    Abrir no WhatsApp
                  </button>
                )}
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => void copiar()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                >
                  {copiado ? <Check size={13} /> : <Copy size={13} />}
                  Copiar mensagem
                </button>
              </div>
            )
          )}

          {estado.fase === "erro" && (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
              <Send size={12} className="mt-0.5 shrink-0" />
              {estado.texto}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
