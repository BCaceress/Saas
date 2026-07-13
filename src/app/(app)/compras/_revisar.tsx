"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  Loader2,
  PackageCheck,
  PartyPopper,
  RotateCcw,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import type { GrupoReposicao, SugestaoRow, HistoricoCompraProduto } from "./_data";
import { fetchHistoricoCompraProdutoAction } from "./actions";
import { SolicitarSheet, type GrupoEnvio } from "./_solicitar";
import { fmtMoney, fmtQtd, previsaoLabel, relDia, Stepper, Thumb } from "./_ui";

// ── Revisar reposição — uma página só, organizada por prioridade ──
// Precisa de atenção → Repor em breve → Já sendo repostos (recolhida).
// Cada linha separa claramente sugestão do sistema × decisão do operador.

type Sel = { on: boolean; qtd: number; supplierId: string | null };

const PESO: Record<SugestaoRow["status"], number> = { ruptura: 0, critico: 1, abaixo: 2, monitorar: 3 };

/** SugestaoRow com o fornecedor padrão do grupo colado — a lista aqui é plana. */
type Linha = SugestaoRow & {
  supplierId: string | null;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  leadTimeDias: number | null;
};

type Efetivo = { nome: string; custo: number | null; leadTime: number | null; telefone: string | null; email: string | null };

/** Resolve nome/custo/prazo do fornecedor efetivamente escolhido pro item (pode ter sido trocado no popover). */
function fornecedorEfetivo(l: Linha, supplierId: string | null): Efetivo {
  const f = supplierId ? l.fornecedores.find((x) => x.supplierId === supplierId) : null;
  if (f) return { nome: f.nome, custo: f.custoUnitCompra, leadTime: f.leadTimeDias, telefone: f.telefone, email: f.email };
  return { nome: l.supplierNome, custo: l.custoUnitCompra, leadTime: l.leadTimeDias, telefone: l.supplierTelefone, email: l.supplierEmail };
}

export function RevisarClient({
  grupos,
  siteId,
  empresa,
}: {
  grupos: GrupoReposicao[];
  siteId: string | null;
  empresa: string;
}) {
  const router = useRouter();

  const linhas = useMemo<Linha[]>(
    () =>
      grupos.flatMap((g) =>
        g.itens.map((it) => ({
          ...it,
          supplierId: g.supplierId,
          supplierNome: g.supplierNome,
          supplierTelefone: g.supplierTelefone,
          supplierEmail: g.supplierEmail,
          leadTimeDias: g.leadTimeDias,
        })),
      ),
    [grupos],
  );

  const [sel, setSel] = useState<Record<string, Sel>>(() => {
    const s: Record<string, Sel> = {};
    for (const l of linhas) s[l.productId] = { on: l.qtdSugerida > 0 && l.supplierId !== null, qtd: Math.max(l.qtdSugerida, 1), supplierId: l.supplierId };
    return s;
  });
  const [jaRepostosAberto, setJaRepostosAberto] = useState(false);
  const [historico, setHistorico] = useState<Linha | null>(null);
  const [solicitar, setSolicitar] = useState<GrupoEnvio[] | null>(null);
  const [concluido, setConcluido] = useState(false);

  const setItem = (productId: string, patch: Partial<Sel>) =>
    setSel((s) => ({ ...s, [productId]: { ...s[productId], ...patch } }));

  // Separa quem já está coberto por pedido a caminho (não é mais sugestão) do resto.
  const jaRepostos = useMemo(
    () => linhas.filter((l) => l.qtdSugerida === 0 && l.pendente > 0),
    [linhas],
  );
  const ativas = useMemo(
    () => linhas.filter((l) => !(l.qtdSugerida === 0 && l.pendente > 0)),
    [linhas],
  );
  const ordenar = (rows: Linha[]) =>
    [...rows].sort((a, b) => PESO[a.status] - PESO[b.status] || (a.coberturaDias ?? 99) - (b.coberturaDias ?? 99) || a.nome.localeCompare(b.nome));
  const agora = useMemo(() => ordenar(ativas.filter((l) => l.status === "ruptura" || l.status === "critico")), [ativas]);
  const breve = useMemo(() => ordenar(ativas.filter((l) => l.status === "abaixo" || l.status === "monitorar")), [ativas]);

  // ── Resumo vivo: o que a revisão atual vira ──
  const resumo = useMemo(() => {
    const porFornecedor = new Map<string, { nome: string; produtos: number; total: number }>();
    let produtos = 0;
    let unidades = 0;
    let total = 0;
    for (const l of linhas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || !s.supplierId) continue;
      const eff = fornecedorEfetivo(l, s.supplierId);
      produtos += 1;
      unidades += s.qtd * l.fatorConversao;
      const sub = s.qtd * (eff.custo ?? 0);
      total += sub;
      const f = porFornecedor.get(s.supplierId) ?? { nome: eff.nome, produtos: 0, total: 0 };
      f.produtos += 1;
      f.total += sub;
      porFornecedor.set(s.supplierId, f);
    }
    return { produtos, unidades, total, fornecedores: [...porFornecedor.values()] };
  }, [linhas, sel]);

  const nPedidos = resumo.fornecedores.length;
  const nSugestoes = agora.length + breve.length;

  // Congela a revisão em grupos de envio — o sheet pergunta só COMO solicitar.
  function abrirSolicitar() {
    const porFornecedor = new Map<string, GrupoEnvio>();
    for (const l of linhas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || !s.supplierId) continue;
      const eff = fornecedorEfetivo(l, s.supplierId);
      const g = porFornecedor.get(s.supplierId) ?? {
        supplierId: s.supplierId,
        supplierNome: eff.nome,
        telefone: eff.telefone,
        email: eff.email,
        leadTimeDias: eff.leadTime,
        itens: [],
      };
      g.itens.push({
        productId: l.productId,
        packagingId: l.packagingId,
        nome: l.nome,
        qtd: s.qtd,
        packagingNome: l.packagingNome,
        fatorConversao: l.fatorConversao,
        custoUnitCompra: eff.custo,
      });
      porFornecedor.set(s.supplierId, g);
    }
    const envio = [...porFornecedor.values()];
    if (envio.length > 0) setSolicitar(envio);
  }

  // Ao fechar depois do sucesso, volta para a central de Compras — os
  // pedidos criados aparecem em "Em andamento".
  const fecharSolicitar = () => {
    setSolicitar(null);
    if (concluido) {
      router.push("/compras");
      router.refresh();
    }
  };

  if (linhas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <PartyPopper size={32} className="text-ok" />
        <p className="text-sm font-semibold text-ink">Estoque em dia — nada para repor.</p>
        <p className="max-w-sm text-xs text-muted">
          Quando um produto ficar abaixo do mínimo, do ideal, ou o ritmo de venda indicar que o estoque vai acabar, a sugestão aparece aqui.
        </p>
      </div>
    );
  }

  const resumoTexto = [
    `${nSugestoes} ${nSugestoes === 1 ? "sugestão" : "sugestões"}`,
    agora.length > 0 ? `${agora.length} ${agora.length === 1 ? "urgente" : "urgentes"}` : null,
    `${resumo.produtos} ${resumo.produtos === 1 ? "selecionada" : "selecionadas"}`,
    resumo.total > 0 ? fmtMoney(resumo.total) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <p className="-mt-1 px-1 text-sm text-muted">{resumoTexto}</p>

      {agora.length > 0 && (
        <SecaoLista titulo="Precisa de atenção" tom="danger" icon={CircleAlert} count={agora.length}>
          {agora.map((l) => (
            <ItemRow key={l.productId} linha={l} sel={sel[l.productId]} setItem={setItem} onHistorico={setHistorico} />
          ))}
        </SecaoLista>
      )}
      {breve.length > 0 && (
        <SecaoLista titulo="Repor em breve" tom="warn" icon={CircleAlert} count={breve.length}>
          {breve.map((l) => (
            <ItemRow key={l.productId} linha={l} sel={sel[l.productId]} setItem={setItem} onHistorico={setHistorico} />
          ))}
        </SecaoLista>
      )}

      {jaRepostos.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setJaRepostosAberto((v) => !v)}
            aria-expanded={jaRepostosAberto}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-2/60"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-ok">
              <PackageCheck size={15} />
              Já sendo repostos
            </span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-muted">{jaRepostos.length}</span>
              <ChevronDown size={15} className={cn("text-muted transition-transform", jaRepostosAberto && "rotate-180")} />
            </span>
          </button>
          {jaRepostosAberto && (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {jaRepostos.map((l) => {
                const pedido = l.pedidosPendentes[0] ?? null;
                return (
                  <li key={l.productId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumb url={l.imagemUrl} nome={l.nome} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{l.nome}</p>
                        <p className="text-xs text-muted">
                          {fmtQtd(l.estoque)} disponíveis · {fmtQtd(l.pendente)} a caminho
                        </p>
                        <p className="text-xs text-ok">A reposição atual já cobre a necessidade.</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pl-13 sm:pl-0">
                      {pedido && (
                        <span className="text-xs text-faint">
                          {pedido.numero}
                          {pedido.previsaoEntrega && ` · previsto para ${previsaoLabel(pedido.previsaoEntrega).toLowerCase()}`}
                        </span>
                      )}
                      <a
                        href={`/compras?q=${encodeURIComponent(pedido?.numero ?? l.supplierNome)}`}
                        className="shrink-0 text-xs font-semibold text-brand hover:underline"
                      >
                        Ver pedido →
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── Rodapé fixo: agrupamento automático por fornecedor ── */}
      <div className="sticky bottom-0 z-40 -mx-1 rounded-[var(--radius-lg)] border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:-mx-2">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            {resumo.produtos === 0 ? (
              <>
                <p className="text-sm font-semibold text-ink">Nenhum produto selecionado</p>
                <p className="text-xs text-muted">Selecione ao menos um produto para criar um pedido.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink">
                  {resumo.produtos} {resumo.produtos === 1 ? "produto" : "produtos"} ·{" "}
                  {nPedidos > 1 ? (
                    <Menu
                      align="start"
                      trigger={
                        <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-brand">
                          {nPedidos} fornecedores
                        </button>
                      }
                    >
                      <div className="w-64 p-1">
                        <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Pedidos que serão criados</p>
                        {resumo.fornecedores.map((f) => (
                          <div key={f.nome} className="flex items-center justify-between gap-3 px-2 py-1.5">
                            <span className="min-w-0 truncate text-sm text-ink">{f.nome}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {f.produtos} {f.produtos === 1 ? "produto" : "produtos"} · {fmtMoney(f.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Menu>
                  ) : (
                    `${nPedidos} fornecedor`
                  )}{" "}
                  · {fmtMoney(resumo.total)}
                </p>
                <p className="text-xs text-muted">{fmtQtd(resumo.unidades)} unidades no total</p>
              </>
            )}
          </div>
          <button
            type="button"
            disabled={nPedidos === 0 || !siteId}
            onClick={abrirSolicitar}
            className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            <Send size={15} />
            {nPedidos <= 1 ? "Criar pedido" : `Criar ${nPedidos} pedidos`}
          </button>
        </div>
      </div>

      {/* Finalização: como deseja solicitar esta compra? */}
      {solicitar && siteId && (
        <SolicitarSheet
          grupos={solicitar}
          empresa={empresa}
          siteId={siteId}
          onClose={fecharSolicitar}
          onConcluido={() => setConcluido(true)}
        />
      )}

      {/* Drawer: histórico de compras do produto */}
      <HistoricoDrawer item={historico} onClose={() => setHistorico(null)} />
    </div>
  );
}

const TOM_TEXT: Record<"danger" | "warn", string> = { danger: "text-danger", warn: "text-warn" };

function SecaoLista({
  titulo,
  tom,
  icon: Icon,
  count,
  children,
}: {
  titulo: string;
  tom: "danger" | "warn";
  icon: React.ElementType;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className={cn("flex items-center gap-2 text-sm font-semibold", TOM_TEXT[tom])}>
          <Icon size={15} />
          {titulo}
        </h2>
        <span className="text-sm font-semibold tabular-nums text-muted">{count}</span>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">{children}</ul>
    </section>
  );
}

// ── Situação do estoque — texto claro, sem barra decorativa ───

function Situacao({ l }: { l: Linha }) {
  const idealShow = l.estoqueIdeal > 0 ? l.estoqueIdeal : l.alvoReposicao;
  const coberturaTxt = l.coberturaDias != null ? `≈${fmtQtd(l.coberturaDias)} ${l.coberturaDias === 1 ? "dia" : "dias"} de cobertura` : null;
  const faltamTxt =
    l.pendente > 0 && l.qtdSugerida > 0 ? (
      <p className="text-xs text-brand">
        +{fmtQtd(l.pendente)} a caminho · faltam {fmtQtd(l.necessidadeBase)} p/ a cobertura recomendada
      </p>
    ) : null;

  if (l.status === "ruptura") {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" /> Sem estoque
        </p>
        <p className="text-xs text-muted">0 disponíveis{l.estoqueMinimo > 0 && <> · mínimo {fmtQtd(l.estoqueMinimo)}</>}</p>
        {faltamTxt}
      </div>
    );
  }

  if (l.status === "critico") {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" /> Risco de ruptura
        </p>
        <p className="text-xs text-muted">
          {fmtQtd(l.estoque)} disponíveis · mín. {fmtQtd(l.estoqueMinimo)} · ideal {fmtQtd(idealShow)}
        </p>
        {faltamTxt ?? (coberturaTxt && <p className="text-xs text-muted">{coberturaTxt}</p>)}
      </div>
    );
  }

  // abaixo | monitorar — "Repor em breve": preventivo, âmbar discreto
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" /> {fmtQtd(l.estoque)} disponíveis
      </p>
      <p className="text-xs text-muted">
        {l.estoqueMinimo > 0 && <>mín. {fmtQtd(l.estoqueMinimo)} · </>}ideal {fmtQtd(idealShow)}
      </p>
      {faltamTxt ?? <p className="text-xs text-muted">{coberturaTxt ?? "Reposição recomendada em breve"}</p>}
    </div>
  );
}

// ── Linha de produto — quatro grupos: produto · situação · compra · total ──

function ItemRow({
  linha: l,
  sel,
  setItem,
  onHistorico,
}: {
  linha: Linha;
  sel: Sel | undefined;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  onHistorico: (l: Linha) => void;
}) {
  const semFornecedor = l.supplierId === null;
  const s = sel ?? { on: false, qtd: Math.max(l.qtdSugerida, 1), supplierId: l.supplierId };
  const eff = fornecedorEfetivo(l, s.supplierId);
  const qtd = s.qtd;
  const subtotal = qtd * (eff.custo ?? 0);
  const restaurar = qtd !== l.qtdSugerida;
  const unidade = l.packagingNome ?? "unidades";

  return (
    <li className={cn("transition-opacity", !s.on && "opacity-60")}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:grid lg:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1.5fr)_auto_minmax(0,1.1fr)] lg:items-center lg:gap-4">
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={s.on && !semFornecedor}
            disabled={semFornecedor}
            onChange={(e) => setItem(l.productId, { on: e.target.checked })}
            className="h-4.5 w-4.5 accent-brand"
            aria-label={`Incluir ${l.nome} no pedido`}
          />
        </label>

        {/* Produto: imagem, nome (destaque), fornecedor + prazo (secundário) */}
        <div className="flex min-w-0 items-center gap-3">
          <Thumb url={l.imagemUrl} nome={l.nome} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onHistorico(l)}
              className="block max-w-full truncate text-left text-[15px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              {l.nome}
            </button>
            <p className="truncate text-xs text-muted">
              {semFornecedor ? (
                <span className="text-warn">
                  Sem fornecedor — vincule em <a href="/produtos" className="font-semibold underline underline-offset-2">Produtos</a>
                </span>
              ) : (
                <>
                  <Building2 size={11} className="mr-1 inline align-[-1px] text-faint" />
                  {l.fornecedores.length > 1 ? (
                    <Menu
                      align="start"
                      trigger={
                        <button type="button" className="inline-flex items-center gap-0.5 font-medium text-ink-2 hover:text-brand hover:underline">
                          {eff.nome}
                          <ChevronDown size={11} />
                        </button>
                      }
                    >
                      <FornecedorPicker linha={l} atual={s.supplierId} onSelect={(id) => setItem(l.productId, { supplierId: id })} />
                    </Menu>
                  ) : (
                    eff.nome
                  )}
                  {eff.leadTime != null && (
                    <span>
                      {" "}
                      · entrega em ~{eff.leadTime} {eff.leadTime === 1 ? "dia" : "dias"}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Situação */}
        <Situacao l={l} />

        {/* Compra: sugestão do sistema × decisão do operador */}
        <div className="flex flex-col gap-1.5 lg:items-end">
          <p className="text-xs text-muted">
            Sugerido: <span className="font-semibold text-ink">{fmtQtd(l.qtdSugerida)} {unidade}</span>
          </p>
          <div className="flex flex-col gap-1 lg:items-end">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Comprar</span>
            <div className="flex items-center gap-2">
              <Stepper value={qtd} onChange={(v) => setItem(l.productId, { qtd: v })} disabled={semFornecedor || !s.on} min={0} />
              <span className="text-xs text-muted">{unidade}</span>
            </div>
            {l.packagingNome && l.fatorConversao !== 1 && (
              <span className="text-[11px] text-faint">{fmtQtd(qtd * l.fatorConversao)} unidades no total</span>
            )}
          </div>
          {restaurar && (
            <button
              type="button"
              onClick={() => setItem(l.productId, { qtd: l.qtdSugerida })}
              className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
            >
              <RotateCcw size={11} /> Restaurar sugestão
            </button>
          )}
        </div>

        {/* Total + por quê */}
        <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end lg:justify-center lg:gap-1.5">
          <div className="lg:text-right">
            <p className="text-base font-semibold tabular-nums text-ink">{eff.custo != null ? fmtMoney(subtotal) : "—"}</p>
            {eff.custo != null && (
              <p className="text-[11px] tabular-nums text-muted">
                {fmtMoney(eff.custo)}/{l.packagingNome?.toLowerCase() ?? "un"}
              </p>
            )}
          </div>
          <Menu
            align="end"
            className="rounded-2xl p-0"
            trigger={
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Info size={12} /> Por quê?
              </button>
            }
          >
            <PorQuePopover l={l} eff={eff} />
          </Menu>
        </div>
      </div>
    </li>
  );
}

// ── Popover: escolher fornecedor ──────────────────────────────

function FornecedorPicker({
  linha: l,
  atual,
  onSelect,
}: {
  linha: Linha;
  atual: string | null;
  onSelect: (supplierId: string) => void;
}) {
  const custos = l.fornecedores.map((f) => f.custoUnitCompra).filter((v): v is number => v != null);
  const menorPreco = custos.length > 1 ? Math.min(...custos) : null;
  const leads = l.fornecedores.map((f) => f.leadTimeDias).filter((v): v is number => v != null);
  const menorLead = leads.length > 1 ? Math.min(...leads) : null;

  return (
    <div className="w-72">
      <p className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-faint">Escolher fornecedor</p>
      {l.fornecedores.map((f) => (
        <MenuItem
          key={f.supplierId}
          icon={f.supplierId === atual ? <Check size={14} className="text-brand" /> : <span className="inline-block w-3.5" />}
          onClick={() => onSelect(f.supplierId)}
          trailing={
            <span className="flex flex-col items-end gap-0.5">
              {f.custoUnitCompra === menorPreco && <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] font-semibold text-ok">Menor preço</span>}
              {f.leadTimeDias === menorLead && <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">Entrega mais rápida</span>}
            </span>
          }
        >
          <span className="block font-medium text-ink">{f.nome}</span>
          <span className="block text-xs text-muted">
            {f.custoUnitCompra != null ? `${fmtMoney(f.custoUnitCompra)}${l.packagingNome ? `/${l.packagingNome.toLowerCase()}` : ""}` : "sem custo"}
            {f.leadTimeDias != null && ` · entrega ~${f.leadTimeDias}d`}
          </span>
        </MenuItem>
      ))}
    </div>
  );
}

// ── Popover: por que recomendamos essa quantidade ─────────────

function PorQuePopover({ l, eff }: { l: Linha; eff: Efetivo }) {
  const idealShow = l.estoqueIdeal > 0 ? l.estoqueIdeal : l.alvoReposicao;
  const linhas: [string, string][] = [["Estoque atual", `${fmtQtd(l.estoque)} un`]];
  if (l.estoqueMinimo > 0) linhas.push(["Estoque mínimo", `${fmtQtd(l.estoqueMinimo)} un`]);
  linhas.push(["Estoque ideal", `${fmtQtd(idealShow)} un`]);
  if (l.mediaDia > 0) linhas.push(["Venda média", `${l.mediaDia.toFixed(1)}/dia`]);
  linhas.push(["Cobertura atual", l.coberturaDias != null ? `${Math.max(0, l.coberturaDias)} ${l.coberturaDias === 1 ? "dia" : "dias"}` : "sem giro"]);
  if (eff.leadTime != null) linhas.push(["Prazo do fornecedor", `~${eff.leadTime} ${eff.leadTime === 1 ? "dia" : "dias"}`]);
  if (l.pendente > 0) linhas.push(["Já a caminho", `${fmtQtd(l.pendente)} un`]);

  const temAdicional = l.pendente > 0 && l.qtdSugerida > 0;

  return (
    <div className="flex w-72 flex-col gap-3 p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-faint">
        Por que recomendamos {fmtQtd(l.qtdSugerida)} {l.packagingNome ?? "unidades"}?
      </p>
      <dl className="flex flex-col gap-1.5 text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-line pt-2.5">
        {temAdicional ? (
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Necessidade calculada</dt>
              <dd className="font-medium tabular-nums text-ink">{fmtQtd(l.necessidadeBase + l.pendente)} un</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Já a caminho</dt>
              <dd className="font-medium tabular-nums text-ink">{fmtQtd(l.pendente)} un</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-semibold text-brand">Sugestão adicional</dt>
              <dd className="font-semibold tabular-nums text-brand">
                {fmtQtd(l.qtdSugerida)} {l.packagingNome ?? "un"}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">Sugestão</p>
            <p className="text-sm font-semibold tabular-nums text-brand">
              {fmtQtd(l.qtdSugerida)} {l.packagingNome ?? "unidades"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drawer: histórico de compras do produto ───────────────────

function HistoricoDrawer({ item, onClose }: { item: Linha | null; onClose: () => void }) {
  // Guarda o resultado junto do productId: "carregando" é derivado (nenhum
  // setState síncrono no effect) e trocar de produto invalida o anterior.
  const [resultado, setResultado] = useState<{ productId: string; dados: HistoricoCompraProduto | null } | null>(null);

  const productId = item?.productId ?? null;
  useEffect(() => {
    if (!productId) return;
    let ativo = true;
    fetchHistoricoCompraProdutoAction(productId)
      .then((d) => { if (ativo) setResultado({ productId, dados: d }); })
      .catch(() => { if (ativo) setResultado({ productId, dados: null }); });
    return () => {
      ativo = false;
    };
  }, [productId]);

  const carregando = productId !== null && resultado?.productId !== productId;
  const dados = resultado?.productId === productId ? resultado.dados : null;

  const melhor = dados && dados.fornecedores.length > 1
    ? dados.fornecedores.reduce((a, b) => {
        const ca = a.custoFornecedor ?? Infinity;
        const cb = b.custoFornecedor ?? Infinity;
        return cb < ca ? b : a;
      })
    : null;

  return (
    <Sheet open={item !== null} onClose={onClose} title={item?.nome ?? ""} description={item ? `${item.sku}${item.categoria ? ` · ${item.categoria}` : ""}` : ""} width="lg">
      {item && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-xl bg-surface-2/60 p-4">
            <Thumb url={item.imagemUrl} nome={item.nome} size={56} />
            <div className="grid flex-1 grid-cols-3 gap-2 text-center">
              <MiniStat rotulo="Estoque" valor={fmtQtd(item.estoque)} />
              <MiniStat rotulo="Mínimo" valor={item.estoqueMinimo > 0 ? fmtQtd(item.estoqueMinimo) : "—"} />
              <MiniStat rotulo="7 dias" valor={`${fmtQtd(item.consumo7)} vend.`} />
            </div>
          </div>

          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Carregando histórico…
            </div>
          ) : !dados || dados.compras.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              Ainda não há compras registradas deste produto.
            </p>
          ) : (
            <>
              {/* Preços */}
              <div className="grid grid-cols-3 gap-2">
                <StatCard rotulo="Preço médio" valor={dados.precoMedio != null ? fmtMoney(dados.precoMedio) : "—"} />
                <StatCard rotulo="Menor preço" valor={dados.menorPreco != null ? fmtMoney(dados.menorPreco) : "—"} tom="ok" />
                <StatCard rotulo="Maior preço" valor={dados.maiorPreco != null ? fmtMoney(dados.maiorPreco) : "—"} tom="warn" />
              </div>
              {dados.qtdHabitual != null && (
                <p className="text-xs text-muted">
                  Quantidade normalmente comprada: <span className="font-semibold text-ink">{dados.qtdHabitual}</span> por pedido.
                </p>
              )}

              {/* Comparação de fornecedores */}
              {dados.fornecedores.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-faint">Fornecedores</p>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                          <th className="px-3 py-2">Fornecedor</th>
                          <th className="px-3 py-2 text-right">Custo</th>
                          <th className="px-3 py-2 text-right">Entrega</th>
                          <th className="px-3 py-2 text-right">Última compra</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {dados.fornecedores.map((f) => (
                          <tr key={f.supplierId} className={cn(melhor?.supplierId === f.supplierId && "bg-ok-soft/40")}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-ink">{f.nome}</span>
                              {f.isPrincipal && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand">habitual</span>}
                              {melhor?.supplierId === f.supplierId && <span className="ml-1.5 rounded-full bg-ok-soft px-1.5 py-px text-[10px] font-semibold text-ok">melhor custo</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink">{f.custoFornecedor != null ? fmtMoney(f.custoFornecedor) : "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted">{f.leadTimeDias != null ? `~${f.leadTimeDias}d` : "—"}</td>
                            <td className="px-3 py-2 text-right text-muted">{relDia(f.ultimaCompraEm)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Últimas compras */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">Últimas compras</p>
                <ul className="flex flex-col gap-1.5">
                  {dados.compras.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2/60 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{c.supplierNome ?? "Entrada manual"}</p>
                        <p className="text-[11px] text-faint">
                          {relDia(c.data)}
                          {c.numeroPedido && <span className="font-mono"> · {c.numeroPedido}</span>}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className="text-ink">{fmtQtd(c.quantidade)} {c.packagingNome ?? "un"}</p>
                        <p className="text-[11px] text-muted">{fmtMoney(c.custoUn)}/{c.packagingNome ?? "un"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function MiniStat({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{rotulo}</p>
      <p className="text-sm font-semibold tabular-nums text-ink">{valor}</p>
    </div>
  );
}

function StatCard({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{rotulo}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tom === "ok" ? "text-ok" : tom === "warn" ? "text-warn" : "text-ink")}>{valor}</p>
    </div>
  );
}
