"use client";

// ── Sidepanel "Adicionar à compra" — compra 100% manual ────────
// O operador escolhe exatamente o que comprar: quais produtos entram
// (checkbox), de qual fornecedor, quanto e por qual valor. Nenhuma
// quantidade é sugerida e nenhuma decisão é tomada pelo sistema — a
// inteligência de reposição vive exclusivamente em Reposições (/compras).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShoppingCart, CheckCircle2, ArrowRight, Building2, Store } from "lucide-react";
import { cn, maskMoney, parseMoney, moneyToMask } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { loadComprasFormOptionsAction } from "../actions";
import { criarPedidosReposicaoAction } from "../../compras/actions";
import { fmtMoney, fmtQtd, Thumb } from "../../compras/_ui";

type Options = Awaited<ReturnType<typeof loadComprasFormOptionsAction>>;
type Produto = Options["products"][number];
type Supplier = Options["suppliers"][number];

const supplierLabel = (s: Supplier) => s.nomeFantasia ?? s.razaoSocial;

type Linha = {
  productId: string;
  checked: boolean;
  supplierId: string;
  qtd: string;   // digitação livre (vírgula)
  custo: string; // máscara monetária
};

export function AdicionarCompraSheet({
  open,
  produtoIds,
  siteId,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Produtos que o operador mandou para a compra (1 ou vários). */
  produtoIds: string[];
  siteId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [destinoId, setDestinoId] = useState(siteId ?? "");
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criados, setCriados] = useState<{ numero: string }[] | null>(null);

  // Opções carregadas sob demanda ao abrir — catálogo/fornecedores não
  // pesam no load da página de Estoque.
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    loadComprasFormOptionsAction().then((opts) => {
      if (!vivo) return;
      setOptions(opts);
      setDestinoId((cur) => cur || siteId || opts.sites[0]?.id || "");
      setLinhas(
        produtoIds.flatMap((id) => {
          const prod = opts.products.find((p) => p.id === id);
          if (!prod) return []; // fora do catálogo comprável (tipo não estocável/inativo)
          return [{
            productId: id,
            checked: true,
            // Pré-seleciona só quando o cadastro tem UM fornecedor vinculado —
            // com mais de um (ou nenhum), a escolha é do operador.
            supplierId: prod.supplierIds.length === 1 ? prod.supplierIds[0] : "",
            qtd: "1",
            custo: prod.custoMedio != null ? moneyToMask(custoPadrao(prod)) : "",
          }];
        }),
      );
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const prodMap = useMemo(
    () => new Map((options?.products ?? []).map((p) => [p.id, p])),
    [options],
  );

  function setLinha(productId: string, patch: Partial<Linha>) {
    setLinhas((ls) => (ls ?? []).map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  const num = (s: string) => parseMoney(s) ?? 0;
  const qtdNum = (s: string) => {
    const v = Number(s.replace(",", "."));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };

  const marcadas = (linhas ?? []).filter((l) => l.checked);
  const totalQtd = marcadas.reduce((acc, l) => acc + qtdNum(l.qtd), 0);
  const totalValor = marcadas.reduce((acc, l) => acc + qtdNum(l.qtd) * num(l.custo), 0);
  const semFornecedor = marcadas.filter((l) => !l.supplierId).length;
  const semQtd = marcadas.filter((l) => qtdNum(l.qtd) <= 0).length;
  const fornecedoresDistintos = new Set(marcadas.map((l) => l.supplierId).filter(Boolean)).size;
  const valido = destinoId !== "" && marcadas.length > 0 && semFornecedor === 0 && semQtd === 0 && !pending;

  async function criarPedidos() {
    if (!valido) return;
    setPending(true);
    setErro(null);
    // Um pedido por fornecedor escolhido — exigência do modelo (pedido tem
    // um fornecedor), não decisão do sistema.
    const porFornecedor = new Map<string, typeof marcadas>();
    for (const l of marcadas) {
      const g = porFornecedor.get(l.supplierId) ?? [];
      g.push(l);
      porFornecedor.set(l.supplierId, g);
    }
    try {
      const res = await criarPedidosReposicaoAction({
        siteId: destinoId,
        enviar: false, // nasce RASCUNHO — o envio acontece em Reposições
        pedidos: [...porFornecedor.entries()].map(([supplierId, itens]) => ({
          supplierId,
          items: itens.map((l) => {
            const prod = prodMap.get(l.productId);
            const padrao = prod?.packagings.find((pk) => pk.isCompraDefault) ?? null;
            return {
              productId: l.productId,
              packagingId: padrao?.id ?? null,
              qtdPedida: qtdNum(l.qtd),
              custoUnitario: num(l.custo),
            };
          }),
        })),
      });
      setCriados(res.map((r) => ({ numero: r.numero })));
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao criar o pedido.");
    } finally {
      setPending(false);
    }
  }

  function fechar() {
    setCriados(null);
    setLinhas(null);
    setOptions(null);
    setErro(null);
    if (criados) onDone();
    else onClose();
  }

  const inputCls =
    "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

  return (
    <Sheet
      open={open}
      onClose={fechar}
      title="Adicionar à compra"
      description="Escolha os produtos, o fornecedor, a quantidade e o valor. Nada é sugerido automaticamente."
      width="2xl"
      footer={
        criados ? undefined : (
          <div className="flex flex-col gap-3">
            {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}
            {!erro && marcadas.length > 0 && (semFornecedor > 0 || semQtd > 0) && (
              <p className="text-xs text-muted">
                {semFornecedor > 0
                  ? `${semFornecedor} ${semFornecedor === 1 ? "item precisa" : "itens precisam"} de fornecedor.`
                  : "Informe uma quantidade maior que zero em todos os itens."}
              </p>
            )}
            {fornecedoresDistintos > 1 && (
              <p className="text-xs text-muted">
                Serão criados {fornecedoresDistintos} pedidos — um por fornecedor.
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Resumo — espelha exatamente o que o operador marcou */}
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted">
                <span>
                  <b className="font-display text-base text-ink tabular-nums">{marcadas.length}</b>{" "}
                  {marcadas.length === 1 ? "produto" : "produtos"}
                </span>
                <span>
                  <b className="text-ink tabular-nums">{fmtQtd(totalQtd)}</b> un
                </span>
                <span>
                  estimado <b className="font-display text-base text-ink tabular-nums">{fmtMoney(totalValor)}</b>
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={fechar}
                  className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!valido}
                  onClick={criarPedidos}
                  className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
                >
                  {pending ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}
                  Criar pedido manual
                </button>
              </div>
            </div>
          </div>
        )
      }
    >
      {criados ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 size={40} className="text-ok" />
          <p className="text-sm font-medium text-ink">
            {criados.length === 1
              ? `Pedido ${criados[0].numero} criado como rascunho.`
              : `${criados.length} pedidos criados como rascunho: ${criados.map((c) => c.numero).join(", ")}.`}
          </p>
          <p className="max-w-sm text-xs text-muted">
            Revise, envie ao fornecedor e acompanhe o recebimento na tela de Reposições.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={fechar}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              Fechar
            </button>
            <Link
              href="/compras"
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              Ir para Reposições <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      ) : !options || !linhas ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-faint" />
        </div>
      ) : linhas.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          Nenhum dos produtos selecionados pode entrar em pedido de compra.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {options.sites.length > 1 && (
            <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted">
              <span className="flex items-center gap-1"><Store size={12} /> Destino</span>
              <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className={inputCls}>
                {options.sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}{s.tipo === "CD" ? " (CD)" : ""}</option>
                ))}
              </select>
            </label>
          )}

          <ul className="flex flex-col gap-2">
            {linhas.map((l) => {
              const prod = prodMap.get(l.productId);
              if (!prod) return null;
              const padrao = prod.packagings.find((pk) => pk.isCompraDefault) ?? null;
              const doProduto = options.suppliers.filter((s) => prod.supplierIds.includes(s.id));
              const outros = options.suppliers.filter((s) => !prod.supplierIds.includes(s.id));
              const total = qtdNum(l.qtd) * num(l.custo);
              return (
                <li
                  key={l.productId}
                  className={cn(
                    "flex flex-col gap-2.5 rounded-xl border p-3 transition-colors",
                    l.checked ? "border-line bg-surface-2/40" : "border-line bg-surface opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={l.checked}
                      onChange={(e) => setLinha(l.productId, { checked: e.target.checked })}
                      aria-label={`Incluir ${prod.nome} na compra`}
                      className="h-4 w-4 shrink-0 accent-brand"
                    />
                    <Thumb url={prod.imagemUrl} nome={prod.nome} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{prod.nome}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {prod.sku}{padrao ? ` · compra em ${padrao.nome}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {total > 0 ? fmtMoney(total) : "—"}
                    </span>
                  </div>

                  {l.checked && (
                    <div className="grid grid-cols-2 gap-3 pl-7 sm:grid-cols-4">
                      <label className="col-span-2 flex flex-col gap-1 text-[11px] font-medium text-muted">
                        <span className="flex items-center gap-1"><Building2 size={11} /> Fornecedor</span>
                        <select
                          value={l.supplierId}
                          onChange={(e) => setLinha(l.productId, { supplierId: e.target.value })}
                          className={cn(inputCls, !l.supplierId && "border-warn/60")}
                        >
                          <option value="">Selecione…</option>
                          {doProduto.length > 0 && (
                            <optgroup label="Vinculados ao produto">
                              {doProduto.map((s) => (
                                <option key={s.id} value={s.id}>{supplierLabel(s)}</option>
                              ))}
                            </optgroup>
                          )}
                          {outros.length > 0 && (
                            <optgroup label={doProduto.length > 0 ? "Outros fornecedores" : "Fornecedores"}>
                              {outros.map((s) => (
                                <option key={s.id} value={s.id}>{supplierLabel(s)}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
                        Quantidade{padrao ? ` (${padrao.nome})` : ""}
                        <input
                          inputMode="decimal"
                          value={l.qtd}
                          onChange={(e) => setLinha(l.productId, { qtd: e.target.value })}
                          className={cn(inputCls, "tabular-nums")}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
                        Valor unitário
                        <input
                          inputMode="decimal"
                          value={l.custo}
                          placeholder="R$ 0,00"
                          onChange={(e) => setLinha(l.productId, { custo: maskMoney(e.target.value) })}
                          className={cn(inputCls, "tabular-nums")}
                        />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

/** Custo conhecido do produto na embalagem padrão de compra (fato de cadastro, não sugestão). */
function custoPadrao(prod: Produto): number {
  const padrao = prod.packagings.find((pk) => pk.isCompraDefault) ?? null;
  return padrao ? (prod.custoMedio ?? 0) * padrao.fatorConversao : (prod.custoMedio ?? 0);
}
