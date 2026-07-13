"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCheck,
  ChevronDown,
  Clock,
  Info,
  Link2,
  Loader2,
  PartyPopper,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  Truck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { GrupoReposicao, SugestaoRow, HistoricoCompraProduto } from "./_data";
import { fetchHistoricoCompraProdutoAction } from "./actions";
import { SolicitarSheet, type GrupoEnvio } from "./_solicitar";
import { CoberturaBar, fmtMoney, fmtQtd, relDia, StatusDot, Stepper, STATUS_REPO, Thumb, type StatusRepo } from "./_ui";

// ── Estado de seleção ─────────────────────────────────────────
// A tela nasce com tudo que precisa de compra já marcado e com a
// quantidade sugerida — o operador só revisa e envia.

type Sel = { on: boolean; qtd: number };

function initSel(grupos: GrupoReposicao[]): Record<string, Sel> {
  const sel: Record<string, Sel> = {};
  for (const g of grupos) {
    for (const it of g.itens) {
      sel[it.productId] = { on: it.qtdSugerida > 0 && g.supplierId !== null, qtd: Math.max(it.qtdSugerida, 1) };
    }
  }
  return sel;
}

// ── Componente principal ──────────────────────────────────────

export function ReposicaoClient({
  grupos,
  siteId,
  empresa,
  filtro,
  onFiltro,
}: {
  grupos: GrupoReposicao[];
  siteId: string | null;
  empresa: string;
  filtro: StatusRepo | "todos";
  onFiltro: (f: StatusRepo | "todos") => void;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Record<string, Sel>>(() => initSel(grupos));
  const [q, setQ] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  // Grupos em finalização (sheet "como deseja solicitar?") — null = fechado.
  const [solicitar, setSolicitar] = useState<GrupoEnvio[] | null>(null);
  const [sucessoPendente, setSucessoPendente] = useState<string | null>(null);
  const [historico, setHistorico] = useState<SugestaoRow | null>(null);

  const setItem = (productId: string, patch: Partial<Sel>) =>
    setSel((s) => ({ ...s, [productId]: { ...s[productId], ...patch } }));

  // Filtro por status/busca — o grupo some quando não sobra item visível.
  const visiveis = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return grupos
      .map((g) => ({
        ...g,
        itens: g.itens.filter((it) => {
          if (filtro !== "todos" && it.status !== filtro) return false;
          if (termo && !`${it.nome} ${it.sku} ${it.marca ?? ""} ${it.categoria ?? ""}`.toLowerCase().includes(termo)) return false;
          return true;
        }),
      }))
      .filter((g) => g.itens.length > 0);
  }, [grupos, filtro, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: 0, ruptura: 0, critico: 0, abaixo: 0 };
    for (const g of grupos) for (const it of g.itens) {
      c.todos += 1;
      c[it.status] += 1;
    }
    return c;
  }, [grupos]);

  // Resumo por grupo (itens marcados)
  const resumoGrupo = (g: GrupoReposicao) => {
    const marcados = g.itens.filter((it) => sel[it.productId]?.on);
    const total = marcados.reduce((acc, it) => acc + (sel[it.productId]?.qtd ?? 0) * (it.custoUnitCompra ?? 0), 0);
    return { marcados, total };
  };

  const resumoGeral = useMemo(() => {
    let pedidos = 0;
    let itens = 0;
    let total = 0;
    for (const g of grupos) {
      if (g.supplierId === null) continue;
      const marcados = g.itens.filter((it) => sel[it.productId]?.on && (sel[it.productId]?.qtd ?? 0) > 0);
      if (marcados.length === 0) continue;
      pedidos += 1;
      itens += marcados.length;
      total += marcados.reduce((acc, it) => acc + (sel[it.productId]?.qtd ?? 0) * (it.custoUnitCompra ?? 0), 0);
    }
    return { pedidos, itens, total };
  }, [grupos, sel]);

  // Congela a revisão atual (itens marcados + quantidades) em grupos de envio
  // para a finalização — o sheet pergunta só COMO solicitar.
  const paraEnvio = (gs: GrupoReposicao[]): GrupoEnvio[] =>
    gs
      .filter((g) => g.supplierId !== null)
      .map((g) => ({
        supplierId: g.supplierId!,
        supplierNome: g.supplierNome,
        telefone: g.supplierTelefone,
        email: g.supplierEmail,
        leadTimeDias: g.leadTimeDias,
        itens: g.itens
          .filter((it) => sel[it.productId]?.on && (sel[it.productId]?.qtd ?? 0) > 0)
          .map((it) => ({
            productId: it.productId,
            packagingId: it.packagingId,
            nome: it.nome,
            qtd: sel[it.productId].qtd,
            packagingNome: it.packagingNome,
            fatorConversao: it.fatorConversao,
            custoUnitCompra: it.custoUnitCompra,
          })),
      }))
      .filter((g) => g.itens.length > 0);

  const abrirSolicitar = (gs: GrupoReposicao[]) => {
    const envio = paraEnvio(gs);
    if (envio.length === 0) return;
    setSucesso(null);
    setSolicitar(envio);
  };

  // A lista só recarrega ao fechar o sheet: os pedidos criados viram
  // "pendente" e as sugestões atendidas saem da tela.
  const fecharSolicitar = () => {
    setSolicitar(null);
    if (sucessoPendente) {
      setSucesso(sucessoPendente);
      setSucessoPendente(null);
      router.refresh();
    }
  };

  const chips: { key: StatusRepo | "todos"; label: string }[] = [
    { key: "todos", label: "Tudo" },
    { key: "ruptura", label: "Ruptura" },
    { key: "critico", label: "Crítico" },
    { key: "abaixo", label: "Abaixo do mínimo" },
  ];

  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <PartyPopper size={32} className="text-ok" />
        <p className="text-sm font-semibold text-ink">Estoque em dia — nada para repor.</p>
        <p className="max-w-sm text-xs text-muted">
          Quando um produto ficar abaixo do mínimo ou o ritmo de venda indicar que o estoque vai acabar, a sugestão de compra aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: filtros + busca + comprar em 1 clique */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const total = counts[c.key] ?? 0;
            if (c.key !== "todos" && total === 0) return null;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onFiltro(c.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  filtro === c.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
                )}
              >
                {c.key !== "todos" && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_REPO[c.key].dot)} />}
                {c.label}
                <span className={cn("rounded-full px-1.5 py-px text-[10px] tabular-nums", filtro === c.key ? "bg-brand/15 text-brand" : "bg-surface-2 text-faint")}>
                  {total}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-52 lg:flex-none">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto"
              className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </div>
          <button
            type="button"
            disabled={resumoGeralVazio(resumoGeral) || !siteId}
            onClick={() => abrirSolicitar(grupos)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            <Zap size={15} />
            <span className="hidden sm:inline">Solicitar tudo{resumoGeral.total > 0 ? ` · ${fmtMoney(resumoGeral.total)}` : ""}</span>
            <span className="sm:hidden">Solicitar tudo</span>
          </button>
        </div>
      </div>

      {sucesso && (
        <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-4 py-3 text-sm font-medium text-ok">
          <CheckCheck size={16} className="shrink-0" /> {sucesso}
        </p>
      )}

      {visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface py-12 text-center">
          <Search size={24} className="text-faint" />
          <p className="text-sm font-medium text-muted">Nenhuma sugestão para este filtro.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visiveis.map((g) => (
            <GrupoCard
              key={g.supplierId ?? "sem"}
              grupo={g}
              sel={sel}
              setItem={setItem}
              expandido={expandido}
              setExpandido={setExpandido}
              resumo={resumoGrupo(g)}
              podeEnviar={!!siteId}
              onSolicitar={() => abrirSolicitar([g])}
              onHistorico={setHistorico}
            />
          ))}
        </div>
      )}

      {/* Finalização: como deseja solicitar esta compra? */}
      {solicitar && siteId && (
        <SolicitarSheet
          grupos={solicitar}
          empresa={empresa}
          siteId={siteId}
          onClose={fecharSolicitar}
          onConcluido={setSucessoPendente}
        />
      )}

      {/* Drawer: histórico de compras do produto */}
      <HistoricoDrawer item={historico} onClose={() => setHistorico(null)} />
    </div>
  );
}

const resumoGeralVazio = (r: { pedidos: number }) => r.pedidos === 0;

// ── Card por fornecedor ───────────────────────────────────────

function GrupoCard({
  grupo: g,
  sel,
  setItem,
  expandido,
  setExpandido,
  resumo,
  podeEnviar,
  onSolicitar,
  onHistorico,
}: {
  grupo: GrupoReposicao;
  sel: Record<string, Sel>;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  expandido: string | null;
  setExpandido: (id: string | null) => void;
  resumo: { marcados: SugestaoRow[]; total: number };
  podeEnviar: boolean;
  onSolicitar: () => void;
  onHistorico: (item: SugestaoRow) => void;
}) {
  const semFornecedor = g.supplierId === null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
      {/* Cabeçalho do fornecedor */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2/50 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", semFornecedor ? "bg-surface-2 text-faint" : "bg-brand-soft text-brand")}>
            {semFornecedor ? <Link2 size={16} /> : <Building2 size={16} />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-ink">{g.supplierNome}</h3>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span>{g.itens.length} {g.itens.length === 1 ? "produto" : "produtos"}</span>
              {g.leadTimeDias != null && (
                <span className="flex items-center gap-1"><Truck size={11} /> entrega ~{g.leadTimeDias}d</span>
              )}
            </p>
          </div>
        </div>

        {!semFornecedor && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-muted">
                {resumo.marcados.length} {resumo.marcados.length === 1 ? "item" : "itens"} selecionados
              </p>
              <p className="font-display text-base font-semibold tabular-nums text-ink">{fmtMoney(resumo.total)}</p>
            </div>
            <button
              type="button"
              disabled={resumo.marcados.length === 0 || !podeEnviar}
              onClick={onSolicitar}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              <Send size={14} />
              Solicitar compra
            </button>
          </div>
        )}
      </header>

      {semFornecedor && (
        <p className="flex items-start gap-2 border-b border-line bg-warn-soft/60 px-5 py-2.5 text-xs text-warn">
          <Info size={13} className="mt-px shrink-0" />
          <span>
            Estes produtos precisam de compra, mas não têm fornecedor vinculado. Abra o produto em{" "}
            <a href="/produtos" className="font-semibold underline underline-offset-2">Produtos</a> e vincule um fornecedor para pedir por aqui.
          </span>
        </p>
      )}

      {/* Itens */}
      <ul className="divide-y divide-line">
        {g.itens.map((it) => (
          <ItemRow
            key={it.productId}
            item={it}
            grupo={g}
            sel={sel[it.productId] ?? { on: false, qtd: it.qtdSugerida }}
            setItem={setItem}
            desabilitado={semFornecedor}
            aberto={expandido === it.productId}
            onToggle={() => setExpandido(expandido === it.productId ? null : it.productId)}
            onHistorico={() => onHistorico(it)}
          />
        ))}
      </ul>
    </section>
  );
}

// ── Linha de produto ──────────────────────────────────────────

function ItemRow({
  item: it,
  grupo: g,
  sel,
  setItem,
  desabilitado,
  aberto,
  onToggle,
  onHistorico,
}: {
  item: SugestaoRow;
  grupo: GrupoReposicao;
  sel: Sel;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  desabilitado: boolean;
  aberto: boolean;
  onToggle: () => void;
  onHistorico: () => void;
}) {
  const aCaminho = it.qtdSugerida === 0 && it.pendente > 0;
  const qtd = sel.qtd;
  const subtotal = qtd * (it.custoUnitCompra ?? 0);
  const unidadesBase = qtd * it.fatorConversao;

  return (
    <li className={cn("transition-colors", sel.on && !desabilitado && "bg-brand-soft/30")}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:grid lg:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1.4fr)_auto_auto] lg:items-center lg:gap-4">
        {/* Seleção */}
        <input
          type="checkbox"
          checked={sel.on && !desabilitado}
          disabled={desabilitado || aCaminho}
          onChange={(e) => setItem(it.productId, { on: e.target.checked })}
          className="h-4.5 w-4.5 shrink-0 accent-brand"
          aria-label={`Incluir ${it.nome} no pedido`}
        />

        {/* Produto */}
        <button type="button" onClick={onHistorico} className="flex min-w-0 items-center gap-3 text-left">
          <Thumb url={it.imagemUrl} nome={it.nome} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <StatusDot status={it.status} />
              <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
            </div>
            <p className="truncate font-mono text-[11px] text-faint">
              {it.sku}
              {it.categoria ? <span className="font-sans"> · {it.categoria}</span> : null}
            </p>
          </div>
        </button>

        {/* Situação: estoque × mínimo + cobertura */}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted">
            <span className={cn("font-semibold tabular-nums", STATUS_REPO[it.status].text)}>{fmtQtd(it.estoque)}</span>
            {it.estoqueMinimo > 0 && <span className="text-faint"> / mín {fmtQtd(it.estoqueMinimo)}</span>}
            {it.pendente > 0 && <span className="text-brand"> · +{fmtQtd(it.pendente)} a caminho</span>}
          </p>
          <CoberturaBar dias={it.coberturaDias} status={it.status} />
        </div>

        {/* Quantidade */}
        {aCaminho ? (
          <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand lg:justify-self-center">
            <Truck size={13} /> Pedido a caminho
          </span>
        ) : (
          <div className="flex items-center gap-2 lg:justify-self-center">
            <Stepper value={qtd} onChange={(v) => setItem(it.productId, { qtd: v, on: v > 0 })} disabled={desabilitado} min={0} />
            <span className="w-20 text-[11px] leading-tight text-muted">
              {it.packagingNome ? (
                <>
                  {it.packagingNome} ×{fmtQtd(it.fatorConversao)}
                  <span className="block text-faint">= {fmtQtd(unidadesBase)} un</span>
                </>
              ) : (
                "unidades"
              )}
            </span>
          </div>
        )}

        {/* Custo + expandir motivo */}
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-ink">{it.custoUnitCompra != null ? fmtMoney(subtotal) : "—"}</p>
            {it.custoUnitCompra != null && (
              <p className="text-[11px] tabular-nums text-faint">{fmtMoney(it.custoUnitCompra)}/{it.packagingNome ?? "un"}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={aberto}
            aria-label="Por que comprar?"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-faint transition-colors hover:bg-surface-2 hover:text-ink",
              aberto && "bg-surface-2 text-ink",
            )}
          >
            <ChevronDown size={15} className={cn("transition-transform", aberto && "rotate-180")} />
          </button>
        </div>
      </div>

      {/* Motivo da sugestão */}
      {aberto && <MotivoBox item={it} grupo={g} qtd={qtd} />}
    </li>
  );
}

// ── Caixa "por que comprar" ───────────────────────────────────

function MotivoBox({ item: it, grupo: g, qtd }: { item: SugestaoRow; grupo: GrupoReposicao; qtd: number }) {
  const meta = STATUS_REPO[it.status];
  const aposCompra = it.mediaDia > 0 ? Math.floor((it.estoque + it.pendente + qtd * it.fatorConversao) / it.mediaDia) : null;

  const motivos: { icon: React.ElementType; texto: React.ReactNode }[] = [];

  motivos.push({
    icon: Info,
    texto:
      it.status === "ruptura" ? (
        <>Estoque <strong>zerado</strong> — venda parada até chegar mercadoria.</>
      ) : it.estoqueMinimo > 0 && it.estoque < it.estoqueMinimo ? (
        <>Estoque em <strong>{fmtQtd(it.estoque)} un</strong>, abaixo do mínimo de <strong>{fmtQtd(it.estoqueMinimo)}</strong>.</>
      ) : (
        <>Estoque em <strong>{fmtQtd(it.estoque)} un</strong>, perto de acabar no ritmo atual.</>
      ),
  });

  if (it.consumo7 > 0 || it.consumo30 > 0) {
    motivos.push({
      icon: TrendingUp,
      texto: (
        <>
          Vendeu <strong>{fmtQtd(it.consumo7)} un nos últimos 7 dias</strong>
          {it.consumo30 > 0 && <> ({fmtQtd(it.consumo30)} em 30 dias — média {it.mediaDia.toFixed(1)}/dia)</>}.
        </>
      ),
    });
  }

  if (it.coberturaDias != null) {
    motivos.push({
      icon: Clock,
      texto: <>No ritmo atual, o estoque dura <strong>~{Math.max(0, it.coberturaDias)} {it.coberturaDias === 1 ? "dia" : "dias"}</strong>.</>,
    });
  }

  if (g.leadTimeDias != null) {
    motivos.push({
      icon: Truck,
      texto: <>{g.supplierNome} costuma entregar em <strong>~{g.leadTimeDias} {g.leadTimeDias === 1 ? "dia" : "dias"}</strong>.</>,
    });
  }

  if (qtd > 0 && aposCompra != null) {
    motivos.push({
      icon: Sparkles,
      texto: (
        <>
          Comprando <strong>{qtd} {it.packagingNome ? `${it.packagingNome.toLowerCase()}(s)` : "un"}</strong>
          {it.fatorConversao !== 1 && <> ({fmtQtd(qtd * it.fatorConversao)} un)</>}, o estoque cobre <strong>~{aposCompra} dias</strong> de venda.
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
      {it.ultimaCompraEm && (
        <p className="border-t border-line pt-2 text-xs text-muted">
          Última compra {relDia(it.ultimaCompraEm)}
          {it.ultimoCustoUn != null && <> por <span className="font-medium tabular-nums text-ink">{fmtMoney(it.ultimoCustoUn)}</span>/{it.packagingNome ?? "un"}</>}.
        </p>
      )}
    </div>
  );
}

// ── Drawer: histórico de compras do produto ───────────────────

function HistoricoDrawer({ item, onClose }: { item: SugestaoRow | null; onClose: () => void }) {
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
