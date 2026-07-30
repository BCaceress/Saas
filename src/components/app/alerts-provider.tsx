"use client";

import * as React from "react";
import { getAlerts } from "@/app/(app)/_alerts";
import {
  PRIORITY_ORDER,
  sortAlerts,
  type AlertItem,
  type AlertPriority,
} from "@/lib/alerts-types";
import { navMatches } from "@/components/app/nav-config";

/**
 * Alertas do tenant, buscados uma vez por carga e compartilhados.
 *
 * O sino era o único consumidor e chamava `getAlerts()` por conta própria;
 * agora o menu também precisa dos mesmos números (badge por área). Centralizar
 * aqui evita duas viagens ao banco para a mesma resposta — e garante que menu
 * e sino nunca discordem sobre quantos alertas existem.
 *
 * Alerta ocultado ("marcar como resolvido") some dos dois lugares: quem
 * limpou o sino não quer o menu continuar aceso.
 */

const STORAGE_KEY = "nohub:alerts:dismissed";

type AlertsCtx = {
  /** Alertas visíveis (já ordenados e sem os ocultados). */
  alerts: AlertItem[];
  loading: boolean;
  loaded: boolean;
  refresh: () => void;
  ocultar: (id: string) => void;
  ocultarTodos: () => void;
  /** Quantos alertas caem nesta rota ou abaixo dela. */
  contar: (href: string) => number;
  /** Pior prioridade entre os alertas desta rota — define a cor do badge. */
  prioridadeDe: (href: string) => AlertPriority | null;
};

const Ctx = React.createContext<AlertsCtx | null>(null);

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Só o caminho — `?filtro=` e `#ancora` não decidem a que área o alerta pertence. */
const rota = (href: string) => href.split(/[?#]/)[0];

function saveDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignora quota/privacidade */
  }
}

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [todos, setTodos] = React.useState<AlertItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  // No servidor devolve vazio; no cliente já nasce com o que foi ocultado.
  // Nada renderizado depende disto antes de `todos` chegar, então não há
  // divergência de hidratação.
  const [dismissed, setDismissed] = React.useState<Set<string>>(loadDismissed);

  const refresh = React.useCallback(() => {
    setLoading(true);
    getAlerts()
      .then((rows) => setTodos(sortAlerts(rows)))
      .catch(() => setTodos([]))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, []);

  // Primeira carga. O `setState` mora nos callbacks da promessa, não no corpo
  // do efeito — senão vira render em cascata logo na montagem do shell.
  React.useEffect(() => {
    let vivo = true;
    getAlerts()
      .then((rows) => vivo && setTodos(sortAlerts(rows)))
      .catch(() => vivo && setTodos([]))
      .finally(() => {
        if (!vivo) return;
        setLoading(false);
        setLoaded(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const alerts = React.useMemo(
    () => todos.filter((a) => !dismissed.has(a.id)),
    [todos, dismissed],
  );

  const ocultar = React.useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const ocultarTodos = React.useCallback(() => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const a of alerts) next.add(a.id);
      saveDismissed(next);
      return next;
    });
  }, [alerts]);

  const contar = React.useCallback(
    (href: string) =>
      alerts.filter((a) => a.href && navMatches(rota(a.href), href)).length,
    [alerts],
  );

  const prioridadeDe = React.useCallback(
    (href: string) => {
      let pior: AlertPriority | null = null;
      for (const a of alerts) {
        if (!a.href || !navMatches(rota(a.href), href)) continue;
        if (pior === null || PRIORITY_ORDER[a.priority] < PRIORITY_ORDER[pior]) {
          pior = a.priority;
        }
      }
      return pior;
    },
    [alerts],
  );

  const value = React.useMemo<AlertsCtx>(
    () => ({
      alerts,
      loading,
      loaded,
      refresh,
      ocultar,
      ocultarTodos,
      contar,
      prioridadeDe,
    }),
    [alerts, loading, loaded, refresh, ocultar, ocultarTodos, contar, prioridadeDe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Componentes fora do shell (ex.: totem) não têm provider — devolvemos um
 * contexto vazio em vez de explodir, para o menu nunca derrubar a tela.
 */
const VAZIO: AlertsCtx = {
  alerts: [],
  loading: false,
  loaded: true,
  refresh: () => {},
  ocultar: () => {},
  ocultarTodos: () => {},
  contar: () => 0,
  prioridadeDe: () => null,
};

export function useAlerts(): AlertsCtx {
  return React.useContext(Ctx) ?? VAZIO;
}
