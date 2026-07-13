"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  Clock,
  Info,
  Loader2,
  PartyPopper,
  Send,
  Sparkles,
  TrendingUp,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { GrupoReposicao, SugestaoRow, HistoricoCompraProduto } from "./_data";
import { fetchHistoricoCompraProdutoAction } from "./actions";
import { SolicitarSheet, type GrupoEnvio } from "./_solicitar";
import { CoberturaBar, fmtMoney, fmtQtd, relDia, StatusDot, Stepper, STATUS_REPO, Thumb } from "./_ui";

// ── Revisar reposição — fluxo focado, sem abas nem etapas ─────
// Lista única ordenada por urgência; o fornecedor aparece discreto em
// cada produto e o rodapé fixo mostra em quantos pedidos a revisão
// vai virar. Nasce tudo marcado com a quantidade sugerida: o operador
// só ajusta e confirma.

type Sel = { on: boolean; qtd: number };

const PESO: Record<SugestaoRow["status"], number> = { ruptura: 0, critico: 1, abaixo: 2 };

/** SugestaoRow com o fornecedor do grupo colado — a lista aqui é plana. */
type Linha = SugestaoRow & {
  supplierId: string | null;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  leadTimeDias: number | null;
};

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
    for (const l of linhas) s[l.productId] = { on: l.qtdSugerida > 0 && l.supplierId !== null, qtd: Math.max(l.qtdSugerida, 1) };
    return s;
  });
  const [expandido, setExpandido] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Linha | null>(null);
  const [solicitar, setSolicitar] = useState<GrupoEnvio[] | null>(null);
  const [concluido, setConcluido] = useState(false);

  const setItem = (productId: string, patch: Partial<Sel>) =>
    setSel((s) => ({ ...s, [productId]: { ...s[productId], ...patch } }));

  // Ordenação única por urgência — sem abas: só títulos separadores.
  const ordenadas = useMemo(
    () => [...linhas].sort((a, b) => PESO[a.status] - PESO[b.status] || (a.coberturaDias ?? 99) - (b.coberturaDias ?? 99) || a.nome.localeCompare(b.nome)),
    [linhas],
  );
  const atencao = ordenadas.filter((l) => l.status !== "abaixo");
  const breve = ordenadas.filter((l) => l.status === "abaixo");

  // ── Resumo vivo: o que a revisão atual vira ──
  const resumo = useMemo(() => {
    const porFornecedor = new Map<string, { nome: string; produtos: number; total: number }>();
    let produtos = 0;
    let unidades = 0;
    let total = 0;
    for (const l of linhas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || l.supplierId === null) continue;
      produtos += 1;
      unidades += s.qtd * l.fatorConversao;
      const sub = s.qtd * (l.custoUnitCompra ?? 0);
      total += sub;
      const f = porFornecedor.get(l.supplierId) ?? { nome: l.supplierNome, produtos: 0, total: 0 };
      f.produtos += 1;
      f.total += sub;
      porFornecedor.set(l.supplierId, f);
    }
    return { produtos, unidades, total, fornecedores: [...porFornecedor.values()] };
  }, [linhas, sel]);

  // Congela a revisão em grupos de envio — o sheet pergunta só COMO solicitar.
  function abrirSolicitar() {
    const porFornecedor = new Map<string, GrupoEnvio>();
    for (const l of linhas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || l.supplierId === null) continue;
      const g = porFornecedor.get(l.supplierId) ?? {
        supplierId: l.supplierId,
        supplierNome: l.supplierNome,
        telefone: l.supplierTelefone,
        email: l.supplierEmail,
        leadTimeDias: l.leadTimeDias,
        itens: [],
      };
      g.itens.push({
        productId: l.productId,
        packagingId: l.packagingId,
        nome: l.nome,
        qtd: s.qtd,
        packagingNome: l.packagingNome,
        fatorConversao: l.fatorConversao,
        custoUnitCompra: l.custoUnitCompra,
      });
      porFornecedor.set(l.supplierId, g);
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
          Quando um produto ficar abaixo do mínimo ou o ritmo de venda indicar que o estoque vai acabar, a sugestão aparece aqui.
        </p>
      </div>
    );
  }

  const nPedidos = resumo.fornecedores.length;

  return (
    <div className="flex flex-col gap-5">
      {/* Lista única, títulos separadores no lugar de abas */}
      {atencao.length > 0 && (
        <SecaoLista titulo="Precisam de atenção agora" tom="danger">
          {atencao.map((l) => (
            <ItemRow key={l.productId} linha={l} sel={sel[l.productId]} setItem={setItem} expandido={expandido} setExpandido={setExpandido} onHistorico={setHistorico} />
          ))}
        </SecaoLista>
      )}
      {breve.length > 0 && (
        <SecaoLista titulo="Para repor em breve" tom="warn">
          {breve.map((l) => (
            <ItemRow key={l.productId} linha={l} sel={sel[l.productId]} setItem={setItem} expandido={expandido} setExpandido={setExpandido} onHistorico={setHistorico} />
          ))}
        </SecaoLista>
      )}

      {/* ── Rodapé fixo: agrupamento automático por fornecedor ── */}
      <div className="sticky bottom-0 z-40 -mx-1 rounded-[var(--radius-lg)] border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:-mx-2">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {resumo.produtos === 0
                ? "Nenhum produto selecionado"
                : `${resumo.produtos} ${resumo.produtos === 1 ? "produto selecionado" : "produtos selecionados"} · ${fmtMoney(resumo.total)}`}
            </p>
            {nPedidos > 0 && (
              <p className="truncate text-xs text-muted">
                {nPedidos === 1 ? "1 pedido será criado" : `${nPedidos} pedidos serão criados`} —{" "}
                {resumo.fornecedores.map((f) => `${f.nome} · ${f.produtos} ${f.produtos === 1 ? "produto" : "produtos"}`).join("  ·  ")}
              </p>
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

function SecaoLista({ titulo, tom, children }: { titulo: string; tom: "danger" | "warn"; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide", tom === "danger" ? "text-danger" : "text-warn")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", tom === "danger" ? "bg-danger" : "bg-warn")} />
        {titulo}
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">{children}</ul>
    </section>
  );
}

// ── Linha de produto — fornecedor discreto, sem etapa própria ──

function ItemRow({
  linha: l,
  sel,
  setItem,
  expandido,
  setExpandido,
  onHistorico,
}: {
  linha: Linha;
  sel: Sel | undefined;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  expandido: string | null;
  setExpandido: (id: string | null) => void;
  onHistorico: (l: Linha) => void;
}) {
  const semFornecedor = l.supplierId === null;
  const aCaminho = l.qtdSugerida === 0 && l.pendente > 0;
  const s = sel ?? { on: false, qtd: Math.max(l.qtdSugerida, 1) };
  const qtd = s.qtd;
  const subtotal = qtd * (l.custoUnitCompra ?? 0);
  const aberto = expandido === l.productId;

  return (
    <li className={cn("transition-colors", s.on && !semFornecedor && "bg-brand-soft/25")}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:grid lg:grid-cols-[auto_minmax(0,2.4fr)_minmax(0,1.3fr)_auto_auto] lg:items-center lg:gap-4">
        <input
          type="checkbox"
          checked={s.on && !semFornecedor}
          disabled={semFornecedor || aCaminho}
          onChange={(e) => setItem(l.productId, { on: e.target.checked })}
          className="h-4.5 w-4.5 shrink-0 accent-brand"
          aria-label={`Incluir ${l.nome} no pedido`}
        />

        {/* Produto + fornecedor discreto */}
        <div className="flex min-w-0 items-center gap-3">
          <Thumb url={l.imagemUrl} nome={l.nome} />
          <div className="min-w-0">
            <button type="button" onClick={() => onHistorico(l)} className="flex max-w-full items-center gap-1.5 text-left">
              <StatusDot status={l.status} />
              <span className="truncate text-sm font-medium text-ink underline-offset-2 hover:underline">{l.nome}</span>
            </button>
            <p className="truncate text-[11px] text-muted">
              {semFornecedor ? (
                <span className="text-warn">
                  Sem fornecedor — vincule em <a href="/produtos" className="font-semibold underline underline-offset-2">Produtos</a>
                </span>
              ) : (
                <>
                  <Building2 size={10} className="mr-1 inline align-[-1px] text-faint" />
                  {l.supplierNome}
                  {l.custoUnitCompra != null && (
                    <span className="tabular-nums"> · {fmtMoney(l.custoUnitCompra)}/{l.packagingNome?.toLowerCase() ?? "un"}</span>
                  )}
                  {l.leadTimeDias != null && <span> · entrega ~{l.leadTimeDias}d</span>}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Situação */}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted">
            <span className={cn("font-semibold tabular-nums", STATUS_REPO[l.status].text)}>{fmtQtd(l.estoque)}</span> em estoque
            {l.estoqueMinimo > 0 && <span className="text-faint"> / mín {fmtQtd(l.estoqueMinimo)}</span>}
            {l.pendente > 0 && <span className="text-brand"> · +{fmtQtd(l.pendente)} a caminho</span>}
          </p>
          <CoberturaBar dias={l.coberturaDias} status={l.status} />
        </div>

        {/* Quantidade */}
        {aCaminho ? (
          <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand lg:justify-self-center">
            <Truck size={13} /> Pedido a caminho
          </span>
        ) : (
          <div className="flex items-center gap-2 lg:justify-self-center">
            <Stepper value={qtd} onChange={(v) => setItem(l.productId, { qtd: v, on: v > 0 })} disabled={semFornecedor} min={0} />
            <span className="w-20 text-[11px] leading-tight text-muted">
              {l.packagingNome ? (
                <>
                  {l.packagingNome} ×{fmtQtd(l.fatorConversao)}
                  <span className="block text-faint">= {fmtQtd(qtd * l.fatorConversao)} un</span>
                </>
              ) : (
                "unidades"
              )}
            </span>
          </div>
        )}

        {/* Subtotal + por quê */}
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-ink">{l.custoUnitCompra != null ? fmtMoney(subtotal) : "—"}</p>
          </div>
          <button
            type="button"
            onClick={() => setExpandido(aberto ? null : l.productId)}
            aria-expanded={aberto}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink",
              aberto && "bg-surface-2 text-ink",
            )}
          >
            Por que {aCaminho ? "?" : `${qtd}?`}
            <ChevronDown size={13} className={cn("transition-transform", aberto && "rotate-180")} />
          </button>
        </div>
      </div>

      {aberto && <MotivoBox linha={l} qtd={qtd} />}
    </li>
  );
}

// ── Caixa "por que comprar" ───────────────────────────────────

function MotivoBox({ linha: l, qtd }: { linha: Linha; qtd: number }) {
  const meta = STATUS_REPO[l.status];
  const aposCompra = l.mediaDia > 0 ? Math.floor((l.estoque + l.pendente + qtd * l.fatorConversao) / l.mediaDia) : null;

  const motivos: { icon: React.ElementType; texto: React.ReactNode }[] = [];

  motivos.push({
    icon: Info,
    texto:
      l.status === "ruptura" ? (
        <>Estoque <strong>zerado</strong> — venda parada até chegar mercadoria.</>
      ) : l.estoqueMinimo > 0 && l.estoque < l.estoqueMinimo ? (
        <>Estoque em <strong>{fmtQtd(l.estoque)} un</strong>, abaixo do mínimo de <strong>{fmtQtd(l.estoqueMinimo)}</strong>.</>
      ) : (
        <>Estoque em <strong>{fmtQtd(l.estoque)} un</strong>, perto de acabar no ritmo atual.</>
      ),
  });

  if (l.consumo7 > 0 || l.consumo30 > 0) {
    motivos.push({
      icon: TrendingUp,
      texto: (
        <>
          Vendeu <strong>{fmtQtd(l.consumo7)} un nos últimos 7 dias</strong>
          {l.consumo30 > 0 && <> ({fmtQtd(l.consumo30)} em 30 dias — média {l.mediaDia.toFixed(1)}/dia)</>}.
        </>
      ),
    });
  }

  if (l.coberturaDias != null) {
    motivos.push({
      icon: Clock,
      texto: <>No ritmo atual, o estoque dura <strong>~{Math.max(0, l.coberturaDias)} {l.coberturaDias === 1 ? "dia" : "dias"}</strong>.</>,
    });
  }

  if (l.leadTimeDias != null) {
    motivos.push({
      icon: Truck,
      texto: <>{l.supplierNome} costuma entregar em <strong>~{l.leadTimeDias} {l.leadTimeDias === 1 ? "dia" : "dias"}</strong>.</>,
    });
  }

  if (qtd > 0 && aposCompra != null) {
    motivos.push({
      icon: Sparkles,
      texto: (
        <>
          Comprando <strong>{qtd} {l.packagingNome ? `${l.packagingNome.toLowerCase()}(s)` : "un"}</strong>
          {l.fatorConversao !== 1 && <> ({fmtQtd(qtd * l.fatorConversao)} un)</>}, o estoque cobre <strong>~{aposCompra} dias</strong> de venda.
        </>
      ),
    });
  }

  return (
    <div className="mx-4 mb-3 flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2/60 p-4 sm:mx-5">
      <p className={cn("text-xs font-semibold uppercase tracking-wide", meta.text)}>Por que comprar</p>
      <ul className="flex flex-col gap-1.5">
        {motivos.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
            <m.icon size={14} className="mt-0.5 shrink-0 text-muted" />
            <span>{m.texto}</span>
          </li>
        ))}
      </ul>
      {l.ultimaCompraEm && (
        <p className="border-t border-line pt-2 text-xs text-muted">
          Última compra {relDia(l.ultimaCompraEm)}
          {l.ultimoCustoUn != null && <> por <span className="font-medium tabular-nums text-ink">{fmtMoney(l.ultimoCustoUn)}</span>/{l.packagingNome ?? "un"}</>}.
        </p>
      )}
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
