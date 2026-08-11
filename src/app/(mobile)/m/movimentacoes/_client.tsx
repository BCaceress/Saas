"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  Check,
  ChevronDown,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bolha, MCard, MCardLink } from "@/components/mobile/ui";
import { rotuloMovimento } from "@/components/mobile/movimento-tipo";
import { CHIPS, MAX_DIAS, PERIODOS, paraInput } from "./_filtros";

export type LinhaMovimento = {
  id: string;
  productId: string;
  produto: string;
  sku: string;
  tipo: string;
  /** Rótulo curto já resolvido no servidor: Compra, PDV, Produção, Ajuste… */
  origem: string;
  documento: string | null;
  responsavel: string | null;
  observacao: string | null;
  delta: number;
  saldoDepois: number | null;
  em: string;
};

export function MovimentacoesClient({
  linhas,
  total,
  mostrando,
  chip,
  periodo,
  periodoLabel,
  de,
  ate,
  porPagina,
}: {
  linhas: LinhaMovimento[];
  total: number;
  mostrando: number;
  chip: string;
  periodo: string;
  /** Rótulo já resolvido da janela — vai no botão de data. */
  periodoLabel: string;
  /** Começo e fim da janela atual em YYYY-MM-DD — semente dos campos. */
  de: string;
  ate: string;
  porPagina: number;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [carregando, iniciar] = React.useTransition();
  // Qual filtro foi tocado. Sem isto o toque some sem resposta e a pessoa toca
  // de novo — o recorte vai ao servidor, e no 4G da loja isso demora.
  const [tocado, setTocado] = React.useState<string | null>(null);
  // Derivado, não sincronizado por efeito: a rodinha existe enquanto a viagem
  // dura, e a chegada dos dados novos a apaga sozinha.
  const emCurso = carregando ? tocado : null;

  function navegar(campos: {
    tipo?: string;
    periodo?: string;
    de?: string;
    ate?: string;
    n?: number;
    /** Chave do controle tocado — é ele que mostra a rodinha. */
    marca?: string;
  }) {
    const p = new URLSearchParams();
    const t = campos.tipo ?? chip;
    const per = campos.periodo ?? periodo;
    if (t !== "todos") p.set("tipo", t);
    if (per !== "7") p.set("periodo", per);
    if (per === "custom") {
      p.set("de", campos.de ?? de);
      p.set("ate", campos.ate ?? ate);
    }
    // Trocar de filtro volta ao primeiro lote: manter 300 linhas carregadas de
    // um recorte para o outro faria a tela demorar por dados que ninguém pediu.
    const n = campos.n ?? (campos.tipo || campos.periodo ? 50 : porPagina);
    if (n !== 50) p.set("n", String(n));
    const busca = p.toString();
    setTocado(campos.marca ?? null);
    iniciar(() => router.push(busca ? `/m/movimentacoes?${busca}` : "/m/movimentacoes"));
  }

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter((l) =>
      `${l.produto} ${l.sku} ${l.origem} ${l.documento ?? ""} ${l.responsavel ?? ""}`
        .toLowerCase()
        .includes(termo),
    );
  }, [linhas, busca]);

  // Dia a dia: o extrato se lê por jornada ("o que aconteceu ontem"), e sem a
  // quebra as 300 linhas viram uma parede só. As linhas já vêm da mais nova
  // para a mais velha, então basta cortar quando o dia muda.
  const grupos = React.useMemo(() => {
    const out: Array<{ dia: string; label: string; itens: LinhaMovimento[] }> = [];
    for (const l of visiveis) {
      const data = new Date(l.em);
      const dia = data.toDateString();
      const ultimo = out[out.length - 1];
      if (ultimo?.dia === dia) ultimo.itens.push(l);
      else out.push({ dia, label: rotuloDia(data), itens: [l] });
    }
    return out;
  }, [visiveis]);

  return (
    <div className="space-y-3">
      {/* Busca e data na MESMA linha: são as duas perguntas de quem chega
          ("esse produto" / "esse dia"), e empilhadas empurravam a lista para
          baixo da dobra. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Achar por produto, nota ou responsável"
            aria-label="Buscar movimentação"
            className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </div>

        {/* `key` da janela atual: quando os dados novos chegam o seletor
            remonta fechado, sem efeito nenhum para sincronizar isso. */}
        <SeletorData
          key={`${periodo}:${de}:${ate}`}
          periodo={periodo}
          label={periodoLabel}
          de={de}
          ate={ate}
          pendente={carregando}
          emCurso={emCurso}
          onEscolher={navegar}
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {CHIPS.map((c) => (
          <Chip
            key={c.valor}
            ativo={chip === c.valor}
            carregando={emCurso === `tipo:${c.valor}`}
            desabilitado={carregando}
            onClick={() => navegar({ tipo: c.valor, marca: `tipo:${c.valor}` })}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <MCard className="flex flex-col items-center gap-2 p-8 text-center">
          <SlidersHorizontal className="h-7 w-7 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">
            {busca.trim() ? "Nada com esse termo" : "Nenhuma movimentação no período"}
          </p>
          <p className="text-sm text-ink-2">
            {busca.trim()
              ? "Tente pelo nome do produto, número da nota ou quem lançou."
              : "Troque o período ou o tipo acima para olhar mais para trás."}
          </p>
        </MCard>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <section key={g.dia} className="space-y-2">
              <h2 className="px-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
                {g.label}
              </h2>
              <ul className="space-y-2">
                {g.itens.map((l) => (
                  <li key={l.id}>
                    <Linha linha={l} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* O contador é a resposta de "estou vendo tudo?" — sem ele, uma lista
          cortada em 50 parece o extrato inteiro. */}
      {visiveis.length > 0 && (
        <p className="px-1 text-center text-xs text-muted">
          {busca.trim()
            ? `${visiveis.length} de ${mostrando} carregadas`
            : `${mostrando} de ${total} movimentações`}
        </p>
      )}

      {mostrando < total && porPagina < 300 && !busca.trim() && (
        <button
          type="button"
          onClick={() => navegar({ n: Math.min(porPagina + 100, 300) })}
          disabled={carregando}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-button bg-surface text-sm font-medium text-ink disabled:opacity-50"
        >
          {carregando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Ver mais
        </button>
      )}
    </div>
  );
}

function Linha({ linha }: { linha: LinhaMovimento }) {
  const rotulo = rotuloMovimento({ tipo: linha.tipo });
  const hora = new Date(linha.em).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meio = [rotulo.label, linha.origem, linha.documento].filter(Boolean).join(" · ");

  return (
    <MCardLink
      href={`/m/produto/${linha.productId}?de=/m/movimentacoes`}
      className="flex items-center gap-3 p-3"
    >
      <Bolha icone={rotulo.icone} tom={rotulo.tom} tamanho="md" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{linha.produto}</p>
        <p className="truncate text-xs text-muted">{meio}</p>
        <p className="truncate text-[11px] text-faint">
          {hora}
          {linha.responsavel ? ` · ${linha.responsavel}` : ""}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            "font-display text-base leading-none font-semibold tabular-nums",
            linha.delta < 0 ? "text-danger" : "text-ok",
          )}
        >
          {linha.delta > 0 ? "+" : ""}
          {linha.delta.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
        </p>
        {linha.saldoDepois != null && (
          <p className="mt-1 text-[11px] text-muted tabular-nums">
            saldo {linha.saldoDepois.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
          </p>
        )}
      </div>
    </MCardLink>
  );
}

function Chip({
  ativo,
  onClick,
  carregando = false,
  desabilitado = false,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  /** Este chip foi o tocado — a rodinha fica NELE, não numa barra genérica. */
  carregando?: boolean;
  /** Outro filtro está viajando: a fila inteira para de aceitar toque. */
  desabilitado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      aria-busy={carregando || undefined}
      disabled={desabilitado && !carregando}
      className={cn(
        "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2 hover:bg-surface-2",
        desabilitado && !carregando && "opacity-50",
      )}
    >
      {carregando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Data à direita da busca. Abre para baixo com os quatro atalhos e um intervalo
 * próprio limitado a 30 dias — o mesmo teto que a tela de vendas usa, e pela
 * mesma razão: acima disso a consulta deixa de ser extrato de bolso.
 *
 * O menu NÃO fecha no toque. Fechar devolveria a lista antiga por um segundo,
 * que se lê como "não funcionou"; ele fica aberto com a rodinha na linha tocada
 * e some quando os dados novos chegam.
 */
function SeletorData({
  periodo,
  label,
  de,
  ate,
  pendente,
  emCurso,
  onEscolher,
}: {
  periodo: string;
  label: string;
  de: string;
  ate: string;
  pendente: boolean;
  emCurso: string | null;
  onEscolher: (campos: {
    periodo?: string;
    de?: string;
    ate?: string;
    marca?: string;
  }) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [datas, setDatas] = React.useState(periodo === "custom");
  const [inicio, setInicio] = React.useState(de);
  const [fim, setFim] = React.useState(ate);
  const caixa = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!aberto) return;
    function fora(e: PointerEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const hoje = paraInput(new Date());
  // O "de" não pode ser mais de 29 dias antes do "até": o campo já não deixa
  // pedir a janela que o servidor iria aparar em silêncio.
  const minInicio = paraInput(
    new Date(new Date(`${fim || hoje}T00:00:00`).getTime() - (MAX_DIAS - 1) * 86_400_000),
  );

  return (
    <div ref={caixa} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Período: ${label}`}
        className="tap inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line-button bg-surface px-3.5 text-[13px] font-medium whitespace-nowrap text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
        {label}
        {pendente && emCurso?.startsWith("periodo:") ? (
          <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
        ) : (
          <ChevronDown
            className={cn("h-4 w-4 text-muted transition-transform", aberto && "rotate-180")}
            aria-hidden
          />
        )}
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-m)] border border-line bg-surface shadow-[var(--shadow-2)]"
        >
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              type="button"
              role="menuitem"
              disabled={pendente}
              onClick={() => onEscolher({ periodo: p.valor, marca: `periodo:${p.valor}` })}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
            >
              <span className="flex-1">{p.label}</span>
              {emCurso === `periodo:${p.valor}` ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
              ) : (
                periodo === p.valor && <Check className="h-4 w-4 text-brand" aria-hidden />
              )}
            </button>
          ))}

          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => setDatas((v) => !v)}
              aria-expanded={datas}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-ink hover:bg-surface-2"
            >
              <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
              <span className="flex-1">Escolher datas</span>
              {periodo === "custom" && <Check className="h-4 w-4 text-brand" aria-hidden />}
            </button>

            {datas && (
              <div className="space-y-2 border-t border-line bg-surface-2 p-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">De</span>
                  <input
                    type="date"
                    value={inicio}
                    min={minInicio}
                    max={fim || hoje}
                    onChange={(e) => setInicio(e.target.value)}
                    className="min-h-10 w-full rounded-full border border-line-button bg-surface px-3 text-[13px] text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">Até</span>
                  <input
                    type="date"
                    value={fim}
                    min={inicio}
                    max={hoje}
                    onChange={(e) => setFim(e.target.value)}
                    className="min-h-10 w-full rounded-full border border-line-button bg-surface px-3 text-[13px] text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </label>
                <p className="text-[11px] text-muted">Máximo de {MAX_DIAS} dias.</p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!inicio || pendente}
                  onClick={() =>
                    onEscolher({
                      periodo: "custom",
                      de: inicio,
                      ate: fim || hoje,
                      marca: "periodo:custom",
                    })
                  }
                >
                  {emCurso === "periodo:custom" && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {emCurso === "periodo:custom" ? "Carregando…" : "Aplicar"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Hoje" / "Ontem" / "11/08" — cabeçalho de grupo do extrato. */
function rotuloDia(data: Date): string {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = new Date(data);
  dia.setHours(0, 0, 0, 0);
  const diff = Math.round((hoje.getTime() - dia.getTime()) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: dia.getFullYear() === hoje.getFullYear() ? undefined : "2-digit",
  });
}
