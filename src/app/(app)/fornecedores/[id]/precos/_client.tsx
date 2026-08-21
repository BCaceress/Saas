"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Loader2, LineChart as LineChartIcon, TrendingDown, TrendingUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtPreco } from "../../../cotacoes/_catalogo/ui";
import { historicoPrecoAction } from "../../../cotacoes/_catalogo/actions";
import type { PontoPreco } from "../../../cotacoes/_catalogo/types";
import type { ItemComHistorico, MovimentoPreco } from "../_data";

// ============================================================
// Aba Histórico de preços — a evolução do que este fornecedor cobra.
//
// Duas leituras na mesma tela: o gráfico do item escolhido (a pergunta
// "subiu ou desceu?") e a lista das maiores variações do período (a pergunta
// "o que mudou enquanto eu não olhava?").
// ============================================================

const JANELAS = [7, 30, 90, 180] as const;

export function HistoricoPrecos({
  itens,
  movimentos,
  dias,
  itemSelecionado,
}: {
  itens: ItemComHistorico[];
  movimentos: MovimentoPreco[];
  dias: number;
  itemSelecionado: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [busca, setBusca] = useState("");
  const escolhido = itemSelecionado ?? itens.find((i) => i.pontos >= 2)?.id ?? itens[0]?.id ?? null;

  const [carga, setCarga] = useState<{ chave: string; pontos: PontoPreco[] } | null>(null);
  const chave = `${escolhido}:${dias}`;
  const pontos = carga && carga.chave === chave ? carga.pontos : null;

  useEffect(() => {
    if (!escolhido) return;
    let vivo = true;
    historicoPrecoAction(escolhido, dias).then((r) => {
      if (vivo) setCarga({ chave: `${escolhido}:${dias}`, pontos: r });
    });
    return () => {
      vivo = false;
    };
  }, [escolhido, dias]);

  function aplicar(mudanca: Record<string, string | null>) {
    const proximo = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudanca)) {
      if (!v) proximo.delete(k);
      else proximo.set(k, v);
    }
    router.replace(`${pathname}?${proximo.toString()}`, { scroll: false });
  }

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return itens
      .filter((i) => !t || i.descricao.toLowerCase().includes(t) || (i.ean ?? "").includes(t))
      .slice(0, 120);
  }, [itens, busca]);

  const item = itens.find((i) => i.id === escolhido) ?? null;
  const serie = (pontos ?? []).map((p) => ({
    data: new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    valor: p.precoEfetivo,
  }));
  const menor = pontos && pontos.length > 0 ? Math.min(...pontos.map((p) => p.precoEfetivo)) : null;
  const maior = pontos && pontos.length > 0 ? Math.max(...pontos.map((p) => p.precoEfetivo)) : null;

  if (itens.length === 0) {
    return (
      <EstadoVazio
        icon={<LineChartIcon size={20} />}
        titulo="Nenhum preço registrado ainda"
        descricao="O histórico nasce na segunda tabela importada: é a comparação entre uma versão e a anterior."
        acao={
          <Link href="/cotacoes/importacoes">
            <Button size="sm" variant="secondary">
              Importar tabela
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {JANELAS.map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => aplicar({ dias: String(j) })}
            aria-pressed={dias === j}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              dias === j
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {j} dias
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* Seletor de produto */}
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produto"
              className="pl-9"
              aria-label="Buscar produto no histórico"
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {lista.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-muted">Nenhum produto encontrado.</p>
            ) : (
              lista.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => aplicar({ item: i.id })}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors",
                    i.id === escolhido ? "bg-brand-soft text-brand" : "hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{i.descricao}</span>
                    <span className="block font-mono text-[11px] text-faint">
                      {i.pontos > 0 ? `${i.pontos} registros` : "sem histórico"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px]">{fmtPreco(i.precoAtual)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Gráfico */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[15px] font-semibold text-ink">
              {item?.descricao ?? "Escolha um produto"}
            </h2>
            <p className="text-[12px] text-muted">Evolução do preço efetivo nos últimos {dias} dias.</p>
          </div>

          {pontos == null ? (
            <div className="flex h-52 items-center justify-center text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : serie.length < 2 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-line px-4 py-14 text-center text-[13px] text-muted">
              Este produto ainda não mudou de preço nesta janela. Escolha outra janela ou outro item.
            </div>
          ) : (
            <>
              <LineChart pontos={serie} formato={fmtPreco} altura={220} />
              <div className="grid grid-cols-3 divide-x divide-line rounded-[var(--radius)] border border-line bg-surface-2/50 py-2.5 text-center">
                <div>
                  <p className="font-mono text-sm font-semibold text-ok">{fmtPreco(menor ?? 0)}</p>
                  <p className="text-[11px] text-faint">menor</p>
                </div>
                <div>
                  <p className="font-mono text-sm font-semibold text-ink">
                    {fmtPreco(serie[serie.length - 1]?.valor ?? 0)}
                  </p>
                  <p className="text-[11px] text-faint">hoje</p>
                </div>
                <div>
                  <p className="font-mono text-sm font-semibold text-danger">{fmtPreco(maior ?? 0)}</p>
                  <p className="text-[11px] text-faint">maior</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Maiores variações do período */}
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Alterações de preço nos últimos {dias} dias</h2>
          <p className="text-[11px] text-muted">Da maior variação para a menor.</p>
        </div>
        {movimentos.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">
            Nenhuma alteração registrada nesta janela.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Produto</th>
                  <th className="px-3 py-2.5 text-right font-medium">Antes</th>
                  <th className="px-3 py-2.5 text-right font-medium">Agora</th>
                  <th className="px-3 py-2.5 text-right font-medium">Variação</th>
                  <th className="px-3 py-2.5 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => {
                  const subiu = m.variacao > 0;
                  return (
                    <tr
                      key={m.itemId}
                      onClick={() => aplicar({ item: m.itemId })}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60"
                    >
                      <td className="max-w-80 px-4 py-2.5">
                        <span className="block truncate font-medium text-ink">{m.descricao}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-faint">
                        {fmtPreco(m.precoAnterior)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[13px] font-semibold text-ink">
                        {fmtPreco(m.precoAtual)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Badge tone={subiu ? "danger" : "ok"} className="font-mono">
                          {subiu ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {subiu ? "+" : ""}
                          {m.variacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted">
                        {new Date(m.data).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
