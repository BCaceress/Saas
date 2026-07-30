"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Bookmark,
  Check,
  Plus,
  X,
  Download,
  Printer,
  Filter,
  ArrowUp,
  ArrowDown,
  TriangleAlert,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { codificarConsulta, type Consulta, type Operador } from "@/lib/analises/schema";
import type { FatoCliente } from "@/lib/analises/catalogo";
import type { ColunaResultado } from "@/lib/analises/motor";
import { salvarConsultaAction } from "./actions";

/**
 * A consulta como FRASE EDITÁVEL.
 *
 * Em vez de um painel de filtros que exige aprender onde cada coisa mora, a
 * barra do topo se lê em português — "receita e margem, por produto, nos
 * últimos 30 dias" — e cada pedaço é um chip que abre as opções dele. É a mesma
 * estrutura do DSL, só que legível: o que a IA preenche por texto, o operador
 * ajusta no clique, e os dois terminam no mesmo lugar.
 */

export type ResultadoCliente = {
  colunas: ColunaResultado[];
  linhas: string[][];
  brutas: Record<string, string | number | null>[];
  variacoes?: (number | null)[][];
  totaisTexto: string[];
  totais: Record<string, number>;
  totalGrupos: number;
  truncado: boolean;
  metricasRemovidas: string[];
  filtrosRemovidos: string[];
  periodoLabel: string;
  descricao: string;
};

const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
] as const;

const LIMITES = [10, 20, 50, 100, 500];

export type SalvoAberto = { id: string; nome: string; meu: boolean; sistema: boolean };

export function ConsultaClient({
  consulta,
  catalogo,
  resultado,
  salvo,
  erro,
}: {
  consulta: Consulta;
  catalogo: FatoCliente[];
  resultado: ResultadoCliente | null;
  /** Relatório salvo que originou esta tela, quando veio de `?salvo=`. */
  salvo: SalvoAberto | null;
  erro: string | null;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const fato = catalogo.find((f) => f.id === consulta.fato) ?? catalogo[0];

  function aplicar(mudanca: Partial<Consulta>) {
    const proxima = { ...consulta, ...mudanca };
    iniciar(() => {
      router.push(`/relatorios/consulta?q=${codificarConsulta(proxima)}`);
    });
  }

  const dimensoesLivres = fato.dimensoes.filter((d) => !consulta.dimensoes.includes(d.id));
  const metricasLivres = fato.metricas.filter((m) => !consulta.metricas.includes(m.id));

  const rotuloDim = (id: string) => fato.dimensoes.find((d) => d.id === id)?.label ?? id;
  const rotuloMet = (id: string) => fato.metricas.find((m) => m.id === id)?.label ?? id;
  const rotuloCampo = (id: string) =>
    fato.dimensoes.find((d) => d.id === id)?.label ??
    fato.metricas.find((m) => m.id === id)?.label ??
    id;

  const exportHref = `/relatorios/consulta/export?q=${codificarConsulta(consulta)}`;
  const pdfHref = `/documento/consulta?q=${codificarConsulta(consulta)}`;

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-sm" aria-label="Navegação">
        <Link
          href="/relatorios/lista"
          className="flex items-center gap-1 text-muted transition-colors hover:text-ink"
        >
          <ChevronLeft size={14} aria-hidden />
          Relatórios
        </Link>
        <span className="text-faint" aria-hidden>
          /
        </span>
        <span className="font-medium text-ink" aria-current="page">
          {salvo ? salvo.nome : "Consulta"}
        </span>
        {salvo && !salvo.meu && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            {salvo.sistema ? "de fábrica" : "da equipe"}
          </span>
        )}
      </nav>

      {/* ── A frase ── */}
      <section
        className="rounded-lg border border-line bg-surface p-4 shadow-(--shadow-1)"
        aria-label="Consulta"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 text-sm">
          <Conector>Mostrar</Conector>

          {consulta.metricas.map((id) => (
            <Chip
              key={id}
              tom="metrica"
              onRemover={
                consulta.metricas.length > 1
                  ? () => aplicar({ metricas: consulta.metricas.filter((m) => m !== id) })
                  : undefined
              }
            >
              {rotuloMet(id)}
            </Chip>
          ))}
          {metricasLivres.length > 0 && (
            <Adicionar
              titulo="Adicionar métrica"
              desabilitado={consulta.metricas.length >= 6}
              opcoes={metricasLivres.map((m) => ({
                id: m.id,
                label: m.label,
                descricao: m.descricao,
              }))}
              onEscolher={(id) => aplicar({ metricas: [...consulta.metricas, id] })}
            />
          )}

          <Conector>por</Conector>

          {consulta.dimensoes.map((id) => (
            <Chip
              key={id}
              tom="dimensao"
              onRemover={() =>
                aplicar({ dimensoes: consulta.dimensoes.filter((d) => d !== id) })
              }
            >
              {rotuloDim(id)}
            </Chip>
          ))}
          {consulta.dimensoes.length === 0 && <Conector>tudo junto</Conector>}
          {dimensoesLivres.length > 0 && consulta.dimensoes.length < 3 && (
            <Adicionar
              titulo="Quebrar por"
              opcoes={dimensoesLivres.map((d) => ({
                id: d.id,
                label: d.label,
                descricao: d.descricao,
              }))}
              onEscolher={(id) => aplicar({ dimensoes: [...consulta.dimensoes, id] })}
            />
          )}

          {consulta.filtros.length > 0 && <Conector>onde</Conector>}
          {consulta.filtros.map((f, i) => (
            <Chip
              key={`${f.campo}-${i}`}
              tom="filtro"
              onRemover={() => aplicar({ filtros: consulta.filtros.filter((_, j) => j !== i) })}
            >
              {rotuloCampo(f.campo)} {SIMBOLO[f.op]} {String(f.valor)}
            </Chip>
          ))}
          <NovoFiltro
            fato={fato}
            desabilitado={consulta.filtros.length >= 8}
            onAdicionar={(filtro) => aplicar({ filtros: [...consulta.filtros, filtro] })}
          />

          {pendente && (
            <Loader2 size={14} className="animate-spin text-muted motion-reduce:animate-none" aria-label="Atualizando" />
          )}
        </div>

        {/* Período, comparação e recorte */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-canvas p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => aplicar({ periodo: { preset: p.id } })}
                aria-pressed={consulta.periodo.preset === p.id}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  consulta.periodo.preset === p.id
                    ? "bg-brand text-on-brand"
                    : "text-muted hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <PeriodoCustom consulta={consulta} onAplicar={aplicar} />

          <button
            type="button"
            onClick={() => aplicar({ comparar: !consulta.comparar })}
            aria-pressed={consulta.comparar}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              consulta.comparar
                ? "border-brand bg-brand-softer text-brand"
                : "border-line text-muted hover:text-ink",
            )}
          >
            Comparar com o período anterior
          </button>

          <Menu
            trigger={
              <button
                type="button"
                className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                Top {consulta.limite}
              </button>
            }
          >
            {LIMITES.map((l) => (
              <MenuItem key={l} onClick={() => aplicar({ limite: l })}>
                Top {l}
              </MenuItem>
            ))}
          </Menu>
        </div>

        {resultado && <p className="mt-3 text-xs text-faint">{resultado.descricao}</p>}
      </section>

      {/* ── Avisos ── */}
      {erro && <Aviso>{erro}</Aviso>}
      {resultado?.metricasRemovidas.length ? (
        <Aviso>
          {resultado.metricasRemovidas.join(", ")} — seu perfil não tem acesso a informações
          financeiras, então essas colunas ficaram de fora.
        </Aviso>
      ) : null}
      {resultado?.truncado && (
        <Aviso>
          O período tem mais dados do que cabe numa consulta. Reduza o intervalo para ver os
          números completos.
        </Aviso>
      )}

      {/* ── Resultado ── */}
      {resultado && (
        <>
          {resultado.linhas.length > 0 && (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {consulta.metricas.slice(0, 4).map((id, i) => (
                <div key={id} className="bg-surface px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {rotuloMet(id)}
                  </p>
                  <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
                    {resultado.totaisTexto[consulta.dimensoes.length + i]}
                  </p>
                </div>
              ))}
            </div>
          )}

          <Serie consulta={consulta} resultado={resultado} rotuloMet={rotuloMet} />

          <ChartCard
            title="Detalhamento"
            subtitle={
              resultado.totalGrupos > resultado.linhas.length
                ? `${resultado.linhas.length} de ${resultado.totalGrupos} linhas · ${resultado.periodoLabel}`
                : `${resultado.linhas.length} ${resultado.linhas.length === 1 ? "linha" : "linhas"} · ${resultado.periodoLabel}`
            }
          >
            {resultado.linhas.length === 0 ? (
              <ChartEmpty mensagem="Nada encontrado com esses filtros no período." />
            ) : (
              <Tabela
                consulta={consulta}
                resultado={resultado}
                onOrdenar={(por) =>
                  aplicar({
                    ordenar: {
                      por,
                      ordem:
                        consulta.ordenar?.por === por && consulta.ordenar.ordem === "desc"
                          ? "asc"
                          : "desc",
                    },
                  })
                }
              />
            )}
          </ChartCard>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <SalvarRelatorio q={codificarConsulta(consulta)} />
            <span className="mr-1 text-xs font-medium text-muted">Levar daqui:</span>
            <a
              href={exportHref}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <Download size={12} aria-hidden />
              CSV
            </a>
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <Printer size={12} aria-hidden />
              PDF
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ── Peças da frase ──────────────────────────────────────────

function Conector({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

const TOM = {
  metrica: "border-brand/40 bg-brand-softer text-brand",
  dimensao: "border-accent/40 bg-accent-soft text-accent",
  filtro: "border-line bg-surface-2 text-ink",
} as const;

function Chip({
  children,
  tom,
  onRemover,
}: {
  children: React.ReactNode;
  tom: keyof typeof TOM;
  onRemover?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        TOM[tom],
      )}
    >
      {children}
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label="Remover"
          className="cursor-pointer rounded-full opacity-60 transition-opacity hover:opacity-100"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  );
}

function Adicionar({
  titulo,
  opcoes,
  onEscolher,
  desabilitado,
}: {
  titulo: string;
  opcoes: { id: string; label: string; descricao: string }[];
  onEscolher: (id: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          disabled={desabilitado}
          aria-label={titulo}
          title={titulo}
          className="cursor-pointer rounded-full border border-dashed border-line p-1 text-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} aria-hidden />
        </button>
      }
    >
      <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {titulo}
      </p>
      {opcoes.map((o) => (
        <MenuItem key={o.id} onClick={() => onEscolher(o.id)}>
          <span className="block">{o.label}</span>
          <span className="block text-[11px] text-faint">{o.descricao}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

const SIMBOLO: Record<Operador, string> = {
  "=": "=",
  "!=": "≠",
  ">=": "≥",
  "<=": "≤",
  contem: "contém",
  em: "entre",
};

function NovoFiltro({
  fato,
  onAdicionar,
  desabilitado,
}: {
  fato: FatoCliente;
  onAdicionar: (f: { campo: string; op: Operador; valor: string | number }) => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [campo, setCampo] = useState(fato.dimensoes[0]?.id ?? "");
  const [op, setOp] = useState<Operador>("contem");
  const [valor, setValor] = useState("");

  const ehMetrica = fato.metricas.some((m) => m.id === campo);
  const opcoesOp: Operador[] = ehMetrica ? [">=", "<=", "="] : ["=", "!=", "contem"];
  const rotulo = (id: string) =>
    fato.dimensoes.find((d) => d.id === id)?.label ??
    fato.metricas.find((m) => m.id === id)?.label ??
    id;

  function confirmar() {
    if (!campo || valor.trim() === "") return;
    const numerico = ehMetrica || op === ">=" || op === "<=";
    onAdicionar({
      campo,
      op: opcoesOp.includes(op) ? op : opcoesOp[0],
      valor: numerico ? Number(valor.replace(",", ".")) || 0 : valor.trim(),
    });
    setValor("");
    setAberto(false);
  }

  if (!aberto) {
    return (
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setAberto(true)}
        className="flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Filter size={12} aria-hidden />
        Filtrar
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-brand/40 bg-surface-2 py-1 pl-2 pr-1">
      <Menu
        align="start"
        trigger={
          <button type="button" className="cursor-pointer text-xs font-semibold text-ink">
            {rotulo(campo)}
          </button>
        }
      >
        {[...fato.dimensoes, ...fato.metricas].map((c) => (
          <MenuItem
            key={c.id}
            onClick={() => {
              setCampo(c.id);
              setOp(fato.metricas.some((m) => m.id === c.id) ? ">=" : "contem");
            }}
          >
            {c.label}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        align="start"
        trigger={
          <button type="button" className="cursor-pointer text-xs text-muted">
            {SIMBOLO[op]}
          </button>
        }
      >
        {opcoesOp.map((o) => (
          <MenuItem key={o} onClick={() => setOp(o)}>
            {SIMBOLO[o]}
          </MenuItem>
        ))}
      </Menu>

      <input
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar();
          if (e.key === "Escape") setAberto(false);
        }}
        placeholder={ehMetrica ? "valor" : "texto"}
        aria-label={`Valor do filtro de ${rotulo(campo)}`}
        className="w-24 bg-transparent text-xs text-ink placeholder:text-faint focus:outline-none"
      />
      <button
        type="button"
        onClick={confirmar}
        className="cursor-pointer rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-on-brand"
      >
        Aplicar
      </button>
      <button
        type="button"
        onClick={() => setAberto(false)}
        aria-label="Cancelar filtro"
        className="cursor-pointer rounded-full p-1 text-muted hover:text-ink"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

/**
 * Guardar a consulta com nome. O que se salva é a PERGUNTA, não a resposta:
 * abrir de novo amanhã roda de novo, com os dados de amanhã.
 */
function SalvarRelatorio({ q }: { q: string }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [compartilhado, setCompartilhado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [enviando, iniciar] = useTransition();

  function salvar() {
    setErro(null);
    iniciar(async () => {
      const r = await salvarConsultaAction({ nome, q, compartilhado });
      if (r.ok) {
        setSalvo(true);
        setAberto(false);
        setNome("");
      } else {
        setErro(r.erro);
      }
    });
  }

  if (salvo && !aberto) {
    return (
      <span className="mr-auto flex items-center gap-1.5 text-xs font-medium text-ok">
        <Check size={13} aria-hidden />
        Relatório salvo
      </span>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="mr-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-ink"
      >
        <Bookmark size={12} aria-hidden />
        Salvar relatório
      </button>
    );
  }

  return (
    <div className="mr-auto flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") setAberto(false);
        }}
        placeholder="Nome do relatório"
        aria-label="Nome do relatório"
        maxLength={80}
        className="h-8 w-52 rounded-full border border-line bg-transparent px-3 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none"
      />
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
        <input
          type="checkbox"
          checked={compartilhado}
          onChange={(e) => setCompartilhado(e.target.checked)}
          className="accent-brand"
        />
        Compartilhar com a equipe
      </label>
      <button
        type="button"
        onClick={salvar}
        disabled={enviando || nome.trim().length < 2}
        className="cursor-pointer rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {enviando ? "Salvando…" : "Salvar"}
      </button>
      <button
        type="button"
        onClick={() => setAberto(false)}
        className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
      >
        Cancelar
      </button>
      {erro && <span className="text-xs text-danger">{erro}</span>}
    </div>
  );
}

function PeriodoCustom({
  consulta,
  onAplicar,
}: {
  consulta: Consulta;
  onAplicar: (m: Partial<Consulta>) => void;
}) {
  const [de, setDe] = useState(consulta.periodo.de ?? "");
  const [ate, setAte] = useState(consulta.periodo.ate ?? "");
  const ativo = consulta.periodo.preset === "custom";

  return (
    <span className="flex items-center gap-1.5">
      <input
        type="date"
        value={de}
        onChange={(e) => setDe(e.target.value)}
        aria-label="Data inicial"
        className={cn(
          "h-8 rounded-full border bg-transparent px-3 text-xs text-ink focus:border-brand focus:outline-none",
          ativo ? "border-brand" : "border-line",
        )}
      />
      <span className="text-xs text-faint">até</span>
      <input
        type="date"
        value={ate}
        onChange={(e) => setAte(e.target.value)}
        aria-label="Data final"
        className={cn(
          "h-8 rounded-full border bg-transparent px-3 text-xs text-ink focus:border-brand focus:outline-none",
          ativo ? "border-brand" : "border-line",
        )}
      />
      {de && (
        <button
          type="button"
          onClick={() => onAplicar({ periodo: { preset: "custom", de, ate: ate || undefined } })}
          className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          Usar
        </button>
      )}
    </span>
  );
}

// ── Resultado ───────────────────────────────────────────────

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-(--radius) border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-xs text-ink">
      <TriangleAlert size={14} className="mt-px shrink-0 text-warn" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Só faz sentido quando a quebra é o tempo — série exige eixo cronológico. */
function Serie({
  consulta,
  resultado,
  rotuloMet,
}: {
  consulta: Consulta;
  resultado: ResultadoCliente;
  rotuloMet: (id: string) => string;
}) {
  const iTempo = consulta.dimensoes.indexOf("tempo");
  if (iTempo < 0 || consulta.dimensoes.length !== 1 || resultado.linhas.length < 2) return null;

  const metrica = consulta.metricas[0];
  const pontos = resultado.brutas.map((linha) => ({
    data: String(linha.tempo ?? ""),
    valor: Number(linha[metrica] ?? 0),
  }));
  const colunaMetrica = resultado.colunas.find((c) => c.id === metrica);

  return (
    <ChartCard title={rotuloMet(metrica)} subtitle={`Ao longo do período · ${resultado.periodoLabel}`}>
      <LineChart
        pontos={pontos}
        formato={(v) =>
          colunaMetrica?.formato === "moeda"
            ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
            : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
        }
      />
    </ChartCard>
  );
}

function Tabela({
  consulta,
  resultado,
  onOrdenar,
}: {
  consulta: Consulta;
  resultado: ResultadoCliente;
  onOrdenar: (por: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {resultado.colunas.map((c) => {
              const ativa = consulta.ordenar?.por === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    "py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-muted",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOrdenar(c.id)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-ink",
                      ativa && "text-brand",
                    )}
                  >
                    {c.header}
                    {ativa &&
                      (consulta.ordenar?.ordem === "asc" ? (
                        <ArrowUp size={11} aria-hidden />
                      ) : (
                        <ArrowDown size={11} aria-hidden />
                      ))}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {resultado.linhas.map((linha, r) => (
            <tr key={r} className="border-b border-line/60 last:border-0">
              {linha.map((celula, c) => {
                const coluna = resultado.colunas[c];
                const variacao =
                  coluna?.tipo === "metrica" && resultado.variacoes
                    ? resultado.variacoes[r]?.[c - consulta.dimensoes.length]
                    : null;
                return (
                  <td
                    key={c}
                    className={cn(
                      "py-2 pr-4 text-ink",
                      coluna?.align === "right" ? "text-right tabular-nums" : "text-left",
                    )}
                  >
                    {celula}
                    {variacao != null && (
                      <span
                        className={cn(
                          "ml-1.5 text-[11px] font-medium tabular-nums",
                          variacao > 0 ? "text-ok" : variacao < 0 ? "text-danger" : "text-faint",
                        )}
                      >
                        {variacao > 0 ? "+" : ""}
                        {variacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            {resultado.totaisTexto.map((celula, c) => (
              <td
                key={c}
                className={cn(
                  "py-2.5 pr-4 text-ink",
                  resultado.colunas[c]?.align === "right" ? "text-right tabular-nums" : "text-left",
                )}
              >
                {celula}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
