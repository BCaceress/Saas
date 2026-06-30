import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { resolvePeriodo, fmtDataCompleta } from "@/lib/periodo";
import { getModelo } from "@/app/(app)/relatorios/_modelos";
import { montarDocumento } from "@/app/(app)/relatorios/_documento-data";
import type { Range } from "@/app/(app)/relatorios/_data";
import { DocActions } from "./print-button";

/**
 * Documento PDF de relatório — rota FORA do shell autenticado (sem sidebar/navbar),
 * pensada para abrir em nova aba e imprimir/salvar como PDF. Cores fixas de papel
 * (claras) para imprimir certo independente do tema do app. Tenant resolvido pelo
 * host (mesmo subdomínio) + sessão, igual ao resto do app.
 */

export const dynamic = "force-dynamic";

export default async function DocumentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ modelo: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { modelo } = await params;
  const modeloDef = getModelo(modelo);
  if (!modeloDef) notFound();

  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const periodo = resolvePeriodo(sp);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const { doc, siteNome } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [doc, sites] = await Promise.all([
      montarDocumento(modeloDef.id, range, siteId),
      listSites(),
    ]);
    const siteNome = siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null;
    return { doc, siteNome };
  });

  const emitidoEm = new Date();

  return (
    <main className="min-h-screen bg-zinc-100 py-0 text-zinc-900 sm:py-8 print:bg-white print:py-0">
      {/* @page + esconder ações na impressão */}
      <style>{`@page{size:A4;margin:14mm}@media print{.no-print{display:none!important}body{background:#fff!important}}`}</style>

      <DocActions />

      <article className="mx-auto w-full max-w-[210mm] bg-white px-[16mm] py-[14mm] shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        {/* Cabeçalho */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-5">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand,#0891b2)]">
              {ctx.tenant.nome}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{modeloDef.nome}</h1>
            <p className="mt-1 text-sm text-zinc-500">{modeloDef.descricao}</p>
          </div>
          <div className="shrink-0 text-right text-[11px] leading-relaxed text-zinc-500">
            {modeloDef.usaPeriodo && (
              <p>
                <span className="font-semibold text-zinc-700">Período:</span> {periodo.label}
              </p>
            )}
            {siteNome && (
              <p>
                <span className="font-semibold text-zinc-700">Site:</span> {siteNome}
              </p>
            )}
            <p>
              <span className="font-semibold text-zinc-700">Emitido:</span> {fmtDataCompleta(emitidoEm)}{" "}
              {emitidoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </header>

        {/* KPIs */}
        {doc.kpis.length > 0 && (
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {doc.kpis.map((k) => (
              <div key={k.label} className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{k.label}</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-zinc-900">{k.valor}</p>
                {k.hint && <p className="mt-0.5 text-[11px] text-zinc-400">{k.hint}</p>}
              </div>
            ))}
          </section>
        )}

        {/* Seções (tabelas) */}
        {doc.secoes.map((sec, i) => (
          <section key={i} className="mt-8 break-inside-avoid">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-base font-bold text-zinc-900">{sec.titulo}</h2>
              {sec.subtitulo && <span className="text-[11px] text-zinc-400">{sec.subtitulo}</span>}
            </div>
            {sec.linhas.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-400">
                {sec.vazio ?? "Sem dados no período."}
              </p>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-zinc-300">
                    {sec.colunas.map((c, j) => (
                      <th
                        key={j}
                        className={`py-2 pr-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 ${c.align === "right" ? "text-right" : "text-left"}`}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.linhas.map((linha, r) => (
                    <tr key={r} className="border-b border-zinc-100">
                      {linha.map((cell, c) => (
                        <td
                          key={c}
                          className={`py-1.5 pr-3 text-zinc-700 ${sec.colunas[c]?.align === "right" ? "text-right tabular-nums" : "text-left"}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}

        {/* Rodapé */}
        <footer className="mt-10 border-t border-zinc-200 pt-3 text-[10px] text-zinc-400">
          Gerado por NoHub Market · {ctx.tenant.nome} · {fmtDataCompleta(emitidoEm)}
        </footer>
      </article>
    </main>
  );
}
