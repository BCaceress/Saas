import { fmtDataCompleta } from "@/lib/periodo";
import type { ResultadoRelatorio } from "@/lib/relatorios/executar";
import { DocActions } from "./[modelo]/print-button";

/**
 * Folha adaptativa — o papel de TODO relatório do motor genérico.
 *
 * Não há layout por relatório: orientação, largura de coluna, tamanho de fonte,
 * margem e quebra chegam prontos no `plano` (ver `lib/relatorios/layout-pdf.ts`),
 * calculados a partir das colunas que o operador escolheu. Aqui só se desenha.
 *
 * O que o CSS garante e a conta não garantiria sozinha:
 *  · `thead { display: table-header-group }` repete o cabeçalho em toda página;
 *  · `tr { break-inside: avoid }` não parte uma linha ao meio;
 *  · `table-layout: fixed` + `<colgroup>` fazem as larguras valerem de verdade;
 *  · coluna larga quebra em mais de uma linha — conteúdo nunca é cortado.
 *
 * Vive fora do shell autenticado e usa cores fixas de papel, para imprimir
 * igual independente do tema do app.
 */

export function FolhaRelatorio({
  tenantNome,
  resultado,
  autoImprimir = false,
}: {
  tenantNome: string;
  resultado: ResultadoRelatorio;
  /** Abre o diálogo de impressão sozinho — veio de "Imprimir", não de "PDF". */
  autoImprimir?: boolean;
}) {
  const { plano, colunas } = resultado;
  const emitidoEm = new Date();
  const paisagem = plano.orientacao === "paisagem";
  const temTotais = colunas.some((c) => c.totalizar) && resultado.linhas.length > 0;

  const css = `
    @page { size: A4 ${paisagem ? "landscape" : "portrait"}; margin: ${plano.margemMm}mm }
    @media print {
      .no-print { display: none !important }
      body { background: #fff !important }
      .folha { width: auto !important; padding: 0 !important; box-shadow: none !important }
    }
    .tabela { table-layout: fixed; width: 100%; border-collapse: collapse;
              font-size: ${plano.fontePt}pt; line-height: 1.32 }
    .tabela thead { display: table-header-group }
    .tabela tfoot { display: table-footer-group }
    .tabela tr { break-inside: avoid; page-break-inside: avoid }
    .tabela th, .tabela td { padding: ${plano.paddingPt}pt 0.28em; vertical-align: top }
    .tabela th { font-size: ${plano.fonteCabecalhoPt}pt; text-transform: uppercase;
                 letter-spacing: 0.04em; color: #52525b; font-weight: 600;
                 border-bottom: 1px solid #a1a1aa; text-align: left }
    .tabela td { border-bottom: 1px solid #f4f4f5; color: #3f3f46 }
    .num { text-align: right; font-variant-numeric: tabular-nums }
    .centro { text-align: center }
    .nowrap { white-space: nowrap; overflow-wrap: normal }
    .quebra { white-space: normal; overflow-wrap: anywhere }
    .grupo td { background: #f4f4f5; font-weight: 700; color: #18181b;
                border-top: 1px solid #d4d4d8; break-after: avoid; page-break-after: avoid }
    .subtotal td { font-weight: 600; color: #18181b; border-bottom: 1px solid #d4d4d8 }
    .total td { font-weight: 700; color: #18181b; border-top: 2px solid #a1a1aa }
  `;

  return (
    <main className="min-h-screen bg-zinc-100 py-0 text-zinc-900 sm:py-8 print:bg-white print:py-0">
      <style>{css}</style>
      <DocActions auto={autoImprimir} />

      <article
        className="folha mx-auto w-full bg-white px-[14mm] py-[12mm] shadow-sm"
        style={{ maxWidth: paisagem ? "297mm" : "210mm" }}
      >
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-4">
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--brand,#0891b2)]">
              {tenantNome}
            </p>
            <h1 className="mt-1 font-display text-xl font-bold tracking-tight">{resultado.nome}</h1>
            <p className="mt-0.5 text-[11px] text-zinc-500">{resultado.descricao}</p>
            {resultado.resumo && (
              <p className="mt-1 text-[10px] text-zinc-400">{resultado.resumo}</p>
            )}
          </div>
          <div className="shrink-0 text-right text-[10px] leading-relaxed text-zinc-500">
            {resultado.periodoLabel && (
              <p>
                <span className="font-semibold text-zinc-700">Período:</span>{" "}
                {resultado.periodoLabel}
              </p>
            )}
            {resultado.siteNome && (
              <p>
                <span className="font-semibold text-zinc-700">Loja:</span> {resultado.siteNome}
              </p>
            )}
            <p>
              <span className="font-semibold text-zinc-700">Emitido:</span>{" "}
              {fmtDataCompleta(emitidoEm)}{" "}
              {emitidoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </header>

        {resultado.indicadores.length > 0 && (
          <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {resultado.indicadores.slice(0, 8).map((k) => (
              <div key={k.id} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="text-[8.5px] font-semibold uppercase tracking-wide text-zinc-500">
                  {k.label}
                </p>
                <p className="mt-0.5 font-display text-base font-bold tracking-tight text-zinc-900">
                  {k.valor}
                </p>
                {k.hint && <p className="text-[8.5px] text-zinc-400">{k.hint}</p>}
              </div>
            ))}
          </section>
        )}

        <section className="mt-5">
          {resultado.linhas.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-400">
              Nada encontrado com esses filtros.
            </p>
          ) : (
            <table className="tabela">
              <colgroup>
                {plano.larguras.map((l, i) => (
                  <col key={i} style={{ width: `${l}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {colunas.map((c, i) => (
                    <th key={c.id} className={classeCelula(c.align, plano.quebra[i])}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultado.grupos
                  ? resultado.grupos.map((g) => (
                      <Grupo key={g.chave} grupo={g} colunas={colunas} plano={plano} />
                    ))
                  : resultado.linhas.map((linha, r) => (
                      <tr key={r}>
                        {linha.map((cell, c) => (
                          <td key={c} className={classeCelula(colunas[c]?.align, plano.quebra[c])}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
              {temTotais && (
                <tfoot>
                  <tr className="total">
                    {resultado.totais.map((cell, c) => (
                      <td key={c} className={classeCelula(colunas[c]?.align, plano.quebra[c])}>
                        {cell ?? ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          )}

          {resultado.truncado && (
            <p className="mt-2 text-[10px] text-zinc-500">
              Mostrando as {resultado.exibidas.toLocaleString("pt-BR")} primeiras de{" "}
              {resultado.totalLinhas.toLocaleString("pt-BR")} linhas. Aperte os filtros para ver o
              resto.
            </p>
          )}
        </section>

        <footer className="mt-8 flex items-baseline justify-between gap-4 border-t border-zinc-200 pt-2 text-[9px] text-zinc-400">
          <span>
            Gerado por NoHub Market · {tenantNome} · {fmtDataCompleta(emitidoEm)}
          </span>
          <span>{plano.motivo}</span>
        </footer>
      </article>
    </main>
  );
}

function Grupo({
  grupo,
  colunas,
  plano,
}: {
  grupo: NonNullable<ResultadoRelatorio["grupos"]>[number];
  colunas: ResultadoRelatorio["colunas"];
  plano: ResultadoRelatorio["plano"];
}) {
  return (
    <>
      <tr className="grupo">
        <td colSpan={colunas.length}>
          {grupo.chave}{" "}
          <span className="font-normal text-zinc-500">
            ({grupo.total.toLocaleString("pt-BR")})
          </span>
        </td>
      </tr>
      {grupo.linhas.map((linha, r) => (
        <tr key={r}>
          {linha.map((cell, c) => (
            <td key={c} className={classeCelula(colunas[c]?.align, plano.quebra[c])}>
              {cell}
            </td>
          ))}
        </tr>
      ))}
      {colunas.some((c) => c.totalizar) && (
        <tr className="subtotal">
          {grupo.subtotais.map((cell, c) => (
            <td key={c} className={classeCelula(colunas[c]?.align, plano.quebra[c])}>
              {cell ?? ""}
            </td>
          ))}
        </tr>
      )}
    </>
  );
}

function classeCelula(align: string | undefined, quebra: boolean | undefined): string {
  const alinhamento = align === "right" ? "num" : align === "center" ? "centro" : "";
  return `${alinhamento} ${quebra ? "quebra" : "nowrap"}`.trim();
}
