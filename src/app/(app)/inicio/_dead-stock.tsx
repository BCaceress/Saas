import Link from "next/link";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { brl } from "@/lib/utils";
import { Thumb } from "../compras/_ui";
import type { ProdutoSemGiro } from "./_data";

/** Produtos sem giro — dinheiro parado em estoque que não anda. */
export function DeadStock({ produtos }: { produtos: ProdutoSemGiro[] }) {
  return (
    <ChartCard title="Produtos sem giro" subtitle="Parado além do esperado — dinheiro empatado em estoque">
      {produtos.length === 0 ? (
        <ChartEmpty mensagem="Nenhum produto parado além do limite configurado." />
      ) : (
        <ul className="flex flex-col gap-2">
          {produtos.map((p) => (
            <li key={p.productId} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Thumb url={p.imagemUrl} nome={p.nome} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
                  <p className="font-mono text-xs text-faint">
                    {p.sku} · parado há {p.diasParado} dias · saldo {p.saldo.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-semibold text-warn">{brl(p.valorParado)}</p>
                <Link href={`/produtos/${p.productId}/editar`} className="text-xs font-medium text-brand hover:underline">
                  Abrir produto
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
