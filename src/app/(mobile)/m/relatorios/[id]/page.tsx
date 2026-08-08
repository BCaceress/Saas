import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { getRelatorio } from "@/lib/relatorios/catalogo";
import { getDefinicao } from "@/lib/relatorios/definicoes";
import { codificarConfig, type PeriodoConfig } from "@/lib/relatorios/config";
import { configPadraoDoUsuario } from "@/lib/relatorios/modelos-salvos";
import { executarRelatorio } from "@/lib/relatorios/executar";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/**
 * Relatório GERADO no celular.
 *
 * Roda o mesmo motor do desktop (`executarRelatorio`) — mesma definição, mesmo
 * corte por permissão, mesmos números. O que muda é só o desenho: em vez da
 * tabela de N colunas, cada linha vira um cartão com o primeiro campo como
 * título e o resto como pares rótulo/valor. Tabela de 8 colunas em 390px ou
 * rola de lado (e ninguém acha a coluna) ou encolhe a fonte até não se ler.
 *
 * O que fica de fora de propósito: escolher colunas, agrupar e ordenar. Isso é
 * o configurador, a tela mais densa do sistema — aqui vale o padrão pessoal
 * salvo por quem abriu (o MESMO que o desktop mostra), e o período em um toque.
 * Quem precisa remontar o relatório continua fazendo isso na tela de mesa.
 */

const PRESETS = [
  ["hoje", "Hoje"],
  ["7d", "7 dias"],
  ["30d", "30 dias"],
  ["mes", "Este mês"],
  ["6m", "6 meses"],
] as const;

type Preset = (typeof PRESETS)[number][0];

/** Teto de linhas no celular: o payload desce inteiro para o aparelho. */
const LIMITE_MOBILE = 100;

export default async function RelatorioMobilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { id } = await params;
  const { periodo } = await searchParams;

  const rel = getRelatorio(id);
  const def = rel ? getDefinicao(rel.id) : null;
  // Sem definição o relatório é uma TELA do app (ex.: comparador de compras);
  // o catálogo mobile já não manda para cá nesse caso.
  if (!rel || !def) notFound();

  const ctx = await requirePermissaoMobile(rel.permissao);
  const preset: Preset = PRESETS.some(([p]) => p === periodo) ? (periodo as Preset) : "30d";

  const resultado = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const sites = await listSites();
    // O padrão pessoal é o mesmo que o desktop aplica: abrir no celular não
    // pode devolver colunas diferentes das que a pessoa configurou lá.
    const base = (await configPadraoDoUsuario(def, ctx.user.id)) ?? {};
    const periodoConfig: PeriodoConfig = { preset };

    return await executarRelatorio({
      def,
      config: { ...base, periodo: periodoConfig, limite: LIMITE_MOBILE },
      acessos: ctx.acessos,
      siteId,
      siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
      policy: policyDoTenant(ctx.tenant),
    });
  });

  const podeExportar = podeEmAlguma(ctx.acessos, "relatorio.exportar");
  const c = codificarConfig(resultado.config);
  // A primeira coluna vira o título do cartão (é sempre a que identifica a
  // linha: produto, cliente, dia); o resto desce como pares rótulo/valor.
  const demais = resultado.colunas.slice(1);

  return (
    <>
      <MobilePageHeader
        titulo={rel.nome}
        voltar="/m/relatorios"
        descricao={
          <>
            {resultado.periodoLabel ?? "Posição de agora"}
            {resultado.siteNome ? ` · ${resultado.siteNome}` : ""}
          </>
        }
      />

      <div className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {PRESETS.map(([p, label]) => (
          <Link
            key={p}
            href={`/m/relatorios/${rel.id}?periodo=${p}`}
            aria-current={preset === p ? "page" : undefined}
            className={cn(
              "min-h-9 shrink-0 rounded-full px-3 text-[13px] leading-9 font-medium",
              preset === p
                ? "bg-brand text-on-brand"
                : "border border-line-button bg-surface text-ink-2",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Indicadores primeiro: é o que responde a pergunta sem rolar. */}
      {resultado.indicadores.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {resultado.indicadores.map((i) => (
            <Card key={i.id} className="p-3">
              <p className="truncate text-[12px] text-muted">{i.label}</p>
              <p className="mt-0.5 font-display text-xl leading-tight font-semibold text-ink tabular-nums">
                {i.valor}
              </p>
              {i.hint && <p className="mt-0.5 truncate text-[11px] text-faint">{i.hint}</p>}
            </Card>
          ))}
        </div>
      )}

      {resultado.removidos.length > 0 && (
        <p className="mb-3 rounded-[var(--radius-lg)] border border-line bg-surface p-3 text-[13px] text-ink-2">
          Alguns campos não aparecem no seu perfil: {resultado.removidos.join(", ")}.
        </p>
      )}

      {resultado.linhas.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-base font-semibold text-ink">Nada no período</p>
          <p className="mt-1 text-sm text-ink-2">
            Troque o período acima — ou não houve movimento para este relatório.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {resultado.linhas.map((linha, i) => (
            <li key={i}>
              <Card className="p-3">
                <p className="truncate text-sm font-medium text-ink">{linha[0] || "—"}</p>
                {demais.length > 0 && (
                  <dl className="mt-2 space-y-1">
                    {demais.map((col, j) => (
                      <div key={col.id} className="flex items-baseline justify-between gap-3">
                        <dt className="min-w-0 truncate text-xs text-muted">{col.label}</dt>
                        <dd
                          className={cn(
                            "shrink-0 text-sm text-ink tabular-nums",
                            col.align === "right" && "font-medium",
                          )}
                        >
                          {linha[j + 1] || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Rodapé: o que a lista mostra x o que existe, e os totais do motor. */}
      <div className="mt-3 space-y-2">
        {resultado.totais.some(Boolean) && (
          <Card className="p-3">
            <p className="text-[12px] font-medium text-muted">Totais</p>
            <dl className="mt-1 space-y-1">
              {resultado.colunas.map((col, j) =>
                resultado.totais[j] ? (
                  <div key={col.id} className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 truncate text-xs text-muted">{col.label}</dt>
                    <dd className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                      {resultado.totais[j]}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          </Card>
        )}

        <p className="px-1 text-[12px] text-muted">
          {resultado.truncado
            ? `Mostrando ${resultado.exibidas} de ${resultado.totalLinhas} — refine o período ou baixe o arquivo.`
            : `${resultado.totalLinhas} ${resultado.totalLinhas === 1 ? "registro" : "registros"}.`}
        </p>

        {podeExportar && (
          <div className="grid grid-cols-2 gap-2">
            {/* PDF e planilha saem das MESMAS rotas do desktop, com a config
                desta tela — o arquivo bate com o que está na mão. */}
            <Link
              href={`/documento/relatorio?rel=${rel.id}&c=${c}&imprimir=1`}
              target="_blank"
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-button bg-surface text-sm font-medium text-ink-2"
            >
              <FileText className="h-4 w-4" aria-hidden /> PDF
            </Link>
            <a
              href={`/relatorios/gerar/export?rel=${rel.id}&c=${c}&formato=xlsx`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-button bg-surface text-sm font-medium text-ink-2"
            >
              <Download className="h-4 w-4" aria-hidden /> Excel
            </a>
          </div>
        )}
      </div>
    </>
  );
}
