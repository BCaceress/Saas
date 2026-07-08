"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell, Check, X, PackageX, AlertTriangle, Tag, PackagePlus, ShoppingCart,
  ArrowLeftRight, Truck, ClipboardList, Sparkles, PauseCircle, Coins, Percent,
  Wine, TrendingUp, TrendingDown, Flame, Loader2, CheckCheck, Cake, Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAlerts } from "@/app/(app)/_alerts";
import {
  type AlertItem, type AlertIcon, CATEGORY_ORDER, CATEGORY_LABEL,
  PRIORITY_STYLE, sortAlerts, tempoRelativo,
} from "@/lib/alerts-types";

const STORAGE_KEY = "nohub:alerts:dismissed";

const ICON: Record<AlertIcon, React.ReactNode> = {
  "sem-estoque": <PackageX size={16} />,
  minimo: <AlertTriangle size={16} />,
  "sem-preco": <Tag size={16} />,
  reposicao: <PackagePlus size={16} />,
  compra: <ShoppingCart size={16} />,
  transferencia: <ArrowLeftRight size={16} />,
  recebimento: <Truck size={16} />,
  inventario: <ClipboardList size={16} />,
  divergencia: <AlertTriangle size={16} />,
  novo: <Sparkles size={16} />,
  parado: <PauseCircle size={16} />,
  custo: <Coins size={16} />,
  margem: <Percent size={16} />,
  consumo: <Wine size={16} />,
  alta: <TrendingUp size={16} />,
  baixa: <TrendingDown size={16} />,
  campeao: <Flame size={16} />,
  aniversario: <Cake size={16} />,
  "cliente-risco": <Gift size={16} />,
};

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignora quota/privacidade */
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    getAlerts()
      .then((rows) => setAlerts(sortAlerts(rows)))
      .catch(() => setAlerts([]))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, []);

  // Carrega uma vez ao montar (para o contador) e revalida ao abrir.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const visiveis = useMemo(
    () => alerts.filter((a) => !dismissed.has(a.id)),
    [alerts, dismissed],
  );

  const grupos = useMemo(() => {
    const map = new Map<string, AlertItem[]>();
    for (const a of visiveis) {
      const arr = map.get(a.category) ?? [];
      arr.push(a);
      map.set(a.category, arr);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      categoria: c,
      itens: map.get(c)!,
    }));
  }, [visiveis]);

  function ocultar(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }

  function limparTudo() {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const a of visiveis) next.add(a.id);
      saveDismissed(next);
      return next;
    });
  }

  const total = visiveis.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer"
        aria-label={`Alertas${total > 0 ? ` (${total})` : ""}`}
        title="Alertas"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell size={18} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 flex max-h-[min(32rem,calc(100vh-5rem))] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-2)]"
        >
          {/* Cabeçalho */}
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Alertas</span>
              {total > 0 && (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted tnum">
                  {total}
                </span>
              )}
              {loading && <Loader2 size={14} className="animate-spin text-faint" />}
            </div>
            {total > 0 && (
              <button
                onClick={limparTudo}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer"
              >
                <CheckCheck size={13} /> Marcar tudo
              </button>
            )}
          </div>

          {/* Corpo */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!loaded && loading ? (
              <div className="grid place-items-center gap-2 px-4 py-12 text-muted">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">Carregando alertas…</span>
              </div>
            ) : total === 0 ? (
              <div className="grid place-items-center gap-2 px-4 py-12 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-ok-soft text-ok">
                  <Check size={20} />
                </span>
                <p className="text-sm font-medium text-ink">Tudo em ordem</p>
                <p className="max-w-[16rem] text-xs text-muted">
                  Nenhum alerta agora. Voltamos a avisar quando algo precisar de atenção.
                </p>
              </div>
            ) : (
              grupos.map(({ categoria, itens }) => (
                <div key={categoria} className="border-b border-line last:border-0">
                  <div className="flex items-center justify-between bg-surface-2/60 px-4 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                      {CATEGORY_LABEL[categoria]}
                    </span>
                    <span className="text-[10px] font-semibold text-faint tnum">{itens.length}</span>
                  </div>
                  <ul>
                    {itens.map((a) => (
                      <AlertRow
                        key={a.id}
                        alerta={a}
                        onOcultar={() => ocultar(a.id)}
                        onNavegar={() => setOpen(false)}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alerta,
  onOcultar,
  onNavegar,
}: {
  alerta: AlertItem;
  onOcultar: () => void;
  onNavegar: () => void;
}) {
  const style = PRIORITY_STYLE[alerta.priority];
  return (
    <li className="group relative flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full",
          style.soft,
          style.text,
        )}
        aria-hidden
      >
        {ICON[alerta.icon]}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} aria-hidden />
          <p className="truncate text-[13px] font-semibold text-ink">{alerta.titulo}</p>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{alerta.descricao}</p>
        <div className="mt-1 flex items-center gap-2">
          {alerta.at && (
            <span className="text-[11px] text-faint">{tempoRelativo(alerta.at)}</span>
          )}
          {alerta.href && (
            <Link
              href={alerta.href}
              onClick={onNavegar}
              className={cn(
                "text-[11px] font-semibold transition-colors hover:underline",
                style.text,
              )}
            >
              {alerta.acaoLabel ?? "Ver detalhes"}
            </Link>
          )}
        </div>
      </div>

      <button
        onClick={onOcultar}
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint opacity-0 transition-all hover:bg-surface hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
        aria-label="Marcar como resolvido"
        title="Resolver / ocultar"
      >
        <X size={14} />
      </button>
    </li>
  );
}
