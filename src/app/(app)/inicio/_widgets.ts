/**
 * Registro dos widgets personalizáveis do Centro de Operações. Cabeçalho,
 * Assistente e KPIs ficam sempre visíveis (são a resposta às 6 perguntas em
 * 10s) — só os blocos de análise abaixo entram na personalização.
 */

export type WidgetId =
  | "tendencia"
  | "mix"
  | "produtos"
  | "margem"
  | "insights"
  | "sem_giro"
  | "categorias"
  | "por_site"
  | "fiscal";

export const WIDGET_ORDER_DEFAULT: WidgetId[] = [
  "tendencia",
  "mix",
  "produtos",
  "margem",
  "insights",
  "sem_giro",
  "categorias",
  "por_site",
  "fiscal",
];

export const WIDGET_LABEL: Record<WidgetId, string> = {
  tendencia: "Gráfico de tendência",
  mix: "Mix de pagamento / ruptura",
  produtos: "Produtos que mais vendem",
  margem: "Maior margem",
  insights: "Insights inteligentes",
  sem_giro: "Produtos sem giro",
  categorias: "Categorias",
  por_site: "Faturamento por ponto",
  fiscal: "Situação fiscal",
};

/** Junta a ordem salva com widgets novos (não presentes na preferência salva ainda), no final. */
export function resolveOrder(saved: string[]): WidgetId[] {
  const validSaved = saved.filter((id): id is WidgetId => WIDGET_ORDER_DEFAULT.includes(id as WidgetId));
  const faltando = WIDGET_ORDER_DEFAULT.filter((id) => !validSaved.includes(id));
  return [...validSaved, ...faltando];
}
