import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Receipt,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { withTenant, type ActiveTenant } from "@/lib/current-tenant";
import { variacao, type Variacao } from "@/lib/periodo";
import { brl, cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { KpiCarousel, KpiSlide } from "@/components/mobile/kpi-carousel";
import { resumoVendas, ruptura, type Range } from "@/app/(app)/relatorios/_data";
import { contarVencimentos } from "@/app/(app)/estoque/_data";
import { pedidosEmAndamento } from "@/app/(app)/inicio/_data";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";

/**
 * Blocos da home mobile. Cada um é uma ilha de `<Suspense>` da página.
 *
 * Cada seção reabre `withTenant`: o AsyncLocalStorage do tenant NÃO atravessa a
 * fronteira de streaming do React — a mesma regra documentada em
 * `(app)/inicio/_sections.tsx`. Sem isso a query sai sem tenantId e estoura.
 *
 * A home NÃO usa `buildInsights`: aquele motor pede quinze carregadores (o
 * dashboard inteiro) para escrever um parágrafo. No celular a mesma pergunta —
 * "o que precisa de mim agora?" — já é respondida por `getAlerts()`, numa
 * chamada só, já ordenada por prioridade. Ver `_precisa-de-voce.tsx`.
 */

export type MobileCtx = {
  ctx: ActiveTenant;
  range: Range;
  prevRange: Range;
  siteId: string | null;
  policy: EstoquePolicy;
  validadeAlertaDias: number;
};

/* ── Indicadores do dia ─────────────────────────────────────── */

export async function KpisSection({ d }: { d: MobileCtx }) {
  const { resumo, prev } = await withTenant(d.ctx, async () => {
    const [resumo, prev] = await Promise.all([
      resumoVendas(d.range, d.siteId),
      resumoVendas(d.prevRange, d.siteId),
    ]);
    return { resumo, prev };
  });

  return (
    <KpiCarousel>
      <KpiSlide>
        <Tile
          label="Receita"
          valor={brl(resumo.faturamento)}
          delta={variacao(resumo.faturamento, prev.faturamento)}
          icone={DollarSign}
          tom="brand"
        />
      </KpiSlide>
      <KpiSlide>
        <Tile
          label="Lucro bruto"
          valor={brl(resumo.margemBruta)}
          delta={variacao(resumo.margemBruta, prev.margemBruta)}
          nota={`${Math.round(resumo.margemPct)}% da receita`}
          icone={TrendingUp}
          tom="ok"
        />
      </KpiSlide>
      <KpiSlide>
        <Tile
          label="Vendas"
          valor={String(resumo.numVendas)}
          delta={variacao(resumo.numVendas, prev.numVendas)}
          nota={`ticket ${brl(resumo.ticket)}`}
          icone={Receipt}
          tom="info"
        />
      </KpiSlide>
    </KpiCarousel>
  );
}

export function KpisFallback() {
  return (
    <KpiCarousel>
      {[0, 1, 2].map((i) => (
        <KpiSlide key={i}>
          <Card className="h-28 animate-pulse bg-surface-2" />
        </KpiSlide>
      ))}
    </KpiCarousel>
  );
}

const TOM_TILE = {
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
} as const;

function Tile({
  label,
  valor,
  delta,
  nota,
  icone: Icone,
  tom,
}: {
  label: string;
  valor: string;
  delta?: Variacao | null;
  nota?: string;
  icone: LucideIcon;
  tom: keyof typeof TOM_TILE;
}) {
  return (
    <Card className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-full", TOM_TILE[tom])}>
          <Icone className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-xs font-medium text-ink-2">{label}</span>
      </div>

      <p className="font-display text-2xl leading-none font-semibold text-ink">{valor}</p>

      <div className="flex min-h-4 items-center gap-2 text-[11px]">
        {delta?.pct != null && (
          // Seta + sinal, não só cor: daltonismo não pode custar a leitura.
          <span
            className={cn(
              "font-medium",
              delta.dir === "up" ? "text-ok" : delta.dir === "down" ? "text-danger" : "text-muted",
            )}
          >
            {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—"}{" "}
            {Math.abs(delta.pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
        )}
        {nota && <span className="truncate text-muted">{nota}</span>}
      </div>
    </Card>
  );
}

/* ── Faixa de operação ──────────────────────────────────────── */

export async function OperacaoSection({ d }: { d: MobileCtx }) {
  const { rupturaRows, vencimentos, pedidos } = await withTenant(d.ctx, async () => {
    const [rupturaRows, vencimentos, pedidos] = await Promise.all([
      ruptura(d.siteId, d.policy),
      contarVencimentos(d.siteId, d.validadeAlertaDias),
      pedidosEmAndamento(d.siteId),
    ]);
    return { rupturaRows, vencimentos, pedidos };
  });

  const chegamHoje = pedidos.filter((p) => p.previsaoHoje).length;

  const linhas = [
    {
      href: d.policy.usaGiro ? "/m/estoque?filtro=sem" : "/m/estoque?filtro=minimo",
      icone: AlertTriangle,
      label: d.policy.usaGiro ? "Sem estoque" : "Abaixo do mínimo",
      valor: rupturaRows.length,
      tom: rupturaRows.length > 0 ? ("danger" as const) : ("ok" as const),
      nota: rupturaRows.length > 0 ? rupturaRows[0].nome : "nada em falta",
    },
    {
      // Validade continua no desktop: `/m/estoque` mostra saldo, não lote.
      href: "/estoque/validade",
      icone: CalendarClock,
      label: "Validade",
      valor: vencimentos.vencidos + vencimentos.vencendo,
      tom: vencimentos.vencidos > 0 ? ("danger" as const) : vencimentos.vencendo > 0 ? ("warn" as const) : ("ok" as const),
      nota:
        vencimentos.vencidos > 0
          ? `${vencimentos.vencidos} já ${vencimentos.vencidos === 1 ? "vencido" : "vencidos"}`
          : vencimentos.vencendo > 0
            ? "vencendo em breve"
            : "nada vencendo",
    },
    {
      href: "/m/receber",
      icone: Truck,
      label: "Pedidos a receber",
      valor: pedidos.length,
      tom: "info" as const,
      nota: chegamHoje > 0 ? `${chegamHoje} ${chegamHoje === 1 ? "chega" : "chegam"} hoje` : "nenhum previsto hoje",
    },
  ];

  return (
    <Card className="divide-y divide-line overflow-hidden">
      {linhas.map((l) => (
        <Link
          key={l.label}
          href={l.href}
          className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full",
              l.tom === "danger"
                ? "bg-danger-soft text-danger"
                : l.tom === "warn"
                  ? "bg-warn-soft text-warn"
                  : l.tom === "ok"
                    ? "bg-ok-soft text-ok"
                    : "bg-info-soft text-info",
            )}
          >
            <l.icone className="h-4 w-4" aria-hidden />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">{l.label}</span>
            <span className="block truncate text-xs text-muted">{l.nota}</span>
          </span>

          <span className="font-display text-lg font-semibold text-ink tabular-nums">
            {l.valor}
          </span>
        </Link>
      ))}
    </Card>
  );
}

export function OperacaoFallback() {
  return <Card className="h-44 animate-pulse bg-surface-2" />;
}
