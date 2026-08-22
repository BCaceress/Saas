"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Undo2,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
  FileText,
  Package,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid } from "../../cotacoes/_catalogo/ui";
import { fmtMoney, fmtQtd } from "../../cotacoes/_catalogo/format";
import {
  criarDevolucaoAction,
  confirmarDevolucaoAction,
  cancelarDevolucaoAction,
  emitirNfeDevolucaoAction,
  entradasDoFornecedorAction,
  itensDaEntradaAction,
} from "./actions";
import type { DevolucaoRow } from "./_data";

// ============================================================
// Devolução ao fornecedor.
//
// O desenho segue o que o operador faz de verdade: ele não escolhe produtos
// avulsos, ele olha a carga que chegou e diz "isto aqui volta". Por isso o
// formulário começa pelo fornecedor, oferece as últimas entradas, e só cai no
// modo avulso quando nenhuma serve.
// ============================================================

const MOTIVOS = [
  { value: "AVARIA", label: "Avaria", desc: "Chegou quebrado, amassado, vazando." },
  { value: "VALIDADE", label: "Validade", desc: "Vencido ou perto demais do vencimento." },
  { value: "DIVERGENCIA", label: "Divergência", desc: "Veio diferente do pedido ou da nota." },
  { value: "RECUSA", label: "Recusa", desc: "Recusado ainda no recebimento." },
  { value: "ACORDO_COMERCIAL", label: "Acordo comercial", desc: "Combinado com o fornecedor." },
  { value: "OUTRO", label: "Outro", desc: "Explique na observação." },
] as const;

type MotivoValue = (typeof MOTIVOS)[number]["value"];

const MOTIVO_LABEL: Record<string, string> = Object.fromEntries(
  MOTIVOS.map((m) => [m.value, m.label]),
);

const STATUS_META: Record<string, { label: string; tone: "neutral" | "ok" | "danger" }> = {
  RASCUNHO: { label: "Rascunho", tone: "neutral" },
  CONFIRMADA: { label: "Confirmada", tone: "ok" },
  CANCELADA: { label: "Cancelada", tone: "danger" },
};

const campo =
  "w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

const rotulo = "text-xs font-semibold uppercase tracking-wide text-faint";

type Site = { id: string; nome: string };
type Supplier = { id: string; nome: string; comprou: boolean };
type Entrada = Awaited<ReturnType<typeof entradasDoFornecedorAction>>[number];
type ItemEntrada = NonNullable<Awaited<ReturnType<typeof itensDaEntradaAction>>>["items"][number];

type Linha = ItemEntrada & { devolver: number };

export function DevolucoesView({
  rows,
  sites,
  suppliers,
  siteId,
  podeDevolver,
}: {
  rows: DevolucaoRow[];
  sites: Site[];
  suppliers: Supplier[];
  siteId: string | null;
  podeDevolver: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const confirmadas = rows.filter((r) => r.status === "CONFIRMADA");
  const rascunhos = rows.filter((r) => r.status === "RASCUNHO");
  const valorDevolvido = confirmadas.reduce((a, r) => a + r.valorTotal, 0);

  function confirmar(id: string) {
    setErro(null);
    startTransition(async () => {
      try {
        const r = await confirmarDevolucaoAction(id);
        router.refresh();
        if (r.sobra > 0) {
          setErro(
            `Devolução confirmada. Sobraram ${fmtMoney(r.sobra)} sem título em aberto para abater — combine o crédito com o fornecedor.`,
          );
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao confirmar.");
      }
    });
  }

  // Emissão é separada da confirmação de propósito: a mercadoria sai hoje e a
  // nota pode sair amanhã. Amarrar as duas travaria a operação física por causa
  // de configuração fiscal.
  function emitirNota(id: string) {
    setErro(null);
    startTransition(async () => {
      try {
        await emitirNfeDevolucaoAction(id);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao emitir a nota.");
      }
    });
  }

  function cancelar(id: string) {
    const motivo = window.prompt("Por que está cancelando esta devolução?");
    if (!motivo?.trim()) return;
    setErro(null);
    startTransition(async () => {
      try {
        await cancelarDevolucaoAction({ returnId: id, motivo });
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Devoluções ao fornecedor</h2>
          <p className="text-sm text-muted">
            Mercadoria que volta. Ao confirmar, sai do estoque e abate o que se deve.
          </p>
        </div>
        {podeDevolver && (
          <Button size="sm" onClick={() => setAberto(true)}>
            <Plus size={15} />
            Nova devolução
          </Button>
        )}
      </div>

      {rows.length > 0 && (
        <MetricaGrid className="sm:grid-cols-3 lg:grid-cols-3">
          <Metrica label="Devoluções" valor={String(rows.length)} sub="nesta loja" />
          <Metrica
            label="Aguardando confirmação"
            valor={String(rascunhos.length)}
            tom={rascunhos.length > 0 ? "accent" : "ink"}
            sub={rascunhos.length > 0 ? "ainda não saíram do estoque" : "nenhuma pendente"}
          />
          <Metrica label="Devolvido" valor={fmtMoney(valorDevolvido)} sub="valor confirmado" />
        </MetricaGrid>
      )}

      {erro && (
        <p className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {erro}
        </p>
      )}

      {rows.length === 0 ? (
        <EstadoVazio
          icon={<Undo2 size={20} />}
          titulo="Nenhuma devolução registrada"
          descricao="Quando uma mercadoria voltar para o fornecedor — avaria, validade, divergência — registre aqui para o estoque e o financeiro acompanharem."
          acao={
            podeDevolver ? (
              <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
                Registrar devolução
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-ink">{r.numero}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <Badge>{MOTIVO_LABEL[r.motivo] ?? r.motivo}</Badge>
                      {r.pedidoNumero && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                          <FileText size={11} />
                          {r.pedidoNumero}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink">{r.supplierNome}</p>
                    <p className="truncate text-xs text-muted">{r.observacao}</p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-[15px] font-semibold text-ink">
                      {fmtMoney(r.valorTotal)}
                    </p>
                    <p className="text-[11px] text-muted">
                      {r.itens} {r.itens === 1 ? "item" : "itens"} ·{" "}
                      {r.createdAt.toLocaleDateString("pt-BR")}
                    </p>
                  </div>

                  {podeDevolver && r.status === "RASCUNHO" && (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => confirmar(r.id)}>
                        <Check size={14} />
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => cancelar(r.id)}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  )}

                  {podeDevolver && r.status === "CONFIRMADA" && !r.numeroNota && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => emitirNota(r.id)}
                    >
                      <FileText size={14} />
                      Emitir NF-e
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {aberto && (
        <NovaDevolucaoSheet
          sites={sites}
          suppliers={suppliers}
          siteIdInicial={siteId ?? sites[0]?.id ?? ""}
          onClose={() => setAberto(false)}
          onDone={() => {
            setAberto(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Formulário ────────────────────────────────────────────────

function NovaDevolucaoSheet({
  sites,
  suppliers,
  siteIdInicial,
  onClose,
  onDone,
}: {
  sites: Site[];
  suppliers: Supplier[];
  siteIdInicial: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [siteId, setSiteId] = useState(siteIdInicial);
  const [supplierId, setSupplierId] = useState("");
  const [motivo, setMotivo] = useState<MotivoValue>("AVARIA");
  const [observacao, setObservacao] = useState("");
  const [numeroNota, setNumeroNota] = useState("");

  const [entradas, setEntradas] = useState<Entrada[] | null>(null);
  const [entradaId, setEntradaId] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [vinculo, setVinculo] = useState<{
    purchaseOrderId: string | null;
    inboundId: string | null;
  }>({ purchaseOrderId: null, inboundId: null });

  // Buscar as entradas é efeito (fala com o servidor); LIMPAR o que veio da
  // carga anterior é consequência direta da escolha, e mora em `trocarOrigem`.
  // Zerar dentro do efeito custava um render extra a cada digitação do form.
  useEffect(() => {
    if (!supplierId || !siteId) return;
    let vivo = true;
    entradasDoFornecedorAction(supplierId, siteId)
      .then((r) => vivo && setEntradas(r))
      .catch(() => vivo && setEntradas([]));
    return () => {
      vivo = false;
    };
  }, [supplierId, siteId]);

  /** Trocar fornecedor ou loja invalida tudo o que veio da carga anterior. */
  function trocarOrigem(patch: { supplierId?: string; siteId?: string }) {
    if (patch.supplierId !== undefined) setSupplierId(patch.supplierId);
    if (patch.siteId !== undefined) setSiteId(patch.siteId);
    setEntradas(null);
    setEntradaId(null);
    setLinhas([]);
    setNumeroNota("");
    setVinculo({ purchaseOrderId: null, inboundId: null });
  }

  function escolherEntrada(e: Entrada) {
    setEntradaId(e.id);
    setVinculo({ purchaseOrderId: e.purchaseOrderId, inboundId: e.inboundId });
    setNumeroNota(e.numeroNota ?? "");
    startTransition(async () => {
      const detalhe = await itensDaEntradaAction(e.id);
      setLinhas((detalhe?.items ?? []).map((i) => ({ ...i, devolver: 0 })));
    });
  }

  const escolhidas = linhas.filter((l) => l.devolver > 0);
  const total = escolhidas.reduce((a, l) => a + l.devolver * l.custoUnitario, 0);

  function submit(confirmar: boolean) {
    setErro(null);
    if (!supplierId) return setErro("Selecione o fornecedor.");
    if (escolhidas.length === 0) return setErro("Marque a quantidade do que volta.");
    if (observacao.trim().length < 3) return setErro("Descreva o motivo da devolução.");

    startTransition(async () => {
      try {
        await criarDevolucaoAction({
          siteId,
          supplierId,
          motivo,
          observacao,
          numeroNota: numeroNota || null,
          purchaseId: entradaId,
          purchaseOrderId: vinculo.purchaseOrderId,
          inboundId: vinculo.inboundId,
          confirmar,
          itens: escolhidas.map((l) => ({
            productId: l.productId,
            quantidade: l.devolver,
            custoUnitario: l.custoUnitario,
          })),
        });
        onDone();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao registrar devolução.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Nova devolução ao fornecedor"
      description="Escolha a carga que trouxe a mercadoria e marque o que volta."
      width="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-muted">Total a devolver </span>
            <span className="font-display text-[17px] font-semibold text-ink">
              {fmtMoney(total)}
            </span>
            {escolhidas.length > 0 && (
              <span className="ml-2 text-xs text-muted">
                {escolhidas.length} {escolhidas.length === 1 ? "item" : "itens"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => submit(false)}>
              Salvar rascunho
            </Button>
            <Button size="sm" disabled={pending} onClick={() => submit(true)}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Confirmar devolução
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {erro && (
          <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {erro}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {sites.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className={rotulo}>Loja</label>
              <select
                value={siteId}
                onChange={(e) => trocarOrigem({ siteId: e.target.value })}
                className={campo}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Fornecedor</label>
            <select
              value={supplierId}
              onChange={(e) => trocarOrigem({ supplierId: e.target.value })}
              className={campo}
            >
              <option value="">Selecione…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={rotulo}>Nota de devolução (opcional)</label>
            <input
              value={numeroNota}
              onChange={(e) => setNumeroNota(e.target.value)}
              placeholder="Ex: 000123"
              className={campo}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={rotulo}>Motivo</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {MOTIVOS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMotivo(m.value)}
                className={cn(
                  "rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors",
                  motivo === m.value
                    ? "border-brand bg-brand-soft/50"
                    : "border-line bg-surface hover:bg-surface-2",
                )}
              >
                <span className="block text-sm font-medium text-ink">{m.label}</span>
                <span className="block text-[11px] text-muted">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={rotulo}>O que aconteceu</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex: 3 garrafas quebradas na caixa 2 — motorista viu"
            className={campo}
          />
          <p className="text-[11px] text-muted">
            É este texto que o fornecedor lê. Seja específico o bastante para ele não perguntar.
          </p>
        </div>

        {supplierId && (
          <div className="flex flex-col gap-2">
            <label className={rotulo}>De qual entrada</label>
            {entradas === null ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Buscando as últimas entradas…
              </div>
            ) : entradas.length === 0 ? (
              <p className="rounded-[var(--radius)] border border-dashed border-line bg-surface-2 px-3.5 py-3 text-sm text-muted">
                Não há entradas registradas deste fornecedor nesta loja. Sem carga de origem não dá
                para saber o que voltar — registre a entrada antes.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {entradas.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => escolherEntrada(e)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors",
                        entradaId === e.id
                          ? "border-brand bg-brand-soft/50"
                          : "border-line bg-surface hover:bg-surface-2",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">
                          {e.numeroNota ? `Nota ${e.numeroNota}` : "Entrada sem nota"}
                          {e.pedidoNumero && (
                            <span className="ml-2 font-mono text-[11px] text-muted">
                              {e.pedidoNumero}
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {e.data.toLocaleDateString("pt-BR")} · {e.itens}{" "}
                          {e.itens === 1 ? "item" : "itens"}
                        </span>
                      </span>
                      <span className="shrink-0 font-display text-sm font-semibold text-ink">
                        {fmtMoney(e.valor)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {linhas.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className={rotulo}>O que volta</label>
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
              {linhas.map((l, i) => (
                <li key={l.productId} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Package size={15} className="shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{l.nome}</p>
                    <p className="text-[11px] text-muted">
                      Entrou {fmtQtd(l.quantidade)} {l.unidadeBase} ·{" "}
                      {fmtMoney(l.custoUnitario)}/{l.unidadeBase}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={l.quantidade}
                    step="0.001"
                    value={l.devolver || ""}
                    placeholder="0"
                    onChange={(e) => {
                      const v = Math.min(l.quantidade, Math.max(0, Number(e.target.value) || 0));
                      setLinhas((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, devolver: v } : x)),
                      );
                    }}
                    className="w-24 rounded-[var(--radius)] border border-line bg-surface px-2.5 py-1.5 text-right text-sm text-ink focus-visible:border-brand focus-visible:outline-none"
                  />
                  {l.devolver > 0 && (
                    <button
                      type="button"
                      aria-label={`Zerar ${l.nome}`}
                      onClick={() =>
                        setLinhas((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, devolver: 0 } : x)),
                        )
                      }
                      className="text-faint transition-colors hover:text-danger"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
