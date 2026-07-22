import Link from "next/link";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { pct as fmtPct } from "@/lib/periodo";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { Thumb } from "../compras/_ui";
import type { ProdutoCrescimento } from "./_data";

const AMOSTRA = 5;

/** Produtos que mais vendem — tabela compacta com ranking, qtd e variação. */
export function ProductCards({ produtos }: { produtos: ProdutoCrescimento[] }) {
  const top = produtos.slice(0, AMOSTRA);

  return (
    <ChartCard title="Produtos que mais vendem" subtitle="Por faturamento" action={<VerRelatorio />}>
      {top.length === 0 ? (
        <ChartEmpty />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="w-8 pb-2 font-medium" />
              <th className="pb-2 font-medium">Produto</th>
              <th className="pb-2 pl-2 text-right font-medium">Qtd.</th>
              <th className="pb-2 pl-2 text-right font-medium">Receita</th>
              <th className="pb-2 pl-2 text-right font-medium">Var.</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p, i) => (
              <tr key={p.productId} className="border-t border-line">
                <td className="py-2">
                  <RankBadge posicao={i + 1} />
                </td>
                <td className="min-w-0 py-2 pr-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Thumb url={p.imagemUrl} nome={p.nome} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{p.nome}</p>
                      <p className="font-mono text-xs text-faint">{p.sku}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2 pl-2 text-right tabular-nums text-ink-2">{p.quantidade.toLocaleString("pt-BR")}</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-ink">{brl(p.receita)}</td>
                <td className="py-2 pl-2 text-right">
                  <VariacaoBadge pct={p.crescimento.pct} dir={p.crescimento.dir} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartCard>
  );
}

/** Maior margem — mesma amostra de produtos, ranqueada por margem bruta (%). */
export function MarginProducts({ produtos }: { produtos: ProdutoCrescimento[] }) {
  const top = produtos
    .filter((p) => p.custo > 0 && p.receita > 0)
    .sort((a, b) => b.margemPct - a.margemPct)
    .slice(0, AMOSTRA);

  return (
    <ChartCard title="Maior margem" subtitle="Lucro bruto por produto">
      {top.length === 0 ? (
        <ChartEmpty mensagem="Sem custo cadastrado nos produtos vendidos." />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="w-8 pb-2 font-medium" />
              <th className="pb-2 font-medium">Produto</th>
              <th className="pb-2 pl-2 text-right font-medium">Margem</th>
              <th className="pb-2 pl-2 text-right font-medium">Lucro</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p, i) => (
              <tr key={p.productId} className="border-t border-line">
                <td className="py-2">
                  <RankBadge posicao={i + 1} />
                </td>
                <td className="min-w-0 py-2 pr-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Thumb url={p.imagemUrl} nome={p.nome} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{p.nome}</p>
                      <p className="font-mono text-xs text-faint">{p.sku}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums text-ok">{Math.round(p.margemPct)}%</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums text-ink">{brl(p.receita - p.custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartCard>
  );
}

function VerRelatorio() {
  return (
    <Link href="/relatorios/vendas" className="text-xs font-medium text-brand hover:underline">
      Ver todos
    </Link>
  );
}

function RankBadge({ posicao }: { posicao: number }) {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-semibold tabular-nums text-ink-2">
      {posicao}
    </span>
  );
}

function VariacaoBadge({ pct, dir }: { pct: number | null; dir: "up" | "down" | "flat" }) {
  if (pct == null || dir === "flat") return <span className="text-xs text-faint">—</span>;
  const bom = dir === "up";
  const Icon = bom ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
        bom ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
      )}
    >
      <Icon size={11} />
      {fmtPct(Math.abs(pct), 0)}
    </span>
  );
}
