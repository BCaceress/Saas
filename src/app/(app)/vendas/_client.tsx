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
  Landmark,
  Layers,
  X,
  Sparkles,
  Check,
  ImageOff,
  ChevronDown,
  Circle,
  User,
  UserPlus,
  UserCheck,
  RefreshCw,
  Delete,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { CaixaSheet, type CaixaInfo } from "@/components/app/caixa-sheet";
import { finalizarVendaPdvAction } from "./actions";
import { searchCustomers, createCustomer } from "../clientes/actions";
import type { ComponentGroupVenda, ProdutoVenda } from "./_data";
import type { PaymentMethod } from "@/generated/prisma";
import type { CustomerRow } from "../clientes/_types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// centavos digitados → número (campos monetários)
const parseCentavos = (s: string) =>
  (parseInt(s.replace(/\D/g, "") || "0", 10) || 0) / 100;
const fmtCentavos = (s: string) => {
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

function mascararCpf(cpf: string | null): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "—";
  return `${d.slice(0, 3)}.•••.•••-${d.slice(9)}`;
}

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

type ClienteSel = { id: string; nome: string; cpf: string | null };

// método → ícone (cards de pagamento)
const METODO_ICON: Record<PaymentMethod, typeof Banknote> = {
  DINHEIRO: Banknote,
  PIX: QrCode,
  CARTAO_CREDITO: CreditCard,
  CARTAO_DEBITO: Landmark,
  OUTRO: Wallet,
};

const METODO_LABEL_CURTO: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  CARTAO_CREDITO: "Crédito",
  CARTAO_DEBITO: "Débito",
  OUTRO: "Outro",
};

// atalhos de teclado por método (balcão)
const METODO_ATALHO: Record<PaymentMethod, string> = {
  DINHEIRO: "F5",
  CARTAO_CREDITO: "F6",
  CARTAO_DEBITO: "F7",
  PIX: "F8",
  OUTRO: "F10",
};

const BANDEIRAS = ["Visa", "Mastercard", "Elo", "Amex", "Hipercard"];

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
  fundoTrocoPadrao,
  limiteGaveta,
}: {
  sites: { id: string; nome: string; controleIdade?: boolean }[];
  defaultSiteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  caixa: CaixaInfo | null;
  fundoTrocoPadrao?: number | null;
  limiteGaveta?: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [maiorIdade, setMaiorIdade] = useState(false);
  const [cliente, setCliente] = useState<ClienteSel | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pdvModal, setPdvModal] = useState<ProdutoVenda | null>(null);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [pagamentoOpen, setPagamentoOpen] = useState(false);

  const [flashKey, setFlashKey] = useState<string | null>(null);
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
        if (p.estoqueFechado != null && p.estoqueFechado <= 0) return false;
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

  const total = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const numItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const precisaIdade = siteControlaIdade && cart.some((i) => i.restricaoIdade);
  const podePagar =
    caixaOk && cart.length > 0 && total > 0.005 && (!precisaIdade || maiorIdade);

  function pulsar(key: string) {
    setFlashKey(key);
    window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 260);
  }

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
    pulsar(key);
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
    setMaiorIdade(false);
    setCliente(null);
  }

  // Leitor de código de barras: digita o código e envia Enter no campo de busca.
  function onBuscaEnter() {
    const q = busca.trim();
    if (!q) return;
    // 1) casamento exato por EAN/SKU (leitor)
    const exato = produtos.find(
      (p) => p.ean === q || p.sku.toLowerCase() === q.toLowerCase(),
    );
    const alvo = exato ?? (filtrados.length === 1 ? filtrados[0] : null);
    if (!alvo) return;
    const semEstoque =
      alvo.estoqueFechado != null && alvo.estoqueFechado <= 0;
    if (semEstoque) {
      toast.error("Sem estoque", `"${alvo.nome}" está zerado.`);
      return;
    }
    if (alvo.tipo === "PERSONALIZADO") {
      setPdvModal(alvo);
    } else {
      addItem(alvo, alvo.variants[0]?.id ?? null);
    }
    setBusca("");
  }

  function finalizar(pagamentos: {
    metodo: PaymentMethod;
    valor: number;
    troco?: number | null;
  }[]) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        try {
          await finalizarVendaPdvAction({
            siteId,
            customerId: cliente?.id ?? null,
            items: cart.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantidade: i.quantidade,
              selecoes: i.selecoes,
            })),
            descontoVenda: 0,
            maiorIdadeConfirmada: maiorIdade,
            pagamentos,
          });
          toast.success("Venda concluída!", brl(total));
          setPagamentoOpen(false);
          limpar();
          router.refresh();
          window.setTimeout(() => buscaRef.current?.focus(), 60);
          resolve(true);
        } catch (e) {
          toast.error(
            "Erro ao finalizar venda",
            e instanceof Error ? e.message : "Tente novamente.",
          );
          resolve(false);
        }
      });
    });
  }

  // Atalhos de balcão na tela principal.
  useEffect(() => {
    if (pagamentoOpen || clienteOpen || pdvModal || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        if (podePagar) setPagamentoOpen(true);
        else if (!caixaOk) setSheetOpen(true);
      } else if (e.key === "F3") {
        e.preventDefault();
        setClienteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="grid gap-4 pt-2 lg:h-full lg:grid-cols-[1fr_440px] lg:overflow-hidden xl:grid-cols-[1fr_480px]">
        {/* ── Catálogo ── */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:h-full">
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
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                ref={buscaRef}
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onBuscaEnter();
                  }
                }}
                placeholder="Bipe o código ou busque por nome, SKU ou EAN…"
                className="w-full rounded-[var(--radius)] border border-line bg-surface py-3.5 pl-11 pr-3 text-base text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <button
              onClick={() => setSheetOpen(true)}
              className={cn(
                "flex min-h-[3rem] cursor-pointer items-center gap-2 rounded-[var(--radius)] border px-4 text-sm font-semibold transition-colors",
                caixaOk
                  ? "border-ok/40 bg-ok-soft text-ok hover:bg-ok-soft/70"
                  : "animate-pulse border-danger bg-danger text-on-brand hover:opacity-90",
              )}
            >
              {caixaOk ? <Unlock size={15} /> : <Lock size={15} />}
              {caixaOk ? "Caixa aberto" : "Caixa fechado"}
            </button>
          </div>

          {/* Categorias em chips */}
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

          <div className="scrollbar-thin grid min-h-0 flex-1 auto-rows-min content-start grid-cols-[repeat(auto-fill,minmax(clamp(5.5rem,8vw,7.5rem),1fr))] gap-2 overflow-y-auto pb-2">
            {filtrados.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted">
                Nenhum produto encontrado.
              </p>
            )}
            {filtrados.map((p) => (
              <ProdutoCard
                key={p.id}
                produto={p}
                flash={flashKey?.startsWith(p.id + ":") ?? false}
                onAdd={addItem}
                onOpenModal={setPdvModal}
              />
            ))}
          </div>
        </div>

        {/* ── Painel da venda ── */}
        <div className="flex min-h-0 flex-col lg:h-full">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand">
                  <ShoppingCart size={16} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Venda
                  </span>
                  <span className="block text-xs text-ink-2">
                    {numItens} {numItens === 1 ? "item" : "itens"}
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
            <div className="scrollbar-thin min-h-[140px] flex-1 overflow-y-auto px-2 py-2">
              {cart.length === 0 ? (
                <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center">
                  <ShoppingCart size={28} className="text-faint" />
                  <p className="text-sm text-muted">
                    Bipe ou toque em um produto para começar.
                  </p>
                </div>
              ) : (
                cart.map((i) => (
                  <div
                    key={i.key}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                      flashKey === i.key ? "bg-brand-soft" : "hover:bg-surface-2",
                    )}
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
                        aria-label="Diminuir"
                        className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                      >
                        {i.quantidade <= 1 ? (
                          <Trash2 size={13} />
                        ) : (
                          <Minus size={14} />
                        )}
                      </button>
                      <span className="w-6 text-center font-mono text-sm tabular-nums">
                        {i.quantidade}
                      </span>
                      <button
                        onClick={() => setQtd(i.key, i.quantidade + 1)}
                        aria-label="Aumentar"
                        className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                      >
                        <Plus size={14} />
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

            {/* Cliente */}
            <div className="border-t border-line px-4 py-3">
              {cliente ? (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                    <UserCheck size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {cliente.nome}
                    </p>
                    <p className="truncate font-mono text-xs text-muted">
                      {mascararCpf(cliente.cpf)}
                    </p>
                  </div>
                  <button
                    onClick={() => setClienteOpen(true)}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-medium text-muted hover:border-brand hover:text-brand"
                  >
                    <RefreshCw size={13} /> Trocar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-faint">
                    <User size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      Cliente não identificado
                    </p>
                    <p className="text-xs text-muted">Opcional</p>
                  </div>
                  <button
                    onClick={() => setClienteOpen(true)}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-semibold text-ink hover:border-brand hover:text-brand"
                  >
                    <UserPlus size={14} /> Adicionar
                    <kbd className="rounded border border-line px-1 text-[10px] text-muted">
                      F3
                    </kbd>
                  </button>
                </div>
              )}
            </div>

            {/* Total — maior destaque da tela */}
            <div className="flex items-end justify-between border-t border-line px-4 py-4">
              <span className="pb-1 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                Total
              </span>
              <span className="font-display text-[2.75rem] font-bold leading-none tabular-nums text-ink">
                {brl(total)}
              </span>
            </div>

            {/* Finalizar */}
            <div className="border-t border-line p-3">
              <button
                onClick={() => setPagamentoOpen(true)}
                disabled={!podePagar}
                className="flex min-h-[3.5rem] w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-5 text-lg font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 size={20} />
                Finalizar venda
                <kbd className="ml-1 rounded border border-on-brand/40 px-1.5 py-0.5 text-xs font-medium">
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

      {clienteOpen && (
        <ClienteModal
          onClose={() => setClienteOpen(false)}
          onSelect={(c) => {
            setCliente(c);
            setClienteOpen(false);
            buscaRef.current?.focus();
          }}
        />
      )}

      {pagamentoOpen && (
        <PagamentoModal
          total={total}
          numItens={numItens}
          cliente={cliente}
          metodosAtivos={metodosAtivos}
          pending={pending}
          onClose={() => setPagamentoOpen(false)}
          onReceber={finalizar}
        />
      )}

      <CaixaSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sites={sites}
        defaultSiteId={siteId}
        metodos={metodosAtivos}
        caixa={caixa}
        onChanged={() => router.refresh()}
        fundoTrocoPadrao={fundoTrocoPadrao}
        limiteGaveta={limiteGaveta}
      />
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
        "min-h-[2.5rem] cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors",
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
  flash,
  onAdd,
  onOpenModal,
}: {
  produto: ProdutoVenda;
  flash: boolean;
  onAdd: (p: ProdutoVenda, variantId: string | null, qty?: number) => void;
  onOpenModal: (p: ProdutoVenda) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const semEstoque =
    produto.estoqueFechado != null && produto.estoqueFechado <= 0;
  const temVariants = produto.variants.length > 0;
  const isPersonalizado = produto.tipo === "PERSONALIZADO";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius)] border bg-surface transition-transform duration-150",
        flash ? "border-brand ring-2 ring-brand/40 pdv-pop" : "border-line",
      )}
    >
      <button
        onClick={() => {
          if (isPersonalizado) onOpenModal(produto);
          else if (temVariants) setExpanded((v) => !v);
          else onAdd(produto, null);
        }}
        disabled={semEstoque}
        className="flex flex-1 cursor-pointer flex-col text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="relative aspect-square w-full bg-surface-2">
          {produto.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={produto.imagemUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-contain p-1.5"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-faint">
              <Wine size={20} />
            </span>
          )}
          {produto.restricaoIdade && (
            <Badge
              tone="danger"
              className="absolute right-1 top-1 px-1 py-0 text-[9px] leading-[1.4]"
            >
              +18
            </Badge>
          )}
          {flash && (
            <span className="pdv-badge absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand shadow-[var(--shadow-1)]">
              <Check size={14} strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 p-1.5">
          <span className="line-clamp-2 h-[1.9rem] text-[11.5px] font-medium leading-[1.1] text-ink">
            {produto.nome}
          </span>
          <div className="flex items-center justify-between gap-1">
            <span className="font-display text-sm font-bold leading-none text-ink">
              {brl(produto.preco)}
            </span>
            {produto.estoqueFechado != null ? (
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px]",
                  semEstoque ? "text-danger" : "text-muted",
                )}
              >
                {produto.estoqueFechado} un
              </span>
            ) : (
              <span className="shrink-0 text-[10px] text-faint">
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
              className="min-h-[2.25rem] cursor-pointer rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink hover:border-brand hover:bg-brand-soft hover:text-brand"
            >
              {v.nome} · {brl(v.preco)}
            </button>
          ))}
        </div>
      )}
      <style>{`
        @keyframes pdvPop { 0% { transform: scale(1) } 45% { transform: scale(1.035) } 100% { transform: scale(1) } }
        @keyframes pdvBadge { 0% { transform: scale(0); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        .pdv-pop { animation: pdvPop 240ms cubic-bezier(0.22,1,0.36,1) }
        .pdv-badge { animation: pdvBadge 220ms cubic-bezier(0.22,1,0.36,1) }
        @media (prefers-reduced-motion: reduce) { .pdv-pop, .pdv-badge { animation: none } }
      `}</style>
    </div>
  );
}

// ============================================================
// Modal de pagamento — recebimento em foco total (§ fluxo de venda)
// ============================================================

type ModalMetodo = PaymentMethod | "MISTO";
type MistoLinha = { metodo: PaymentMethod; valor: number };

function PagamentoModal({
  total,
  numItens,
  cliente,
  metodosAtivos,
  pending,
  onClose,
  onReceber,
}: {
  total: number;
  numItens: number;
  cliente: ClienteSel | null;
  metodosAtivos: PaymentMethod[];
  pending: boolean;
  onClose: () => void;
  onReceber: (
    pagamentos: { metodo: PaymentMethod; valor: number; troco?: number | null }[],
  ) => Promise<boolean>;
}) {
  const [metodo, setMetodo] = useState<ModalMetodo | null>(null);
  const [recebido, setRecebido] = useState("");
  const [bandeira, setBandeira] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState(1);
  const [pixConfirmado, setPixConfirmado] = useState(false);
  const [misto, setMisto] = useState<MistoLinha[]>([]);
  const [isTouch] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  const recebidoRef = useRef<HTMLInputElement>(null);

  const recebidoNum = parseCentavos(recebido);
  const troco = Math.max(0, recebidoNum - total);
  const mistoPago = misto.reduce((s, l) => s + l.valor, 0);
  const mistoFalta = Math.max(0, total - mistoPago);

  const pronto = (() => {
    if (metodo === "DINHEIRO") return recebidoNum >= total - 0.005;
    if (metodo === "CARTAO_CREDITO") return !!bandeira;
    if (metodo === "CARTAO_DEBITO") return true;
    if (metodo === "PIX") return pixConfirmado;
    if (metodo === "MISTO") return mistoPago >= total - 0.005;
    return false;
  })();

  function receber() {
    if (!pronto || pending) return;
    let pagamentos: {
      metodo: PaymentMethod;
      valor: number;
      troco?: number | null;
    }[];
    if (metodo === "MISTO") {
      // ajusta a última linha para bater exatamente o total (troco no dinheiro)
      pagamentos = misto.map((l) => ({ metodo: l.metodo, valor: l.valor }));
    } else if (metodo === "DINHEIRO") {
      pagamentos = [{ metodo: "DINHEIRO", valor: total, troco: troco || null }];
    } else {
      pagamentos = [{ metodo: metodo as PaymentMethod, valor: total }];
    }
    onReceber(pagamentos);
  }

  // seleção por atalho + Enter recebe
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const map: Record<string, ModalMetodo> = {
        F5: "DINHEIRO",
        F6: "CARTAO_CREDITO",
        F7: "CARTAO_DEBITO",
        F8: "PIX",
        F9: "MISTO",
      };
      const m = map[e.key];
      if (m && (m === "MISTO" || metodosAtivos.includes(m))) {
        e.preventDefault();
        setMetodo(m);
        return;
      }
      if (e.key === "Enter" && pronto && !pending) {
        e.preventDefault();
        receber();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // foca campo de dinheiro em teclado físico
  useEffect(() => {
    if (metodo === "DINHEIRO" && !isTouch)
      window.setTimeout(() => recebidoRef.current?.focus(), 50);
  }, [metodo, isTouch]);

  const metodoCards: ModalMetodo[] = [...metodosAtivos, "MISTO"];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recebimento"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)] sm:w-[70vw] sm:max-w-4xl">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Recebimento
            </p>
            <h2 className="font-display text-xl font-bold text-ink">
              {cliente ? cliente.nome : "Cliente não identificado"}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {numItens} {numItens === 1 ? "item" : "itens"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                Total
              </p>
              <p className="font-display text-3xl font-bold leading-none tabular-nums text-brand">
                {brl(total)}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Corpo */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
          {/* Cartões de método */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {metodoCards.map((m) => {
              const Icon = m === "MISTO" ? Layers : METODO_ICON[m];
              const label =
                m === "MISTO" ? "Misto" : METODO_LABEL_CURTO[m];
              const atalho =
                m === "MISTO" ? "F9" : METODO_ATALHO[m];
              const sel = metodo === m;
              return (
                <button
                  key={m}
                  onClick={() => setMetodo(m)}
                  className={cn(
                    "flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius)] border-2 px-2 py-3 transition-all duration-150",
                    sel
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line bg-surface text-ink hover:border-brand hover:bg-brand-soft hover:text-brand",
                  )}
                >
                  <Icon size={24} />
                  <span className="text-sm font-semibold">{label}</span>
                  <kbd
                    className={cn(
                      "rounded border px-1.5 text-[10px] font-medium",
                      sel
                        ? "border-on-brand/40 text-on-brand"
                        : "border-line text-muted",
                    )}
                  >
                    {atalho}
                  </kbd>
                </button>
              );
            })}
          </div>

          {/* Detalhe do método */}
          <div className="mt-5">
            {metodo === null && (
              <p className="py-8 text-center text-sm text-muted">
                Escolha a forma de pagamento para continuar.
              </p>
            )}

            {metodo === "DINHEIRO" && (
              <DinheiroPanel
                total={total}
                recebido={recebido}
                setRecebido={setRecebido}
                troco={troco}
                isTouch={isTouch}
                recebidoRef={recebidoRef}
              />
            )}

            {metodo === "CARTAO_CREDITO" && (
              <CreditoPanel
                bandeira={bandeira}
                setBandeira={setBandeira}
                parcelas={parcelas}
                setParcelas={setParcelas}
                total={total}
              />
            )}

            {metodo === "CARTAO_DEBITO" && (
              <ConfirmacaoPanel
                icon={<Landmark size={28} />}
                titulo="Cartão de débito"
                texto="Insira ou aproxime o cartão na maquininha e conclua a venda."
              />
            )}

            {metodo === "PIX" && (
              <PixPanel
                total={total}
                confirmado={pixConfirmado}
                onConfirmar={() => setPixConfirmado(true)}
              />
            )}

            {metodo === "MISTO" && (
              <MistoPanel
                total={total}
                metodosAtivos={metodosAtivos}
                linhas={misto}
                setLinhas={setMisto}
                falta={mistoFalta}
                pago={mistoPago}
              />
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            className="min-h-[3rem] cursor-pointer rounded-[var(--radius)] border border-line px-6 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
          >
            Cancelar
          </button>
          <button
            onClick={receber}
            disabled={!pronto || pending}
            className="flex min-h-[3.25rem] flex-1 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-6 text-lg font-bold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:min-w-[16rem]"
          >
            {pending ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <CheckCircle2 size={20} />
            )}
            Receber venda
          </button>
        </div>
      </div>
    </div>
  );
}

function DinheiroPanel({
  total,
  recebido,
  setRecebido,
  troco,
  isTouch,
  recebidoRef,
}: {
  total: number;
  recebido: string;
  setRecebido: (v: string) => void;
  troco: number;
  isTouch: boolean;
  recebidoRef: React.RefObject<HTMLInputElement | null>;
}) {
  const recebidoNum = parseCentavos(recebido);
  const atalhos = [20, 50, 100, 200];

  function setValor(n: number) {
    setRecebido(
      n.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  }
  function numpad(d: string) {
    const digits = recebido.replace(/\D/g, "");
    let next: string;
    if (d === "back") next = digits.slice(0, -1);
    else next = digits + d;
    setRecebido(fmtCentavos(next));
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Valor recebido
          </span>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted">
              R$
            </span>
            <input
              ref={recebidoRef}
              type="text"
              inputMode={isTouch ? "none" : "numeric"}
              value={recebido}
              onChange={(e) => setRecebido(fmtCentavos(e.target.value))}
              placeholder="0,00"
              className="w-full rounded-[var(--radius)] border border-line bg-surface py-4 pl-12 pr-4 text-right font-mono text-3xl font-bold tabular-nums text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            onClick={() => setValor(total)}
            className="min-h-[3rem] cursor-pointer rounded-[var(--radius)] border border-brand bg-brand-soft text-sm font-semibold text-brand hover:bg-brand-softer"
          >
            Valor exato
          </button>
          {atalhos.map((v) => (
            <button
              key={v}
              onClick={() => setValor(v)}
              className="min-h-[3rem] cursor-pointer rounded-[var(--radius)] border border-line bg-surface text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              {brl(v)}
            </button>
          ))}
        </div>

        {isTouch && (
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map(
              (d) => (
                <button
                  key={d}
                  onClick={() => numpad(d)}
                  className="grid min-h-[3.25rem] cursor-pointer place-items-center rounded-[var(--radius)] border border-line bg-surface text-lg font-semibold text-ink hover:bg-surface-2"
                >
                  {d === "back" ? <Delete size={20} /> : d}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col justify-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Total</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-ink">
            {brl(total)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Recebido</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-ink">
            {brl(recebidoNum)}
          </span>
        </div>
        <div className="border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Troco
          </p>
          <p
            className={cn(
              "font-display text-4xl font-bold tabular-nums",
              troco > 0 ? "text-ok" : "text-faint",
            )}
          >
            {brl(troco)}
          </p>
        </div>
      </div>
    </div>
  );
}

function CreditoPanel({
  bandeira,
  setBandeira,
  parcelas,
  setParcelas,
  total,
}: {
  bandeira: string | null;
  setBandeira: (b: string) => void;
  parcelas: number;
  setParcelas: (n: number) => void;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Bandeira
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {BANDEIRAS.map((b) => (
            <button
              key={b}
              onClick={() => setBandeira(b)}
              className={cn(
                "min-h-[3.25rem] cursor-pointer rounded-[var(--radius)] border-2 px-2 text-sm font-semibold transition-colors",
                bandeira === b
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-ink hover:border-brand hover:text-brand",
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Parcelamento
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setParcelas(n)}
              className={cn(
                "flex min-h-[3.75rem] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] border-2 transition-colors",
                parcelas === n
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-ink hover:border-brand hover:text-brand",
              )}
            >
              <span className="text-base font-bold">{n}x</span>
              <span
                className={cn(
                  "font-mono text-[11px]",
                  parcelas === n ? "text-on-brand/80" : "text-muted",
                )}
              >
                {brl(total / n)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfirmacaoPanel({
  icon,
  titulo,
  texto,
}: {
  icon: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-brand">
        {icon}
      </span>
      <p className="font-display text-lg font-bold text-ink">{titulo}</p>
      <p className="max-w-sm text-sm text-muted">{texto}</p>
    </div>
  );
}

function PixPanel({
  total,
  confirmado,
  onConfirmar,
}: {
  total: number;
  confirmado: boolean;
  onConfirmar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="grid h-44 w-44 place-items-center rounded-[var(--radius-lg)] border-4 border-dashed border-line bg-surface-2 text-faint">
        <QrCode size={96} />
      </div>
      <p className="font-display text-2xl font-bold tabular-nums text-brand">
        {brl(total)}
      </p>
      {confirmado ? (
        <p className="flex items-center gap-2 font-semibold text-ok">
          <CheckCircle2 size={18} /> Pagamento confirmado
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Aguardando confirmação do pagamento…
          </p>
          <button
            onClick={onConfirmar}
            className="min-h-[3rem] cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-6 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
          >
            Confirmar pagamento recebido
          </button>
        </>
      )}
    </div>
  );
}

function MistoPanel({
  total,
  metodosAtivos,
  linhas,
  setLinhas,
  falta,
  pago,
}: {
  total: number;
  metodosAtivos: PaymentMethod[];
  linhas: MistoLinha[];
  setLinhas: (l: MistoLinha[]) => void;
  falta: number;
  pago: number;
}) {
  const [metodo, setMetodo] = useState<PaymentMethod>(
    metodosAtivos[0] ?? "DINHEIRO",
  );
  const [valor, setValor] = useState("");

  function adicionar() {
    const v = parseCentavos(valor) || falta;
    if (v <= 0) return;
    setLinhas([...linhas, { metodo, valor: Math.min(v, falta || v) }]);
    setValor("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-[var(--radius)] bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold text-ink">Falta pagar</span>
        <span
          className={cn(
            "font-display text-2xl font-bold tabular-nums",
            falta <= 0.005 ? "text-ok" : "text-brand",
          )}
        >
          {brl(falta)}
        </span>
      </div>

      {linhas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {linhas.map((l, idx) => {
            const Icon = METODO_ICON[l.metodo];
            return (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-[var(--radius)] border border-line px-3 py-2.5"
              >
                <Icon size={18} className="text-muted" />
                <span className="flex-1 text-sm font-medium text-ink">
                  {METODO_LABEL_CURTO[l.metodo]}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {brl(l.valor)}
                </span>
                <button
                  onClick={() =>
                    setLinhas(linhas.filter((_, i) => i !== idx))
                  }
                  aria-label="Remover"
                  className="cursor-pointer text-faint hover:text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {falta > 0.005 && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {metodosAtivos.map((m) => {
              const Icon = METODO_ICON[m];
              return (
                <button
                  key={m}
                  onClick={() => setMetodo(m)}
                  className={cn(
                    "flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border text-xs font-semibold transition-colors",
                    metodo === m
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line bg-surface text-ink hover:border-brand",
                  )}
                >
                  <Icon size={15} /> {METODO_LABEL_CURTO[m]}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={valor}
              onChange={(e) => setValor(fmtCentavos(e.target.value))}
              placeholder={`Falta ${brl(falta)}`}
              className={cn(inputCls, "flex-1 py-3 text-right text-base")}
            />
            <button
              onClick={adicionar}
              className="flex min-h-[3rem] cursor-pointer items-center gap-1.5 rounded-[var(--radius)] bg-brand px-5 text-sm font-semibold text-on-brand hover:bg-brand-strong"
            >
              <Plus size={16} /> Adicionar
            </button>
          </div>
        </div>
      )}

      {pago > total + 0.005 && (
        <p className="text-center text-xs text-muted">
          Recebido a mais: troco de {brl(pago - total)}.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Modal de cliente — busca rápida + cadastro express (§ cliente)
// ============================================================

function ClienteModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (c: ClienteSel) => void;
}) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<CustomerRow[]>([]);
  const [buscando, startBusca] = useTransition();
  const [modo, setModo] = useState<"busca" | "novo">("busca");
  const buscaRef = useRef<HTMLInputElement>(null);

  // cadastro express
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, startSalvar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    window.setTimeout(() => buscaRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // debounce da busca
  useEffect(() => {
    if (modo !== "busca") return;
    const term = busca.trim();
    if (term.length < 2) return;
    const t = window.setTimeout(() => {
      startBusca(async () => {
        try {
          const rows = await searchCustomers(term);
          setResultados(rows);
        } catch {
          setResultados([]);
        }
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [busca, modo]);

  // só mostra resultados enquanto o termo é válido (evita lista velha)
  const listar = busca.trim().length >= 2 ? resultados : [];

  function salvarNovo() {
    setErro(null);
    startSalvar(async () => {
      try {
        const id = await createCustomer({
          nome,
          cpf: cpf || null,
          whatsapp: telefone || null,
        });
        onSelect({ id, nome: nome.trim(), cpf: cpf.replace(/\D/g, "") || null });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao cadastrar cliente.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Identificar cliente"
      className="fixed inset-0 z-[55] flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]"
    >
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)] sm:max-w-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">
            {modo === "busca" ? "Identificar cliente" : "Novo cliente"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {modo === "busca" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-5 pt-4">
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                />
                <input
                  ref={buscaRef}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nome, CPF ou telefone…"
                  className="w-full rounded-[var(--radius)] border border-line bg-surface py-3.5 pl-11 pr-3 text-base text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>
            </div>

            <div className="scrollbar-thin min-h-[120px] flex-1 overflow-y-auto px-5 py-3">
              {buscando && (
                <p className="py-6 text-center text-sm text-muted">Buscando…</p>
              )}
              {!buscando && busca.trim().length >= 2 && listar.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  Nenhum cliente encontrado.
                </p>
              )}
              {!buscando && busca.trim().length < 2 && (
                <p className="py-6 text-center text-sm text-muted">
                  Digite ao menos 2 caracteres para buscar.
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {listar.map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      onSelect({ id: c.id, nome: c.nome, cpf: c.cpf })
                    }
                    className="flex min-h-[3.25rem] cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-line px-3 py-2 text-left hover:border-brand hover:bg-brand-soft"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                      <User size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {c.nome}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted">
                        {mascararCpf(c.cpf)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-line p-3">
              <button
                onClick={() => {
                  // pré-preenche nome se buscou por texto
                  const t = busca.trim();
                  if (t && !/\d/.test(t)) setNome(t);
                  setModo("novo");
                }}
                className="flex min-h-[3rem] w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-line text-sm font-semibold text-ink hover:border-brand hover:text-brand"
              >
                <UserPlus size={16} /> Cadastrar novo cliente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Nome
              </span>
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do cliente"
                className={cn(inputCls, "py-3 text-base")}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  CPF
                </span>
                <input
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  inputMode="numeric"
                  placeholder="Opcional"
                  className={cn(inputCls, "py-3 text-base")}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Telefone
                </span>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  inputMode="numeric"
                  placeholder="Opcional"
                  className={cn(inputCls, "py-3 text-base")}
                />
              </label>
            </div>
            {erro && (
              <p className="rounded-[var(--radius)] bg-danger-soft px-3 py-2 text-sm text-danger">
                {erro}
              </p>
            )}
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => setModo("busca")}
                className="min-h-[3rem] flex-1 cursor-pointer rounded-[var(--radius)] border border-line text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                Voltar
              </button>
              <button
                onClick={salvarNovo}
                disabled={nome.trim().length < 2 || salvando}
                className="flex min-h-[3rem] flex-[2] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
              >
                {salvando ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UserCheck size={16} />
                )}
                Salvar e usar
              </button>
            </div>
          </div>
        )}
      </div>
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
        <div className="scrollbar-thin flex flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
          <div className="scrollbar-thin flex-1 space-y-3 px-4 py-4 sm:overflow-y-auto sm:border-r sm:border-line">
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

          <aside className="flex shrink-0 flex-col sm:w-[400px]">
            <div className="scrollbar-thin sm:flex-1 sm:overflow-y-auto">
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

