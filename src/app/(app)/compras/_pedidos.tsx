"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  Trash2,
  Loader2,
  Send,
  Pencil,
  CircleX,
  CircleCheck,
  Clock3,
  Truck,
  PackageCheck,
  ShoppingCart,
  CalendarClock,
  Building2,
  Store,
  FilePenLine,
  ChevronDown,
  Gift,
  MessageSquarePlus,
  MoreHorizontal,
  Info,
  Copy,
  ArrowUpRight,
  Sparkles,
  Check,
} from "lucide-react";
import { cn, moneyToMask, parseMoney } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import {
  criarPedidoCompraAction,
  atualizarPedidoCompraAction,
  enviarPedidoCompraAction,
  marcarAguardandoPedidoAction,
  marcarEmTransitoPedidoAction,
  cancelarPedidoCompraAction,
  excluirPedidoCompraAction,
  adicionarBonificacaoPedidoAction,
} from "../estoque/actions";
import { SolicitarSheet, type GrupoEnvio, copiarTexto } from "./_solicitar";
import { ReenviarSheet } from "./_reenviar";
import { fmtMoney, fmtQtd, previsaoLabel, relDiaHora, Thumb } from "./_ui";
import { PurchaseItemCard, PurchaseListHeader, defaultPackaging, precoSugerido } from "./_purchase-item";
import { BonusItemCard, BonusItemSidePanel, BonusListHeader, type BonusDraftItem } from "./_bonus";
import { type MotivoBonificacao, type TipoItemPedido } from "./_types";

// ── Tipos ─────────────────────────────────────────────────────

type ItemView = {
  id: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagingId: string | null;
  packagingNome: string | null;
  fatorConversao: number; // un base por unidade de compra (1 = unidade)
  tipo: TipoItemPedido;
  motivoBonificacao: MotivoBonificacao | null;
  qtdPedida: number; // em unidades de compra (embalagem)
  qtdRecebida: number;
  custoUnitario: number; // por unidade de compra (embalagem)
  observacao: string | null;
};

export type PedidoView = {
  id: string;
  numero: string;
  status: string;
  supplierId: string;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  supplierLogoUrl: string | null;
  siteId: string;
  siteNome: string;
  previsaoEntrega: string | null;
  valorTotal: number;
  observacao: string | null;
  financeiroGerado: boolean;
  createdAt: string;
  updatedAt: string;
  enviadoEm: string | null;
  confirmadoEm: string | null;
  emTransitoEm: string | null;
  recebidoEm: string | null;
  canceladoEm: string | null;
  operador: string | null;
  totalItems: number;
  items: ItemView[];
};

type Packaging = { id: string; nome: string; fatorConversao: number; isCompraDefault: boolean };
type Product = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: number | null;
  categoria: string | null;
  supplierIds: string[];
  packagings: Packaging[];
  /** UN base disponíveis por site (fechado + aberto). */
  estoquePorSite: Record<string, number>;
  /** Último preço pago por UN base — 1 por fornecedor, mais recente primeiro. */
  ultimosPrecos: { supplierId: string | null; custoUnBase: number; em: string }[];
  /** Itens em pedidos abertos (restante > 0) — aviso de duplicidade. */
  pendentes: { poId: string; numero: string; supplierId: string; qtd: number; packagingNome: string | null }[];
};
type Supplier = { id: string; razaoSocial: string; nomeFantasia: string | null; telefone: string | null; email: string | null; pedidoMinimo: number | null };
type Site = { id: string; nome: string; tipo: string };
export type FormOptions = { suppliers: Supplier[]; sites: Site[]; products: Product[] };

const supplierLabel = (s: Supplier) => s.nomeFantasia ?? s.razaoSocial;

// ── Drawer de detalhe ─────────────────────────────────────────
// Edição de rascunho e recebimento são delegados a quem hospeda o
// drawer (inbox) via `onEditar`/`onReceber`.

export function PedidoDrawer({
  pedido,
  empresa,
  products,
  onClose,
  onEditar,
  onReceber,
  onStatusChanging,
}: {
  pedido: PedidoView | null;
  empresa: string;
  /** Catálogo p/ o painel de bonificação — mesma lista do form de pedido. */
  products: Product[];
  onClose: () => void;
  onEditar?: (p: PedidoView) => void;
  onReceber?: (p: PedidoView) => void;
  /** Notifica a lista que o status de um pedido está sendo alterado (id) — null quando termina. */
  onStatusChanging?: (id: string | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviar, setReenviar] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [produtosAbertos, setProdutosAbertos] = useState(true);
  const [bonusAbertos, setBonusAbertos] = useState(true);
  const [stepAberto, setStepAberto] = useState<StepKey | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  const pendingIdRef = useRef<string | null>(null);
  const p = pedido;
  const comprados = useMemo(() => p?.items.filter((it) => it.tipo === "COMPRA") ?? [], [p]);
  const bonificados = useMemo(() => p?.items.filter((it) => it.tipo !== "COMPRA") ?? [], [p]);
  const steps = useMemo(() => (p ? pedidoSteps(p) : []), [p]);
  // Fornecedor confirma o pedido (e é aqui que costuma avisar bonificação
  // junto) — mesma janela vale durante o recebimento parcial.
  const podeBonificar = p ? p.status === "AGUARDANDO" || p.status === "RECEBIDO_PARCIAL" : false;

  // Some visível até o refresh (RSC) aplicar o novo status — não só a
  // resposta da action — porque a lista lê os dados do server.
  useEffect(() => {
    if (!isRefreshing && pendingIdRef.current) {
      onStatusChanging?.(null);
      pendingIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRefreshing]);

  async function run(label: string, fn: () => Promise<unknown>) {
    if (!p) return;
    const id = p.id;
    setPending(label);
    setErro(null);
    try {
      await fn();
      onClose();
      pendingIdRef.current = id;
      onStatusChanging?.(id);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha na operação.");
      setPending(null);
    }
  }

  // Não fecha o drawer — o painel de bonificação já se fecha sozinho ao
  // confirmar; aqui só persiste e atualiza os itens exibidos.
  async function adicionarBonificacao(itens: BonusDraftItem[]) {
    if (!p) return;
    const id = p.id;
    setPending("bonificacao");
    setErro(null);
    try {
      await adicionarBonificacaoPedidoAction(id, {
        items: itens.map((it) => ({
          productId: it.productId,
          packagingId: it.packagingId,
          motivoBonificacao: it.motivo,
          qtdPedida: it.qtd,
          observacao: it.observacao.trim() || null,
        })),
      });
      pendingIdRef.current = id;
      onStatusChanging?.(id);
      startTransition(() => router.refresh());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao adicionar bonificação.");
    } finally {
      setPending(null);
    }
  }

  function renderRodape() {
    if (!p) return null;
    if (p.status === "CANCELADO") {
      return <p className="text-sm text-muted">Pedido cancelado — nenhuma ação disponível.</p>;
    }
    const botoes: React.ReactNode[] = [];
    if (p.status === "RASCUNHO") {
      if (onEditar) {
        botoes.push(
          <AcaoBtn key="editar" tone="secondary" icon={Pencil} label="Editar" tooltip="Editar itens e dados do pedido" onClick={() => onEditar(p)} />,
        );
      }
      botoes.push(
        <AcaoBtn
          key="enviar"
          tone="primary"
          icon={Send}
          label="Enviar pedido"
          tooltip="Envia o pedido ao fornecedor"
          loading={pending === "enviar"}
          disabled={pending !== null}
          onClick={() => run("enviar", () => enviarPedidoCompraAction(p.id))}
        />,
      );
      botoes.push(
        <AcaoBtn
          key="excluir"
          tone="danger"
          icon={Trash2}
          label="Excluir"
          tooltip="Remove este rascunho definitivamente"
          loading={pending === "excluir"}
          disabled={pending !== null}
          onClick={() => {
            if (window.confirm(`Excluir o pedido ${p.numero}? Essa ação não pode ser desfeita.`)) {
              run("excluir", () => excluirPedidoCompraAction(p.id));
            }
          }}
        />,
      );
    } else if (p.status === "ENVIADO") {
      botoes.push(
        <AcaoBtn
          key="confirmado"
          tone="secondary"
          icon={Clock3}
          label="Marcar como confirmado"
          tooltip="O fornecedor confirmou o recebimento do pedido"
          loading={pending === "aguardando"}
          disabled={pending !== null}
          onClick={() => run("aguardando", () => marcarAguardandoPedidoAction(p.id))}
        />,
      );
      botoes.push(
        <AcaoBtn key="reenviar" tone="secondary" icon={Send} label="Reenviar / compartilhar" tooltip="Reenvia o pedido por WhatsApp, e-mail ou PDF" onClick={() => setReenviar(true)} />,
      );
      botoes.push(
        <AcaoBtn
          key="transito"
          tone="secondary"
          icon={Truck}
          label="Marcar em trânsito"
          tooltip="A mercadoria já está a caminho"
          loading={pending === "transito"}
          disabled={pending !== null}
          onClick={() => run("transito", () => marcarEmTransitoPedidoAction(p.id))}
        />,
      );
      botoes.push(
        <AcaoBtn
          key="cancelar"
          tone="danger"
          icon={CircleX}
          label="Cancelar pedido"
          tooltip="Cancela este pedido"
          loading={pending === "cancelar"}
          disabled={pending !== null}
          onClick={() => run("cancelar", () => cancelarPedidoCompraAction(p.id))}
        />,
      );
    } else if (p.status === "AGUARDANDO" || p.status === "EM_TRANSITO") {
      if (onReceber) {
        botoes.push(
          <AcaoBtn key="receber" tone="primary" icon={PackageCheck} label="Receber mercadoria" tooltip="Conferir os itens recebidos e gerar a entrada no estoque" onClick={() => onReceber(p)} />,
        );
      }
      if (p.status === "AGUARDANDO") {
        botoes.push(
          <AcaoBtn
            key="transito"
            tone="secondary"
            icon={Truck}
            label="Marcar em trânsito"
            tooltip="A mercadoria já está a caminho"
            loading={pending === "transito"}
            disabled={pending !== null}
            onClick={() => run("transito", () => marcarEmTransitoPedidoAction(p.id))}
          />,
        );
      }
      botoes.push(
        <AcaoBtn
          key="cancelar"
          tone="danger"
          icon={CircleX}
          label="Cancelar pedido"
          tooltip="Cancela este pedido"
          loading={pending === "cancelar"}
          disabled={pending !== null}
          onClick={() => run("cancelar", () => cancelarPedidoCompraAction(p.id))}
        />,
      );
    } else if (p.status === "RECEBIDO_PARCIAL") {
      if (onReceber) {
        botoes.push(
          <AcaoBtn key="conferir" tone="primary" icon={PackageCheck} label="Conferir recebimento" tooltip="Lançar o restante da mercadoria recebida" onClick={() => onReceber(p)} />,
        );
      }
      botoes.push(
        <AcaoBtn
          key="cancelar"
          tone="danger"
          icon={CircleX}
          label="Cancelar pedido"
          tooltip="Cancela o saldo pendente deste pedido"
          loading={pending === "cancelar"}
          disabled={pending !== null}
          onClick={() => run("cancelar", () => cancelarPedidoCompraAction(p.id))}
        />,
      );
    } else if (p.status === "RECEBIDO") {
      botoes.push(
        <Link
          key="mov"
          href={`/estoque/movimentacoes?q=${encodeURIComponent(p.numero)}`}
          title="Ver as movimentações de estoque geradas por este pedido"
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <ArrowUpRight size={14} className="text-muted" /> Visualizar movimentações
        </Link>,
      );
    }
    return <div className="flex flex-wrap gap-2">{botoes}</div>;
  }

  return (
    <Sheet
      open={p !== null}
      onClose={onClose}
      title={p?.numero ?? ""}
      description={p ? `${p.supplierNome} · ${p.siteNome}` : ""}
      width="3xl"
      headerActions={
        p && (
          <Menu
            trigger={
              <button
                type="button"
                aria-label="Mais ações do pedido"
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <MoreHorizontal size={18} />
              </button>
            }
          >
            {p.status !== "RECEBIDO" && p.status !== "CANCELADO" && (
              <MenuItem
                icon={<Gift size={14} />}
                disabled={!podeBonificar}
                onClick={() => setBonusOpen(true)}
              >
                Adicionar bonificação
              </MenuItem>
            )}
            <MenuItem
              icon={<Copy size={14} />}
              onClick={async () => {
                await copiarTexto(p.numero);
                toast.success("Número copiado", p.numero);
              }}
            >
              Copiar número do pedido
            </MenuItem>
          </Menu>
        )
      }
      footer={renderRodape()}
    >
      {p && (
        <div className="flex flex-col gap-6">
          {/* Timeline — elemento principal: etapa atual e próxima ação */}
          <PedidoTimeline steps={steps} aberto={stepAberto} onToggle={setStepAberto} pedido={p} />

          {/* Assistente contextual — mensagem dinâmica conforme o status */}
          <AssistenteContextual pedido={p} steps={steps} />

          {/* Resumo do pedido — só texto, sem cards */}
          <div className="flex flex-wrap gap-x-6 gap-y-2.5 border-y border-line py-3.5">
            <ResumoCampo label="Criado em" valor={relDiaHora(p.createdAt)} />
            <ResumoCampo label="Operador" valor={p.operador ?? "—"} />
            <ResumoCampo
              label="Entrada prevista no estoque"
              valor={`${fmtQtd(p.items.reduce((a, it) => a + it.qtdPedida * it.fatorConversao, 0))} UN`}
            />
            <ResumoCampo label="Previsão de entrega" valor={p.previsaoEntrega ? previsaoLabel(p.previsaoEntrega) : "Sem previsão"} />
            {p.observacao && <ResumoCampo label="Observação" valor={p.observacao} full />}
          </div>

          {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}

          {/* Produtos comprados — informação principal, expansível */}
          <ItemSection
            icon={ShoppingCart}
            titulo="Produtos comprados"
            resumo={
              comprados.length > 0
                ? `${comprados.length} ${comprados.length === 1 ? "item" : "itens"} • ${fmtQtd(comprados.reduce((a, it) => a + it.qtdPedida * it.fatorConversao, 0))} UN • ${fmtMoney(p.valorTotal)}`
                : "Nenhum item"
            }
            aberto={produtosAbertos}
            onToggle={() => setProdutosAbertos((v) => !v)}
          >
            {comprados.length > 0 ? (
              <TabelaItens itens={comprados} />
            ) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-muted">
                Nenhum produto comprado neste pedido.
              </p>
            )}
          </ItemSection>

          {/* Bonificações — mesmo padrão, tom neutro + badge discreta.
              Some só quando o pedido já está fechado (recebido/cancelado)
              e nunca teve bonificação — nada de útil a mostrar ali. */}
          {(bonificados.length > 0 || (p.status !== "RECEBIDO" && p.status !== "CANCELADO")) && (
            <ItemSection
              icon={Gift}
              titulo="Bonificações"
              badge={<InfoTip texto="Itens bonificados entram no estoque, mas não geram custo nem somam no valor financeiro do pedido." />}
              resumo={
                bonificados.length > 0
                  ? `${bonificados.length} ${bonificados.length === 1 ? "item" : "itens"} • ${fmtQtd(bonificados.reduce((a, it) => a + it.qtdPedida * it.fatorConversao, 0))} UN`
                  : "Nenhum item"
              }
              aberto={bonusAbertos}
              onToggle={() => setBonusAbertos((v) => !v)}
              acao={
                p.status !== "RECEBIDO" && p.status !== "CANCELADO" ? (
                  <button
                    type="button"
                    disabled={!podeBonificar}
                    onClick={() => setBonusOpen(true)}
                    title={podeBonificar ? undefined : "Disponível quando o fornecedor confirma o pedido ou durante o recebimento parcial."}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface"
                  >
                    <Plus size={12} /> Adicionar bonificação
                  </button>
                ) : null
              }
            >
              {bonificados.length > 0 ? (
                <TabelaItens itens={bonificados} bonus />
              ) : (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-muted">
                  Nenhuma bonificação neste pedido ainda.
                </p>
              )}
            </ItemSection>
          )}
        </div>
      )}

      {p && reenviar && (
        <ReenviarSheet
          pedido={{
            numero: p.numero,
            supplierId: p.supplierId,
            supplierNome: p.supplierNome,
            supplierTelefone: p.supplierTelefone,
            supplierEmail: p.supplierEmail,
            previsaoEntrega: p.previsaoEntrega,
            observacao: p.observacao,
            items: p.items.map((it) => ({
              productId: it.productId,
              nome: it.nome,
              packagingNome: it.packagingNome,
              qtdPedida: it.qtdPedida,
              custoUnitario: it.custoUnitario,
            })),
          }}
          empresa={empresa}
          onClose={() => setReenviar(false)}
        />
      )}

      {p && (
        <BonusItemSidePanel
          open={bonusOpen}
          onClose={() => setBonusOpen(false)}
          products={products}
          onAdd={adicionarBonificacao}
        />
      )}
    </Sheet>
  );
}

// ── Sheet de novo/editar pedido — fluxo de seleção ────────────
// Sem formulário grande: busca instantânea, toque para adicionar,
// stepper de quantidade e custo pré-preenchido pelo histórico. O
// próprio Sheet hospeda o form: topo (fornecedor/destino/busca) fica
// fixo, só a lista de itens rola, e o rodapé (observação/total/ações)
// fica sempre visível. "Enviar pedido" abre a escolha de canal — a
// criação do pedido só acontece depois de confirmado o canal.

type CartItem = {
  id: string; // chave client-side — permite o mesmo produto aparecer como COMPRA e como bonificação
  productId: string;
  packagingId: string | null; // unidade de compra (null = unidade)
  tipo: TipoItemPedido;
  motivoBonificacao: MotivoBonificacao | null;
  qtd: number; // na embalagem selecionada
  preco: string; // preço DA EMBALAGEM — string p/ digitação com vírgula. Sempre "0,00" quando tipo != COMPRA
  observacao: string;
};

let cartIdSeq = 0;
const novoCartId = () => `cart-${Date.now()}-${cartIdSeq++}`;

export function PedidoFormSheet({
  open,
  onClose,
  mode,
  pedido,
  formOptions,
  empresa,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  mode: "novo" | "editar";
  pedido?: PedidoView;
  formOptions: FormOptions;
  /** Nome do tenant — assina a mensagem ao fornecedor na escolha de canal. */
  empresa: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const { suppliers, sites, products } = formOptions;
  const buscaRef = useRef<HTMLInputElement>(null);

  const [supplierId, setSupplierId] = useState(pedido?.supplierId ?? "");
  const [siteId, setSiteId] = useState(pedido?.siteId ?? sites[0]?.id ?? "");
  const [previsao, setPrevisao] = useState(pedido?.previsaoEntrega ? pedido.previsaoEntrega.slice(0, 10) : "");
  const [observacao, setObservacao] = useState(pedido?.observacao ?? "");
  const [busca, setBusca] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [cart, setCart] = useState<CartItem[]>(
    pedido
      ? pedido.items.map((it) => ({
          id: it.id,
          productId: it.productId,
          packagingId: it.packagingId,
          tipo: it.tipo,
          motivoBonificacao: it.motivoBonificacao,
          qtd: it.qtdPedida,
          preco: moneyToMask(it.custoUnitario),
          observacao: it.observacao ?? "",
        }))
      : [],
  );
  const [pending, setPending] = useState<"rascunho" | "enviar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Escolha de canal (WhatsApp/e-mail/PDF/salvar) antes de criar+enviar o pedido novo.
  const [solicitar, setSolicitar] = useState<GrupoEnvio[] | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const observacaoRef = useRef<HTMLTextAreaElement>(null);

  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const compraCart = useMemo(() => cart.filter((c) => c.tipo === "COMPRA"), [cart]);
  const bonusCart = useMemo(() => cart.filter((c) => c.tipo !== "COMPRA"), [cart]);
  // "Já no pedido" só considera as linhas de COMPRA — o mesmo produto pode
  // ter uma linha comprada e outra bonificada, sem conflito.
  const noCart = useMemo(() => new Set(compraCart.map((c) => c.productId)), [compraCart]);

  // Busca instantânea — nome, SKU ou EAN (leitor de código de barras: bipar
  // preenche o EAN e o Enter adiciona o 1º resultado). Produtos do fornecedor
  // selecionado vêm primeiro.
  const resultados = useMemo(() => {
    if (!supplierId) return [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    const acha = products.filter((p) => `${p.nome} ${p.sku} ${p.ean ?? ""}`.toLowerCase().includes(termo));
    return [
      ...acha.filter((p) => p.supplierIds.includes(supplierId)),
      ...acha.filter((p) => !p.supplierIds.includes(supplierId)),
    ].slice(0, 8);
  }, [busca, products, supplierId]);

  function addProduto(prod: Product | undefined) {
    if (!prod) return;
    if (noCart.has(prod.id)) {
      // Já comprado no pedido → soma 1 na embalagem atual (em vez de ignorar).
      setCart((c) => c.map((it) => (it.productId === prod.id && it.tipo === "COMPRA" ? { ...it, qtd: it.qtd + 1 } : it)));
      setBusca("");
      setHighlighted(0);
      buscaRef.current?.focus();
      return;
    }
    const pkg = defaultPackaging(prod);
    setCart((c) => [
      ...c,
      { id: novoCartId(), productId: prod.id, packagingId: pkg?.id ?? null, tipo: "COMPRA", motivoBonificacao: null, qtd: 1, preco: precoSugerido(prod, pkg), observacao: "" },
    ]);
    setBusca("");
    setHighlighted(0);
    buscaRef.current?.focus();
  }

  function setItem(id: string, patch: Partial<CartItem>) {
    setCart((c) => c.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // Adiciona a lista vinda do painel de bonificação — sempre custo zero,
  // sempre linhas novas (nunca soma em item comprado existente).
  function addBonificacoes(itens: BonusDraftItem[]) {
    setCart((c) => [
      ...c,
      ...itens.map((it) => ({
        id: novoCartId(),
        productId: it.productId,
        packagingId: it.packagingId,
        tipo: "BONIFICACAO" as TipoItemPedido,
        motivoBonificacao: it.motivo,
        qtd: it.qtd,
        preco: "0,00",
        observacao: it.observacao,
      })),
    ]);
  }

  // Remoção com desfazer — o item some na hora, mas fica 5s recuperável.
  const [desfazer, setDesfazer] = useState<{ item: CartItem; nome: string; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function removeItem(id: string) {
    const index = cart.findIndex((it) => it.id === id);
    if (index < 0) return;
    const item = cart[index];
    setCart((c) => c.filter((it) => it.id !== id));
    setDesfazer({ item, nome: prodMap.get(item.productId)?.nome ?? "Item", index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDesfazer(null), 5000);
  }

  function desfazerRemocao() {
    if (!desfazer) return;
    const { item, index } = desfazer;
    setCart((c) => {
      const novo = [...c];
      novo.splice(Math.min(index, novo.length), 0, item);
      return novo;
    });
    setDesfazer(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  const num = (s: string) => parseMoney(s) ?? 0;
  const fatorDe = (it: CartItem) => {
    const prod = prodMap.get(it.productId);
    if (!prod || !it.packagingId) return 1;
    return prod.packagings.find((pk) => pk.id === it.packagingId)?.fatorConversao ?? 1;
  };
  const total = cart.reduce((acc, it) => acc + it.qtd * num(it.preco), 0);
  const totalUnidades = cart.reduce((acc, it) => acc + it.qtd * fatorDe(it), 0);
  const valido = supplierId && siteId && cart.some((it) => it.qtd > 0);
  const compraQtd = compraCart.filter((it) => it.qtd > 0).length;
  const bonusQtd = bonusCart.filter((it) => it.qtd > 0).length;

  // Pedido mínimo do fornecedor — barra de progresso no rodapé quando cadastrado.
  const fornecedorSel = suppliers.find((s) => s.id === supplierId) ?? null;
  const pedidoMinimo = fornecedorSel?.pedidoMinimo != null && fornecedorSel.pedidoMinimo > 0 ? fornecedorSel.pedidoMinimo : null;
  const faltaMinimo = pedidoMinimo != null ? Math.max(0, pedidoMinimo - total) : 0;

  async function salvarRascunho() {
    if (!valido) return;
    setPending("rascunho");
    setErro(null);
    const items = cart
      .filter((it) => it.qtd > 0)
      .map((it) => ({
        productId: it.productId,
        packagingId: it.packagingId,
        tipo: it.tipo,
        motivoBonificacao: it.tipo !== "COMPRA" ? it.motivoBonificacao : null,
        qtdPedida: it.qtd,
        custoUnitario: it.tipo === "COMPRA" ? num(it.preco) : 0,
        observacao: it.observacao.trim() || null,
      }));
    const payload = { siteId, supplierId, previsaoEntrega: previsao || null, observacao: observacao || null, items };
    try {
      if (mode === "editar" && pedido) {
        await atualizarPedidoCompraAction(pedido.id, payload);
      } else {
        await criarPedidoCompraAction(payload, false);
      }
      onDone();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar o pedido.");
      setPending(null);
    }
  }

  // "Enviar pedido" não cria nada direto: monta o grupo (1 fornecedor)
  // e abre a mesma escolha de canal da Reposição — a criação acontece
  // só depois de confirmado o canal (ou "salvar para depois").
  function abrirEnvio() {
    if (!valido) return;
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) return;
    const itens = cart
      .filter((it) => it.qtd > 0)
      .map((it) => {
        const prod = prodMap.get(it.productId);
        const pkg = prod?.packagings.find((pk) => pk.id === it.packagingId) ?? null;
        return {
          productId: it.productId,
          packagingId: it.packagingId,
          nome: prod?.nome ?? "",
          qtd: it.qtd,
          packagingNome: pkg?.nome ?? null,
          fatorConversao: pkg ? pkg.fatorConversao : 1,
          custoUnitCompra: num(it.preco),
          observacao: it.observacao.trim() || null,
        };
      });
    if (itens.length === 0) return;
    setErro(null);
    setSolicitar([
      {
        supplierId: supplier.id,
        supplierNome: supplierLabel(supplier),
        telefone: supplier.telefone,
        email: supplier.email,
        leadTimeDias: null,
        previsaoEntrega: previsao || null,
        observacao: observacao || null,
        itens,
      },
    ]);
  }

  function fecharSolicitar() {
    setSolicitar(null);
    if (concluido) {
      onDone();
      router.refresh();
    }
  }

  const selectCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "editar" ? `Editar ${pedido?.numero}` : "Novo pedido de compra"}
      description="Busque, toque para adicionar e ajuste a quantidade. A entrada no estoque acontece no recebimento."
      width="4xl"
      footer={
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Observação
            <textarea ref={observacaoRef} value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={1} placeholder="Condições, prazo de pagamento, etc." className={cn(selectCls, "resize-none")} />
          </label>

          {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}

          {desfazer && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-muted">
                <strong className="font-medium text-ink">{desfazer.nome}</strong> removido do pedido.
              </span>
              <button type="button" onClick={desfazerRemocao} className="shrink-0 font-semibold text-brand hover:underline">
                Desfazer
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-sm text-muted">
                <span className="tabular-nums">
                  {compraQtd} {compraQtd === 1 ? "produto comprado" : "produtos comprados"}
                  {bonusQtd > 0 && (
                    <span className="text-violet"> · {bonusQtd} {bonusQtd === 1 ? "bonificação" : "bonificações"}</span>
                  )}
                  {" "}· {compraQtd + bonusQtd} itens totais · {fmtQtd(totalUnidades)} UN no estoque ·
                </span>{" "}
                <span className="font-display text-lg font-semibold tabular-nums text-ink">{fmtMoney(total)}</span>
              </div>
              {pedidoMinimo != null && (
                <div className="flex items-center gap-2">
                  <div className="h-1 w-36 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full transition-[width]", faltaMinimo > 0 ? "bg-warn" : "bg-ok")}
                      style={{ width: `${Math.min(100, (total / pedidoMinimo) * 100)}%` }}
                    />
                  </div>
                  <p className={cn("text-[11px] tabular-nums", faltaMinimo > 0 ? "text-warn" : "text-ok")}>
                    {faltaMinimo > 0
                      ? `Faltam ${fmtMoney(faltaMinimo)} para o mínimo de ${fmtMoney(pedidoMinimo)}`
                      : `Pedido mínimo de ${fmtMoney(pedidoMinimo)} atingido`}
                  </p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!valido || pending !== null}
                onClick={salvarRascunho}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {pending === "rascunho" ? <Loader2 size={15} className="animate-spin" /> : <Pencil size={15} className="text-muted" />}
                {mode === "editar" ? "Salvar" : "Salvar rascunho"}
              </button>
              {mode === "novo" && (
                <button
                  type="button"
                  disabled={!valido || pending !== null}
                  onClick={abrirEnvio}
                  className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
                >
                  <Send size={15} />
                  Enviar pedido
                </button>
              )}
            </div>
          </div>
        </div>
      }
    >
      {/* Cabeçalho do pedido + busca — fixo no topo da área de rolagem */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex flex-col gap-3 border-b border-line bg-surface px-5 pt-4 pb-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            <span className="flex items-center gap-1"><Building2 size={12} /> Fornecedor</span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={cart.length > 0}
              className={cn(selectCls, cart.length > 0 && "cursor-not-allowed opacity-60")}
            >
              <option value="">Selecione…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{supplierLabel(s)}</option>
              ))}
            </select>
            {cart.length > 0 && (
              <span className="text-[11px] font-normal normal-case text-faint">Remova os itens para trocar de fornecedor.</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            <span className="flex items-center gap-1"><Store size={12} /> Destino</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={selectCls}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}{s.tipo === "CD" ? " (CD)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            <span className="flex items-center gap-1"><CalendarClock size={12} /> Previsão de entrega</span>
            <input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={selectCls} />
          </label>
        </div>

        {/* Busca instantânea — setas navegam, Enter escolhe o item destacado */}
        <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-3 text-faint" />
          <input
            ref={buscaRef}
            value={busca}
            disabled={!supplierId}
            onChange={(e) => {
              setBusca(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (resultados.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, resultados.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                addProduto(resultados[highlighted] ?? resultados[0]);
              }
            }}
            placeholder={supplierId ? "Buscar por nome, SKU ou EAN… (setas + Enter adicionam · Del remove item)" : "Selecione um fornecedor para buscar produtos…"}
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:cursor-not-allowed disabled:bg-surface-2/60 disabled:opacity-70"
          />
          {resultados.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
              {resultados.map((p, i) => {
                const ja = noCart.has(p.id);
                const doFornecedor = supplierId && p.supplierIds.includes(supplierId);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduto(p)}
                      onMouseEnter={() => setHighlighted(i)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-surface-2",
                        i === highlighted && "bg-brand-soft/50",
                      )}
                    >
                      <Thumb url={p.imagemUrl} nome={p.nome} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
                        <p className="font-mono text-[11px] text-faint">{p.sku}</p>
                      </div>
                      {ja ? (
                        <span className="shrink-0 text-[11px] font-medium text-ok">no pedido · +1</span>
                      ) : doFornecedor ? (
                        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">deste fornecedor</span>
                      ) : (
                        <Plus size={15} className="shrink-0 text-faint" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Menu
          trigger={
            <button
              type="button"
              disabled={!supplierId}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={15} className="text-muted" />
              Adicionar produto
              <ChevronDown size={13} className="text-muted" />
            </button>
          }
        >
          <MenuItem icon={<Gift size={14} />} onClick={() => setBonusOpen(true)}>
            Adicionar bonificação
          </MenuItem>
          <MenuItem icon={<MessageSquarePlus size={14} />} onClick={() => observacaoRef.current?.focus()}>
            Adicionar observação
          </MenuItem>
          <MenuItem icon={<Truck size={14} />} disabled trailing={<span className="text-[10px] text-faint">futuro</span>}>
            Adicionar frete
          </MenuItem>
        </Menu>
        </div>
      </div>

      {/* Itens do pedido — única área que rola */}
      <div className="pt-3">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
            <ShoppingCart size={24} className="text-faint" />
            <p className="text-sm text-muted">
              {supplierId ? "Busque um produto acima para começar o pedido." : "Selecione um fornecedor para começar a incluir produtos."}
            </p>
          </div>
        ) : (
          <>
            {compraCart.length > 0 && (
              <>
                <PurchaseListHeader />
                <ul className="flex flex-col gap-1.5">
                  {compraCart.map((it) => {
                    const prod = prodMap.get(it.productId);
                    if (!prod) return null;
                    // Referências do fornecedor selecionado (fallback: qualquer fornecedor).
                    const ultimo = prod.ultimosPrecos.find((u) => u.supplierId === supplierId) ?? prod.ultimosPrecos[0] ?? null;
                    const pend = prod.pendentes.find((pd) => (!supplierId || pd.supplierId === supplierId) && pd.poId !== pedido?.id);
                    return (
                      <PurchaseItemCard
                        key={it.id}
                        product={prod}
                        value={it}
                        onChange={(patch) => setItem(it.id, patch)}
                        onRemove={() => removeItem(it.id)}
                        estoqueDisponivel={siteId ? (prod.estoquePorSite[siteId] ?? 0) : null}
                        ultimoPreco={ultimo}
                        avisoPendente={
                          pend ? `Já a caminho: ${fmtQtd(pend.qtd)} × ${pend.packagingNome ?? "un"} no ${pend.numero}` : null
                        }
                      />
                    );
                  })}
                </ul>
              </>
            )}

            {/* Bonificações — sempre em lista separada, nunca misturada com produtos comprados */}
            {bonusCart.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet">
                  <span className="h-px flex-1 bg-violet/25" />
                  <Gift size={12} /> Bonificações
                  <span className="h-px flex-1 bg-violet/25" />
                </div>
                <BonusListHeader />
                <ul className="flex flex-col gap-1.5">
                  {bonusCart.map((it) => {
                    const prod = prodMap.get(it.productId);
                    if (!prod) return null;
                    return (
                      <BonusItemCard
                        key={it.id}
                        product={prod}
                        value={{ id: it.id, productId: it.productId, packagingId: it.packagingId, qtd: it.qtd, motivo: it.motivoBonificacao, observacao: it.observacao }}
                        onChange={(patch) => {
                          const { motivo, ...resto } = patch;
                          setItem(it.id, { ...resto, ...(motivo !== undefined ? { motivoBonificacao: motivo } : {}) });
                        }}
                        onRemove={() => removeItem(it.id)}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* Painel de bonificação — fluxo próprio, nunca um checkbox no item */}
      <BonusItemSidePanel
        open={bonusOpen}
        onClose={() => setBonusOpen(false)}
        products={products}
        onAdd={addBonificacoes}
      />

      {/* Escolha de canal — só ao "Enviar pedido" (mode novo) */}
      {solicitar && (
        <SolicitarSheet
          grupos={solicitar}
          empresa={empresa}
          siteId={siteId}
          onClose={fecharSolicitar}
          onConcluido={() => setConcluido(true)}
        />
      )}
    </Sheet>
  );
}

// ── Painel de acompanhamento do pedido — timeline, assistente e itens ──
// Helpers puros usados só pelo PedidoDrawer: nenhum acesso a rede/estado
// global, só leitura de PedidoView. Mantidos fora do componente porque
// não fecham sobre nada além dos props recebidos.

type StepKey = "criado" | "enviado" | "confirmado" | "transito" | "recebido";

type PedidoStep = {
  key: StepKey;
  label: string;
  icon: React.ElementType;
  quando: string | null;
  state: "done" | "current" | "future";
};

/** Posição de cada status no fluxo linear — usada só para decidir se uma
 *  etapa da timeline já foi ultrapassada quando o pedido "pulou" direto
 *  (ex.: recebido sem ter passado por "em trânsito" explicitamente). */
const ORDEM_STATUS: Record<string, number> = {
  RASCUNHO: 0,
  ENVIADO: 1,
  AGUARDANDO: 2,
  EM_TRANSITO: 3,
  RECEBIDO_PARCIAL: 4,
  RECEBIDO: 5,
  CANCELADO: -1,
};

function pedidoSteps(p: PedidoView): PedidoStep[] {
  const cancelado = p.status === "CANCELADO";
  const ordem = ORDEM_STATUS[p.status] ?? 0;
  const base: { key: StepKey; label: string; icon: React.ElementType; quando: string | null; limiar: number }[] = [
    { key: "criado", label: "Pedido criado", icon: FilePenLine, quando: p.createdAt, limiar: 0 },
    { key: "enviado", label: "Enviado", icon: Send, quando: p.enviadoEm, limiar: 1 },
    { key: "confirmado", label: "Confirmado", icon: CircleCheck, quando: p.confirmadoEm, limiar: 2 },
    { key: "transito", label: "Em trânsito", icon: Truck, quando: p.emTransitoEm, limiar: 3 },
    { key: "recebido", label: "Recebido", icon: PackageCheck, quando: p.recebidoEm, limiar: 5 },
  ];
  let currentSet = false;
  return base.map((s) => {
    // Cancelado: só o que de fato tem timestamp conta como concluído —
    // não dá pra inferir posição no fluxo depois de um cancelamento.
    const done = cancelado ? !!s.quando : ordem >= s.limiar;
    let state: PedidoStep["state"] = done ? "done" : "future";
    if (!done && !cancelado && !currentSet) {
      state = "current";
      currentSet = true;
    }
    return { key: s.key, label: s.label, icon: s.icon, quando: s.quando, state };
  });
}

function stepDetalhe(step: PedidoStep, p: PedidoView): string {
  if (step.state === "done") {
    const base = step.quando ? `Concluído ${relDiaHora(step.quando)}.` : "Concluído.";
    return step.key === "criado" && p.operador ? `${base} Por ${p.operador}.` : base;
  }
  if (step.state === "current") {
    switch (step.key) {
      case "enviado":
        return "Aguardando envio ao fornecedor.";
      case "confirmado":
        return "Aguardando confirmação do fornecedor.";
      case "transito":
        return "Aguardando início do transporte.";
      case "recebido":
        return p.status === "RECEBIDO_PARCIAL"
          ? "Recebimento parcial registrado — aguardando o restante da mercadoria."
          : "Aguardando chegada da mercadoria.";
      default:
        return "Em andamento.";
    }
  }
  return "Ainda não iniciada.";
}

function assistenteMensagem(p: PedidoView, etapaAtual: PedidoStep | undefined): { icon: React.ElementType; texto: string; tom: "brand" | "ok" | "danger" } {
  if (p.status === "CANCELADO") {
    return {
      icon: CircleX,
      tom: "danger",
      texto: p.canceladoEm ? `Pedido cancelado ${relDiaHora(p.canceladoEm)}. Nenhuma ação pendente.` : "Pedido cancelado. Nenhuma ação pendente.",
    };
  }
  if (p.status === "RECEBIDO") {
    return { icon: CircleCheck, tom: "ok", texto: "Pedido concluído — mercadoria lançada no estoque." };
  }
  const textos: Record<string, string> = {
    RASCUNHO: "Pedido em rascunho. Envie ao fornecedor quando estiver pronto, usando “Enviar pedido”.",
    ENVIADO: "Pedido enviado ao fornecedor. Assim que ele confirmar o recebimento do pedido, marque como “Confirmado”.",
    AGUARDANDO: "Pedido confirmado. A próxima etapa será marcar este pedido como “Em trânsito” quando o fornecedor informar o envio.",
    EM_TRANSITO: "Pedido em trânsito. Quando a mercadoria chegar, utilize “Receber mercadoria” para conferir os itens e gerar a entrada no estoque.",
    RECEBIDO_PARCIAL: "Recebimento parcial registrado. Utilize “Conferir recebimento” para lançar o restante assim que chegar.",
  };
  return { icon: etapaAtual?.icon ?? Sparkles, tom: "brand", texto: textos[p.status] ?? "Acompanhe o andamento do pedido pela linha do tempo." };
}

function PedidoTimeline({
  steps,
  pedido,
  aberto,
  onToggle,
}: {
  steps: PedidoStep[];
  pedido: PedidoView;
  aberto: StepKey | null;
  onToggle: (k: StepKey | null) => void;
}) {
  const selecionado = steps.find((s) => s.key === aberto) ?? null;
  return (
    <div className="flex flex-col gap-2">
      {/* overflow-x-auto: em telas estreitas os nós mantêm a largura mínima
          e a linha rola, em vez de espremer rótulo/hora até virar sopa */}
      <div className="-mx-1 overflow-x-auto px-1 pt-2 pb-0.5">
        <ol className="flex">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isOpen = aberto === s.key;
            return (
              <li key={s.key} className="relative flex min-w-[84px] flex-1 flex-col items-center gap-1.5 px-1 text-center">
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn("absolute top-4 left-1/2 h-px w-full", s.state === "done" ? "bg-brand" : "bg-line")}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onToggle(isOpen ? null : s.key)}
                  aria-label={`${s.label} — ${stepDetalhe(s, pedido)}`}
                  className={cn(
                    "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-shadow",
                    // Concluída: preenchida sólida. Atual: contorno + anel — nunca a
                    // mesma cor sólida da concluída, senão fica impossível distinguir.
                    s.state === "done" && "bg-brand text-on-brand",
                    s.state === "current" && "border-2 border-brand bg-surface text-brand ring-4 ring-brand/15",
                    s.state === "future" && "border border-line bg-surface text-faint",
                    isOpen && "ring-2 ring-offset-2 ring-offset-surface ring-ink/20",
                  )}
                >
                  {s.state === "done" ? <Check size={15} /> : <Icon size={13} />}
                </button>
                <span className={cn("text-xs font-medium", s.state === "future" ? "text-faint" : "text-ink")}>{s.label}</span>
                <span className={cn("text-[11px] tabular-nums", s.state === "current" ? "font-medium text-brand" : "text-faint")}>
                  {s.quando
                    ? relDiaHora(s.quando)
                    : s.state === "done"
                      ? "Concluído"
                      : s.state === "current"
                        ? "Em andamento"
                        : "Aguardando"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {selecionado && (
        <div className="rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-ink-2">
          <strong className="font-medium text-ink">{selecionado.label}.</strong> {stepDetalhe(selecionado, pedido)}
        </div>
      )}
    </div>
  );
}

function AssistenteContextual({ pedido, steps }: { pedido: PedidoView; steps: PedidoStep[] }) {
  const etapaAtual = steps.find((s) => s.state === "current");
  const { icon: Icon, texto, tom } = assistenteMensagem(pedido, etapaAtual);
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        tom === "danger" && "border-danger/25 bg-danger-soft/60 text-danger",
        tom === "ok" && "border-ok/25 bg-ok-soft/60 text-ok",
        tom === "brand" && "border-line bg-surface-2/60 text-ink-2",
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <p>{texto}</p>
    </div>
  );
}

function ResumoCampo({ label, valor, full }: { label: string; valor: string; full?: boolean }) {
  return (
    <div className={full ? "basis-full" : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className="text-sm text-ink">{valor}</p>
    </div>
  );
}

function InfoTip({ texto }: { texto: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <Info size={13} className="cursor-help text-faint" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-[11px] leading-snug text-surface opacity-0 shadow-(--shadow-2) transition-opacity group-hover/tip:opacity-100"
      >
        {texto}
      </span>
    </span>
  );
}

/** Seção expansível — mesmo padrão para "Produtos comprados" e "Bonificações": título + resumo ao lado, sem cards. */
function ItemSection({
  icon: Icon,
  titulo,
  resumo,
  aberto,
  onToggle,
  acao,
  badge,
  children,
}: {
  icon: React.ElementType;
  titulo: string;
  resumo: string;
  aberto: boolean;
  onToggle: () => void;
  acao?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon size={15} className="text-muted" />
          {titulo}
          {badge}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted">{resumo}</span>
          {acao}
          <button
            type="button"
            onClick={onToggle}
            aria-label={aberto ? `Recolher ${titulo}` : `Expandir ${titulo}`}
            aria-expanded={aberto}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronDown size={15} className={cn("transition-transform", !aberto && "-rotate-90")} />
          </button>
        </div>
      </div>
      {aberto && children}
    </div>
  );
}

/** Tabela de itens (comprados ou bonificados). */
function TabelaItens({ itens, bonus = false }: { itens: ItemView[]; bonus?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
            <th className="px-3 py-2">Produto</th>
            <th className="px-3 py-2 text-right">{bonus ? "Quantidade" : "Compra"}</th>
            <th className="px-3 py-2 text-right">Entrada</th>
            {!bonus && <th className="px-3 py-2 text-right">Preço</th>}
            {!bonus && <th className="px-3 py-2 text-right">Subtotal</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {itens.map((it) => {
            const emb = it.packagingNome
              ? `${it.packagingNome}${it.fatorConversao !== 1 ? ` c/${fmtQtd(it.fatorConversao)}` : ""}`
              : "un";
            return (
              <tr key={it.id}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <Thumb url={it.imagemUrl} nome={it.nome} size={32} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{it.nome}</p>
                      <p className="truncate font-mono text-[11px] text-faint">{it.sku}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {fmtQtd(it.qtdPedida)} × {emb}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtQtd(it.qtdPedida * it.fatorConversao)} UN</td>
                {!bonus && <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtMoney(it.custoUnitario)}</td>}
                {!bonus && (
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{fmtMoney(it.qtdPedida * it.custoUnitario)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Botão de ação do rodapé fixo — ícone + cor coerente com o tom + tooltip nativo. */
function AcaoBtn({
  icon: Icon,
  label,
  tooltip,
  tone = "secondary",
  onClick,
  disabled,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  tooltip: string;
  tone?: "primary" | "secondary" | "danger";
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
        tone === "primary" && "bg-brand text-on-brand hover:bg-brand-strong",
        tone === "secondary" && "border border-line bg-surface font-medium text-ink hover:bg-surface-2",
        tone === "danger" && "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} className={tone === "secondary" ? "text-muted" : undefined} />}
      {label}
    </button>
  );
}
