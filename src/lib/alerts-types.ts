/**
 * Central de alertas (sino do navbar) — tipos e metadados de apresentação.
 * Módulo client-safe: sem acesso ao banco. A computação vive em
 * `src/app/(app)/_alerts.ts` (server action) e usa estes tipos.
 */

/** Prioridade visual do alerta — define a cor. */
export type AlertPriority = "critico" | "alto" | "medio" | "baixo" | "info";

/** Agrupamento do alerta no painel do sino. */
export type AlertCategory =
  | "criticos"
  | "operacao"
  | "consumo"
  | "inteligencia"
  | "financeiro"
  | "inventario";

/** Ícone do alerta — chave mapeada para um ícone no cliente. */
export type AlertIcon =
  | "sem-estoque"
  | "minimo"
  | "sem-preco"
  | "reposicao"
  | "compra"
  | "transferencia"
  | "recebimento"
  | "inventario"
  | "divergencia"
  | "novo"
  | "parado"
  | "custo"
  | "margem"
  | "consumo"
  | "alta"
  | "baixa"
  | "campeao"
  | "aniversario"
  | "cliente-risco";

export type AlertItem = {
  /** Estável entre recargas — usado para ocultar/resolver. Ex.: "sem-estoque:<productId>". */
  id: string;
  priority: AlertPriority;
  category: AlertCategory;
  icon: AlertIcon;
  titulo: string;
  descricao: string;
  /** Momento do evento (opcional) — vira "há 5 min", "ontem", "há 3 dias". */
  at?: string;
  /** Link da ação rápida. */
  href?: string;
  /** Rótulo da ação rápida. Ex.: "Abrir produto", "Ver detalhes", "Resolver". */
  acaoLabel?: string;
};

// ── Metadados de prioridade ─────────────────────────────────

export const PRIORITY_ORDER: Record<AlertPriority, number> = {
  critico: 0,
  alto: 1,
  medio: 2,
  baixo: 3,
  info: 4,
};

/** Classes de cor por prioridade (ponto + texto + fundo suave). */
export const PRIORITY_STYLE: Record<
  AlertPriority,
  { dot: string; text: string; soft: string }
> = {
  critico: { dot: "bg-danger", text: "text-danger", soft: "bg-danger-soft" },
  alto: { dot: "bg-warn", text: "text-warn", soft: "bg-warn-soft" },
  medio: { dot: "bg-brand", text: "text-brand", soft: "bg-brand-soft" },
  baixo: { dot: "bg-ok", text: "text-ok", soft: "bg-ok-soft" },
  info: { dot: "bg-muted", text: "text-muted", soft: "bg-surface-2" },
};

// ── Metadados de categoria ──────────────────────────────────

export const CATEGORY_ORDER: AlertCategory[] = [
  "criticos",
  "operacao",
  "consumo",
  "financeiro",
  "inventario",
  "inteligencia",
];

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  criticos: "Críticos",
  operacao: "Operação",
  consumo: "Consumo aberto",
  inteligencia: "Inteligência",
  financeiro: "Financeiro",
  inventario: "Inventário",
};

/** Ordena por categoria e, dentro dela, por prioridade. */
export function sortAlerts(alerts: AlertItem[]): AlertItem[] {
  const cat = (c: AlertCategory) => CATEGORY_ORDER.indexOf(c);
  return [...alerts].sort(
    (a, b) =>
      cat(a.category) - cat(b.category) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

/** "há 5 min", "ontem", "há 3 dias". */
export function tempoRelativo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  const mes = Math.round(d / 30);
  return mes === 1 ? "há 1 mês" : `há ${mes} meses`;
}
