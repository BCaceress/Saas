// Filtros de /recebimento — lidos da URL, aplicados no banco.
//
// Módulo client-safe (sem `server-only`), mesmo padrão de `pedidos/_query.ts`:
// a página monta o filtro a partir dos searchParams e o client monta a URL de
// volta, com um vocabulário só. Dois vocabulários fariam a tela mostrar um
// recorte e o servidor devolver outro.
//
// A tela é UMA ABA POR VEZ. Não existe "tudo": cada aba faz a sua consulta,
// paginada no banco, e nenhuma outra roda. O histórico de concluídos cresce
// para sempre — abrir a tela não pode significar lê-lo.

/** Recortes da tela. Cada um responde a uma pergunta do operador. */
export type RecAba =
  | "aguardando" // PEDIDO com mercadoria esperada e nenhuma conferência aberta
  | "andamento" // recebimento chegou, ainda não foi conferido até o fim
  | "divergencia" // conferido com diferença registrada
  | "concluidos" // entrou no estoque — histórico
  | "avulsos" // recebimento sem pedido por trás
  | "sem-nfe"; // entrou sem documento fiscal — falta o XML

export const REC_ABAS: RecAba[] = [
  "aguardando",
  "andamento",
  "divergencia",
  "concluidos",
  "avulsos",
  "sem-nfe",
];

export const ABA_PADRAO: RecAba = "aguardando";

/** Qual contador do resumo aparece no rótulo da aba (null = sem contagem). */
export type ContadorAba = "aguardando" | "emConferencia" | "divergencia" | null;

/**
 * As abas visíveis, na ordem em que o operador precisa delas: primeiro o que
 * exige ação, por último o histórico e a exceção.
 *
 * `sem-nfe` não está aqui de propósito — é um recorte alcançado pelo indicador
 * "Sem NF-e" e por links de fora, não uma sexta aba competindo por atenção.
 */
export const REC_TABS: { aba: RecAba; label: string; contador: ContadorAba }[] = [
  { aba: "aguardando", label: "Aguardando recebimento", contador: "aguardando" },
  { aba: "andamento", label: "Em conferência", contador: "emConferencia" },
  { aba: "divergencia", label: "Com divergência", contador: "divergencia" },
  { aba: "concluidos", label: "Concluídos", contador: null },
  { aba: "avulsos", label: "Avulsos", contador: null },
];

/** A aba mostra PEDIDOS (não recebimentos)? Só "aguardando". */
export function abaDePedidos(aba: RecAba): boolean {
  return aba === "aguardando";
}

export const REC_LIMITES = [20, 50, 100];
export const REC_LIMITE_PADRAO = 20;

/** O envelope que toda aba devolve. Uma página, nunca a lista inteira. */
export type Pagina<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function paginaVazia<T>(f: RecFiltros): Pagina<T> {
  return { items: [], total: 0, page: f.pagina, limit: f.limite, totalPages: 1 };
}

export function montarPagina<T>(items: T[], total: number, f: RecFiltros): Pagina<T> {
  return {
    items,
    total,
    page: f.pagina,
    limit: f.limite,
    totalPages: Math.max(1, Math.ceil(total / f.limite)),
  };
}

export type RecFiltros = {
  q: string;
  supplierId: string;
  aba: RecAba;
  /** dias: "" | "7" | "30" | "90" */
  periodo: string;
  pagina: number;
  limite: number;
};

export const REC_FILTROS_VAZIO: RecFiltros = {
  q: "",
  supplierId: "",
  aba: ABA_PADRAO,
  periodo: "30",
  pagina: 1,
  limite: REC_LIMITE_PADRAO,
};

/**
 * O período recorta histórico, não trabalho.
 *
 * Uma conferência aberta há 40 dias é justamente a que ninguém pode perder de
 * vista; escondê-la por causa de um filtro padrão de 30 dias transformaria o
 * filtro num apagador de pendência.
 */
export function periodoAplicavel(aba: RecAba): boolean {
  return aba === "concluidos" || aba === "avulsos";
}

export function filtrosDaUrl(sp: Record<string, string | string[] | undefined>): RecFiltros {
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const q = um("q").trim();
  // O parâmetro continua chamando `status` na URL: links antigos
  // (/recebimento?status=sem-nfe) precisam continuar caindo no lugar certo.
  const abaBruta = um("status") as RecAba;
  const aba = REC_ABAS.includes(abaBruta) ? abaBruta : ABA_PADRAO;
  const periodoBruto = um("periodo");
  const limiteBruto = Number(um("limite"));

  return {
    q,
    supplierId: um("fornecedor"),
    aba,
    // Quem chega buscando procura UM recebimento, que pode ser de meses atrás
    // — recortar por período esconderia justamente o que a pessoa veio ver.
    periodo: periodoBruto || (q ? "" : REC_FILTROS_VAZIO.periodo),
    pagina: Math.max(1, Number(um("pagina")) || 1),
    limite: REC_LIMITES.includes(limiteBruto) ? limiteBruto : REC_LIMITE_PADRAO,
  };
}

export function urlDosFiltros(f: RecFiltros): string {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.supplierId) q.set("fornecedor", f.supplierId);
  if (f.aba !== ABA_PADRAO) q.set("status", f.aba);
  if (f.periodo !== REC_FILTROS_VAZIO.periodo) q.set("periodo", f.periodo);
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  if (f.limite !== REC_LIMITE_PADRAO) q.set("limite", String(f.limite));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** A aba não é filtro: ela é onde a pessoa está. Isto conta o que recorta. */
export function filtrosAtivos(f: RecFiltros): boolean {
  return (
    f.q.trim() !== "" ||
    f.supplierId !== "" ||
    (periodoAplicavel(f.aba) && f.periodo !== REC_FILTROS_VAZIO.periodo)
  );
}

/**
 * A busca é contextual: cada aba procura dentro do que ela mostra.
 *
 * Prometer "NF-e" no campo da aba de pedidos seria mentira — pedido não tem
 * nota; ela nasce no recebimento.
 */
export function placeholderBusca(aba: RecAba): string {
  return abaDePedidos(aba)
    ? "Buscar pedido, fornecedor ou produto…"
    : aba === "andamento"
      ? "Buscar recebimento, pedido, NF-e ou fornecedor…"
      : "Buscar recebimento, NF-e, pedido ou fornecedor…";
}
