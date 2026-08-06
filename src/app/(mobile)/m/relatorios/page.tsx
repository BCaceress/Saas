import Link from "next/link";
import { ChevronRight, Monitor } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import {
  CATEGORIAS,
  relatoriosVisiveis,
  hrefExecucao,
  PARAMETROS_PADRAO,
  type Parametros,
} from "@/lib/relatorios/catalogo";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Card } from "@/components/ui/misc";

/**
 * Catálogo de relatórios.
 *
 * ESCOPO ASSUMIDO: aqui o celular lista e abre; quem desenha a tabela é a tela
 * de desktop. Trazer o motor genérico (`executarRelatorio` + configurador de
 * colunas, filtros e indicadores) para 390px seria reconstruir a tela mais
 * densa do sistema — e o gestor que abre um relatório no celular quer o
 * número, que a home e `/m/vendas` já entregam nativos.
 *
 * O que o mobile ganha de verdade: ver TUDO a que tem direito num lugar só,
 * com o período já preenchido, e abrir com um toque.
 */
export default async function RelatoriosMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const ctx = await requirePermissaoMobile("relatorio.ver");
  const { periodo } = await searchParams;

  const params: Parametros = {
    ...PARAMETROS_PADRAO,
    periodo: (["hoje", "7d", "30d", "mes"] as const).includes(periodo as never)
      ? (periodo as Parametros["periodo"])
      : "30d",
  };

  // Já cortado por permissão: o caixa não vê financeiro nem no cartão.
  const visiveis = relatoriosVisiveis(ctx.acessos);

  return (
    <>
      <MobilePageHeader
        titulo="Relatórios"
        descricao={`${visiveis.length} disponíveis para você.`}
      />

      <div className="scrollbar-none -mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3">
        {(
          [
            ["hoje", "Hoje"],
            ["7d", "7 dias"],
            ["30d", "30 dias"],
            ["mes", "Este mês"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={`/m/relatorios?periodo=${id}`}
            aria-current={params.periodo === id ? "page" : undefined}
            className={
              params.periodo === id
                ? "min-h-9 shrink-0 rounded-full bg-brand px-3 text-[13px] leading-9 font-medium text-on-brand"
                : "min-h-9 shrink-0 rounded-full border border-line-button bg-surface px-3 text-[13px] leading-9 font-medium text-ink-2"
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        {CATEGORIAS.map((cat) => {
          const doGrupo = visiveis.filter((r) => r.categoria === cat.id);
          if (doGrupo.length === 0) return null;

          return (
            <section key={cat.id} className="space-y-2">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">{cat.nome}</h2>
                <p className="text-xs text-muted">{cat.descricao}</p>
              </div>

              <Card className="divide-y divide-line overflow-hidden">
                {doGrupo.map((r) => {
                  const href = hrefExecucao(r, params);
                  const conteudo = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {r.nome}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {r.destino.tipo === "indisponivel" ? r.destino.motivo : r.descricao}
                        </span>
                      </span>
                      {href ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                      ) : null}
                    </>
                  );

                  return href ? (
                    <Link
                      key={r.id}
                      href={href}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      {conteudo}
                    </Link>
                  ) : (
                    <div
                      key={r.id}
                      className="flex min-h-14 items-center gap-3 px-4 py-3 opacity-60"
                    >
                      {conteudo}
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-3 text-[13px] text-ink-2">
        <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        As tabelas abrem na versão de computador. Os números do dia a dia estão em
        Início e Vendas, já prontos para o celular.
      </p>
    </>
  );
}
