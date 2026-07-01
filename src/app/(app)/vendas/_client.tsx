"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Loader2,
  ShoppingCart,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Wine,
  Banknote,
  CreditCard,
  QrCode,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  X,
  Sparkles,
  Check,
  ImageOff,
  ChevronDown,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import { finalizarVendaPdvAction, cancelarVendaAction } from "./actions";
import {
  abrirCaixaAction,
  movimentarCaixaAction,
  fecharCaixaAction,
} from "./caixa/actions";
import type { ComponentGroupVenda, ProdutoVenda } from "./_data";
import type { FechamentoReport } from "@/lib/caixa";
import type { PaymentMethod } from "@/generated/prisma";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type CartItem = {
  key: string;
  productId: string;
  variantId: string | null;
  nome: string;
  variantNome: string | null;
  preco: number;
  quantidade: number;
  restricaoIdade: boolean;
  selecoes: string[];
};

type CaixaInfo = {
  id: string;
  siteNome: string;
  abertaEm: Date;
  valorAbertura: number;
  relatorio: FechamentoReport | null;
};

const METODO_ICONS: Record<PaymentMethod, typeof Banknote> = {
  DINHEIRO: Banknote,
  PIX: QrCode,
  CARTAO_CREDITO: CreditCard,
  CARTAO_DEBITO: CreditCard,
  OUTRO: Wallet,
};

const METODO_LABEL_CURTO: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  CARTAO_CREDITO: "Crédito",
  CARTAO_DEBITO: "Débito",
  OUTRO: "Outro",
};

const selectCls =
  "cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const inputCls =
  "rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink tabular-nums placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function PdvClient({
  sites,
  defaultSiteId,
  produtos,
  metodosAtivos,
  caixa,
}: {
  sites: { id: string; nome: string; controleIdade?: boolean }[];
  defaultSiteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  caixa: CaixaInfo | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [descontoVenda, setDescontoVenda] = useState(0);
  const [descontoDisplay, setDescontoDisplay] = useState("");
  const [maiorIdade, setMaiorIdade] = useState(false);
  const [metodoSel, setMetodoSel] = useState<PaymentMethod | null>(null);
  const [recebido, setRecebido] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pdvModal, setPdvModal] = useState<ProdutoVenda | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const caixaOk = !!caixa;

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const p of produtos) if (p.categoria) set.add(p.categoria);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [produtos]);

  const temIdade = useMemo(
    () => produtos.some((p) => p.restricaoIdade),
    [produtos],
  );

  const siteControlaIdade =
    sites.find((s) => s.id === siteId)?.controleIdade ?? false;

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos
      .filter((p) => {
        // produtos com estoque controlado zerado ficam fora da vitrine
        if (p.estoqueFechado != null && p.estoqueFechado <= 0) return false;
        // personalizado sem insumos para a receita mínima fica fora da vitrine
        if (p.tipo === "PERSONALIZADO" && !p.disponivel) return false;
        if (filtroCat === "+18" && !p.restricaoIdade) return false;
        if (filtroCat && filtroCat !== "+18" && p.categoria !== filtroCat)
          return false;
        if (!q) return true;
        return (
          p.nome.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.ean ?? "").includes(q)
        );
      })
      .slice(0, 60);
  }, [busca, filtroCat, produtos]);

  const subtotal = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const total = Math.max(0, subtotal - descontoVenda);
  const recebidoNum =
    parseFloat(recebido.replace(/\./g, "").replace(",", ".")) || 0;
  const troco = metodoSel === "DINHEIRO" ? Math.max(0, recebidoNum - total) : 0;
  const precisaIdade = siteControlaIdade && cart.some((i) => i.restricaoIdade);
  const dinheiroOk = metodoSel !== "DINHEIRO" || recebidoNum >= total - 0.005;
  const podeFinalizar =
    caixaOk &&
    cart.length > 0 &&
    total > 0.005 &&
    !!metodoSel &&
    dinheiroOk &&
    (!precisaIdade || maiorIdade) &&
    !pending;

  function addItem(
    p: ProdutoVenda,
    variantId: string | null,
    qty = 1,
    selecoes: string[] = [],
    precoUnit?: number,
  ) {
    if (!caixaOk) {
      setSheetOpen(true);
      return;
    }
    const variant = variantId
      ? (p.variants.find((v) => v.id === variantId) ?? null)
      : null;
    const selKey = selecoes.length ? ":" + [...selecoes].sort().join(",") : "";
    const key = p.id + ":" + (variantId ?? "") + selKey;
    setCart((prev) => {
      const ex = prev.find((i) => i.key === key);
      if (ex)
        return prev.map((i) =>
          i.key === key ? { ...i, quantidade: i.quantidade + qty } : i,
        );
      return [
        ...prev,
        {
          key,
          productId: p.id,
          variantId,
          nome: p.nome,
          variantNome: variant?.nome ?? null,
          preco: precoUnit ?? variant?.preco ?? p.preco,
          quantidade: qty,
          restricaoIdade: p.restricaoIdade,
          selecoes,
        },
      ];
    });
    buscaRef.current?.focus();
  }

  function setQtd(key: string, q: number) {
    if (q <= 0) return setCart((prev) => prev.filter((i) => i.key !== key));
    setCart((prev) =>
      prev.map((i) => (i.key === key ? { ...i, quantidade: q } : i)),
    );
  }

  function limpar() {
    setCart([]);
    setDescontoVenda(0);
    setDescontoDisplay("");
    setMaiorIdade(false);
    setMetodoSel(null);
    setRecebido("");
  }

  function finalizar() {
    if (!podeFinalizar || !metodoSel) return;
    startTransition(async () => {
      try {
        await finalizarVendaPdvAction({
          siteId,
          items: cart.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantidade: i.quantidade,
            selecoes: i.selecoes,
          })),
          descontoVenda,
          maiorIdadeConfirmada: maiorIdade,
          pagamentos: [
            { metodo: metodoSel, valor: total, troco: troco || null },
          ],
        });
        toast.success("Venda concluída com sucesso!", `${brl(total)}`);
        limpar();
        router.refresh();
      } catch (e) {
        toast.error(
          "Erro ao finalizar venda",
          e instanceof Error ? e.message : "Tente novamente.",
        );
      }
    });
  }

  function cancelar(saleId: string) {
    startTransition(async () => {
      try {
        await cancelarVendaAction(saleId);
        router.refresh();
      } catch (e) {
        toast.error(
          "Erro ao cancelar",
          e instanceof Error ? e.message : "Tente novamente.",
        );
      }
    });
  }

  // F2 finaliza a venda (atalho de balcão).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        finalizar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="grid gap-4 pt-2 lg:h-full lg:grid-cols-[1fr_440px] lg:overflow-hidden xl:grid-cols-[1fr_480px]">
        {/* Catálogo */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:h-full">
          {/* Barra superior — busca + caixa, só do lado dos cards */}
          <div className="flex flex-wrap items-center gap-2">
            {sites.length > 1 && (
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className={selectCls}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            )}
            <div className="relative min-w-[200px] flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                ref={buscaRef}
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, SKU ou EAN…"
                className="w-full rounded-[var(--radius)] border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <button
              onClick={() => setSheetOpen(true)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border px-4 py-2.5 text-sm font-semibold transition-colors",
                caixaOk
                  ? "border-ok/40 bg-ok-soft text-ok hover:bg-ok-soft/70"
                  : "animate-pulse border-danger bg-danger text-on-brand hover:opacity-90",
              )}
            >
              {caixaOk ? <Unlock size={15} /> : <Lock size={15} />}
              {caixaOk ? "Caixa aberto" : "Caixa fechado"}
            </button>
          </div>

          {/* Filtros rápidos */}
          <div className="flex flex-wrap gap-1.5">
            <FiltroChip
              ativo={filtroCat === null}
              onClick={() => setFiltroCat(null)}
            >
              Todos
            </FiltroChip>
            {temIdade && (
              <FiltroChip
                ativo={filtroCat === "+18"}
                onClick={() => setFiltroCat("+18")}
              >
                +18
              </FiltroChip>
            )}
            {categorias.map((c) => (
              <FiltroChip
                key={c}
                ativo={filtroCat === c}
                onClick={() => setFiltroCat(c)}
              >
                {c}
              </FiltroChip>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 auto-rows-min content-start grid-cols-[repeat(auto-fill,minmax(clamp(6.5rem,9vw,10rem),1fr))] gap-2 overflow-y-auto">
            {filtrados.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted">
                Nenhum produto encontrado.
              </p>
            )}
            {filtrados.map((p) => (
              <ProdutoCard
                key={p.id}
                produto={p}
                onAdd={addItem}
                onOpenModal={setPdvModal}
              />
            ))}
          </div>
        </div>

        {/* Carrinho — ocupa todo o lado direito, altura total */}
        <div className="flex min-h-0 flex-col lg:h-full">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {/* Cabeçalho do carrinho */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand">
                  <ShoppingCart size={16} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Carrinho
                  </span>
                  <span className="block text-xs text-ink-2">
                    {cart.length} {cart.length === 1 ? "item" : "itens"}
                  </span>
                </span>
              </span>
              {cart.length > 0 && (
                <button
                  onClick={limpar}
                  className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-danger"
                >
                  <X size={13} /> Limpar
                </button>
              )}
            </div>

            {/* Itens */}
            <div className="min-h-[180px] flex-1 overflow-y-auto px-2 py-2">
              {cart.length === 0 ? (
                <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
                  <ShoppingCart size={28} className="text-faint" />
                  <p className="text-sm text-muted">
                    Selecione um produto para adicionar ao carrinho.
                  </p>
                </div>
              ) : (
                cart.map((i) => (
                  <div
                    key={i.key}
                    className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {i.nome}
                        {i.variantNome && (
                          <span className="text-muted"> · {i.variantNome}</span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-ink-2">
                        {brl(i.preco)} un.
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setQtd(i.key, i.quantidade - 1)}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                      >
                        {i.quantidade <= 1 ? (
                          <Trash2 size={12} />
                        ) : (
                          <Minus size={13} />
                        )}
                      </button>
                      <span className="w-6 text-center font-mono text-sm tabular-nums">
                        {i.quantidade}
                      </span>
                      <button
                        onClick={() => setQtd(i.key, i.quantidade + 1)}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <span className="w-16 text-right font-mono text-sm font-semibold tabular-nums text-ink">
                      {brl(i.preco * i.quantidade)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* +18 */}
            {precisaIdade && (
              <label className="mx-3 mb-2 flex cursor-pointer items-center gap-2.5 rounded-[var(--radius)] border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-warn">
                <input
                  type="checkbox"
                  checked={maiorIdade}
                  onChange={(e) => setMaiorIdade(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-[var(--warn)]"
                />
                <AlertTriangle size={15} className="shrink-0" />
                <span>Confirmo que o cliente é maior de 18 anos.</span>
              </label>
            )}

            {/* Pagamento */}
            <div className="border-t border-line px-4 py-3">
              <div className="grid grid-cols-4 gap-1.5">
                {metodosAtivos.map((m) => {
                  const Icon = METODO_ICONS[m] ?? Wallet;
                  const sel = metodoSel === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setMetodoSel(m)}
                      disabled={!caixaOk}
                      title={PAYMENT_METHOD_LABELS[m]}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-[var(--radius)] border px-1 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        sel
                          ? "border-brand bg-brand text-on-brand"
                          : "border-line bg-surface text-ink hover:border-brand hover:bg-brand-soft hover:text-brand",
                      )}
                    >
                      <Icon size={16} />
                      <span className="truncate">{METODO_LABEL_CURTO[m]}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                    Desconto (R$)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={descontoDisplay}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      const cents = parseInt(digits || "0", 10);
                      const num = cents / 100;
                      setDescontoDisplay(
                        digits
                          ? num.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "",
                      );
                      setDescontoVenda(num);
                    }}
                    placeholder="0,00"
                    disabled={!caixaOk}
                    className={cn(
                      inputCls,
                      "py-2 text-right disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                    Recebido (R$)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={recebido}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      const cents = parseInt(digits || "0", 10);
                      const num = cents / 100;
                      setRecebido(
                        digits
                          ? num.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "",
                      );
                    }}
                    placeholder="0,00"
                    disabled={!caixaOk || metodoSel !== "DINHEIRO"}
                    className={cn(
                      inputCls,
                      "py-2 text-right disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  />
                </label>
              </div>
            </div>

            {/* Totais */}
            <div className="flex flex-col gap-1.5 border-t border-line px-4 py-3">
              <div className="flex items-center justify-between text-sm text-ink-2">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{brl(subtotal)}</span>
              </div>
              {descontoVenda > 0 && (
                <div className="flex items-center justify-between text-sm text-ink-2">
                  <span>Desconto</span>
                  <span className="font-mono tabular-nums text-danger">
                    −{brl(descontoVenda)}
                  </span>
                </div>
              )}
              {troco > 0 && (
                <div className="flex items-center justify-between text-sm text-ink-2">
                  <span>Troco</span>
                  <span className="font-mono tabular-nums text-accent">
                    {brl(troco)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line pt-2">
                <span className="text-sm font-semibold text-ink">
                  Total a pagar
                </span>
                <span className="font-display text-[2rem] font-bold leading-none tabular-nums text-brand">
                  {brl(total)}
                </span>
              </div>
            </div>

            {/* Finalizar */}
            <div className="border-t border-line p-3">
              <button
                onClick={finalizar}
                disabled={!podeFinalizar}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-5 py-3.5 text-base font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={18} />
                )}
                Finalizar venda
                <kbd className="ml-1 rounded border border-on-brand/40 px-1.5 py-0.5 text-[10px] font-medium">
                  F2
                </kbd>
              </button>
            </div>
          </div>
        </div>
      </div>

      <PersonalizadoModal
        produto={pdvModal}
        onClose={() => setPdvModal(null)}
        onAdd={(p, variantId, qty, selecoes, precoUnit) => {
          addItem(p, variantId, qty, selecoes, precoUnit);
          setPdvModal(null);
        }}
      />

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Caixa"
        description="Abertura, sangria, suprimento e fechamento do caixa do PDV."
      >
        <CaixaPanel
          sites={sites}
          siteId={siteId}
          setSiteId={setSiteId}
          metodos={metodosAtivos}
          caixa={caixa}
          onDone={() => router.refresh()}
        />
      </Sheet>
    </>
  );
}

function FiltroChip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        ativo
          ? "border-brand bg-brand text-on-brand"
          : "border-line bg-surface text-muted hover:border-brand hover:text-brand",
      )}
    >
      {children}
    </button>
  );
}

function ProdutoCard({
  produto,
  onAdd,
  onOpenModal,
}: {
  produto: ProdutoVenda;
  onAdd: (p: ProdutoVenda, variantId: string | null, qty?: number) => void;
  onOpenModal: (p: ProdutoVenda) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const semEstoque =
    produto.estoqueFechado != null && produto.estoqueFechado <= 0;
  const temVariants = produto.variants.length > 0;
  const isPersonalizado = produto.tipo === "PERSONALIZADO";

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
      <button
        onClick={() => {
          if (isPersonalizado) onOpenModal(produto);
          else if (temVariants) setExpanded((v) => !v);
          else onAdd(produto, null);
        }}
        disabled={semEstoque}
        className="flex flex-1 cursor-pointer flex-col text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="relative aspect-[4/3] w-full bg-surface-2">
          {produto.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={produto.imagemUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-contain p-1"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-faint">
              <Wine size={22} />
            </span>
          )}
          {produto.restricaoIdade && (
            <Badge tone="danger" className="absolute right-1 top-1">
              +18
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-0.5 p-1.5">
          <span className="line-clamp-2 h-[1.7rem] text-xs font-medium leading-[1.1] text-ink">
            {produto.nome}
          </span>
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-semibold text-brand">
              {brl(produto.preco)}
            </span>
            {produto.estoqueFechado != null ? (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  semEstoque ? "text-danger" : "text-muted",
                )}
              >
                {produto.estoqueFechado} un
              </span>
            ) : (
              <span className="text-[11px] text-faint">
                {produto.tipo === "COMBO" ? "kit" : "produção"}
              </span>
            )}
          </div>
        </div>
      </button>
      {expanded && temVariants && !isPersonalizado && (
        <div className="flex flex-wrap gap-1 border-t border-line p-2">
          {produto.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                onAdd(produto, v.id);
                setExpanded(false);
              }}
              className="cursor-pointer rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:border-brand hover:bg-brand-soft hover:text-brand"
            >
              {v.nome} · {brl(v.preco)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal de produto personalizado (drink/prato/outro) ───────────

function regraGrupo(g: ComponentGroupVenda): string {
  if (g.tipoSelecao === "UNICA") return "Escolha 1 opção";
  if (g.maxSelecoes != null) return `Escolha até ${g.maxSelecoes}`;
  return "Escolha quantas quiser";
}

function PersonalizadoModal({
  produto,
  onClose,
  onAdd,
}: {
  produto: ProdutoVenda | null;
  onClose: () => void;
  onAdd: (
    p: ProdutoVenda,
    variantId: string | null,
    qty: number,
    selecoes: string[],
    precoUnit: number,
  ) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!produto) return;
    setSelectedVariant(produto.variants[0]?.id ?? null);
    setQty(1);
    setClosedGroups(new Set());
    // Pré-seleciona apenas os grupos obrigatórios — extras/opcionais
    // começam vazios para não surpreender o operador com acréscimo.
    if (produto.groups) {
      const sels: Record<string, string[]> = {};
      for (const g of produto.groups) {
        if (!g.obrigatoria) {
          sels[g.id] = [];
          continue;
        }
        const disp = g.items.filter((i) => i.disponivel);
        const defaultItem = disp.find((i) => i.isDefault) ?? disp[0];
        sels[g.id] = defaultItem ? [defaultItem.componentProductId] : [];
      }
      setSelections(sels);
    } else {
      setSelections({});
    }
  }, [produto]);

  useEffect(() => {
    if (!produto) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [produto, onClose]);

  if (!produto) return null;

  const temVariants = produto.variants.length > 0;
  const variant = selectedVariant
    ? (produto.variants.find((v) => v.id === selectedVariant) ?? null)
    : null;
  const precoBase = variant?.preco ?? produto.preco;

  let acrescimoTotal = 0;
  if (produto.groups) {
    for (const g of produto.groups) {
      for (const id of selections[g.id] ?? []) {
        const item = g.items.find((i) => i.componentProductId === id);
        if (item?.acrescimoPreco) acrescimoTotal += item.acrescimoPreco;
      }
    }
  }

  const preco = precoBase + acrescimoTotal;
  const total = preco * qty;

  function toggleSelection(g: ComponentGroupVenda, itemId: string) {
    const current = selections[g.id] ?? [];
    let nextForGroup: string[];
    if (g.tipoSelecao === "UNICA") {
      nextForGroup = current[0] === itemId ? [] : [itemId];
    } else {
      const has = current.includes(itemId);
      if (has) {
        nextForGroup = current.filter((id) => id !== itemId);
      } else if (g.maxSelecoes != null && current.length >= g.maxSelecoes) {
        nextForGroup = current;
      } else {
        nextForGroup = [...current, itemId];
      }
    }
    setSelections((prev) => ({ ...prev, [g.id]: nextForGroup }));
  }

  function toggleGrupoAberto(id: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focarGrupo(id: string) {
    setClosedGroups((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    requestAnimationFrame(() => {
      groupRefs.current[id]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]" />

      <div
        className="relative z-10 flex w-full max-h-[94dvh] flex-col overflow-hidden rounded-t-[var(--radius-xl)] border border-line bg-surface text-ink shadow-[var(--shadow-2)] sm:max-h-[88dvh] sm:max-w-[980px] sm:rounded-[var(--radius-xl)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
          {/* ── Coluna esquerda: grupos disponíveis ── */}
          <div className="flex-1 space-y-3 px-4 py-4 sm:overflow-y-auto sm:border-r sm:border-line">
            {temVariants && (
              <div className="rounded-[var(--radius-lg)] border border-line bg-surface overflow-hidden">
                <div className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">Tamanho</h3>
                    <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-brand">
                      Obrigatório
                    </span>
                  </div>
                  <p className="text-xs text-muted">Escolha 1 opção</p>
                </div>
                <div className="flex flex-col gap-2 px-4 pb-4">
                  {produto.variants.map((v) => {
                    const sel = selectedVariant === v.id;
                    return (
                      <OpcaoCard
                        key={v.id}
                        selecionado={sel}
                        onClick={() => setSelectedVariant(v.id)}
                        nome={
                          v.volumeMl ? `${v.nome} · ${v.volumeMl}ml` : v.nome
                        }
                        priceNode={
                          <span
                            className={cn(
                              "font-mono text-[12px] font-semibold",
                              sel ? "text-brand" : "text-muted",
                            )}
                          >
                            {brl(v.preco)}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {(produto.groups ?? []).map((g) => {
              const aberto = !closedGroups.has(g.id);
              const ids = selections[g.id] ?? [];
              const itensDisp = g.items.filter((i) => i.disponivel);
              const satisfeito = ids.length > 0;
              const itensSelecionados = g.items.filter((i) =>
                ids.includes(i.componentProductId),
              );
              return (
                <div
                  key={g.id}
                  ref={(el) => {
                    groupRefs.current[g.id] = el;
                  }}
                  className="rounded-[var(--radius-lg)] border border-line bg-surface overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleGrupoAberto(g.id)}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3.5 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">
                          {g.nome}
                        </h3>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide",
                            g.obrigatoria
                              ? "bg-brand-soft text-brand"
                              : "bg-surface-2 text-muted",
                          )}
                        >
                          {g.obrigatoria ? "Obrigatório" : "Opcional"}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted">
                        {aberto || !satisfeito
                          ? regraGrupo(g)
                          : itensSelecionados.map((i) => i.nome).join(" + ")}
                      </p>
                    </div>
                    {satisfeito && (
                      <Check size={16} className="shrink-0 text-ok" />
                    )}
                    <ChevronDown
                      size={16}
                      className={cn(
                        "shrink-0 text-muted transition-transform duration-200",
                        aberto && "rotate-180",
                      )}
                    />
                  </button>

                  {aberto && (
                    <div className="flex flex-col gap-2 px-4 pb-4">
                      {[...itensDisp]
                        .sort(
                          (a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0),
                        )
                        .map((item) => {
                          const selecionado = ids.includes(
                            item.componentProductId,
                          );
                          const noLimite =
                            !selecionado &&
                            g.maxSelecoes != null &&
                            ids.length >= g.maxSelecoes;
                          return (
                            <OpcaoCard
                              key={item.componentProductId}
                              selecionado={selecionado}
                              disabled={noLimite}
                              onClick={() =>
                                toggleSelection(g, item.componentProductId)
                              }
                              nome={item.nome}
                              imagemUrl={item.imagemUrl}
                              priceNode={
                                item.acrescimoPreco ? (
                                  <span className="font-mono text-[12px] font-semibold text-brand">
                                    +{brl(item.acrescimoPreco)}
                                  </span>
                                ) : null
                              }
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}

            {!temVariants && !(produto.groups && produto.groups.length > 0) && (
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-faint">
                  <ImageOff size={18} />
                </span>
                <p className="text-sm text-muted">
                  Adicione ao carrinho para personalizar no balcão.
                </p>
              </div>
            )}
          </div>

          {/* ── Coluna direita: imagem + info + "Sua escolha" + rodapé ── */}
          <aside className="flex shrink-0 flex-col sm:w-[400px]">
            <div className="sm:flex-1 sm:overflow-y-auto">
              {produto.imagemUrl ? (
                <div className="relative h-40 shrink-0 overflow-hidden sm:h-52">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={produto.imagemUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 px-4 pb-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm">
                      <Sparkles size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">
                        Personalizado
                      </p>
                      <h2 className="truncate text-lg font-bold leading-tight text-white">
                        {produto.nome}
                      </h2>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Fechar"
                    onClick={onClose}
                    className="absolute right-3 top-3 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-black/30 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                    <Sparkles size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                      Personalizado
                    </p>
                    <h2 className="truncate text-[15px] font-semibold text-ink">
                      {produto.nome}
                    </h2>
                  </div>
                  <button
                    type="button"
                    aria-label="Fechar"
                    onClick={onClose}
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-ink-2"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              <div className="px-4 py-3.5">
                <p className="text-[13px] leading-snug text-muted">
                  {produto.modoPreparo || "Monte do seu jeito."}
                </p>
              </div>

              {/* Card "Sua escolha" */}
              <div className="mx-4 mb-4 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-3.5">
                <p className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                  Sua escolha
                </p>
                <div className="flex flex-col gap-2.5">
                  {temVariants && (
                    <ResumoLinha
                      nome="Tamanho"
                      valor={variant?.nome ?? null}
                      badge={null}
                      satisfeito={!!variant}
                    />
                  )}
                  {(produto.groups ?? []).map((g) => {
                    const ids = selections[g.id] ?? [];
                    const itens = g.items.filter((i) =>
                      ids.includes(i.componentProductId),
                    );
                    const acrescimo = itens.reduce(
                      (s, i) => s + (i.acrescimoPreco ?? 0),
                      0,
                    );
                    const satisfeito = itens.length > 0;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => focarGrupo(g.id)}
                        className="text-left transition-opacity hover:opacity-80"
                      >
                        <ResumoLinha
                          nome={g.nome}
                          valor={
                            satisfeito
                              ? itens.map((i) => i.nome).join(" + ")
                              : g.obrigatoria
                                ? "Falta selecionar"
                                : "Não selecionado"
                          }
                          badge={acrescimo > 0 ? `+${brl(acrescimo)}` : null}
                          satisfeito={satisfeito}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Rodapé: quantidade + resumo financeiro + CTA (só do lado direito) */}
            <div className="shrink-0 border-t border-line bg-surface px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Diminuir quantidade"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-7 text-center font-mono text-sm font-bold text-ink">
                    {qty}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar quantidade"
                    onClick={() => setQty((q) => q + 1)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="text-right">
                  {acrescimoTotal > 0 && (
                    <p className="font-mono text-[11px] text-muted">
                      {brl(precoBase)}{" "}
                      <span className="text-brand">
                        +{brl(acrescimoTotal)}
                      </span>
                    </p>
                  )}
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                    Total
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums text-ink transition-all duration-200">
                    {brl(total)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const selecoes = Object.values(selections).flat();
                  onAdd(produto, selectedVariant, qty, selecoes, preco);
                }}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-5 py-3 text-sm font-semibold text-on-brand transition-all duration-150 hover:bg-brand-strong active:scale-[0.99]"
              >
                <ShoppingCart size={16} />
                Adicionar ao pedido
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ResumoLinha({
  nome,
  valor,
  badge,
  satisfeito,
}: {
  nome: string;
  valor: string | null;
  badge: string | null;
  satisfeito: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors",
          satisfeito ? "bg-ok-soft text-ok" : "bg-surface-2 text-faint",
        )}
      >
        {satisfeito ? (
          <Check size={11} strokeWidth={3} />
        ) : (
          <Circle size={9} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-muted">{nome}</p>
        <p
          className={cn(
            "truncate text-[13px]",
            satisfeito ? "font-medium text-ink" : "text-muted",
          )}
        >
          {valor ?? "—"}
        </p>
      </div>
      {badge && (
        <span className="mt-0.5 shrink-0 font-mono text-[11px] font-semibold text-brand">
          {badge}
        </span>
      )}
    </div>
  );
}

function OpcaoCard({
  selecionado,
  disabled,
  onClick,
  nome,
  imagemUrl,
  priceNode,
}: {
  selecionado: boolean;
  disabled?: boolean;
  onClick: () => void;
  nome: string;
  imagemUrl?: string | null;
  priceNode?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius)] border px-3 py-2.5 text-left transition-all duration-150",
        selecionado
          ? "border-brand bg-brand-soft"
          : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
        disabled &&
          "cursor-not-allowed opacity-40 hover:border-line hover:bg-surface",
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2 text-faint">
        {imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagemUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageOff size={16} />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug",
          selecionado ? "font-semibold text-ink" : "font-normal text-ink-2",
        )}
      >
        {nome}
      </span>
      {priceNode}
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
          selecionado ? "border-brand bg-brand" : "border-line-strong",
        )}
      >
        {selecionado && (
          <Check size={10} strokeWidth={3} className="text-on-brand" />
        )}
      </span>
    </button>
  );
}

// ============================================================
// Painel do Caixa — abertura / sangria / suprimento / fechamento (no Sheet)
// ============================================================

function CaixaPanel({
  sites,
  siteId,
  setSiteId,
  metodos,
  caixa,
  onDone,
}: {
  sites: { id: string; nome: string }[];
  siteId: string;
  setSiteId: (id: string) => void;
  metodos: PaymentMethod[];
  caixa: CaixaInfo | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [valorAbertura, setValorAbertura] = useState("");
  const [mov, setMov] = useState<"SANGRIA" | "SUPRIMENTO" | null>(null);
  const [movValor, setMovValor] = useState("");
  const [movMotivo, setMovMotivo] = useState("");
  const [fechando, setFechando] = useState(false);
  const [contado, setContado] = useState("");

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro.");
      }
    });
  }

  const errBox = error && (
    <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );

  // ---- Caixa fechado: formulário de abertura ----
  if (!caixa) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-warn-soft text-warn">
            <Lock size={20} />
          </span>
          <p className="text-sm font-semibold text-ink">Caixa fechado</p>
          <p className="text-xs text-muted">
            Informe o fundo de troco e abra o caixa para começar.
          </p>
        </div>
        {sites.length > 1 && (
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className={selectCls}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Fundo de troco
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={valorAbertura}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              const cents = parseInt(digits || "0", 10);
              const num = cents / 100;
              setValorAbertura(
                digits
                  ? num.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "",
              );
            }}
            placeholder="0,00"
            className={inputCls}
          />
        </label>
        {errBox}
        <button
          onClick={() =>
            run(async () => {
              await abrirCaixaAction({
                siteId,
                valorAbertura:
                  parseFloat(
                    valorAbertura.replace(/\./g, "").replace(",", "."),
                  ) || 0,
              });
            })
          }
          disabled={pending}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Unlock size={14} />
          )}
          Abrir caixa
        </button>
      </div>
    );
  }

  // ---- Caixa aberto: resumo + ações ----
  const r = caixa.relatorio;
  const totalVendido = r
    ? Object.values(r.totalPorMetodo).reduce((s, v) => s + v, 0)
    : 0;
  const dinheiroEmCaixa = r?.esperadoDinheiro ?? caixa.valorAbertura;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-base font-semibold text-ink">
            {caixa.siteNome}
          </p>
          <Badge tone="ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Aberto
          </Badge>
        </div>
        <p className="text-xs text-muted">
          Aberto em{" "}
          {caixa.abertaEm.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {r && ` · ${r.numVendas} ${r.numVendas === 1 ? "venda" : "vendas"}`}
        </p>

        {/* Vendas por método */}
        <div className="rounded-[var(--radius)] border border-line">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Vendas no caixa
          </p>
          <div className="flex flex-col">
            {metodos.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between px-3 py-1.5 text-sm"
              >
                <span className="text-muted">{PAYMENT_METHOD_LABELS[m]}</span>
                <span className="font-mono tabular-nums text-ink">
                  {brl(r?.totalPorMetodo[m] ?? 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-sm">
              <span className="font-semibold text-ink">Total vendido</span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {brl(totalVendido)}
              </span>
            </div>
          </div>
        </div>

        {/* Dinheiro em caixa */}
        <div className="flex items-center justify-between rounded-[var(--radius)] bg-ok-soft px-3 py-2.5">
          <span className="text-sm font-semibold text-ok">
            Dinheiro em caixa
          </span>
          <span className="font-display text-lg font-bold tabular-nums text-ok">
            {brl(dinheiroEmCaixa)}
          </span>
        </div>
        <p className="text-[11px] text-muted">
          Abertura {brl(caixa.valorAbertura)} · + vendas em dinheiro · ±
          sangria/suprimento
        </p>
      </div>

      {errBox}

      {/* Movimentação inline */}
      {mov && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            {mov === "SANGRIA" ? "Sangria — retirada" : "Suprimento — entrada"}
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={movValor}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              const cents = parseInt(digits || "0", 10);
              const num = cents / 100;
              setMovValor(
                digits
                  ? num.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "",
              );
            }}
            placeholder="0,00"
            className={inputCls}
          />
          <input
            value={movMotivo}
            onChange={(e) => setMovMotivo(e.target.value)}
            placeholder="Motivo"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMov(null);
                setMovValor("");
                setMovMotivo("");
              }}
              className="flex-1 cursor-pointer rounded-full border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await movimentarCaixaAction({
                    cashSessionId: caixa.id,
                    tipo: mov,
                    valor:
                      parseFloat(
                        movValor.replace(/\./g, "").replace(",", "."),
                      ) || 0,
                    motivo: movMotivo,
                  });
                  setMov(null);
                  setMovValor("");
                  setMovMotivo("");
                })
              }
              disabled={pending}
              className="flex-1 cursor-pointer rounded-full bg-brand px-3 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Fechamento inline */}
      {fechando && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            Fechar caixa
          </p>
          <label className="text-xs text-muted">Valor contado na gaveta</label>
          <input
            type="text"
            inputMode="numeric"
            value={contado}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              const cents = parseInt(digits || "0", 10);
              const num = cents / 100;
              setContado(
                digits
                  ? num.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "",
              );
            }}
            placeholder="0,00"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setFechando(false);
                setContado("");
              }}
              className="flex-1 cursor-pointer rounded-full border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await fecharCaixaAction({
                    cashSessionId: caixa.id,
                    valorFechamento:
                      parseFloat(
                        contado.replace(/\./g, "").replace(",", "."),
                      ) || 0,
                  });
                  setFechando(false);
                  setContado("");
                })
              }
              disabled={pending}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-danger px-3 py-2 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Lock size={14} />
              )}
              Fechar caixa
            </button>
          </div>
        </div>
      )}

      {/* Ações principais */}
      {!mov && !fechando && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setMov("SANGRIA")}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <ArrowDownCircle size={15} className="text-danger" /> Sangria
          </button>
          <button
            onClick={() => setMov("SUPRIMENTO")}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <ArrowUpCircle size={15} className="text-ok" /> Suprimento
          </button>
          <button
            onClick={() => setFechando(true)}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-danger px-3 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90"
          >
            <Lock size={15} /> Fechar
          </button>
        </div>
      )}
    </div>
  );
}
