"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { HistoricoCompraProduto } from "../_data";
import { fetchHistoricoCompraProdutoAction } from "../actions";
import { fmtMoney, fmtQtd, relDia, Thumb } from "../_ui";
import type { Linha } from "./_shared";

// ── Drawer: histórico de compras do produto ───────────────────
// Abre ao clicar no nome do produto — preços praticados, comparação
// de fornecedores e últimas compras.

export function HistoricoDrawer({ item, onClose }: { item: Linha | null; onClose: () => void }) {
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
