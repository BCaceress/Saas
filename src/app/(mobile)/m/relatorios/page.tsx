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
import { temDefinicao } from "@/lib/relatorios/definicoes";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Card } from "@/components/ui/misc";

/**
 * Catálogo de relatórios.
 *
 * Quem TEM definição no motor genérico é gerado aqui mesmo, em
 * `/m/relatorios/[id]` — mesmo motor do desktop, desenho de cartão em vez de
 * tabela. O que ainda aponta para uma TELA do app (comparador de compras,
 * validade, ABC) continua abrindo a versão de computador, e a lista avisa
 * antes com o ícone de monitor.
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

      <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
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
                  // Tem definição = o motor sabe gerar; então gera aqui, com o
                  // período que a pessoa acabou de escolher nos chips.
                  const nativo = temDefinicao(r.id);
                  const href = nativo
                    ? `/m/relatorios/${r.id}?periodo=${params.periodo}`
                    : hrefExecucao(r, params);
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
                      {/* O aviso agora é por linha: sem ele, quem toca num dos
                          poucos que ainda são tela de mesa é pego de surpresa. */}
                      {href && !nativo && (
                        <Monitor
                          className="h-3.5 w-3.5 shrink-0 text-faint"
                          aria-label="Abre na versão de computador"
                        />
                      )}
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
        Os relatórios são gerados aqui mesmo, com PDF e Excel. Só os marcados com este
        ícone abrem na versão de computador — são telas do app, não tabelas.
      </p>
    </>
  );
}
