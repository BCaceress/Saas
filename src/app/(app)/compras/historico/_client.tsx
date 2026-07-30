"use client";

import { usePathname, useRouter } from "next/navigation";
import { TrendingDown, TrendingUp, PiggyBank, Trophy, Repeat, Tag, Receipt, History } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { LinhaHistorico, ResumoEconomia } from "../_catalogo/types";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney, fmtPreco, fmtQuando } from "../_catalogo/ui";

const JANELAS = [7, 30, 90, 180];

/**
 * Histórico — o contrapeso da promoção. Quem guarda a série sabe se o preço
 * "de oferta" é mesmo o menor dos últimos meses ou só o de sempre com etiqueta
 * nova.
 */
export function HistoricoPrecos({
  linhas,
  resumo,
  dias,
}: {
  linhas: LinhaHistorico[];
  resumo: ResumoEconomia;
  dias: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4">
      <MetricaGrid>
        <Metrica
          label="Economia do mês"
          valor={fmtMoney(resumo.economiaMes)}
          sub="mais caro × mais barato"
          tom="accent"
          icon={<PiggyBank size={12} />}
        />
        <Metrica
          label="Mais barato"
          valor={resumo.fornecedorMaisBarato?.nome ?? "—"}
          sub={
            resumo.fornecedorMaisBarato
              ? `vence em ${resumo.fornecedorMaisBarato.vitorias} produtos`
              : "sem comparação ainda"
          }
          tom="ok"
          icon={<Trophy size={12} />}
        />
        <Metrica
          label="Mais usado"
          valor={resumo.fornecedorMaisUsado?.nome ?? "—"}
          sub={
            resumo.fornecedorMaisUsado
              ? `${resumo.fornecedorMaisUsado.pedidos} pedidos no mês`
              : "nenhum pedido no mês"
          }
          icon={<Repeat size={12} />}
        />
        <Metrica
          label="Maior promoção"
          valor={
            resumo.maiorPromocao ? `−${resumo.maiorPromocao.percentual.toFixed(0)}%` : "—"
          }
          sub={resumo.maiorPromocao?.descricao ?? "nenhuma oferta vigente"}
          tom="accent"
          icon={<Tag size={12} />}
        />
        <Metrica
          label="Pedidos no mês"
          valor={String(resumo.pedidosMes)}
          sub="todos os fornecedores"
          icon={<Receipt size={12} />}
        />
        <Metrica
          label="Comprado no mês"
          valor={fmtMoney(resumo.valorCompradoMes)}
          sub="valor dos pedidos"
          icon={<Receipt size={12} />}
        />
      </MetricaGrid>

      <div className="flex flex-wrap items-center gap-1.5">
        {JANELAS.map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => router.replace(`${pathname}?dias=${j}`, { scroll: false })}
            aria-pressed={dias === j}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
              dias === j
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {j} dias
          </button>
        ))}
      </div>

      {linhas.length === 0 ? (
        <EstadoVazio
          icon={<History size={20} />}
          titulo="Sem mudança de preço no período"
          descricao="O histórico ganha corpo a partir da segunda tabela importada de cada fornecedor — só o que muda vira registro."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Fornecedor</th>
                <th className="px-3 py-2.5 text-right font-medium">Antes</th>
                <th className="px-3 py-2.5 text-right font-medium">Agora</th>
                <th className="px-3 py-2.5 text-right font-medium">Variação</th>
                <th className="px-3 py-2.5 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const subiu = (linha.variacao ?? 0) > 0;
                const caiu = (linha.variacao ?? 0) < 0;
                return (
                  <tr key={linha.itemId} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className="max-w-72 px-4 py-2.5">
                      <p className="truncate font-medium text-ink">{linha.descricao}</p>
                      {linha.produtoNome && (
                        <p className="truncate text-[11px] text-muted">{linha.produtoNome}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-ink-2">{linha.supplierNome}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-muted">
                      {linha.precoAnterior != null ? fmtPreco(linha.precoAnterior) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={cn(
                          "font-mono text-[13px] font-semibold",
                          linha.emPromocao ? "text-accent" : "text-ink",
                        )}
                      >
                        {fmtPreco(linha.precoAtual)}
                      </span>
                      {linha.emPromocao && (
                        <Badge tone="accent" className="ml-1.5">
                          promoção
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {linha.variacao == null ? (
                        <span className="text-[12px] text-faint">primeiro preço</span>
                      ) : (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-mono text-[12px] font-medium",
                            caiu ? "text-ok" : subiu ? "text-danger" : "text-muted",
                          )}
                        >
                          {caiu ? <TrendingDown size={12} /> : subiu ? <TrendingUp size={12} /> : null}
                          {linha.variacao > 0 ? "+" : ""}
                          {linha.variacao.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">{fmtQuando(linha.data)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
