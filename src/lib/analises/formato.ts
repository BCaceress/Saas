import type { DocumentoData } from "@/app/documento/_folha";
import { getMetrica, type FatoDef } from "./catalogo";
import { formatar, type ResultadoConsulta } from "./motor";
import type { Consulta } from "./schema";

/**
 * Saídas de um resultado do motor. A tabela da tela, o CSV e o PDF nascem todos
 * do MESMO `ResultadoConsulta` — é o que garante que os quatro caminhos
 * (tela, export, documento e insight da IA) mostrem os mesmos números.
 */

// ── CSV ─────────────────────────────────────────────────────

/**
 * CSV no dialeto que o Excel brasileiro abre sem perguntar nada: separador `;`,
 * decimal `,` e BOM UTF-8. Números saem CRUS (sem "R$" e sem separador de
 * milhar) para que a planilha some a coluna em vez de tratá-la como texto.
 */
export function paraCsv(r: ResultadoConsulta): string {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const dec = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });

  const cabecalho = r.colunas.map((c) => c.header);
  const corpo = r.brutas.map((linha) =>
    r.colunas.map((c) => {
      const v = linha[c.id];
      return typeof v === "number" ? dec(v) : String(v ?? "");
    }),
  );
  const rodape = [
    ...r.colunas.filter((c) => c.tipo === "dimensao").map((_, i) => (i === 0 ? "Total" : "")),
    ...r.colunas.filter((c) => c.tipo === "metrica").map((c) => dec(r.totais[c.id] ?? 0)),
  ];

  const linhas = [cabecalho, ...corpo, rodape].map((l) => l.map(esc).join(";"));
  return "﻿" + linhas.join("\r\n");
}

/** Nome de arquivo estável e legível: `analise-vendas-por-produto-30d.csv`. */
export function nomeArquivo(r: ResultadoConsulta, extensao: string): string {
  const partes = [
    "analise",
    r.fato.label,
    ...(r.consulta.dimensoes.length > 0 ? ["por", ...r.consulta.dimensoes] : []),
    r.consulta.periodo.preset,
  ];
  const slug = partes
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}.${extensao}`;
}

// ── Documento (PDF) ─────────────────────────────────────────

/**
 * Documento imprimível: os totais do período viram os KPIs do topo (é o que o
 * operador lê primeiro) e o detalhamento vira a tabela, com a linha de total
 * repetida no rodapé.
 */
export function paraDocumento(r: ResultadoConsulta): DocumentoData {
  const kpis = r.consulta.metricas.slice(0, 4).map((id) => {
    const m = getMetrica(r.fato, id);
    return {
      label: m?.label ?? id,
      valor: formatar(r.totais[id] ?? 0, m?.formato ?? "numero"),
    };
  });

  const quebra =
    r.consulta.dimensoes.length > 0
      ? `por ${r.consulta.dimensoes.map((d) => rotulo(r, d)).join(" · ")}`
      : "total do período";

  return {
    kpis,
    secoes: [
      {
        titulo: "Detalhamento",
        subtitulo:
          r.totalGrupos > r.linhas.length
            ? `${quebra} — ${r.linhas.length} de ${r.totalGrupos} linhas`
            : quebra,
        colunas: r.colunas.map((c) => ({ header: c.header, align: c.align })),
        linhas: r.linhas,
        rodape: r.linhas.length > 0 ? r.totaisTexto : undefined,
        vazio: "Nada encontrado com esses filtros no período.",
      },
    ],
  };
}

function rotulo(r: ResultadoConsulta, dimensaoId: string): string {
  return (r.fato.dimensoes.find((d) => d.id === dimensaoId)?.label ?? dimensaoId).toLowerCase();
}

// ── Frase de interpretação ──────────────────────────────────

/**
 * O que a consulta diz, em português. A IA acerta a maior parte do tempo, mas
 * não vale confiar sem conferir — esta frase é o que permite ao operador
 * validar (ou corrigir) o que foi entendido.
 */
export function descreverConsulta(r: ResultadoConsulta): string {
  const base = descreverDSL(r.fato, r.consulta, r.periodo.label);
  return r.totalGrupos > r.consulta.limite ? `${base} · top ${r.consulta.limite}` : base;
}

/**
 * Mesma frase, a partir só do DSL — sem executar nada. É o que permite listar
 * relatórios salvos com um resumo do que fazem sem rodar cada consulta.
 */
export function descreverDSL(fato: FatoDef, consulta: Consulta, periodoLabel?: string): string {
  const rotuloDe = (id: string) =>
    (fato.dimensoes.find((d) => d.id === id)?.label ?? id).toLowerCase();

  const partes = [consulta.metricas.map((id) => getMetrica(fato, id)?.label ?? id).join(", ")];

  if (consulta.dimensoes.length > 0) {
    partes.push(`por ${consulta.dimensoes.map(rotuloDe).join(" e ")}`);
  }
  if (fato.usaPeriodo) {
    partes.push(`· ${(periodoLabel ?? PERIODO_LABEL[consulta.periodo.preset]).toLowerCase()}`);
  }

  for (const f of consulta.filtros) {
    const nome =
      fato.dimensoes.find((d) => d.id === f.campo)?.label ??
      getMetrica(fato, f.campo)?.label ??
      f.campo;
    partes.push(`· ${nome.toLowerCase()} ${SIMBOLO[f.op]} ${valorTexto(f.valor)}`);
  }
  if (consulta.comparar) partes.push("· comparado ao período anterior");

  return partes.join(" ");
}

const PERIODO_LABEL: Record<string, string> = {
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  custom: "Período escolhido",
};

const SIMBOLO: Record<string, string> = {
  "=": "=",
  "!=": "≠",
  ">=": "≥",
  "<=": "≤",
  contem: "contém",
  em: "entre",
};

function valorTexto(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
