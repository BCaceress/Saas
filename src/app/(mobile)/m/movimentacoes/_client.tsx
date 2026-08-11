"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bolha, MCard, MCardLink } from "@/components/mobile/ui";
import { rotuloMovimento } from "@/components/mobile/movimento-tipo";
import { CHIPS, PERIODOS } from "./_filtros";

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
  porPagina,
}: {
  linhas: LinhaMovimento[];
  total: number;
  mostrando: number;
  chip: string;
  periodo: string;
  porPagina: number;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [carregando, iniciar] = React.useTransition();

  function navegar(campos: { tipo?: string; periodo?: string; n?: number }) {
    const p = new URLSearchParams();
    const t = campos.tipo ?? chip;
    const per = campos.periodo ?? periodo;
    if (t !== "todos") p.set("tipo", t);
    if (per !== "7") p.set("periodo", per);
    // Trocar de filtro volta ao primeiro lote: manter 300 linhas carregadas de
    // um recorte para o outro faria a tela demorar por dados que ninguém pediu.
    const n = campos.n ?? (campos.tipo || campos.periodo ? 50 : porPagina);
    if (n !== 50) p.set("n", String(n));
    const busca = p.toString();
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
      <div className="relative">
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

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {CHIPS.map((c) => (
          <Chip
            key={c.valor}
            ativo={chip === c.valor}
            onClick={() => navegar({ tipo: c.valor })}
          >
            {c.label}
          </Chip>
        ))}
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {PERIODOS.map((p) => (
          <Chip
            key={p.valor}
            ativo={periodo === p.valor}
            onClick={() => navegar({ periodo: p.valor })}
            discreto
          >
            {p.label}
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
  discreto = false,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  /** Segunda fila (período): pesa menos que a de tipo, que é o filtro principal. */
  discreto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        ativo
          ? discreto
            ? "border-transparent bg-surface-2 text-ink"
            : "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2 hover:bg-surface-2",
      )}
    >
      {children}
    </button>
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
