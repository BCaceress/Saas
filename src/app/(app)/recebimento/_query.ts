// Filtros de /recebimento — lidos da URL, aplicados no banco.
//
// Módulo client-safe (sem `server-only`), mesmo padrão de `pedidos/_query.ts`:
// a página monta o filtro a partir dos searchParams e o client monta a URL de
// volta, com um vocabulário só. Dois vocabulários fariam a tela mostrar um
// recorte e o servidor devolver outro.
//
// A tela abre em TODOS e o status é um filtro de seleção múltipla: nenhum
// marcado = tudo; marcados = a união deles. A lista continua paginada no banco
// — "todos" não significa ler o histórico inteiro, e o período segue recortando
// o que já foi concluído.

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

/** Qual contador do resumo aparece no rótulo do recorte (null = sem contagem). */
export type ContadorAba = "aguardando" | "emConferencia" | "divergencia" | null;

/**
 * As opções do filtro de status, na ordem em que o operador precisa delas:
 * primeiro o que exige ação, por último o histórico e a exceção.
 */
export const REC_RECORTES: { aba: RecAba; label: string; contador: ContadorAba }[] = [
  { aba: "aguardando", label: "Aguardando recebimento", contador: "aguardando" },
  { aba: "andamento", label: "Em conferência", contador: "emConferencia" },
  { aba: "divergencia", label: "Com divergência", contador: "divergencia" },
  { aba: "concluidos", label: "Concluídos", contador: null },
  { aba: "avulsos", label: "Avulsos", contador: null },
  { aba: "sem-nfe", label: "Sem NF-e", contador: null },
];

/**
 * "Aguardando" mostra PEDIDOS, não recebimentos — são tabelas diferentes. Eles
 * entram na tela quando nada está marcado (todos) ou quando o recorte os inclui.
 */
export function mostraPedidos(abas: RecAba[]): boolean {
  return abas.length === 0 || abas.includes("aguardando");
}

/** Só "Aguardando" marcado: a lista principal (paginada) é a de pedidos. */
export function soPedidos(abas: RecAba[]): boolean {
  return abas.length === 1 && abas[0] === "aguardando";
}

/** Os recortes que caem em recebimentos. Vazio = todos os recebimentos. */
export function abasDeRecebimento(abas: RecAba[]): RecAba[] {
  return abas.filter((a) => a !== "aguardando");
}

/** Quantos pedidos aguardando cabem no topo quando dividem a tela com recebimentos. */
export const PEDIDOS_NO_TOPO = 10;

export const REC_LIMITES = [20, 50, 100];
export const REC_LIMITE_PADRAO = 20;

/** O envelope que toda consulta devolve. Uma página, nunca a lista inteira. */
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
  /** Recortes marcados. Vazio = todos. Sempre na ordem de `REC_ABAS`. */
  abas: RecAba[];
  /** dias: "" | "7" | "30" | "90" */
  periodo: string;
  /** Ordem da data na tabela de recebimentos. */
  ordem: "desc" | "asc";
  pagina: number;
  limite: number;
};

export const REC_FILTROS_VAZIO: RecFiltros = {
  q: "",
  supplierId: "",
  abas: [],
  periodo: "30",
  ordem: "desc",
  pagina: 1,
  limite: REC_LIMITE_PADRAO,
};

/**
 * O período recorta histórico, não trabalho.
 *
 * Uma conferência aberta há 40 dias é justamente a que ninguém pode perder de
 * vista; escondê-la por causa de um filtro padrão de 30 dias transformaria o
 * filtro num apagador de pendência. Por isso ele só vale quando há histórico
 * na tela: em "todos", em "concluídos" e em "avulsos".
 */
export function periodoAplicavel(abas: RecAba[]): boolean {
  return abas.length === 0 || abas.includes("concluidos") || abas.includes("avulsos");
}

export function filtrosDaUrl(sp: Record<string, string | string[] | undefined>): RecFiltros {
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const q = um("q").trim();
  // O parâmetro continua chamando `status` na URL: links antigos
  // (/recebimento?status=sem-nfe) precisam continuar caindo no lugar certo.
  // Vários recortes vêm separados por vírgula; o desconhecido é ignorado.
  const statusBruto = sp.status;
  const marcados = (Array.isArray(statusBruto) ? statusBruto : [statusBruto ?? ""]).flatMap((v) =>
    v.split(","),
  );
  const abas = REC_ABAS.filter((a) => marcados.includes(a));
  const periodoBruto = um("periodo");
  const limiteBruto = Number(um("limite"));

  return {
    q,
    supplierId: um("fornecedor"),
    abas,
    // Quem chega buscando procura UM recebimento, que pode ser de meses atrás
    // — recortar por período esconderia justamente o que a pessoa veio ver.
    periodo: periodoBruto || (q ? "" : REC_FILTROS_VAZIO.periodo),
    ordem: um("ordem") === "asc" ? "asc" : "desc",
    pagina: Math.max(1, Number(um("pagina")) || 1),
    limite: REC_LIMITES.includes(limiteBruto) ? limiteBruto : REC_LIMITE_PADRAO,
  };
}

export function urlDosFiltros(f: RecFiltros): string {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.supplierId) q.set("fornecedor", f.supplierId);
  if (f.abas.length > 0) q.set("status", REC_ABAS.filter((a) => f.abas.includes(a)).join(","));
  if (f.periodo !== REC_FILTROS_VAZIO.periodo) q.set("periodo", f.periodo);
  if (f.ordem === "asc") q.set("ordem", "asc");
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  if (f.limite !== REC_LIMITE_PADRAO) q.set("limite", String(f.limite));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** O que recorta a lista — o status marcado é filtro como os outros. */
export function filtrosAtivos(f: RecFiltros): boolean {
  return (
    f.q.trim() !== "" ||
    f.supplierId !== "" ||
    f.abas.length > 0 ||
    (periodoAplicavel(f.abas) && f.periodo !== REC_FILTROS_VAZIO.periodo)
  );
}

/**
 * A busca é contextual: procura dentro do que a tela mostra.
 *
 * Prometer "NF-e" no campo quando só há pedidos seria mentira — pedido não tem
 * nota; ela nasce no recebimento.
 */
export function placeholderBusca(abas: RecAba[]): string {
  return soPedidos(abas)
    ? "Buscar pedido, fornecedor ou produto…"
    : "Buscar recebimento, NF-e, pedido ou fornecedor…";
}
