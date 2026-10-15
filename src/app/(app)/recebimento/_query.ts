// Filtros de /recebimento — lidos da URL, aplicados no banco.
//
// Módulo client-safe (sem `server-only`), mesmo padrão de `pedidos/_query.ts`:
// a página monta o filtro a partir dos searchParams e o client monta a URL de
// volta, com um vocabulário só. Dois vocabulários fariam a tela mostrar um
// recorte e o servidor devolver outro.
//
//   STATUS — UMA escolha, na barra de filtros: em que ponto do caminho a
//            mercadoria está. Todos · Aguardando · Em aberto · Concluídos.
//   MARCAS — só os atalhos dos indicadores ("Com divergência", "Sem NF-e")
//            chegam aqui; restringem o status (E, nunca OU). Não têm controle
//            próprio na barra — o indicador marcado é quem mostra que estão
//            ligadas, e clicar nele de novo desliga.

/** Em que ponto do caminho a mercadoria está. "" = todos. */
export type RecStatus = "" | "aguardando" | "aberto" | "concluidos";

/** Recortes dos indicadores que se somam ao status. */
export type RecMarca = "divergencia" | "sem-nfe";

export const REC_STATUS: { value: RecStatus; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "aguardando", label: "Aguardando" },
  { value: "aberto", label: "Em aberto" },
  { value: "concluidos", label: "Concluídos" },
];

/** Ordem canônica: a mesma seleção gera a mesma URL. */
const MARCAS: RecMarca[] = ["divergencia", "sem-nfe"];

/** "Aguardando" mostra PEDIDOS — tabela própria, as marcas não se aplicam a eles. */
export function soPedidos(f: Pick<RecFiltros, "status">): boolean {
  return f.status === "aguardando";
}

/**
 * Os pedidos aguardando sobem num bloco no topo só na visão geral: qualquer
 * marca fala de recebimento, e pedido nenhum tem divergência ou NF-e ainda.
 */
export function mostraPedidos(f: Pick<RecFiltros, "status" | "marcas">): boolean {
  return f.status === "aguardando" || (f.status === "" && f.marcas.length === 0);
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
  status: RecStatus;
  /** Sempre na ordem canônica: a mesma seleção gera a mesma URL. */
  marcas: RecMarca[];
  /** dias: "" | "7" | "30" | "90" */
  periodo: string;
  /** Ordem da data de recebimento (conclusão) na tabela. */
  ordem: "desc" | "asc";
  pagina: number;
  limite: number;
};

export const REC_FILTROS_VAZIO: RecFiltros = {
  q: "",
  supplierId: "",
  status: "",
  marcas: [],
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
 * filtro num apagador de pendência. Por isso ele só vale onde há concluídos na
 * tela — e nunca com "Sem NF-e", que é concluído com pendência.
 */
export function periodoAplicavel(f: Pick<RecFiltros, "status" | "marcas">): boolean {
  return (f.status === "" || f.status === "concluidos") && !f.marcas.includes("sem-nfe");
}

/** Normaliza marcas: só as conhecidas, na ordem canônica. */
export function marcasCanonicas(marcas: string[]): RecMarca[] {
  return MARCAS.filter((m) => marcas.includes(m));
}

export function filtrosDaUrl(sp: Record<string, string | string[] | undefined>): RecFiltros {
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const lista = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => x.split(",")).filter(Boolean);
  };

  const q = um("q").trim();
  const statusBruto = lista("status");
  const marcasBrutas = lista("marca");

  // Links antigos (/recebimento?status=sem-nfe, ?status=andamento…) vinham da
  // seleção múltipla. Cada recorte velho cai no par status + marca que diz a
  // mesma coisa.
  let status: RecStatus = "";
  for (const s of statusBruto) {
    if (s === "aguardando" || s === "aberto" || s === "concluidos") status = s;
    else if (s === "andamento") status = "aberto";
    else if (s === "divergencia") marcasBrutas.push("divergencia");
    else if (s === "sem-nfe") marcasBrutas.push("sem-nfe");
  }

  const periodoBruto = um("periodo");
  const limiteBruto = Number(um("limite"));

  return {
    q,
    supplierId: um("fornecedor"),
    status,
    // Pedido aguardando não tem marca nenhuma — a combinação não existe.
    marcas: status === "aguardando" ? [] : marcasCanonicas(marcasBrutas),
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
  if (f.status) q.set("status", f.status);
  if (f.marcas.length > 0 && f.status !== "aguardando") {
    q.set("marca", marcasCanonicas(f.marcas).join(","));
  }
  if (f.periodo !== REC_FILTROS_VAZIO.periodo) q.set("periodo", f.periodo);
  if (f.ordem === "asc") q.set("ordem", "asc");
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  if (f.limite !== REC_LIMITE_PADRAO) q.set("limite", String(f.limite));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** O que recorta a lista. */
export function filtrosAtivos(f: RecFiltros): boolean {
  return (
    f.q.trim() !== "" ||
    f.supplierId !== "" ||
    f.status !== "" ||
    f.marcas.length > 0 ||
    (periodoAplicavel(f) && f.periodo !== REC_FILTROS_VAZIO.periodo)
  );
}

/**
 * Quantos controles do painel "Filtros" (celular) estão ligados. Busca tem
 * campo à vista e as marcas vêm dos indicadores — nenhum dos dois conta aqui.
 */
export function quantosFiltros(f: RecFiltros): number {
  return (
    (f.supplierId ? 1 : 0) +
    (f.status ? 1 : 0) +
    (periodoAplicavel(f) && f.periodo !== REC_FILTROS_VAZIO.periodo ? 1 : 0)
  );
}

/**
 * A busca é contextual: procura dentro do que a tela mostra.
 *
 * Prometer "NF-e" no campo quando só há pedidos seria mentira — pedido não tem
 * nota; ela nasce no recebimento.
 */
export function placeholderBusca(f: Pick<RecFiltros, "status">): string {
  return soPedidos(f) ? "Buscar pedido, fornecedor ou produto…" : "Buscar número, NF-e ou produto…";
}
