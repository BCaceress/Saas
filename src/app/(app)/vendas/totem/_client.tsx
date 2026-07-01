"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, Trash2, Loader2, ShoppingCart, QrCode, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { criarVendaTotemAction, confirmarPagamentoTotemAction } from "../actions";
import type { ProdutoVenda } from "../_data";
import type { PaymentMethod } from "@/generated/prisma";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type CartItem = {
  key: string; productId: string; variantId: string | null;
  nome: string; variantNome: string | null; preco: number; quantidade: number; restricaoIdade: boolean;
};

type Etapa = "compra" | "idade" | "pagamento" | "confirmado";

export function TotemClient({
  siteId,
  produtos,
  metodosAtivos,
  tenantNome,
  controleIdade,
}: {
  siteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  tenantNome: string;
  controleIdade: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [etapa, setEtapa] = useState<Etapa>("compra");
  const [saleId, setSaleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q
      ? produtos.filter((p) => p.nome.toLowerCase().includes(q) || (p.ean ?? "").includes(q))
      : produtos;
    return base.slice(0, 48);
  }, [busca, produtos]);

  const total = cart.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const precisaIdade = controleIdade && cart.some((i) => i.restricaoIdade);
  const metodo: PaymentMethod = metodosAtivos.includes("PIX") ? "PIX" : metodosAtivos[0] ?? "PIX";

  function add(p: ProdutoVenda, variantId: string | null) {
    const variant = variantId ? p.variants.find((v) => v.id === variantId) ?? null : null;
    const key = p.id + ":" + (variantId ?? "");
    setCart((prev) => {
      const ex = prev.find((i) => i.key === key);
      if (ex) return prev.map((i) => (i.key === key ? { ...i, quantidade: i.quantidade + 1 } : i));
      return [...prev, {
        key, productId: p.id, variantId, nome: p.nome,
        variantNome: variant?.nome ?? null, preco: variant?.preco ?? p.preco,
        quantidade: 1, restricaoIdade: p.restricaoIdade,
      }];
    });
  }
  function setQtd(key: string, q: number) {
    if (q <= 0) return setCart((prev) => prev.filter((i) => i.key !== key));
    setCart((prev) => prev.map((i) => (i.key === key ? { ...i, quantidade: q } : i)));
  }

  function irPagar() {
    if (precisaIdade) { setEtapa("idade"); return; }
    criarVenda(true);
  }

  function criarVenda(maiorIdade: boolean) {
    setError(null);
    if (!siteId) { setError("Site não configurado."); return; }
    startTransition(async () => {
      try {
        const id = await criarVendaTotemAction({
          siteId, origem: "TOTEM",
          items: cart.map((i) => ({ productId: i.productId, variantId: i.variantId, quantidade: i.quantidade })),
          maiorIdadeConfirmada: maiorIdade,
          metodo: (metodo === "DINHEIRO" ? "PIX" : metodo) as "PIX" | "CARTAO_CREDITO" | "CARTAO_DEBITO",
        });
        setSaleId(id);
        setEtapa("pagamento");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao iniciar pagamento.");
        setEtapa("compra");
      }
    });
  }

  function confirmarPagamento() {
    if (!saleId) return;
    setError(null);
    startTransition(async () => {
      try {
        await confirmarPagamentoTotemAction(saleId);
        toast.success("Venda concluída com sucesso!", `${brl(total)}`);
        setEtapa("confirmado");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao confirmar pagamento.");
      }
    });
  }

  function reiniciar() {
    setCart([]); setSaleId(null); setError(null); setEtapa("compra");
    router.refresh();
  }

  // ── Telas de checkout (alvos grandes, alto contraste) ──
  if (etapa === "idade") {
    return (
      <Tela>
        <h2 className="font-display text-3xl font-bold text-ink">Confirmação de idade</h2>
        <p className="text-lg text-muted">Há itens com restrição +18. Confirme que você é maior de idade.</p>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex w-full max-w-md flex-col gap-3">
          <button onClick={() => criarVenda(true)} disabled={pending}
            className="rounded-2xl bg-brand px-6 py-5 text-xl font-bold text-on-brand hover:bg-brand-strong disabled:opacity-50">
            {pending ? "Aguarde…" : "Sou maior de 18 anos"}
          </button>
          <button onClick={() => setEtapa("compra")} className="rounded-2xl border border-line px-6 py-4 text-lg text-ink hover:bg-surface-2">
            Voltar
          </button>
        </div>
      </Tela>
    );
  }

  if (etapa === "pagamento") {
    return (
      <Tela>
        <h2 className="font-display text-3xl font-bold text-ink">Pague com Pix</h2>
        <div className="grid h-56 w-56 place-items-center rounded-3xl border-4 border-dashed border-line bg-surface-2 text-faint">
          <QrCode size={120} />
        </div>
        <p className="font-display text-4xl font-bold tabular-nums text-brand">{brl(total)}</p>
        <p className="text-lg text-muted">Aponte a câmera para o QR e confirme o pagamento.</p>
        {error && <p className="text-danger">{error}</p>}
        <button onClick={confirmarPagamento} disabled={pending}
          className="flex items-center gap-2 rounded-2xl bg-brand px-8 py-5 text-xl font-bold text-on-brand hover:bg-brand-strong disabled:opacity-50">
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Já paguei
        </button>
      </Tela>
    );
  }

  if (etapa === "confirmado") {
    return (
      <Tela>
        <span className="grid h-24 w-24 place-items-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 size={56} />
        </span>
        <h2 className="font-display text-3xl font-bold text-ink">Pagamento confirmado!</h2>
        <p className="text-lg text-muted">Retire seus itens. Obrigado por comprar na {tenantNome}.</p>
        <button onClick={reiniciar}
          className="rounded-2xl bg-brand px-8 py-5 text-xl font-bold text-on-brand hover:bg-brand-strong">
          Nova compra
        </button>
      </Tela>
    );
  }

  // ── Tela de compra ──
  return (
    <div className="grid min-h-[calc(100dvh-2rem)] gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto…"
          className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-lg text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtrados.map((p) => {
            const semEstoque = p.estoqueFechado != null && p.estoqueFechado <= 0;
            return (
              <button key={p.id} onClick={() => add(p, p.variants[0]?.id ?? null)} disabled={semEstoque}
                className={cn(
                  "flex min-h-32 flex-col gap-1 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand hover:bg-brand-soft disabled:opacity-40",
                )}>
                <span className="line-clamp-2 text-base font-semibold leading-tight text-ink">{p.nome}</span>
                {p.restricaoIdade && <span className="text-xs font-bold text-danger">+18</span>}
                <span className="mt-auto font-display text-xl font-bold text-brand">
                  {brl(p.variants[0]?.preco ?? p.preco)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Carrinho touch */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-3 lg:h-fit">
        <div className="flex items-center gap-2 text-lg font-bold text-ink">
          <ShoppingCart size={20} /> Sua compra
        </div>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="py-10 text-center text-muted">Toque nos produtos para adicionar.</p>
          ) : cart.map((i) => (
            <div key={i.key} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{i.nome}{i.variantNome && ` · ${i.variantNome}`}</p>
                <p className="font-mono text-sm text-muted">{brl(i.preco)}</p>
              </div>
              <button onClick={() => setQtd(i.key, i.quantidade - 1)} className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink"><Minus size={18} /></button>
              <span className="w-8 text-center font-mono text-lg tabular-nums">{i.quantidade}</span>
              <button onClick={() => setQtd(i.key, i.quantidade + 1)} className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink"><Plus size={18} /></button>
              <button onClick={() => setQtd(i.key, 0)} className="text-faint hover:text-danger"><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-ink">Total</span>
            <span className="font-display text-3xl font-bold tabular-nums text-brand">{brl(total)}</span>
          </div>
        </div>
        {error && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-danger">{error}</p>}
        <button onClick={irPagar} disabled={cart.length === 0 || pending}
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand px-6 py-5 text-xl font-bold text-on-brand hover:bg-brand-strong disabled:opacity-50">
          {pending ? <Loader2 className="animate-spin" /> : null} Pagar
        </button>
      </div>
    </div>
  );
}

function Tela({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col items-center justify-center gap-6 text-center">
      {children}
    </div>
  );
}
