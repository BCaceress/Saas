"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { criarPedidosReposicaoAction } from "./actions";
import { fmtMoney, fmtQtd } from "./_ui";

// ── Finalização da reposição ──────────────────────────────────
// O pedido não "nasce documento": depois de revisar as sugestões o
// operador só escolhe COMO avisar o fornecedor. O sistema monta a
// mensagem, cria o pedido e abre o canal escolhido.

export type ItemEnvio = {
  productId: string;
  packagingId: string | null;
  nome: string;
  qtd: number; // em unidades de compra
  packagingNome: string | null;
  fatorConversao: number;
  custoUnitCompra: number | null;
};

export type GrupoEnvio = {
  supplierId: string;
  supplierNome: string;
  telefone: string | null;
  email: string | null;
  leadTimeDias: number | null;
  itens: ItemEnvio[];
};

type Canal = "whatsapp" | "email" | "copiar" | "pdf" | "salvar";

const CANAIS: { key: Canal; icon: React.ElementType; titulo: string; desc: string }[] = [
  { key: "whatsapp", icon: MessageCircle, titulo: "WhatsApp", desc: "Abre a conversa com a mensagem pronta" },
  { key: "email", icon: Mail, titulo: "E-mail", desc: "Abre seu e-mail com o pedido preenchido" },
  { key: "copiar", icon: Copy, titulo: "Copiar lista", desc: "Copia o texto para colar onde quiser" },
  { key: "pdf", icon: FileText, titulo: "PDF", desc: "Versão limpa para imprimir ou anexar" },
];

// ── Texto do pedido ───────────────────────────────────────────

const totalGrupo = (g: GrupoEnvio) => g.itens.reduce((a, it) => a + it.qtd * (it.custoUnitCompra ?? 0), 0);

const hojeMais = (dias: number) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);

/** Navegação fora do render (mailto na mesma aba) — módulo p/ agradar o compiler. */
const irPara = (url: string) => {
  window.location.href = url;
};

function textoPedido(g: GrupoEnvio, empresa: string, numero: string | null, negrito: boolean): string {
  const b = (s: string) => (negrito ? `*${s}*` : s);
  const linhas: string[] = [];
  linhas.push(b(`Pedido de compra${numero ? ` ${numero}` : ""} — ${empresa}`));
  linhas.push("");
  linhas.push(`Olá, ${g.supplierNome}! Segue nossa solicitação de reposição:`);
  linhas.push("");
  for (const it of g.itens) {
    const emb = it.packagingNome
      ? `${it.packagingNome}${it.fatorConversao !== 1 ? ` c/ ${fmtQtd(it.fatorConversao)}` : ""}`
      : "un";
    linhas.push(`• ${it.qtd}× ${emb} — ${it.nome}`);
  }
  const total = totalGrupo(g);
  if (total > 0) {
    linhas.push("");
    linhas.push(`Total estimado: ${fmtMoney(total)}`);
  }
  linhas.push("");
  linhas.push("Pode confirmar a disponibilidade e a previsão de entrega? Obrigado!");
  return linhas.join("\n");
}

function urlWhatsApp(telefone: string, texto: string): string {
  const dig = telefone.replace(/\D/g, "");
  const fone = dig.length > 11 ? dig : `55${dig}`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

function urlEmail(email: string, empresa: string, numero: string | null, texto: string): string {
  const assunto = `Pedido de compra${numero ? ` ${numero}` : ""} — ${empresa}`;
  return `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
}

// ── PDF (janela de impressão) ─────────────────────────────────

function escreverPdf(janela: Window, grupos: GrupoEnvio[], empresa: string, numeros: Map<string, string>) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const secoes = grupos
    .map((g) => {
      const numero = numeros.get(g.supplierId) ?? null;
      const linhas = g.itens
        .map((it) => {
          const emb = it.packagingNome
            ? `${it.packagingNome}${it.fatorConversao !== 1 ? ` c/ ${fmtQtd(it.fatorConversao)}` : ""}`
            : "un";
          const sub = it.custoUnitCompra != null ? fmtMoney(it.qtd * it.custoUnitCompra) : "—";
          return `<tr><td class="q">${it.qtd}×</td><td>${esc(emb)}</td><td>${esc(it.nome)}</td><td class="v">${
            it.custoUnitCompra != null ? fmtMoney(it.custoUnitCompra) : "—"
          }</td><td class="v">${sub}</td></tr>`;
        })
        .join("");
      const total = totalGrupo(g);
      return `<section>
        <header><div><h2>${esc(g.supplierNome)}</h2>${numero ? `<p class="num">${esc(numero)}</p>` : ""}</div></header>
        <table>
          <thead><tr><th class="q">Qtd</th><th>Embalagem</th><th>Produto</th><th class="v">Custo un.</th><th class="v">Subtotal</th></tr></thead>
          <tbody>${linhas}</tbody>
          ${total > 0 ? `<tfoot><tr><td colspan="4">Total estimado</td><td class="v">${fmtMoney(total)}</td></tr></tfoot>` : ""}
        </table>
      </section>`;
    })
    .join("");

  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Pedido de compra — ${esc(empresa)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; }
      body { font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; padding: 32px; max-width: 720px; margin: 0 auto; }
      h1 { font-size: 18px; margin-bottom: 2px; }
      .sub { color: #666; margin-bottom: 24px; }
      section { margin-bottom: 28px; break-inside: avoid; }
      section header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      h2 { font-size: 15px; }
      .num { font-family: ui-monospace, monospace; color: #666; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #666; border-bottom: 1px solid #ccc; padding: 6px 8px; }
      td { padding: 6px 8px; border-bottom: 1px solid #eee; }
      .q { width: 48px; white-space: nowrap; }
      .v { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      tfoot td { border-bottom: none; border-top: 2px solid #111; font-weight: 600; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>Pedido de compra</h1>
    <p class="sub">${esc(empresa)} · ${new Date().toLocaleDateString("pt-BR")}</p>
    ${secoes}
    <script>window.onload = () => window.print()</script>
  </body></html>`);
  janela.document.close();
}

// ── Sheet de finalização ──────────────────────────────────────

export function SolicitarSheet({
  grupos,
  empresa,
  siteId,
  onClose,
  onConcluido,
}: {
  grupos: GrupoEnvio[]; // já filtrados: só itens marcados, qtd > 0
  empresa: string;
  siteId: string;
  onClose: () => void;
  onConcluido: (msg: string) => void; // chamado 1× quando os pedidos são criados
}) {
  const [fase, setFase] = useState<"escolha" | "enviando" | "pronto">("escolha");
  const [canal, setCanal] = useState<Canal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verMensagem, setVerMensagem] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // supplierId → numero do pedido criado (PC-000NN)
  const [numeros, setNumeros] = useState<Map<string, string>>(new Map());

  const varios = grupos.length > 1;
  const totalItens = grupos.reduce((a, g) => a + g.itens.length, 0);
  const totalGeral = grupos.reduce((a, g) => a + totalGrupo(g), 0);

  const disponivel: Record<Canal, boolean> = useMemo(
    () => ({
      whatsapp: grupos.some((g) => !!g.telefone),
      email: grupos.some((g) => !!g.email),
      copiar: true,
      pdf: true,
      salvar: true,
    }),
    [grupos],
  );

  const textoTodos = (nums: Map<string, string>, negrito: boolean) =>
    grupos.map((g) => textoPedido(g, empresa, nums.get(g.supplierId) ?? null, negrito)).join("\n\n————————\n\n");

  async function executar(c: Canal) {
    setErro(null);
    // Nova aba aberta ainda no gesto do clique — depois do await o popup seria bloqueado.
    let janela: Window | null = null;
    if (c === "pdf" || (c === "whatsapp" && !varios)) janela = window.open("", "_blank");

    setCanal(c);
    setFase("enviando");
    try {
      const criados = await criarPedidosReposicaoAction({
        siteId,
        enviar: c !== "salvar",
        pedidos: grupos.map((g) => ({
          supplierId: g.supplierId,
          previsaoEntrega: g.leadTimeDias != null ? hojeMais(g.leadTimeDias) : null,
          items: g.itens.map((it) => ({
            productId: it.productId,
            packagingId: it.packagingId,
            qtdPedida: it.qtd,
            custoUnitario: it.custoUnitCompra ?? 0,
          })),
        })),
      });
      const nums = new Map(criados.map((p) => [p.supplierId, p.numero]));
      setNumeros(nums);

      if (c === "copiar") {
        await navigator.clipboard.writeText(textoTodos(nums, false));
        setCopiado(true);
      }
      if (c === "pdf") {
        if (janela) escreverPdf(janela, grupos, empresa, nums);
      }
      if (c === "whatsapp" && !varios && janela && grupos[0].telefone) {
        janela.location.href = urlWhatsApp(grupos[0].telefone, textoPedido(grupos[0], empresa, nums.get(grupos[0].supplierId) ?? null, true));
      }
      if (c === "email" && !varios && grupos[0].email) {
        const numero = nums.get(grupos[0].supplierId) ?? null;
        irPara(urlEmail(grupos[0].email, empresa, numero, textoPedido(grupos[0], empresa, numero, false)));
      }

      setFase("pronto");
      const n = criados.length;
      onConcluido(
        c === "salvar"
          ? n === 1
            ? "Pedido salvo como rascunho — retome na aba Pedidos."
            : `${n} pedidos salvos como rascunho — retome na aba Pedidos.`
          : n === 1
            ? `Pedido ${criados[0].numero} criado. Acompanhe em "A receber".`
            : `${n} pedidos criados. Acompanhe em "A receber".`,
      );
    } catch (e) {
      janela?.close();
      setFase("escolha");
      setErro(e instanceof Error ? e.message : "Não foi possível criar o pedido. Tente de novo.");
    }
  }

  return (
    <Sheet
      open
      onClose={() => fase !== "enviando" && onClose()}
      title={fase === "pronto" ? "Solicitação pronta" : "Como deseja solicitar esta compra?"}
      description={
        fase === "pronto"
          ? canal === "salvar"
            ? "Nada foi enviado — retome quando quiser."
            : "O pedido já está registrado — só falta o fornecedor receber."
          : varios
            ? `${grupos.length} fornecedores · ${totalItens} itens${totalGeral > 0 ? ` · ${fmtMoney(totalGeral)}` : ""}`
            : `${grupos[0].supplierNome} · ${totalItens} ${totalItens === 1 ? "item" : "itens"}${totalGeral > 0 ? ` · ${fmtMoney(totalGeral)}` : ""}`
      }
    >
      {fase !== "pronto" ? (
        <div className="flex flex-col gap-4">
          {/* Canais */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CANAIS.map(({ key, icon: Icon, titulo, desc }) => {
              const off = !disponivel[key];
              const carregando = fase === "enviando" && canal === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={off || fase === "enviando"}
                  onClick={() => executar(key)}
                  className={cn(
                    "group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors",
                    "hover:border-brand hover:bg-brand-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    (off || fase === "enviando") && "opacity-45 hover:border-line hover:bg-surface",
                  )}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted transition-colors group-hover:bg-brand-soft group-hover:text-brand">
                    {carregando ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{titulo}</span>
                    <span className="block text-xs leading-snug text-muted">
                      {off
                        ? key === "whatsapp"
                          ? "Fornecedor sem telefone cadastrado"
                          : "Fornecedor sem e-mail cadastrado"
                        : desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Salvar para depois — ação secundária */}
          <button
            type="button"
            disabled={fase === "enviando"}
            onClick={() => executar("salvar")}
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:opacity-45"
          >
            {fase === "enviando" && canal === "salvar" ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
            Salvar para depois — sem enviar nada agora
          </button>

          {erro && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{erro}</p>}

          {/* Preview da mensagem — estilo cupom */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setVerMensagem((v) => !v)}
              aria-expanded={verMensagem}
              className="flex items-center gap-1.5 self-start text-xs font-semibold text-muted transition-colors hover:text-ink"
            >
              <ChevronDown size={13} className={cn("transition-transform", verMensagem && "rotate-180")} />
              {verMensagem ? "Ocultar mensagem" : "Ver a mensagem que o fornecedor recebe"}
            </button>
            {verMensagem && (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-4">
                {grupos.map((g, i) => (
                  <div key={g.supplierId}>
                    {i > 0 && <hr className="my-4 border-dashed border-line" />}
                    <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-2">
                      {textoPedido(g, empresa, null, false)}
                    </pre>
                  </div>
                ))}
                <p className="mt-3 text-[11px] text-faint">O número do pedido (PC-…) entra na mensagem ao confirmar.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Pronto: confirmação + reabrir canal por fornecedor ── */
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-ok">
              <CheckCheck size={22} />
            </span>
            <p className="text-sm font-semibold text-ink">
              {canal === "salvar"
                ? grupos.length === 1
                  ? "Pedido salvo como rascunho"
                  : `${grupos.length} pedidos salvos como rascunho`
                : grupos.length === 1
                  ? `Pedido ${numeros.get(grupos[0].supplierId) ?? ""} criado`
                  : `${grupos.length} pedidos criados`}
            </p>
            <p className="max-w-xs text-xs text-muted">
              {canal === "salvar"
                ? "Retome quando quiser na aba Pedidos — nada foi enviado ao fornecedor."
                : canal === "copiar"
                  ? "Lista copiada. Cole na conversa ou onde preferir."
                  : 'Acompanhe a chegada da mercadoria em "A receber".'}
            </p>
          </div>

          {/* Ações por fornecedor (reabrir/abrir canal) */}
          {canal !== "salvar" && (
            <ul className="flex flex-col gap-2">
              {grupos.map((g) => {
                const numero = numeros.get(g.supplierId) ?? null;
                return (
                  <li key={g.supplierId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Building2 size={15} className="shrink-0 text-muted" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{g.supplierNome}</p>
                        {numero && <p className="font-mono text-[11px] text-faint">{numero}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {g.telefone && (
                        <a
                          href={urlWhatsApp(g.telefone, textoPedido(g, empresa, numero, true))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                        >
                          <MessageCircle size={13} /> WhatsApp <ExternalLink size={11} className="text-faint" />
                        </a>
                      )}
                      {g.email && (
                        <a
                          href={urlEmail(g.email, empresa, numero, textoPedido(g, empresa, numero, false))}
                          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                        >
                          <Mail size={13} /> E-mail
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canal !== "salvar" && (
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(textoTodos(numeros, false));
                setCopiado(true);
              }}
              className="flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {copiado ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
              {copiado ? "Lista copiada" : "Copiar lista"}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-brand px-5 py-3 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            Concluir
          </button>
        </div>
      )}
    </Sheet>
  );
}
