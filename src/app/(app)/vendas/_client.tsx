"use client";

// PDV — tela operacional de venda.
// Duas áreas: a venda atual (busca → carrinho → total → pagamento) e a fila
// do autoatendimento (vendas dos terminais, em tempo real). Sem catálogo,
// sem métricas, sem navegação extra: só o necessário para vender.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Minus,
  Trash2,
  Loader2,
  Lock,
  Unlock,
  AlertTriangle,
  Wine,
  X,
  UserPlus,
  UserCheck,
  UserX,
  MonitorSmartphone,
  PauseCircle,
  CornerUpLeft,
  ScanBarcode,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { CaixaSheet, type CaixaInfo } from "@/components/app/caixa-sheet";
import {
  finalizarVendaPdvAction,
  carregarVendaTotemAction,
  receberVendaTotemAction,
  type VendaTotemFila,
} from "./actions";
import type { ProdutoVenda } from "./_data";
import type { PaymentMethod } from "@/generated/prisma";
import { brl, mascararCpf, type CartItem, type ClienteSel } from "./_shared";
import { PagamentoModal, ClienteModal, PersonalizadoModal } from "./_modais";
import { FilaAutoatendimentoPanel } from "./_fila";

type VendaTotemAtiva = { id: string; numero: string; terminal: string | null };
type VendaSuspensa = {
  cart: CartItem[];
  cliente: ClienteSel | null;
  maiorIdade: boolean;
};

const selectCls =
  "cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function PdvClient({
  sites,
  defaultSiteId,
  produtos,
  metodosAtivos,
  caixa,
  operador,
  fundoTrocoPadrao,
  limiteGaveta,
}: {
  sites: { id: string; nome: string; controleIdade?: boolean }[];
  defaultSiteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  caixa: CaixaInfo | null;
  operador: string;
  fundoTrocoPadrao?: number | null;
  limiteGaveta?: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const [hi, setHi] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [maiorIdade, setMaiorIdade] = useState(false);
  const [cliente, setCliente] = useState<ClienteSel | null>(null);

  // Autoatendimento
  const [vendaTotem, setVendaTotem] = useState<VendaTotemAtiva | null>(null);
  const [suspensa, setSuspensa] = useState<VendaSuspensa | null>(null);
  const [conflito, setConflito] = useState<VendaTotemFila | null>(null);
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [bump, setBump] = useState(0);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pdvModal, setPdvModal] = useState<ProdutoVenda | null>(null);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [pagamentoOpen, setPagamentoOpen] = useState(false);

  const [flashKey, setFlashKey] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const caixaOk = !!caixa;
  const siteNome = sites.find((s) => s.id === siteId)?.nome ?? "";
  const siteControlaIdade =
    sites.find((s) => s.id === siteId)?.controleIdade ?? false;

  // Busca: nome, SKU ou EAN — resultado enxuto, direto ao ponto.
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return produtos
      .filter((p) => {
        if (p.estoqueFechado != null && p.estoqueFechado <= 0) return false;
        if (p.tipo === "PERSONALIZADO" && !p.disponivel) return false;
        return (
          p.nome.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.ean ?? "").includes(q)
        );
      })
      .slice(0, 8);
  }, [busca, produtos]);

  // Personalizados (drinks/pratos montados) não têm código de barras —
  // acesso rápido por chips abaixo da busca.
  const personalizados = useMemo(
    () => produtos.filter((p) => p.tipo === "PERSONALIZADO" && p.disponivel),
    [produtos],
  );

  const total = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const numItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const precisaIdade = siteControlaIdade && cart.some((i) => i.restricaoIdade);
  const podePagar =
    caixaOk &&
    cart.length > 0 &&
    total > 0.005 &&
    (!precisaIdade || maiorIdade);

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
    detalhe: string | null = null,
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
          imagemUrl: p.imagemUrl,
          selecoes,
          detalhe,
        },
      ];
    });
    pulsar(key);
    setBusca("");
    buscaRef.current?.focus();
  }

  function escolher(p: ProdutoVenda) {
    if (p.tipo === "PERSONALIZADO") {
      setPdvModal(p);
      setBusca("");
    } else {
      addItem(p, p.variants[0]?.id ?? null);
    }
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
    setVendaTotem(null);
  }

  // Leitor de código de barras: digita o código e envia Enter no campo de busca.
  function onBuscaEnter() {
    const q = busca.trim();
    if (!q) return;
    const exato = produtos.find(
      (p) => p.ean === q || p.sku.toLowerCase() === q.toLowerCase(),
    );
    const alvo = exato ?? filtrados[hi] ?? filtrados[0] ?? null;
    if (!alvo) return;
    const semEstoque = alvo.estoqueFechado != null && alvo.estoqueFechado <= 0;
    if (semEstoque) {
      toast.error("Sem estoque", `"${alvo.nome}" está zerado.`);
      return;
    }
    escolher(alvo);
  }

  function onBuscaKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      onBuscaEnter();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((v) => Math.min(v + 1, filtrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((v) => Math.max(v - 1, 0));
    } else if (e.key === "Escape") {
      setBusca("");
    }
  }

  // ── Autoatendimento: receber venda da fila ──────────────────
  async function carregarVenda(id: string) {
    setCarregando(true);
    try {
      const d = await carregarVendaTotemAction(id);
      setCart(
        d.items.map((i) => {
          const selKey = i.selecoes.length
            ? ":" + [...i.selecoes].sort().join(",")
            : "";
          return {
            key: i.productId + ":" + (i.variantId ?? "") + selKey,
            productId: i.productId,
            variantId: i.variantId,
            nome: i.nome,
            variantNome: i.variantNome,
            preco: i.preco,
            quantidade: i.quantidade,
            restricaoIdade: i.restricaoIdade,
            imagemUrl: i.imagemUrl,
            selecoes: i.selecoes,
            detalhe: i.detalhe,
          };
        }),
      );
      setCliente(d.cliente);
      setMaiorIdade(d.maiorIdadeConfirmada);
      setVendaTotem({ id: d.id, numero: d.numero, terminal: d.terminal });
      setConflito(null);
      buscaRef.current?.focus();
    } catch (e) {
      toast.error(
        "Não foi possível carregar a venda",
        e instanceof Error ? e.message : "Tente novamente.",
      );
      setBump((b) => b + 1);
    } finally {
      setCarregando(false);
    }
  }

  function receberDaFila(v: VendaTotemFila) {
    if (!caixaOk) {
      setSheetOpen(true);
      return;
    }
    if (cart.length > 0 || vendaTotem) {
      setConflito(v);
      return;
    }
    carregarVenda(v.id);
  }

  function suspenderEReceber() {
    if (!conflito) return;
    if (vendaTotem) {
      // Venda do totem volta para a fila (continua ABERTA no servidor).
      setVendaTotem(null);
    } else {
      setSuspensa({ cart, cliente, maiorIdade });
    }
    setCart([]);
    setCliente(null);
    setMaiorIdade(false);
    carregarVenda(conflito.id);
  }

  function devolverAFila() {
    limpar();
    setBump((b) => b + 1);
    buscaRef.current?.focus();
  }

  // Cancela a venda em digitação (limpa a tela). Venda do autoatendimento
  // continua ABERTA no servidor e volta para a fila.
  function cancelarVendaAtual() {
    if (cart.length === 0 && !vendaTotem) return;
    const eraTotem = !!vendaTotem;
    limpar();
    if (eraTotem) setBump((b) => b + 1);
    setConfirmaCancelar(false);
    buscaRef.current?.focus();
  }

  function retomarSuspensa() {
    if (!suspensa || cart.length > 0 || vendaTotem) return;
    setCart(suspensa.cart);
    setCliente(suspensa.cliente);
    setMaiorIdade(suspensa.maiorIdade);
    setSuspensa(null);
    buscaRef.current?.focus();
  }

  // ── Finalização ──────────────────────────────────────────────
  function finalizar(
    pagamentos: {
      metodo: PaymentMethod;
      valor: number;
      troco?: number | null;
    }[],
  ) {
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        try {
          const items = cart.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantidade: i.quantidade,
            selecoes: i.selecoes,
          }));
          if (vendaTotem) {
            await receberVendaTotemAction({
              saleId: vendaTotem.id,
              siteId,
              customerId: cliente?.id ?? null,
              items,
              maiorIdadeConfirmada: maiorIdade,
              pagamentos,
            });
          } else {
            await finalizarVendaPdvAction({
              siteId,
              customerId: cliente?.id ?? null,
              items,
              descontoVenda: 0,
              maiorIdadeConfirmada: maiorIdade,
              pagamentos,
            });
          }
          toast.success("Venda concluída!", brl(total));
          setPagamentoOpen(false);
          limpar();
          setBump((b) => b + 1);
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
    if (confirmaCancelar) {
      const onEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setConfirmaCancelar(false);
        }
      };
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }
    if (pagamentoOpen || clienteOpen || pdvModal || sheetOpen || conflito)
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        buscaRef.current?.focus();
        buscaRef.current?.select();
      } else if (e.key === "F2") {
        e.preventDefault();
        if (podePagar) setPagamentoOpen(true);
        else if (!caixaOk) setSheetOpen(true);
      } else if (e.key === "F3") {
        e.preventDefault();
        setClienteOpen(true);
      } else if (e.key === "/") {
        // "/" foca a busca quando não se está digitando em outro campo.
        const alvo = e.target as HTMLElement | null;
        const digitando =
          alvo instanceof HTMLInputElement ||
          alvo instanceof HTMLTextAreaElement ||
          alvo instanceof HTMLSelectElement ||
          alvo?.isContentEditable;
        if (!digitando) {
          e.preventDefault();
          buscaRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="flex flex-col gap-2.5 pt-2 lg:h-full lg:min-h-0">
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── Venda atual ── */}
          <section className="flex min-h-0 min-w-0 flex-col gap-2.5 lg:h-full">
            {/* Busca única, grande */}
            <div className="relative">
              <ScanBarcode
                size={19}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                ref={buscaRef}
                autoFocus
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setHi(0);
                }}
                onKeyDown={onBuscaKeyDown}
                placeholder="Buscar produto ou ler código de barras"
                className="w-full rounded-[var(--radius)] border border-line bg-surface py-3.5 pl-12 pr-12 text-base text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
              <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
                F1
              </kbd>
              {/* Resultados */}
              {busca.trim() && (
                <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-2)]">
                  {filtrados.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">
                      Nenhum produto encontrado para “{busca.trim()}”.
                    </p>
                  ) : (
                    filtrados.map((p, idx) => (
                      <div
                        key={p.id}
                        className={cn(
                          "flex items-center gap-3 border-b border-line/60 px-3 py-2 last:border-0",
                          idx === hi && "bg-brand-soft",
                        )}
                      >
                        <button
                          onClick={() => escolher(p)}
                          onMouseEnter={() => setHi(idx)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2 text-faint">
                            {p.imagemUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={p.imagemUrl}
                                alt=""
                                className="h-full w-full object-contain p-0.5"
                              />
                            ) : (
                              <Wine size={15} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {p.nome}
                            </span>
                            <span className="block font-mono text-[11px] text-muted">
                              {p.sku}
                              {p.estoqueFechado != null &&
                                ` · ${p.estoqueFechado} un`}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
                            {brl(p.preco)}
                          </span>
                        </button>
                        {p.variants.length > 1 && (
                          <span className="flex shrink-0 gap-1">
                            {p.variants.slice(0, 3).map((v) => (
                              <button
                                key={v.id}
                                onClick={() => addItem(p, v.id)}
                                className="cursor-pointer rounded-full border border-line px-2 py-1 text-[11px] font-medium text-muted hover:border-brand hover:text-brand"
                              >
                                {v.nome}
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Personalizados — sem código de barras, um toque abre a montagem */}
            {personalizados.length > 0 && (
              <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
                {personalizados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() =>
                      caixaOk ? setPdvModal(p) : setSheetOpen(true)
                    }
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand"
                  >
                    <Sparkles size={13} className="text-brand" />
                    {p.nome}
                  </button>
                ))}
              </div>
            )}

            {/* Venda suspensa — retomar quando o caixa estiver livre */}
            {suspensa && (
              <div className="flex items-center gap-2.5 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2">
                <PauseCircle size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                  Venda suspensa ·{" "}
                  {suspensa.cart.reduce((s, i) => s + i.quantidade, 0)} itens ·{" "}
                  <span className="font-mono font-semibold tabular-nums">
                    {brl(
                      suspensa.cart.reduce(
                        (s, i) => s + i.preco * i.quantidade,
                        0,
                      ),
                    )}
                  </span>
                </span>
                <button
                  onClick={retomarSuspensa}
                  disabled={cart.length > 0 || !!vendaTotem}
                  className="shrink-0 cursor-pointer rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Retomar
                </button>
              </div>
            )}

            {/* Carrinho */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
              {/* Identificação discreta da venda do autoatendimento */}
              {vendaTotem && (
                <div className="flex items-center gap-2.5 border-b border-accent/30 bg-accent-soft/50 px-4 py-2">
                  <MonitorSmartphone
                    size={15}
                    className="shrink-0 text-accent"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    Venda do autoatendimento
                    {vendaTotem.terminal && ` · ${vendaTotem.terminal}`}
                    <span className="ml-1.5 font-mono text-[12px] text-muted">
                      {vendaTotem.numero}
                    </span>
                  </span>
                  <button
                    onClick={devolverAFila}
                    className="flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-ink"
                  >
                    <CornerUpLeft size={12} /> Devolver à fila
                  </button>
                </div>
              )}

              {/* Itens */}
              <div className="scrollbar-thin min-h-[120px] flex-1 overflow-y-auto px-2 py-1.5">
                {cart.length === 0 ? (
                  <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 text-center">
                    <ScanBarcode size={40} className="text-faint" />
                    <p className="text-md text-muted">
                      Bipe um código ou busque um produto para começar.
                    </p>
                  </div>
                ) : (
                  cart.map((i) => (
                    <div
                      key={i.key}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                        flashKey === i.key
                          ? "bg-brand-soft"
                          : "hover:bg-surface-2",
                      )}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2 text-faint">
                        {i.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={i.imagemUrl}
                            alt=""
                            className="h-full w-full object-contain p-0.5"
                          />
                        ) : (
                          <Wine size={15} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {i.nome}
                          {i.variantNome && (
                            <span className="text-muted">
                              {" "}
                              · {i.variantNome}
                            </span>
                          )}
                        </p>
                        {i.detalhe && (
                          <p className="truncate text-[11px] text-muted">
                            {i.detalhe}
                          </p>
                        )}
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

              {/* Rodapé da venda */}
              <div className="border-t border-line px-4 pb-3 pt-2.5">
                {/* Cliente — uma linha, discreto */}
                <div className="flex min-h-[2rem] items-center gap-2">
                  {cliente ? (
                    <span className="flex min-w-0 items-baseline gap-2">
                      <UserCheck
                        size={15}
                        className="shrink-0 self-center text-brand"
                      />
                      <span className="truncate text-[15px] font-medium text-ink">
                        {cliente.nome}
                      </span>
                      <span className="shrink-0 font-mono text-[13px] text-muted">
                        {mascararCpf(cliente.cpf)}
                      </span>
                      <button
                        onClick={() => setCliente(null)}
                        aria-label="Remover cliente"
                        title="Remover cliente identificado"
                        className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center self-center rounded-full border border-danger/50 text-danger transition-colors hover:bg-danger-soft"
                      >
                        <UserX size={12} />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setClienteOpen(true)}
                      className="flex cursor-pointer items-center gap-1.5 text-[14px] font-medium text-muted transition-colors hover:text-brand"
                    >
                      <UserPlus size={16} /> Identificar cliente
                      <kbd className="rounded border border-line px-1 text-[11px] text-faint">
                        F3
                      </kbd>
                    </button>
                  )}
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                    {numItens} {numItens === 1 ? "item" : "itens"}
                  </span>
                  {cart.length > 0 && (
                    <button
                      onClick={() => setConfirmaCancelar(true)}
                      title="Cancelar esta venda e limpar o carrinho"
                      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-on-brand transition-opacity hover:opacity-90"
                    >
                      <X size={12} /> Cancelar venda
                    </button>
                  )}
                </div>

                {/* Total — maior destaque da tela */}
                <div className="flex items-end justify-between pb-2.5 pt-1">
                  <span className="pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                    Total
                  </span>
                  <span className="font-display text-[2.9rem] font-bold leading-none tabular-nums text-ink">
                    {brl(total)}
                  </span>
                </div>

                <button
                  onClick={() => setPagamentoOpen(true)}
                  disabled={!podePagar}
                  className="flex min-h-[3.5rem] w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-5 text-lg font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Receber pagamento
                  <kbd className="ml-1 rounded border border-on-brand/40 px-1.5 py-0.5 text-xs font-medium">
                    F2
                  </kbd>
                </button>
              </div>
            </div>
          </section>

          {/* ── Lateral direita: caixa + fila do autoatendimento ── */}
          <div className="flex min-h-0 flex-col gap-2.5 lg:h-full">
            <div className="flex items-center justify-end gap-2">
              {sites.length > 1 && (
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className={selectCls}
                  aria-label="Loja"
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setSheetOpen(true)}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-full border py-1.5 pl-4 pr-4 transition-colors",
                  caixaOk
                    ? "border-ok/40 bg-ok-soft text-ok hover:bg-ok-soft/70"
                    : "animate-pulse border-danger bg-danger text-on-brand hover:opacity-90",
                )}
              >
                <span className="flex shrink-0 items-center gap-2">
                  {caixaOk ? <Unlock size={16} /> : <Lock size={16} />}
                  <span className="text-base font-semibold">
                    {caixaOk ? "Caixa aberto" : "Caixa fechado"}
                  </span>
                </span>
                <span className="min-w-0 text-right">
                  <span className="block truncate text-[13px] font-medium leading-tight">
                    {operador}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[13px] font-medium leading-tight",
                      caixaOk ? "text-ok/80" : "text-on-brand/85",
                    )}
                  >
                    {siteNome}
                  </span>
                </span>
              </button>
            </div>
            <FilaAutoatendimentoPanel
              siteId={siteId}
              saleIdEmAtendimento={vendaTotem?.id ?? null}
              bump={bump}
              onReceber={receberDaFila}
            />
          </div>
        </div>
      </div>

      {/* Confirmação do cancelamento da venda atual */}
      {confirmaCancelar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancelar venda"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
            onClick={() => setConfirmaCancelar(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
            <p className="text-sm font-semibold text-ink">
              Cancelar esta venda?
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {numItens} {numItens === 1 ? "item" : "itens"} ·{" "}
              <span className="font-mono font-semibold tabular-nums">
                {brl(total)}
              </span>
              {vendaTotem
                ? " — o pedido volta para a fila do autoatendimento."
                : " — os itens serão removidos da tela."}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setConfirmaCancelar(false)}
                autoFocus
                className="min-h-[2.75rem] cursor-pointer rounded-[var(--radius)] border border-line text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Voltar para a venda
              </button>
              <button
                onClick={cancelarVendaAtual}
                className="flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-danger text-sm font-semibold text-on-brand transition-opacity hover:opacity-90"
              >
                <X size={14} /> Cancelar venda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflito: venda em andamento × venda da fila */}
      {conflito && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Venda em andamento"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
            onClick={() => setConflito(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
            <p className="text-sm font-semibold text-ink">
              Você tem uma venda em andamento.
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {conflito.terminal ?? "Terminal"} · {conflito.numItens}{" "}
              {conflito.numItens === 1 ? "item" : "itens"} ·{" "}
              <span className="font-mono font-semibold tabular-nums">
                {brl(conflito.total)}
              </span>
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setConflito(null)}
                autoFocus
                className="min-h-[2.75rem] cursor-pointer rounded-[var(--radius)] border border-line text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Continuar venda atual
              </button>
              <button
                onClick={suspenderEReceber}
                disabled={carregando}
                className="flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-brand text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
              >
                {carregando && <Loader2 size={14} className="animate-spin" />}
                {vendaTotem
                  ? "Devolver esta à fila e receber"
                  : "Suspender venda atual e receber"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PersonalizadoModal
        key={pdvModal?.id ?? "vazio"}
        produto={pdvModal}
        onClose={() => setPdvModal(null)}
        onAdd={(p, variantId, qty, selecoes, precoUnit, detalhe) => {
          addItem(p, variantId, qty, selecoes, precoUnit, detalhe);
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
          origemTotem={
            vendaTotem
              ? `${vendaTotem.terminal ?? "Autoatendimento"} ${vendaTotem.numero}`
              : null
          }
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

      <style>{`
        @media (prefers-reduced-motion: reduce) { .animate-pulse { animation: none } }
      `}</style>
    </>
  );
}
