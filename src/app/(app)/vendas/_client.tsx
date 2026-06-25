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
import type { ProdutoVenda } from "./_data";
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
  sites: { id: string; nome: string }[];
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
  const [error, setError] = useState<string | null>(null);
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

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos
      .filter((p) => {
        // produtos com estoque controlado zerado ficam fora da vitrine
        if (p.estoqueFechado != null && p.estoqueFechado <= 0) return false;
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
  const precisaIdade = cart.some((i) => i.restricaoIdade);
  const dinheiroOk = metodoSel !== "DINHEIRO" || recebidoNum >= total - 0.005;
  const podeFinalizar =
    caixaOk &&
    cart.length > 0 &&
    total > 0.005 &&
    !!metodoSel &&
    dinheiroOk &&
    (!precisaIdade || maiorIdade) &&
    !pending;

  function addItem(p: ProdutoVenda, variantId: string | null, qty = 1) {
    if (!caixaOk) {
      setSheetOpen(true);
      return;
    }
    const variant = variantId
      ? (p.variants.find((v) => v.id === variantId) ?? null)
      : null;
    const key = p.id + ":" + (variantId ?? "");
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
          preco: variant?.preco ?? p.preco,
          quantidade: qty,
          restricaoIdade: p.restricaoIdade,
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
    setError(null);
  }

  function finalizar() {
    if (!podeFinalizar || !metodoSel) return;
    setError(null);
    startTransition(async () => {
      try {
        await finalizarVendaPdvAction({
          siteId,
          items: cart.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantidade: i.quantidade,
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
        setError(e instanceof Error ? e.message : "Erro ao finalizar venda.");
      }
    });
  }

  function cancelar(saleId: string) {
    startTransition(async () => {
      try {
        await cancelarVendaAction(saleId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao cancelar.");
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

          <div className="grid min-h-0 flex-1 auto-rows-min content-start grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {filtrados.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted">
                Nenhum produto encontrado.
              </p>
            )}
            {filtrados.map((p) => (
              <ProdutoCard key={p.id} produto={p} onAdd={addItem} onOpenModal={setPdvModal} />
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

            {error && (
              <div className="px-4 pb-1">
                <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              </div>
            )}

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
        onAdd={(p, variantId, qty) => {
          addItem(p, variantId, qty);
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

function PersonalizadoModal({
  produto,
  onClose,
  onAdd,
}: {
  produto: ProdutoVenda | null;
  onClose: () => void;
  onAdd: (p: ProdutoVenda, variantId: string | null, qty: number) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string | string[]>>({});
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!produto) return;
    setSelectedVariant(produto.variants[0]?.id ?? null);
    setQty(1);
    // Pre-seleciona items padrão de cada grupo
    if (produto.groups) {
      const sels: Record<string, string | string[]> = {};
      for (const g of produto.groups) {
        const defaultItem = g.items.find((i) => i.isDefault);
        if (defaultItem) {
          sels[g.id] = g.tipoSelecao === "MULTIPLA" ? [defaultItem.componentProductId] : defaultItem.componentProductId;
        }
      }
      setSelections(sels);
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

  const variant = selectedVariant
    ? produto.variants.find((v) => v.id === selectedVariant) ?? null
    : null;
  const precoBase = variant?.preco ?? produto.preco;

  // Calcula acréscimo de itens selecionados
  let acrescimoTotal = 0;
  if (produto.groups) {
    for (const g of produto.groups) {
      const selectedIds = selections[g.id];
      if (selectedIds) {
        const ids = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
        for (const id of ids) {
          const item = g.items.find((i) => i.componentProductId === id);
          if (item?.acrescimoPreco) {
            acrescimoTotal += item.acrescimoPreco;
          }
        }
      }
    }
  }

  const preco = precoBase + acrescimoTotal;
  const total = preco * qty;
  const temVariants = produto.variants.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]" />

      <div
        className="relative z-10 h-full w-full overflow-hidden rounded-t-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-2)] sm:max-h-[90dvh] sm:max-w-4xl sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Layout 2 colunas */}
        <div className="flex min-h-0 flex-1 overflow-hidden sm:flex-row flex-col">
          {/* Coluna Esquerda (35%) — Imagem + Info + Montagem */}
          <div className="flex min-w-0 flex-col border-b border-line sm:border-b-0 sm:border-r sm:border-line sm:w-[35%] bg-surface-2 pb-0">
            {/* Imagem */}
            <div className="relative aspect-square w-full bg-surface-3 sm:h-64">
              {produto.imagemUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={produto.imagemUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-faint">
                  <Wine size={32} />
                </span>
              )}
            </div>

            {/* Conteúdo da coluna esquerda (com scroll interno) */}
            <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              {/* Label + Nome */}
              <div className="mb-4">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-faint mb-1">
                  Personalizado
                </p>
                <h3 className="text-xl font-bold leading-tight text-ink mb-2">
                  {produto.nome}
                </h3>

                {/* Variantes inline se houver */}
                {temVariants && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-ink-2">Tamanho</p>
                    <div className="flex gap-2 flex-wrap">
                      {produto.variants.map((v) => {
                        const sel = selectedVariant === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedVariant(v.id)}
                            className={cn(
                              "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors cursor-pointer",
                              sel
                                ? "border-brand bg-brand text-on-brand"
                                : "border-line bg-surface hover:border-brand hover:text-brand",
                            )}
                          >
                            {v.nome}
                            {v.volumeMl && <span className="ml-1 text-[10px]">{v.volumeMl}ml</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Card de montagem */}
              {produto.modoPreparo && (
                <div className="rounded-[14px] border border-line-strong bg-surface p-3.5">
                  <div className="flex items-start gap-2.5 mb-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                      <Wine size={16} />
                    </span>
                    <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-ink">
                      Modo de preparo
                    </p>
                  </div>
                  <ul className="flex flex-col gap-1 text-xs text-ink-2">
                    {produto.modoPreparo.split('\n').filter(line => line.trim()).map((line, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="shrink-0 text-faint">•</span>
                        <span>{line.trim()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Coluna Direita (65%) — Grupos com etapas */}
          <div className="flex min-h-0 flex-1 flex-col sm:w-[65%]">
            {/* Header da coluna direita com botão fechar */}
            <div className="flex items-center justify-between px-4 py-3 sm:px-6 border-b border-line shrink-0">
              <span className="text-sm font-semibold text-ink">Item Personalizado</span>
              <button
                type="button"
                aria-label="Fechar"
                onClick={onClose}
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-surface-3"
              >
                <X size={16} />
              </button>
            </div>

            {/* Conteúdo scrollável */}
            <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
              {!produto.groups || produto.groups.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-faint mb-2">
                    <Sparkles size={18} />
                  </span>
                  <p className="text-sm text-muted">
                    Sem personalizações disponíveis
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {produto.groups.map((g, idx) => (
                    <div key={g.id} className="flex flex-col gap-3">
                      {/* Título do grupo com número */}
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-on-brand font-mono text-xs font-bold">
                          {idx + 1}
                        </span>
                        <h4 className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-ink">
                          {idx + 1}. {g.nome}
                          {g.obrigatoria && <span className="ml-1 text-danger">*</span>}
                        </h4>
                      </div>

                      {/* Separador */}
                      <div className="h-px bg-line" />

                      {/* Opções com radio + imagem + preço */}
                      <div className="flex flex-col gap-1.5">
                        {[...g.items].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)).map((item) => {
                          const isSelected =
                            g.tipoSelecao === "MULTIPLA"
                              ? Array.isArray(selections[g.id]) && (selections[g.id] as string[]).includes(item.componentProductId)
                              : selections[g.id] === item.componentProductId;

                          return (
                            <button
                              key={item.componentProductId}
                              type="button"
                              onClick={() => {
                                if (g.tipoSelecao === "MULTIPLA") {
                                  const current = Array.isArray(selections[g.id]) ? (selections[g.id] as string[]) : [];
                                  if (isSelected) {
                                    setSelections((prev) => ({
                                      ...prev,
                                      [g.id]: current.filter((id) => id !== item.componentProductId),
                                    }));
                                  } else {
                                    const maxSel = g.maxSelecoes || current.length + 1;
                                    if (current.length < maxSel) {
                                      setSelections((prev) => ({
                                        ...prev,
                                        [g.id]: [...current, item.componentProductId],
                                      }));
                                    }
                                  }
                                } else {
                                  setSelections((prev) => ({
                                    ...prev,
                                    [g.id]: item.componentProductId,
                                  }));
                                }
                              }}
                              className={cn(
                                "flex items-center gap-3 rounded-[12px] border-2 px-3 py-2 transition-all cursor-pointer",
                                isSelected
                                  ? "border-brand bg-brand/5"
                                  : "border-line hover:border-brand/50 hover:bg-surface-2",
                              )}
                            >
                              {/* Radio Button */}
                              <span
                                className={cn(
                                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-all",
                                  isSelected
                                    ? "border-brand bg-brand shadow-[0_0_0_3px_rgba(var(--brand-rgb),0.1)]"
                                    : "border-line hover:border-brand/50",
                                )}
                              >
                                {isSelected && (
                                  <Check size={11} strokeWidth={4} className="text-white" />
                                )}
                              </span>

                              {/* Imagem miniatura */}
                              {item.imagemUrl && (
                                <div className="h-14 w-14 shrink-0 rounded-[8px] bg-surface-3 overflow-hidden border border-line">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.imagemUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              )}

                              {/* Nome + Preço */}
                              <div className="flex-1 min-w-0 text-left">
                                <p className={cn(
                                  "text-sm font-medium truncate",
                                  isSelected ? "text-ink" : "text-ink-2",
                                )}>
                                  {item.nome}
                                </p>
                              </div>

                              {/* Preço adicional */}
                              {item.acrescimoPreco && (
                                <span className={cn(
                                  "shrink-0 font-mono text-xs font-semibold whitespace-nowrap",
                                  isSelected ? "text-brand" : "text-muted",
                                )}>
                                  +{brl(item.acrescimoPreco)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer coluna direita */}
            <div className="border-t border-line bg-surface px-4 py-2 sm:px-6 shrink-0">
              <div className="flex items-center justify-between mb-2">
                {/* Quantidade */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Diminuir quantidade"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:border-brand disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center font-mono text-sm font-bold text-ink">
                    {qty}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar quantidade"
                    onClick={() => setQty((q) => q + 1)}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:border-brand"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* Total */}
                <div className="text-right">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-faint mb-0.5">
                    Total
                  </p>
                  <p className="font-display text-2xl font-bold leading-none tabular-nums text-brand">
                    {brl(total)}
                  </p>
                </div>
              </div>

              {/* CTA Button */}
              <button
                type="button"
                onClick={() => onAdd(produto, selectedVariant, qty)}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                <ShoppingCart size={16} />
                Adicionar ao carrinho
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
