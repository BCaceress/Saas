"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale, Sparkles, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney, fmtPreco } from "../../_catalogo/ui";
import type { CotacaoDetalhe } from "../_types";
import { gerarPedidosAction } from "../actions";

// ── Comparativo ─────────────────────────────────────────────
// A tela onde a cotação paga o próprio custo. Cada linha é um item, cada
// coluna um fornecedor que respondeu, e o menor preço da linha ganha a
// etiqueta âmbar — a mesma etiqueta de prateleira do resto do módulo.
//
// A escolha é por ITEM, não por fornecedor: comprar tudo do mais barato no
// total costuma ser pior do que pegar cada item de quem tem o melhor preço.
// Por isso o padrão já vem marcado no menor preço de cada linha, e o operador
// só muda o que quiser mudar.

export function ComparativoCotacao({
  cotacao,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA");

  // itemId → conviteId com o menor preço disponível.
  const melhorPorItem = useMemo(() => {
    const mapa = new Map<string, { conviteId: string; preco: number }>();
    for (const item of cotacao.itens) {
      for (const convite of respondidos) {
        const r = convite.respostas.find((x) => x.quotationItemId === item.id);
        if (!r?.disponivel) continue;
        const atual = mapa.get(item.id);
        if (!atual || r.precoUnitario < atual.preco) {
          mapa.set(item.id, { conviteId: convite.id, preco: r.precoUnitario });
        }
      }
    }
    return mapa;
  }, [cotacao.itens, respondidos]);

  const [escolhas, setEscolhas] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      cotacao.itens.map((i) => [i.id, melhorPorItem.get(i.id)?.conviteId ?? null]),
    ),
  );

  const decidida = cotacao.status === "DECIDIDA";

  // Cesta escolhida × a mesma cesta no fornecedor único mais barato: a
  // diferença entre as duas é o que a cotação rendeu.
  const totalEscolhido = cotacao.itens.reduce((acc, item) => {
    const conviteId = escolhas[item.id];
    if (!conviteId) return acc;
    const r = respondidos
      .find((c) => c.id === conviteId)
      ?.respostas.find((x) => x.quotationItemId === item.id);
    return r?.disponivel ? acc + r.precoUnitario * item.quantidade : acc;
  }, 0);

  const totaisCheios = respondidos
    .filter((c) =>
      cotacao.itens.every((i) =>
        c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
      ),
    )
    .map((c) => ({ nome: c.supplierNome, total: c.total }));

  const piorCheio = totaisCheios.length
    ? Math.max(...totaisCheios.map((t) => t.total))
    : null;
  const melhorCheio = totaisCheios.length
    ? totaisCheios.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  const itensEscolhidos = Object.entries(escolhas).filter(([, v]) => v !== null).length;

  function gerar() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      try {
        const r = await gerarPedidosAction({
          quotationId: cotacao.id,
          escolhas: Object.entries(escolhas)
            .filter(([, conviteId]) => conviteId !== null)
            .map(([quotationItemId, conviteId]) => ({
              quotationItemId,
              conviteId: conviteId as string,
            })),
          enviar: true,
        });
        if (r.semProduto.length > 0) {
          setAviso(
            `Ficaram de fora ${r.semProduto.length} ${r.semProduto.length === 1 ? "item que não está" : "itens que não estão"} vinculados ao catálogo: ${r.semProduto.join(", ")}.`,
          );
        }
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível gerar os pedidos.");
      }
    });
  }

  if (respondidos.length === 0) {
    return (
      <EstadoVazio
        icon={<Scale size={20} />}
        titulo="Ninguém respondeu ainda"
        descricao="Assim que você registrar a primeira resposta, o comparativo aparece aqui com o melhor preço de cada item."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MetricaGrid className="lg:grid-cols-3">
        <Metrica
          label="Cesta escolhida"
          valor={fmtMoney(totalEscolhido)}
          sub={`${itensEscolhidos} de ${cotacao.itens.length} itens`}
          tom="brand"
          icon={<Sparkles size={13} />}
        />
        <Metrica
          label="Melhor fornecedor único"
          valor={melhorCheio ? fmtMoney(melhorCheio.total) : "—"}
          sub={melhorCheio ? melhorCheio.nome : "ninguém cotou a lista inteira"}
          icon={<Scale size={13} />}
        />
        <Metrica
          label="Economia contra a pior"
          valor={piorCheio !== null ? fmtMoney(Math.max(0, piorCheio - totalEscolhido)) : "—"}
          sub="proposta cheia mais cara"
          tom="ok"
          icon={<TrendingDown size={13} />}
        />
      </MetricaGrid>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd</th>
              {respondidos.map((c) => (
                <th key={c.id} className="px-3 py-2.5 text-right font-medium">
                  <span className="block truncate normal-case text-[12px] text-ink-2">
                    {c.supplierNome}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {cotacao.itens.map((item) => {
              const melhor = melhorPorItem.get(item.id);
              return (
                <tr key={item.id}>
                  <td className="max-w-0 px-4 py-2.5">
                    <span className="block truncate text-ink">{item.descricao}</span>
                    {!item.productId && (
                      <span className="text-[11px] text-faint">fora do catálogo</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums text-muted">
                    {item.quantidade}
                  </td>

                  {respondidos.map((c) => {
                    const r = c.respostas.find((x) => x.quotationItemId === item.id);
                    const escolhido = escolhas[item.id] === c.id;
                    const ehMelhor = melhor?.conviteId === c.id;

                    if (!r?.disponivel) {
                      return (
                        <td key={c.id} className="px-3 py-2.5 text-right text-[12px] text-faint">
                          não tem
                        </td>
                      );
                    }

                    return (
                      <td key={c.id} className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={!podePedir || decidida}
                          onClick={() =>
                            setEscolhas((e) => ({
                              ...e,
                              [item.id]: e[item.id] === c.id ? null : c.id,
                            }))
                          }
                          aria-pressed={escolhido}
                          className={cn(
                            "inline-flex flex-col items-end gap-0.5 rounded-[var(--radius)] px-2.5 py-1 transition-colors",
                            escolhido
                              ? "bg-brand text-on-brand"
                              : ehMelhor
                                ? "bg-accent-soft text-accent hover:bg-accent-soft/70"
                                : "text-ink hover:bg-surface-2",
                            (!podePedir || decidida) && "cursor-default",
                          )}
                        >
                          <span className="font-mono text-[13px] font-semibold tabular-nums">
                            {fmtPreco(r.precoUnitario)}
                          </span>
                          <span
                            className={cn(
                              "font-mono text-[11px] tabular-nums",
                              escolhido ? "text-on-brand/80" : "text-faint",
                            )}
                          >
                            {fmtMoney(r.precoUnitario * item.quantidade)}
                          </span>
                          {r.marca && (
                            <span
                              className={cn(
                                "text-[10px]",
                                escolhido ? "text-on-brand/80" : "text-faint",
                              )}
                            >
                              {r.marca}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          <tfoot className="border-t border-line bg-surface-2">
            <tr>
              <td className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
                Total cheio
              </td>
              <td />
              {respondidos.map((c) => {
                const cobreTudo = cotacao.itens.every((i) =>
                  c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
                );
                return (
                  <td
                    key={c.id}
                    className="px-3 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums text-ink"
                  >
                    {cobreTudo ? fmtMoney(c.total) : <span className="text-faint">parcial</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {erro && <p className="text-[13px] text-danger">{erro}</p>}
      {aviso && (
        <p className="rounded-[var(--radius)] border border-line bg-accent-soft px-3.5 py-2 text-[13px] text-accent">
          {aviso}
        </p>
      )}

      {podePedir && !decidida && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
          <p className="text-[13px] text-muted">
            {itensEscolhidos === 0
              ? "Escolha de quem comprar cada item."
              : `${itensEscolhidos} ${itensEscolhidos === 1 ? "item escolhido" : "itens escolhidos"} · `}
            {itensEscolhidos > 0 && (
              <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                {fmtMoney(totalEscolhido)}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={gerar}
            disabled={pendente || itensEscolhidos === 0}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pendente ? "Gerando…" : "Gerar pedidos de compra"}
          </button>
        </div>
      )}

      {decidida && (
        <p className="rounded-[var(--radius)] border border-line bg-ok-soft px-3.5 py-2 text-[13px] text-ok">
          Esta cotação já virou pedido de compra. Acompanhe o resto em Compras › Pedidos.
        </p>
      )}
    </div>
  );
}
