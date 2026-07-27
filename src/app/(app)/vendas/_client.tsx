"use client";

// PDV — tela operacional de venda.
// Duas áreas: a venda atual (busca → carrinho → total → pagamento) e a fila
// do autoatendimento (vendas dos terminais, em tempo real). Sem catálogo,
// sem métricas, sem navegação extra: só o necessário para vender.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  ChevronDown,
  UserX,
  MonitorSmartphone,
  PauseCircle,
  CornerUpLeft,
  ScanBarcode,
  WifiOff,
  Percent,
  User,
  ShoppingBag,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { CaixaSheet, type CaixaInfo } from "@/components/app/caixa-sheet";
import {
  finalizarVendaPdvAction,
  carregarVendaTotemAction,
  receberVendaTotemAction,
  iniciarPagamentoIntegradoAction,
  iniciarRecebimentoTotemIntegradoAction,
  abortarRecebimentoTotemAction,
  finalizarVendaTefCartaoAction,
  sincronizarVendaOfflineAction,
  type VendaTotemFila,
  type InicioPagamentoIntegrado,
} from "./actions";
import { tefBridge, tefDisponivel } from "@/lib/tef/ipc";
import {
  enfileirarVendaOffline,
  listarVendasOffline,
  removerVendaOffline,
  contarVendasOffline,
} from "@/lib/offline/fila-vendas";
import type { IntegracaoPdv } from "@/lib/pagamentos";
import type { ProdutoVenda } from "./_data";
import type { PaymentMethod } from "@/generated/prisma";

type ControleEstoque = "BLOQUEAR" | "CONFIRMAR" | "IGNORAR";
/** Item aguardando confirmação de venda acima do estoque (modo CONFIRMAR). */
type PendenteEstoque = {
  p: ProdutoVenda;
  variantId: string | null;
  qty: number;
  selecoes: string[];
  precoUnit?: number;
  detalhe: string | null;
  disponivel: number;
};
import { brl, mascararCpf, parseCentavos, type CartItem, type ClienteSel } from "./_shared";
import { PagamentoModal, ClienteModal, PersonalizadoModal } from "./_modais";
import { FilaAutoatendimentoPanel } from "./_fila";
import { NotaFiscalChip } from "./_nota-fiscal";
import { HistoricoVendasModal } from "./_historico";
import { useOnline } from "@/lib/hooks/use-online";

type VendaTotemAtiva = { id: string; numero: string; terminal: string | null };
type VendaSuspensa = {
  cart: CartItem[];
  cliente: ClienteSel | null;
  maiorIdade: boolean;
};

const selectCls =
  "cursor-pointer rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Rótulo curto da venda para o comprovante/conciliação do TEF (não é id). */
function refVendaTef(): string {
  return "#" + Date.now().toString(36).slice(-6).toUpperCase();
}

/** "3*7891…" ou "2x água" → quantidade + termo. Sem prefixo, qty 1. */
function parseMultiplicador(raw: string): { qty: number; termo: string } {
  const m = raw.trim().match(/^(\d{1,4})\s*[*xX]\s*(.+)$/);
  if (m) return { qty: Math.max(1, Math.min(9999, parseInt(m[1], 10))), termo: m[2].trim() };
  return { qty: 1, termo: raw.trim() };
}

/** Id de idempotência da venda offline (módulo: mantém o render puro). */
function novoClientId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `off_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function PdvClient({
  sites,
  defaultSiteId,
  produtos,
  metodosAtivos,
  integracao,
  caixa,
  operador,
  fundoTrocoPadrao,
  limiteGaveta,
  emiteNfce,
  controleEstoque = "BLOQUEAR",
}: {
  sites: { id: string; nome: string; controleIdade?: boolean }[];
  defaultSiteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  integracao: IntegracaoPdv;
  caixa: CaixaInfo | null;
  operador: string;
  fundoTrocoPadrao?: number | null;
  limiteGaveta?: number | null;
  /** Módulo fiscal ligado E emissão automática: só então acompanhamos a nota. */
  emiteNfce?: boolean;
  /** Como o PDV trata saldo insuficiente (Configurações → Estoque). */
  controleEstoque?: ControleEstoque;
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
  const [confirmaRemoverCliente, setConfirmaRemoverCliente] = useState(false);
  const [pendenteEstoque, setPendenteEstoque] = useState<PendenteEstoque | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [bump, setBump] = useState(0);

  const online = useOnline();
  // TEF só existe no runtime nativo (Electron). Detecta no mount (evita mismatch
  // de hidratação — no SSR window.tef não existe).
  const [tefOn, setTefOn] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTefOn(tefDisponivel()), 0);
    return () => window.clearTimeout(t);
  }, []);

  // Fila de vendas offline (Fase 3) — só dinheiro fecha sem rede.
  const [pendentesOffline, setPendentesOffline] = useState(0);
  const drenando = useRef(false);

  // Venda cuja nota ainda estamos acompanhando. Não trava o caixa: o operador
  // já pode passar a próxima compra enquanto a NFC-e vai para a SEFAZ.
  const [vendaFiscal, setVendaFiscal] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pdvModal, setPdvModal] = useState<ProdutoVenda | null>(null);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [pagamentoOpen, setPagamentoOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [drinksOpen, setDrinksOpen] = useState(false);
  // Painel do autoatendimento: colapsa quando não há terminal/venda ativa,
  // liberando a largura toda para o carrinho. Com atividade, fica travado aberto.
  const [filaAberta, setFilaAberta] = useState(true);
  const [filaAtiva, setFilaAtiva] = useState(false);

  const [flashKey, setFlashKey] = useState<string | null>(null);
  // Desconto da venda (balcão) — reduz o total; vai como `descontoVenda`.
  const [desconto, setDesconto] = useState(0);
  const [descontoOpen, setDescontoOpen] = useState(false);
  // Confirmação leve do último bip (chip abaixo da busca).
  const [ultimaAdicao, setUltimaAdicao] = useState<{ nome: string; qty: number } | null>(null);
  // Flash verde no total ao concluir a venda.
  const [vendaFlash, setVendaFlash] = useState(false);
  // Pilha de desfazer (Ctrl+Z) — snapshots do carrinho antes de cada adição.
  const undoRef = useRef<CartItem[][]>([]);
  const buscaRef = useRef<HTMLInputElement>(null);

  // ── Rascunho local (Fase 0) — recuperar a venda após recarregar/travar ──
  // Só o carrinho normal do balcão; venda do totem é do servidor, não rascunho.
  const rascunhoKey = `nohub.pdv.rascunho.${siteId}`;
  const restauradoRef = useRef<string | null>(null);

  useEffect(() => {
    if (vendaTotem) return; // venda do totem não é rascunho local
    if (cart.length === 0) {
      window.localStorage.removeItem(rascunhoKey);
      return;
    }
    window.localStorage.setItem(rascunhoKey, JSON.stringify({ cart, cliente, maiorIdade }));
  }, [cart, cliente, maiorIdade, rascunhoKey, vendaTotem]);

  useEffect(() => {
    // Uma tentativa de restauração por loja, e só com o carrinho vazio.
    if (vendaTotem || restauradoRef.current === siteId) return;
    restauradoRef.current = siteId;
    const t = window.setTimeout(() => {
      if (cart.length > 0) return;
      const raw = window.localStorage.getItem(`nohub.pdv.rascunho.${siteId}`);
      if (!raw) return;
      try {
        const d = JSON.parse(raw) as {
          cart?: CartItem[];
          cliente?: ClienteSel | null;
          maiorIdade?: boolean;
        };
        if (Array.isArray(d.cart) && d.cart.length > 0) {
          setCart(d.cart);
          setCliente(d.cliente ?? null);
          setMaiorIdade(!!d.maiorIdade);
          toast.info("Venda recuperada", "Retomamos o carrinho de antes.");
        }
      } catch {
        // rascunho corrompido — ignora
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [siteId, vendaTotem, cart.length]);

  const caixaOk = !!caixa;
  const siteNome = sites.find((s) => s.id === siteId)?.nome ?? "";
  const siteControlaIdade =
    sites.find((s) => s.id === siteId)?.controleIdade ?? false;

  // Caixa fechou → esvazia o carrinho (não dá para vender sem caixa aberto).
  useEffect(() => {
    if (caixaOk) return;
    const t = window.setTimeout(() => {
      setCart([]);
      setMaiorIdade(false);
      setCliente(null);
      setVendaTotem(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [caixaOk]);

  // Atividade do autoatendimento comanda o colapso: abre ao surgir atividade,
  // fecha ao cessar. Só reage à MUDANÇA REAL de filaAtiva — o card nasce aberto
  // e o valor inicial (false) não deve fechá-lo. Rastreia o valor anterior num
  // ref (resiste ao double-invoke do StrictMode em dev).
  const filaAtivaPrev = useRef(filaAtiva);
  useEffect(() => {
    if (filaAtivaPrev.current === filaAtiva) return;
    filaAtivaPrev.current = filaAtiva;
    const t = window.setTimeout(() => setFilaAberta(filaAtiva), 0);
    return () => window.clearTimeout(t);
  }, [filaAtiva]);

  // Chip "última adição" some sozinho após um instante.
  useEffect(() => {
    if (!ultimaAdicao) return;
    const t = window.setTimeout(() => setUltimaAdicao(null), 1600);
    return () => window.clearTimeout(t);
  }, [ultimaAdicao]);

  // Busca: nome, SKU ou EAN — resultado enxuto, direto ao ponto.
  const filtrados = useMemo(() => {
    const q = parseMultiplicador(busca).termo.toLowerCase();
    if (!q) return [];
    return produtos
      .filter((p) => {
        // Só o modo BLOQUEAR esconde produto zerado da busca; nos outros modos
        // ele aparece (com aviso "sem estoque") e pode ser vendido.
        if (
          controleEstoque === "BLOQUEAR" &&
          p.estoqueFechado != null &&
          p.estoqueFechado <= 0
        )
          return false;
        if (p.tipo === "PERSONALIZADO" && !p.disponivel) return false;
        return (
          p.nome.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.ean ?? "").includes(q)
        );
      })
      .slice(0, 8);
  }, [busca, produtos, controleEstoque]);

  // Saldo do produto no carrinho (SIMPLES: estoque é por produto, soma variações).
  const qtdNoCarrinho = useCallback(
    (productId: string) =>
      cart
        .filter((i) => i.productId === productId)
        .reduce((s, i) => s + i.quantidade, 0),
    [cart],
  );

  // Personalizados (drinks/pratos montados) não têm código de barras —
  // acesso rápido por chips abaixo da busca.
  const personalizados = useMemo(
    () => produtos.filter((p) => p.tipo === "PERSONALIZADO" && p.disponivel),
    [produtos],
  );

  const subtotal = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  // Desconto só no balcão (venda do totem já vem fechada do terminal).
  const descontoAplicado = vendaTotem ? 0 : Math.min(desconto, subtotal);
  const total = Math.max(0, subtotal - descontoAplicado);
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

  /** Flash verde no total ao concluir a venda. */
  function flashVenda() {
    setVendaFlash(true);
    window.setTimeout(() => setVendaFlash(false), 750);
  }

  function addItem(
    p: ProdutoVenda,
    variantId: string | null,
    qty = 1,
    selecoes: string[] = [],
    precoUnit?: number,
    detalhe: string | null = null,
    confirmado = false,
  ) {
    if (!caixaOk) {
      setSheetOpen(true);
      return;
    }
    // Controle de estoque (Configurações → Estoque). estoqueFechado null =
    // combo/personalizado — a baixa é por insumo, não checa aqui.
    if (
      !confirmado &&
      controleEstoque !== "IGNORAR" &&
      p.estoqueFechado != null
    ) {
      const desejado = qtdNoCarrinho(p.id) + qty;
      if (desejado > p.estoqueFechado) {
        if (controleEstoque === "BLOQUEAR") {
          toast.error(
            "Sem estoque",
            p.estoqueFechado <= 0
              ? `"${p.nome}" está zerado.`
              : `"${p.nome}" tem só ${p.estoqueFechado} em estoque.`,
          );
          return;
        }
        // CONFIRMAR — pede confirmação antes de passar do saldo.
        setPendenteEstoque({
          p,
          variantId,
          qty,
          selecoes,
          precoUnit,
          detalhe,
          disponivel: p.estoqueFechado,
        });
        return;
      }
    }
    const variant = variantId
      ? (p.variants.find((v) => v.id === variantId) ?? null)
      : null;
    const selKey = selecoes.length ? ":" + [...selecoes].sort().join(",") : "";
    const key = p.id + ":" + (variantId ?? "") + selKey;
    // Snapshot para o Ctrl+Z (desfaz a última adição).
    undoRef.current.push(cart);
    if (undoRef.current.length > 30) undoRef.current.shift();
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
    setUltimaAdicao({ nome: p.nome, qty });
    setBusca("");
    buscaRef.current?.focus();
  }

  /** Desfaz a última adição (Ctrl+Z). */
  function desfazerUltimo() {
    const prev = undoRef.current.pop();
    if (prev) {
      setCart(prev);
      buscaRef.current?.focus();
    }
  }

  function escolher(p: ProdutoVenda, qty = 1) {
    if (p.tipo === "PERSONALIZADO") {
      setPdvModal(p);
      setBusca("");
    } else {
      addItem(p, p.variants[0]?.id ?? null, qty);
    }
  }

  function setQtd(key: string, q: number) {
    if (q <= 0) return setCart((prev) => prev.filter((i) => i.key !== key));
    // No modo BLOQUEAR, não deixa a quantidade passar do saldo do produto.
    if (controleEstoque === "BLOQUEAR") {
      const item = cart.find((i) => i.key === key);
      const prod = item && produtos.find((p) => p.id === item.productId);
      if (prod && prod.estoqueFechado != null && q > prod.estoqueFechado) {
        toast.error(
          "Sem estoque",
          `"${prod.nome}" tem só ${prod.estoqueFechado} em estoque.`,
        );
        q = prod.estoqueFechado;
        if (q <= 0) return setCart((prev) => prev.filter((i) => i.key !== key));
      }
    }
    setCart((prev) =>
      prev.map((i) => (i.key === key ? { ...i, quantidade: q } : i)),
    );
  }

  function limpar() {
    setCart([]);
    setMaiorIdade(false);
    setCliente(null);
    setVendaTotem(null);
    setDesconto(0);
    setDescontoOpen(false);
    undoRef.current = [];
  }

  // Leitor de código de barras: digita o código e envia Enter no campo de busca.
  function onBuscaEnter() {
    const { qty, termo } = parseMultiplicador(busca);
    if (!termo) return;
    const exato = produtos.find(
      (p) => p.ean === termo || p.sku.toLowerCase() === termo.toLowerCase(),
    );
    const alvo = exato ?? filtrados[hi] ?? filtrados[0] ?? null;
    if (!alvo) return;
    // O controle de estoque (bloquear/confirmar/ignorar) é decidido em addItem.
    escolher(alvo, qty);
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
      setDesconto(0);
      setDescontoOpen(false);
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
    opts?: { cpfNota?: string | null },
  ) {
    // OFFLINE: fecha a venda na fila local (só dinheiro, só balcão). A venda do
    // totem e cartão/PIX precisam de rede — o modal já bloqueia, isto é a rede.
    if (!online) {
      return new Promise<boolean>((resolve) => {
        if (vendaTotem) {
          toast.error("Sem conexão", "Venda do totem precisa de rede.");
          return resolve(false);
        }
        if (!caixa) {
          toast.error("Caixa fechado", "Abra o caixa para vender.");
          return resolve(false);
        }
        if (!pagamentos.every((p) => p.metodo === "DINHEIRO")) {
          toast.error("Sem conexão", "Offline só aceita dinheiro.");
          return resolve(false);
        }
        const payload = {
          clientId: novoClientId(),
          siteId,
          cashSessionId: caixa.id,
          customerId: cliente?.id ?? null,
          items: cart.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantidade: i.quantidade,
            selecoes: i.selecoes,
          })),
          descontoVenda: descontoAplicado,
          maiorIdadeConfirmada: maiorIdade,
          cpfNota: opts?.cpfNota ?? null,
          pagamentos: pagamentos.map((p) => ({
            metodo: "DINHEIRO" as const,
            valor: p.valor,
            troco: p.troco ?? null,
          })),
          criadaEm: new Date().toISOString(),
          totalEstimado: total,
        };
        enfileirarVendaOffline(payload)
          .then(() => {
            setPendentesOffline((n) => n + 1);
            toast.success("Venda salva (offline)", "Sincroniza quando a rede voltar.");
            flashVenda();
            setPagamentoOpen(false);
            limpar();
            window.setTimeout(() => buscaRef.current?.focus(), 60);
            resolve(true);
          })
          .catch(() => {
            toast.error("Erro ao salvar offline", "Tente de novo.");
            resolve(false);
          });
      });
    }

    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        try {
          const items = cart.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantidade: i.quantidade,
            selecoes: i.selecoes,
          }));
          let saleId: string;
          if (vendaTotem) {
            await receberVendaTotemAction({
              saleId: vendaTotem.id,
              siteId,
              customerId: cliente?.id ?? null,
              items,
              maiorIdadeConfirmada: maiorIdade,
              cpfNota: opts?.cpfNota ?? null,
              pagamentos,
            });
            saleId = vendaTotem.id;
          } else {
            saleId = await finalizarVendaPdvAction({
              siteId,
              customerId: cliente?.id ?? null,
              items,
              descontoVenda: descontoAplicado,
              maiorIdadeConfirmada: maiorIdade,
              cpfNota: opts?.cpfNota ?? null,
              pagamentos,
            });
          }
          if (emiteNfce) setVendaFiscal(saleId);
          toast.success("Venda concluída!", brl(total));
          flashVenda();
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

  // ── Pagamento integrado (PIX dinâmico / maquininha) ─────────
  // Cria a venda ABERTA + cobrança no provedor; o modal acompanha por
  // polling e chama concluirIntegrado quando o provedor confirmar.
  async function iniciarIntegrado(
    metodo: "PIX" | "CARTAO_CREDITO" | "CARTAO_DEBITO",
    opts: {
      parcelas?: number;
      terminalId?: string | null;
      cpfNota?: string | null;
      /** MISTO: divisão completa da venda (a perna do cartão vai à maquininha). */
      pagamentos?: { metodo: PaymentMethod; valor: number; troco?: number | null }[];
    },
  ): Promise<InicioPagamentoIntegrado> {
    const items = cart.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantidade: i.quantidade,
      selecoes: i.selecoes,
    }));
    // Venda do totem recebida no caixa (Modo B): cobra a venda existente no
    // PSP em vez de criar uma nova. Método único — misto no totem segue manual.
    if (vendaTotem) {
      return iniciarRecebimentoTotemIntegradoAction({
        saleId: vendaTotem.id,
        siteId,
        customerId: cliente?.id ?? null,
        items,
        maiorIdadeConfirmada: maiorIdade,
        cpfNota: opts.cpfNota ?? null,
        metodo,
        parcelas: opts.parcelas ?? 1,
        terminalId: opts.terminalId ?? null,
      });
    }
    return iniciarPagamentoIntegradoAction({
      siteId,
      customerId: cliente?.id ?? null,
      items,
      descontoVenda: descontoAplicado,
      maiorIdadeConfirmada: maiorIdade,
      cpfNota: opts.cpfNota ?? null,
      metodo,
      parcelas: opts.parcelas ?? 1,
      terminalId: opts.terminalId ?? null,
      pagamentos: opts.pagamentos,
    });
  }

  function concluirIntegrado(saleId?: string) {
    if (emiteNfce && saleId) setVendaFiscal(saleId);
    toast.success("Venda concluída!", brl(total));
    flashVenda();
    setPagamentoOpen(false);
    limpar();
    setBump((b) => b + 1);
    router.refresh();
    window.setTimeout(() => buscaRef.current?.focus(), 60);
  }

  // ── Sincronização da fila offline ────────────────────────────
  const drenarFilaOffline = useCallback(async () => {
    if (drenando.current) return;
    drenando.current = true;
    try {
      const fila = await listarVendasOffline();
      let sincronizou = false;
      let falhou = false;
      for (const v of fila) {
        try {
          await sincronizarVendaOfflineAction(v);
          await removerVendaOffline(v.clientId);
          sincronizou = true;
        } catch {
          // Erro numa venda (rede oscilou ou saldo insuficiente) não pode travar
          // as outras — segue para a próxima; a falha fica na fila para depois.
          falhou = true;
        }
      }
      setPendentesOffline(await contarVendasOffline());
      if (sincronizou) {
        toast.success("Vendas sincronizadas", "A fila offline foi enviada.");
        router.refresh();
      }
      if (falhou) {
        toast.error("Algumas vendas não sincronizaram", "Vamos tentar de novo.");
      }
    } finally {
      drenando.current = false;
    }
  }, [router]);

  // Conta as pendentes ao montar (podem ter sobrado de uma sessão anterior).
  useEffect(() => {
    contarVendasOffline().then(setPendentesOffline).catch(() => {});
  }, []);

  // Ao (re)conectar, drena a fila.
  useEffect(() => {
    if (online) drenarFilaOffline();
  }, [online, drenarFilaOffline]);

  // ── Cartão via TEF (pinpad, Electron) ────────────────────────
  // Dois-fases: pinpad aprova → grava a venda → confirma. Se a gravação falhar,
  // desfaz a autorização (senão fica dinheiro capturado sem venda). Se o confirmar
  // falhar depois de gravar, a venda está paga e o TEF resolve a pendência no
  // próximo fechamento — não desfazemos (a venda existe).
  async function pagarCartaoTef(
    metodo: "CARTAO_CREDITO" | "CARTAO_DEBITO",
    opts: { parcelas?: number; cpfNota?: string | null },
  ): Promise<string> {
    const items = cart.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantidade: i.quantidade,
      selecoes: i.selecoes,
    }));
    const tipo = metodo === "CARTAO_CREDITO" ? "CREDITO" : "DEBITO";
    const referencia = refVendaTef();

    const r = await tefBridge().pagar({ valor: total, tipo, parcelas: opts.parcelas, referencia });
    if (r.status !== "APROVADO") {
      throw new Error(r.mensagem || "Cartão não aprovado no pinpad.");
    }
    try {
      const saleId = await finalizarVendaTefCartaoAction({
        siteId,
        customerId: cliente?.id ?? null,
        items,
        descontoVenda: descontoAplicado,
        maiorIdadeConfirmada: maiorIdade,
        cpfNota: opts.cpfNota ?? null,
        metodo,
        valor: total,
        tefId: r.tefId ?? referencia,
        bandeira: r.bandeira,
        parcelas: r.parcelas,
        nsu: r.nsu,
        autorizacao: r.autorizacao,
        adquirenteCnpj: r.adquirenteCnpj,
        comprovante: r.comprovanteCliente,
      });
      // 2ª fase: confirma a transação. Falha aqui não desfaz a venda (já paga);
      // o TEF resolve pendência no fechamento.
      if (r.tefId) tefBridge().confirmar(r.tefId).catch(() => {});
      return saleId;
    } catch (e) {
      // gravação falhou → desfaz a autorização para não deixar dinheiro preso.
      if (r.tefId) tefBridge().desfazer(r.tefId).catch(() => {});
      throw e;
    }
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
      } else if (e.key === "F4") {
        e.preventDefault();
        setSheetOpen(true);
      } else if (e.key === "Delete" && cart.length > 0) {
        // Del cancela a venda. Não usamos Esc: em tela cheia o navegador o
        // reserva pra sair do fullscreen e suprime o evento. Ignora se estiver
        // digitando num campo (senão Del apagaria texto).
        const alvo = e.target as HTMLElement | null;
        const digitando =
          alvo instanceof HTMLInputElement ||
          alvo instanceof HTMLTextAreaElement ||
          alvo instanceof HTMLSelectElement ||
          alvo?.isContentEditable;
        if (!digitando) {
          e.preventDefault();
          setConfirmaCancelar(true);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        desfazerUltimo();
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
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-warn/40 bg-warn-soft px-3 py-1.5 text-sm font-medium text-warn"
        >
          <WifiOff size={15} />
          Sem conexão — só vendas em dinheiro.
          {pendentesOffline > 0 && (
            <span className="rounded-full bg-warn/20 px-2 py-0.5 text-xs font-semibold">
              {pendentesOffline} na fila
            </span>
          )}
        </div>
      )}
      {online && pendentesOffline > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-brand/30 bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-strong"
        >
          <Loader2 size={14} className="animate-spin" />
          Sincronizando {pendentesOffline} {pendentesOffline === 1 ? "venda" : "vendas"} offline…
        </div>
      )}
      <div className="flex flex-col gap-2.5 pt-2 lg:h-full lg:min-h-0">
        {/* Linha superior: busca + drinks + autoatendimento + caixa */}
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <ScanBarcode
              size={19}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-faint dark:text-ink"
            />
            <input
              ref={buscaRef}
              autoFocus
              value={busca}
              onChange={(e) => {
                const v = e.target.value;
                setBusca(v);
                setHi(0);
                // Leitor de código de barras: adiciona sozinho assim que o valor
                // casar exatamente com um EAN (sem Enter/clique). Só dispara se
                // nenhum outro EAN começar por esse (evita disparar num prefixo).
                const { qty, termo } = parseMultiplicador(v);
                if (/^\d{8,14}$/.test(termo)) {
                  const prod = produtos.find((p) => p.ean === termo);
                  const ambiguo = produtos.some(
                    (p) => p.ean && p.ean !== termo && p.ean.startsWith(termo),
                  );
                  if (prod && !ambiguo) escolher(prod, qty);
                }
              }}
              onKeyDown={onBuscaKeyDown}
              placeholder="Buscar produto ou ler código de barras"
              className="w-full rounded-full border border-line bg-surface py-3.5 pl-12 pr-12 text-base text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)] dark:placeholder:text-ink"
            />
            <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
              F1
            </kbd>
            {/* Resultados */}
            {busca.trim() && (
              <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-2)]">
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
            {/* Confirmação leve do último bip */}
            {ultimaAdicao && !busca.trim() && (
              <div className="absolute inset-x-0 top-full z-20 mt-1.5 flex items-center gap-2 rounded-[var(--radius)] border border-ok/40 bg-ok-soft px-3 py-1.5 text-[13px] font-medium text-ok">
                <Plus size={14} className="shrink-0" />
                <span className="truncate">
                  {ultimaAdicao.qty}× {ultimaAdicao.nome} adicionado
                </span>
              </div>
            )}
          </div>

          {/* Drinks — personalizados sem código de barras, abertos num menu */}
          {personalizados.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setDrinksOpen((v) => !v)}
                aria-expanded={drinksOpen}
                className={cn(
                  "flex h-[3.375rem] cursor-pointer items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors",
                  drinksOpen
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface text-ink hover:border-brand hover:text-brand",
                )}
              >
                <Wine size={17} />
                Drinks
                <ChevronDown
                  size={15}
                  className={cn("transition-transform", drinksOpen && "rotate-180")}
                />
              </button>
              {drinksOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setDrinksOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute right-0 top-full z-30 mt-1.5 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[var(--radius)] border border-line bg-surface py-1 shadow-[var(--shadow-2)]">
                    {personalizados.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setDrinksOpen(false);
                          if (caixaOk) setPdvModal(p);
                          else setSheetOpen(true);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-brand-soft"
                      >
                        <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                          {p.nome}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-muted">
                          {brl(p.preco)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {sites.length > 1 && (
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className={cn(selectCls, "h-[3.375rem] shrink-0")}
              aria-label="Loja"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          )}

          {!filaAberta && (
            <button
              onClick={() => setFilaAberta(true)}
              title="Exibir autoatendimento"
              className="flex h-[3.375rem] shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              <MonitorSmartphone size={18} />
              Autoatendimento
            </button>
          )}

          <button
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex h-[3.375rem] min-w-[12rem] shrink-0 cursor-pointer items-center justify-between gap-3 rounded-full border pl-4 pr-4 transition-colors",
              caixaOk
                ? "border-ok/40 bg-ok-soft text-ok hover:bg-ok-soft/70"
                : "animate-pulse border-danger bg-danger text-on-brand hover:opacity-90",
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center gap-2",
                !caixaOk && "mx-auto",
              )}
            >
              {caixaOk ? <Unlock size={16} /> : <Lock size={16} />}
              <span className="flex flex-col items-start leading-tight">
                <span className="text-base font-semibold">
                  {caixaOk ? "Caixa aberto" : "Caixa fechado"}
                </span>
                {!caixaOk && (
                  <span className="text-[11px] font-medium opacity-90">
                    Toque para abrir · F4
                  </span>
                )}
              </span>
            </span>
            {caixaOk && (
              <span className="min-w-0 text-right">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {operador}
                </span>
                <span className="block truncate text-[13px] font-medium leading-tight text-ok/80">
                  {siteNome}
                </span>
              </span>
            )}
          </button>
        </div>
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3 lg:overflow-hidden lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out",
            filaAberta
              ? "lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_360px]"
              : "lg:grid-cols-[minmax(0,1fr)_0px]",
          )}
        >
          {/* ── Venda atual ── */}
          <section className="flex min-h-0 min-w-0 flex-col gap-2.5 lg:h-full">
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
                  cart
                    .slice()
                    .reverse()
                    .map((i) => (
                    <div
                      key={i.key}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                        flashKey === i.key
                          ? "bg-brand-soft"
                          : "hover:bg-surface-2",
                      )}
                    >
                      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2 text-faint">
                        {i.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={i.imagemUrl}
                            alt=""
                            className="h-full w-full object-contain p-0.5"
                          />
                        ) : (
                          <Wine size={18} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-ink">
                          {i.nome}
                          {i.variantNome && (
                            <span className="text-muted">
                              {" "}
                              · {i.variantNome}
                            </span>
                          )}
                        </p>
                        {i.detalhe && (
                          <p className="truncate text-xs text-muted">
                            {i.detalhe}
                          </p>
                        )}
                        <p className="font-mono text-[13px] text-ink-2">
                          {brl(i.preco)} un.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => {
                            const era = i.quantidade;
                            setQtd(i.key, era - 1);
                            if (era <= 1) buscaRef.current?.focus();
                          }}
                          aria-label="Diminuir"
                          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                        >
                          {i.quantidade <= 1 ? (
                            <Trash2 size={13} />
                          ) : (
                            <Minus size={14} />
                          )}
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Quantidade de ${i.nome}`}
                          value={i.quantidade}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "");
                            if (v === "") return; // não zera enquanto digita
                            setQtd(i.key, Math.min(9999, parseInt(v, 10)));
                          }}
                          className="w-12 rounded-[var(--radius-sm)] border border-line bg-surface px-1 py-1 text-center font-mono text-sm tabular-nums text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ring)]"
                        />
                        <button
                          onClick={() => setQtd(i.key, i.quantidade + 1)}
                          aria-label="Aumentar"
                          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-muted hover:bg-surface-2"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-semibold tabular-nums text-ink">
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

              {/* Rodapé da venda — barra de info + botões (estilo balcão) */}
              <div className="border-t border-line">
                {/* Info: cliente · itens · total */}
                <div className="flex flex-wrap items-stretch">
                  {/* Cliente */}
                  <div className="flex min-w-[15rem] flex-1 items-center gap-3 px-4 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                      <User size={20} />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {cliente ? cliente.nome : "Consumidor Final"}
                        </span>
                        <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
                          F3
                        </kbd>
                      </div>
                      {cliente?.cpf && (
                        <span className="font-mono text-[12px] text-muted">
                          {mascararCpf(cliente.cpf)}
                        </span>
                      )}
                      <div className="mt-0.5 flex items-center gap-2">
                        <button
                          onClick={() => setClienteOpen(true)}
                          className="cursor-pointer text-[13px] font-medium text-brand transition-colors hover:text-brand-strong"
                        >
                          {cliente ? "Trocar cliente" : "Identificar cliente"}
                        </button>
                        {cliente && (
                          <>
                            <span className="text-[13px] text-ink">/</span>
                            <button
                              onClick={() => setConfirmaRemoverCliente(true)}
                              className="cursor-pointer text-[13px] font-medium text-danger transition-colors hover:opacity-80"
                            >
                              Remover cliente
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Itens */}
                  <div className="flex items-center gap-2 border-line px-5 py-3 text-[15px] font-medium text-ink-2 sm:border-l">
                    <ShoppingBag size={18} className="shrink-0 text-muted" />
                    <span className="whitespace-nowrap">
                      {cart.length} {cart.length === 1 ? "produto" : "produtos"} ·{" "}
                      {numItens} {numItens === 1 ? "item" : "itens"}
                    </span>
                  </div>

                  {/* Total */}
                  <div className="flex flex-col items-end justify-center border-line px-8 py-3 sm:border-l lg:px-10">
                    {descontoAplicado > 0 && (
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-mono tabular-nums text-muted line-through">
                          {brl(subtotal)}
                        </span>
                        <span className="font-mono tabular-nums text-danger">
                          − {brl(descontoAplicado)}
                        </span>
                      </div>
                    )}
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Total
                    </span>
                    <span
                      className={cn(
                        "font-display text-[2.6rem] font-bold leading-none tabular-nums transition-colors duration-300",
                        vendaFlash ? "text-ok" : "text-ink",
                      )}
                    >
                      {brl(total)}
                    </span>
                  </div>
                </div>

                {/* Desconto — só no balcão, faixa fina */}
                {cart.length > 0 && !vendaTotem && (
                  <div
                    className={cn(
                      "flex items-center border-t border-line px-4 py-2",
                      descontoOpen || descontoAplicado > 0
                        ? "justify-between"
                        : "justify-end",
                    )}
                  >
                    {descontoOpen || descontoAplicado > 0 ? (
                      <>
                        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          <Percent size={13} /> Desconto
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="relative">
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">
                              R$
                            </span>
                            <input
                              inputMode="numeric"
                              aria-label="Valor do desconto"
                              value={
                                desconto
                                  ? desconto.toLocaleString("pt-BR", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })
                                  : ""
                              }
                              onChange={(e) =>
                                setDesconto(Math.min(subtotal, parseCentavos(e.target.value)))
                              }
                              placeholder="Desconto"
                              autoFocus={descontoOpen && descontoAplicado === 0}
                              className="w-32 rounded-[var(--radius-sm)] border border-line bg-surface py-1.5 pl-8 pr-2 text-right font-mono text-sm tabular-nums text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            />
                          </span>
                          <button
                            onClick={() => {
                              setDesconto(0);
                              setDescontoOpen(false);
                              buscaRef.current?.focus();
                            }}
                            className="cursor-pointer text-xs font-medium text-muted hover:text-danger"
                          >
                            remover
                          </button>
                        </span>
                      </>
                    ) : (
                      <button
                        onClick={() => setDescontoOpen(true)}
                        className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-brand"
                      >
                        <Percent size={14} /> Aplicar desconto
                      </button>
                    )}
                  </div>
                )}

                {/* Botões — receber (destaque) + cancelar (secundário) */}
                <div className="flex gap-3 border-t border-line p-3">
                  <button
                    onClick={() => setPagamentoOpen(true)}
                    disabled={!podePagar}
                    className="flex min-h-[3.5rem] flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-[var(--radius)] bg-brand px-5 text-lg font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CreditCard size={20} />
                    Receber pagamento
                    <kbd className="rounded border border-on-brand/40 px-1.5 py-0.5 text-xs font-medium">
                      F2
                    </kbd>
                  </button>
                  <button
                    onClick={() => setConfirmaCancelar(true)}
                    disabled={cart.length === 0}
                    title="Cancelar esta venda e limpar o carrinho"
                    className="flex min-h-[3.5rem] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-5 text-base font-semibold text-ink transition-colors hover:border-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X size={18} className="text-danger" />
                    Cancelar venda
                    <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-faint">
                      Del
                    </kbd>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Lateral direita: fila do autoatendimento (colapsável) ──
              Fica montada mesmo colapsada (segue o polling): a coluna do grid
              anima até 0 e o carrinho toma o espaço; reabre ao surgir atividade. */}
          <div
            className={cn(
              "flex min-h-0 flex-col overflow-hidden transition-opacity duration-200 lg:h-full",
              filaAberta ? "opacity-100" : "opacity-0 max-lg:hidden",
            )}
          >
            <FilaAutoatendimentoPanel
              siteId={siteId}
              saleIdEmAtendimento={vendaTotem?.id ?? null}
              bump={bump}
              onReceber={receberDaFila}
              onAtividade={setFilaAtiva}
              onColapsar={() => setFilaAberta(false)}
            />
          </div>
        </div>

        {/* Barra de atalhos — sempre à vista, orienta o operador de balcão */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-1 pt-2 text-[12px] text-muted">
          {[
            { k: "F1", label: "Buscar produto" },
            { k: "F2", label: "Pagamento" },
            { k: "F3", label: "Identificar cliente" },
            { k: "F4", label: "Caixa" },
            { k: "Ctrl+Z", label: "Desfazer item" },
          ].map((a) => (
            <span key={a.k} className="flex items-center gap-1.5">
              <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink shadow-[var(--shadow-1)]">
                {a.k}
              </kbd>
              {a.label}
            </span>
          ))}
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

      {/* Confirmação da remoção do cliente identificado */}
      {confirmaRemoverCliente && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Remover cliente"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
            onClick={() => setConfirmaRemoverCliente(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
            <p className="text-sm font-semibold text-ink">
              Remover cliente identificado?
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {cliente?.nome} deixará de estar vinculado a esta venda.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setConfirmaRemoverCliente(false)}
                autoFocus
                className="min-h-[2.75rem] cursor-pointer rounded-[var(--radius)] border border-line text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Manter cliente
              </button>
              <button
                onClick={() => {
                  setCliente(null);
                  setConfirmaRemoverCliente(false);
                }}
                className="flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-danger text-sm font-semibold text-on-brand transition-opacity hover:opacity-90"
              >
                <UserX size={14} /> Remover cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de venda acima do estoque (modo CONFIRMAR) */}
      {pendenteEstoque && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vender acima do estoque"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-ink/50 backdrop-blur-[3px]"
            onClick={() => setPendenteEstoque(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
            <p className="text-sm font-semibold text-ink">
              Vender acima do estoque?
            </p>
            <p className="mt-1 text-[13px] text-muted">
              “{pendenteEstoque.p.nome}” tem{" "}
              <span className="font-mono font-semibold tabular-nums">
                {pendenteEstoque.disponivel}
              </span>{" "}
              em estoque. O saldo pode ficar negativo.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setPendenteEstoque(null)}
                autoFocus
                className="min-h-[2.75rem] cursor-pointer rounded-[var(--radius)] border border-line text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  const d = pendenteEstoque;
                  setPendenteEstoque(null);
                  addItem(
                    d.p,
                    d.variantId,
                    d.qty,
                    d.selecoes,
                    d.precoUnit,
                    d.detalhe,
                    true,
                  );
                }}
                className="flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] bg-warn text-sm font-semibold text-on-brand transition-opacity hover:opacity-90"
              >
                <AlertTriangle size={14} /> Vender assim mesmo
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
          integracao={integracao}
          mistoIntegradoDisponivel={!vendaTotem}
          tefDisponivel={tefOn && !vendaTotem}
          onCartaoTef={pagarCartaoTef}
          online={online}
          pedeCpfNota={emiteNfce}
          pending={pending}
          onClose={() => setPagamentoOpen(false)}
          onReceber={finalizar}
          onIniciarIntegrado={iniciarIntegrado}
          onAbortarIntegrado={
            vendaTotem
              ? (pid) => {
                  abortarRecebimentoTotemAction(pid).catch(() => {});
                }
              : undefined
          }
          onConcluidoIntegrado={concluirIntegrado}
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
        onFechado={() => {
          limpar();
          setSheetOpen(false);
        }}
        fundoTrocoPadrao={fundoTrocoPadrao}
        limiteGaveta={limiteGaveta}
      />

      {historicoOpen && (
        <HistoricoVendasModal
          siteId={siteId}
          onClose={() => setHistoricoOpen(false)}
          onEstornado={() => {
            setBump((b) => b + 1);
            router.refresh();
          }}
        />
      )}

      {/* Nota da última venda — canto inferior, sem roubar o foco do caixa. */}
      {vendaFiscal && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex justify-end">
          <NotaFiscalChip
            key={vendaFiscal}
            saleId={vendaFiscal}
            onClose={() => setVendaFiscal(null)}
          />
        </div>
      )}

      <style>{`
        @media (prefers-reduced-motion: reduce) { .animate-pulse { animation: none } }
      `}</style>
    </>
  );
}

