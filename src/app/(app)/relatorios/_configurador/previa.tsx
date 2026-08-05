"use client";

import * as React from "react";
import {
  FileSpreadsheet,
  FileText,
  Layers,
  LoaderCircle,
  Lock,
  Printer,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu";
import { SHEET_WIDTH_PX, type SheetWidth } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { codificarConfig, type ReportConfig } from "@/lib/relatorios/config";
import type { Exportacao } from "@/lib/relatorios/catalogo";
import type { previaRelatorioAction } from "./actions";

/**
 * Peças compartilhadas pelos dois painéis de relatório.
 *
 * `Visualizador` (abre já com o resultado) e `Configurador` (personaliza antes)
 * mostram a MESMA tabela, com o mesmo cabeçalho, o mesmo rodapé de totais e as
 * mesmas saídas. Se a prévia divergir entre os dois, um deles está mentindo
 * sobre o que vai sair no arquivo — então ela mora aqui, uma vez só.
 */

export type Previa = Extract<
  Awaited<ReturnType<typeof previaRelatorioAction>>,
  { ok: true }
>["dados"];

export type Saida = "csv" | "xlsx" | "pdf" | "impressao";

/** Quantas linhas a prévia desenha. O arquivo leva todas — o DOM não precisa. */
export const TETO_PREVIA = 300;

/* ------------------------------------------------------------------ */
/* Largura do painel                                                   */
/* ------------------------------------------------------------------ */

/** Degraus que uma tabela pode escalar, do menor para o maior. */
const DEGRAUS: SheetWidth[] = ["2xl", "3xl", "4xl", "5xl", "6xl", "full"];

/** Respiro lateral do Sheet (px-5 dos dois lados) + a borda. */
const RESPIRO = 44;

/**
 * A largura do painel acompanha a tabela: mede o quanto a prévia realmente
 * ocupa e escolhe o menor degrau que a contém, nunca abaixo de `base`.
 *
 * Medir vence contar colunas — seis colunas de descrição são mais largas que
 * doze de moeda, e só o DOM sabe disso. A medição vive num ref callback (roda
 * quando a tabela monta, antes da pintura) em vez de num efeito.
 */
export function useLarguraTabela(base: SheetWidth) {
  const [largura, setLargura] = React.useState<SheetWidth>(base);

  const medirTabela = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      // `scrollWidth` é a largura do CONTEÚDO (a tabela é `min-w-max`), não a
      // da caixa. Some o respiro lateral para não deixar a tabela colada.
      const necessario = el.scrollWidth + RESPIRO;
      const possiveis = DEGRAUS.filter((d) => SHEET_WIDTH_PX[d] >= SHEET_WIDTH_PX[base]);
      setLargura(
        possiveis.find((d) => SHEET_WIDTH_PX[d] >= necessario) ??
          possiveis[possiveis.length - 1] ??
          base,
      );
    },
    [base],
  );

  const encolher = React.useCallback(() => setLargura(base), [base]);

  return { largura, medirTabela, encolher };
}

/* ------------------------------------------------------------------ */
/* URLs de saída                                                       */
/* ------------------------------------------------------------------ */

/**
 * Endereço do arquivo. Sem `config`, a rota executa o relatório no padrão —
 * é o que permite exportar direto do card, sem carregar definição nenhuma.
 */
export function hrefSaida(relatorioId: string, formato: Saida, config?: ReportConfig): string {
  const rel = encodeURIComponent(relatorioId);
  const c = config ? `&c=${codificarConfig(config)}` : "";
  return formato === "csv" || formato === "xlsx"
    ? `/relatorios/gerar/export?rel=${rel}&formato=${formato}${c}`
    : `/documento/relatorio?rel=${rel}${c}${formato === "impressao" ? "&imprimir=1" : ""}`;
}

/**
 * Menu de saídas. A orientação do PDF não é pergunta: o motor mede o conteúdo
 * formatado e decide retrato ou paisagem — perguntar seria transferir para o
 * operador uma conta que a máquina faz melhor.
 */
export function MenuExportar({
  exportacoes,
  ocupado,
  align = "end",
  trigger,
  onExportar,
}: {
  exportacoes: readonly Exportacao[];
  ocupado: Saida | null;
  align?: "start" | "end";
  trigger: React.ReactElement;
  onExportar: (f: Saida) => void;
}) {
  const tem = (e: Exportacao) => exportacoes.includes(e);

  return (
    <Menu trigger={trigger} align={align}>
      {tem("pdf") && (
        <MenuItem
          icon={ocupado === "pdf" ? <Girando /> : <FileText size={15} />}
          onClick={() => onExportar("pdf")}
        >
          Gerar PDF
          <span className="ml-1 text-[11px] text-faint">orientação automática</span>
        </MenuItem>
      )}
      {tem("xlsx") && (
        <MenuItem
          icon={ocupado === "xlsx" ? <Girando /> : <FileSpreadsheet size={15} />}
          onClick={() => onExportar("xlsx")}
        >
          Gerar Excel
        </MenuItem>
      )}
      {tem("csv") && (
        <MenuItem
          icon={ocupado === "csv" ? <Girando /> : <FileText size={15} />}
          onClick={() => onExportar("csv")}
        >
          Gerar CSV
        </MenuItem>
      )}
      {tem("imprimir") && (
        <MenuItem
          icon={ocupado === "impressao" ? <Girando /> : <Printer size={15} />}
          onClick={() => onExportar("impressao")}
        >
          Imprimir
        </MenuItem>
      )}
    </Menu>
  );
}

function Girando() {
  return <LoaderCircle size={15} className="animate-spin" aria-hidden />;
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

export function Visualizacao({
  previa,
  tabelaRef,
}: {
  previa: Previa | null;
  /** Mede a caixa que rola: é o `scrollWidth` dela que dimensiona o painel. */
  tabelaRef: (el: HTMLDivElement | null) => void;
}) {
  if (!previa) return null;

  const { plano, colunas } = previa;
  const temTotais = colunas.some((c) => c.totalizar) && previa.linhas.length > 0;
  const linhasVisiveis = previa.linhas.slice(0, TETO_PREVIA);

  return (
    <div className="space-y-5">
      {previa.removidos.length > 0 && (
        <Aviso tom="atencao" icone={Lock}>
          Seu perfil não alcança: {previa.removidos.join(", ")}. O relatório saiu sem esses campos.
        </Aviso>
      )}

      {/* Resumo executivo — vem antes da tabela, é o que o dono lê primeiro */}
      {previa.indicadores.length > 0 && (
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-(--radius) border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {previa.indicadores.map((k) => (
            <div key={k.id} className="bg-surface px-3.5 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                {k.label}
              </p>
              <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink">
                {k.valor}
              </p>
              {k.hint && <p className="text-[11px] text-faint">{k.hint}</p>}
            </div>
          ))}
        </section>
      )}

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        <Table2 size={13} aria-hidden />
        {previa.resumo}
        {previa.periodoLabel && <>· {previa.periodoLabel}</>}
        {previa.siteNome && <>· {previa.siteNome}</>}
      </p>

      {previa.linhas.length === 0 ? (
        <div className="rounded-(--radius) border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink-2">Nada encontrado no período.</p>
          <p className="mt-1 text-[13px] text-muted">
            Este relatório não tem movimento para mostrar agora.
          </p>
        </div>
      ) : (
        <div ref={tabelaRef} className="overflow-x-auto rounded-(--radius) border border-line">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead className="bg-surface-2">
              <tr>
                {colunas.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted",
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                          ? "text-center"
                          : "text-left",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previa.grupos
                ? previa.grupos.map((g) => (
                    <React.Fragment key={g.chave}>
                      <tr className="bg-surface-2">
                        <td
                          colSpan={colunas.length}
                          className="border-b border-line px-3 py-1.5 text-[12px] font-semibold text-ink"
                        >
                          <Layers size={12} className="mr-1.5 inline text-faint" aria-hidden />
                          {g.chave}{" "}
                          <span className="font-normal text-faint">
                            ({g.total.toLocaleString("pt-BR")})
                          </span>
                        </td>
                      </tr>
                      {g.linhas.slice(0, TETO_PREVIA).map((linha, r) => (
                        <Linha key={r} celulas={linha} colunas={colunas} />
                      ))}
                      {temTotais && (
                        <tr className="bg-surface-2/60">
                          {g.subtotais.map((v, i) => (
                            <Celula key={i} valor={v ?? ""} align={colunas[i]?.align} forte />
                          ))}
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                : linhasVisiveis.map((linha, r) => (
                    <Linha key={r} celulas={linha} colunas={colunas} />
                  ))}
            </tbody>
            {temTotais && (
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2">
                  {previa.totais.map((v, i) => (
                    <Celula key={i} valor={v ?? ""} align={colunas[i]?.align} forte />
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-faint">
        <span>
          {previa.exibidas.toLocaleString("pt-BR")} de{" "}
          {previa.totalLinhas.toLocaleString("pt-BR")} linhas
          {previa.linhas.length > TETO_PREVIA &&
            ` · prévia mostra as primeiras ${TETO_PREVIA}; o arquivo leva todas`}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText size={12} aria-hidden />
          PDF em {plano.orientacao} — {plano.motivo}
        </span>
      </div>

      {previa.truncado && (
        <Aviso tom="atencao" icone={TriangleAlert}>
          O resultado passou do limite de {previa.config.limite.toLocaleString("pt-BR")} linhas —
          a prévia e o arquivo trazem as primeiras.
        </Aviso>
      )}
    </div>
  );
}

function Linha({ celulas, colunas }: { celulas: string[]; colunas: Previa["colunas"] }) {
  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
      {celulas.map((v, i) => (
        <Celula key={i} valor={v} align={colunas[i]?.align} />
      ))}
    </tr>
  );
}

function Celula({
  valor,
  align,
  forte,
}: {
  valor: string;
  align?: "left" | "right" | "center";
  forte?: boolean;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-1.5",
        align === "right"
          ? "text-right font-mono tabular-nums"
          : align === "center"
            ? "text-center"
            : "text-left",
        forte ? "font-semibold text-ink" : "text-ink-2",
      )}
    >
      {valor}
    </td>
  );
}

export function Aviso({
  tom,
  icone: Icone,
  children,
}: {
  tom: "erro" | "atencao";
  icone: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-(--radius) border px-3.5 py-2.5 text-[13px]",
        tom === "erro"
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-warn/30 bg-warn-soft text-warn",
      )}
    >
      <Icone size={15} className="mt-px shrink-0" />
      <p>{children}</p>
    </div>
  );
}
