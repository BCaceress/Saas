"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { AlertTriangle, History, PackageCheck, PackageX, ShoppingCart, Sparkles, Truck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { ComprasClient } from "./_pedidos";
import { RecebimentosClient } from "./_recebimentos";
import { ExtratoEntradas } from "./_historico";
import { ReposicaoClient } from "./_reposicao";
import type { GrupoReposicao } from "./_data";
import type { StatusRepo } from "./_ui";
import { fmtMoney } from "./_ui";

type SubTab = "reposicao" | "pedidos" | "receber" | "historico";

export function ComprasHub({
  reposicao,
  compras,
  receber,
  eventos,
}: {
  reposicao: { grupos: GrupoReposicao[]; siteId: string | null; empresa: string };
  compras: ComponentProps<typeof ComprasClient>;
  receber: ComponentProps<typeof RecebimentosClient>;
  eventos: ComponentProps<typeof ExtratoEntradas>["eventos"];
}) {
  const [tab, setTab] = useState<SubTab>("reposicao");
  const [reposFiltro, setReposFiltro] = useState<StatusRepo | "todos">("todos");

  // ── Situação da reposição em números (deriva das props) ──
  const stats = useMemo(() => {
    let rupturas = 0;
    let sugestoes = 0;
    for (const g of reposicao.grupos) {
      for (const it of g.itens) {
        sugestoes += 1;
        if (it.status === "ruptura") rupturas += 1;
      }
    }
    const abertos = compras.pedidos.filter((p) => ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status));
    const valorPendente = abertos.reduce(
      (acc, p) => acc + p.items.reduce((a, it) => a + Math.max(0, it.qtdPedida - it.qtdRecebida) * it.custoUnitario, 0),
      0,
    );
    return { rupturas, sugestoes, aCaminho: abertos.length + receber.transferencias.length, valorPendente };
  }, [reposicao.grupos, compras.pedidos, receber.transferencias]);

  const irParaReposicao = (filtro: StatusRepo | "todos") => {
    setReposFiltro(filtro);
    setTab("reposicao");
  };

  const receberCount = receber.pedidos.length + receber.transferencias.length;

  const subtabs = [
    { key: "reposicao" as const, label: "Reposição", icon: Sparkles, count: stats.sugestoes, alerta: stats.rupturas > 0 },
    { key: "pedidos" as const, label: "Pedidos", icon: ShoppingCart, count: compras.pedidos.length, alerta: false },
    { key: "receber" as const, label: "A receber", icon: PackageCheck, count: receberCount, alerta: false },
    { key: "historico" as const, label: "Histórico", icon: History, count: 0, alerta: false },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Situação da reposição — cards de ação ── */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          icon={PackageX}
          rotulo="Em ruptura"
          valor={String(stats.rupturas)}
          hint="produtos com venda parada"
          tom={stats.rupturas > 0 ? "danger" : "ok"}
          onClick={() => irParaReposicao("ruptura")}
        />
        <StatCard
          icon={AlertTriangle}
          rotulo="Precisam de compra"
          valor={String(stats.sugestoes)}
          hint="sugestões prontas p/ revisar"
          tom={stats.sugestoes > 0 ? "warn" : "ok"}
          onClick={() => irParaReposicao("todos")}
        />
        <StatCard
          icon={Truck}
          rotulo="A caminho"
          valor={String(stats.aCaminho)}
          hint="pedidos e transferências"
          tom="brand"
          onClick={() => setTab("receber")}
        />
        <StatCard
          icon={Wallet}
          rotulo="Compras pendentes"
          valor={fmtMoney(stats.valorPendente)}
          hint="valor ainda não recebido"
          tom="neutro"
          onClick={() => setTab("pedidos")}
        />
      </div>

      {/* ── Sub-abas: etapa da mercadoria ── */}
      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {subtabs.map(({ key, label, icon: Icon, count, alerta }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-4",
              tab === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon size={15} className="shrink-0" />
            <span className="hidden sm:inline">{label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  alerta ? "bg-danger-soft text-danger" : tab === key ? "bg-brand/10 text-brand" : "bg-surface text-faint",
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "reposicao" && (
        <ReposicaoClient
          grupos={reposicao.grupos}
          siteId={reposicao.siteId}
          empresa={reposicao.empresa}
          filtro={reposFiltro}
          onFiltro={setReposFiltro}
        />
      )}
      {tab === "pedidos" && <ComprasClient {...compras} />}
      {tab === "receber" && <RecebimentosClient {...receber} />}
      {tab === "historico" && <ExtratoEntradas eventos={eventos} />}
    </div>
  );
}

// ── Card de situação ──────────────────────────────────────────

const TONS = {
  danger: { icon: "bg-danger-soft text-danger", valor: "text-danger" },
  warn: { icon: "bg-warn-soft text-warn", valor: "text-ink" },
  brand: { icon: "bg-brand-soft text-brand", valor: "text-ink" },
  ok: { icon: "bg-ok-soft text-ok", valor: "text-ink" },
  neutro: { icon: "bg-surface-2 text-muted", valor: "text-ink" },
} as const;

function StatCard({
  icon: Icon,
  rotulo,
  valor,
  hint,
  tom,
  onClick,
}: {
  icon: React.ElementType;
  rotulo: string;
  valor: string;
  hint: string;
  tom: keyof typeof TONS;
  onClick: () => void;
}) {
  const t = TONS[tom];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-(--shadow-1) transition-colors hover:border-line-strong hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
    >
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", t.icon)}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className={cn("block font-display text-lg font-semibold leading-tight tabular-nums", t.valor)}>{valor}</span>
        <span className="block truncate text-xs font-medium text-muted">{rotulo}</span>
        <span className="hidden truncate text-[11px] text-faint xl:block">{hint}</span>
      </span>
    </button>
  );
}
