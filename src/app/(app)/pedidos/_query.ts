// Filtros de /pedidos — lidos da URL, aplicados no banco.
//
// Módulo client-safe (sem `server-only`): a página monta o filtro a partir dos
// searchParams e o client monta a URL de volta. Um só vocabulário nos dois
// lados evita a divergência clássica em que a tela mostra um recorte e o
// servidor devolve outro.
//
// São DOIS recortes, e a separação é a regra do módulo: `status` é o ciclo do
// pedido (rascunho → enviado → confirmado → parcial → concluído/cancelado);
// `recebimento` é só uma condição sobre ele — quanto da mercadoria já chegou.
// Recebimento não é status de pedido: os status da conferência (em
// conferência, com divergência) pertencem a /recebimento.

export const PO_STATUS_ABERTOS = "abertos";

/** Todo status que ainda dá trabalho — o padrão da tela. */
export const STATUS_ABERTOS = [
  "RASCUNHO",
  "ENVIADO",
  "AGUARDANDO",
  "EM_TRANSITO",
  "RECEBIDO_PARCIAL",
];

export type PoOrdem = "recentes" | "entrega" | "valor-desc" | "valor-asc" | "numero";

/** Recorte por quanto da mercadoria já entrou. "" = todos. */
export type PoRecebimento = "" | "sem" | "parcial" | "recebido";

const RECEBIMENTOS: PoRecebimento[] = ["", "sem", "parcial", "recebido"];

export type PoFiltros = {
  q: string;
  supplierId: string;
  /** "abertos" (padrão) | "" = todos | um status do pedido */
  status: string;
  /** Condição de recebimento — separada do status por design. */
  recebimento: PoRecebimento;
  /** dias de criação: "" | "7" | "30" | "90" */
  periodo: string;
  ordem: PoOrdem;
  pagina: number;
};

export const PO_FILTROS_VAZIO: PoFiltros = {
  q: "",
  supplierId: "",
  status: PO_STATUS_ABERTOS,
  recebimento: "",
  periodo: "30",
  ordem: "recentes",
  pagina: 1,
};

const ORDENS: PoOrdem[] = ["recentes", "entrega", "valor-desc", "valor-asc", "numero"];

/** searchParams → filtros. Valor inválido cai no padrão, nunca quebra a tela. */
export function filtrosDaUrl(sp: Record<string, string | string[] | undefined>): PoFiltros {
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const q = um("q").trim();
  const statusBruto = um("status");
  const periodoBruto = um("periodo");
  const ordemBruta = um("ordem") as PoOrdem;
  const recBruto = um("recebimento") as PoRecebimento;

  return {
    q,
    supplierId: um("fornecedor"),
    // Chegou com busca na URL? A pessoa procura UM pedido, que pode muito bem
    // estar concluído — esconder o que ela veio buscar seria a tela mentindo.
    status: statusBruto || (q ? "" : PO_FILTROS_VAZIO.status),
    recebimento: RECEBIMENTOS.includes(recBruto) ? recBruto : "",
    periodo: periodoBruto || (q ? "" : PO_FILTROS_VAZIO.periodo),
    ordem: ORDENS.includes(ordemBruta) ? ordemBruta : "recentes",
    pagina: Math.max(1, Number(um("pagina")) || 1),
  };
}

/** Filtros → querystring. Só o que difere do padrão entra — URL limpa é URL legível. */
export function urlDosFiltros(f: PoFiltros): string {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.supplierId) q.set("fornecedor", f.supplierId);
  if (f.status !== PO_FILTROS_VAZIO.status) q.set("status", f.status);
  if (f.recebimento) q.set("recebimento", f.recebimento);
  if (f.periodo !== PO_FILTROS_VAZIO.periodo) q.set("periodo", f.periodo);
  if (f.ordem !== PO_FILTROS_VAZIO.ordem) q.set("ordem", f.ordem);
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function filtrosAtivos(f: PoFiltros): boolean {
  return (
    f.q.trim() !== "" ||
    f.supplierId !== "" ||
    f.status !== PO_FILTROS_VAZIO.status ||
    f.recebimento !== "" ||
    f.periodo !== PO_FILTROS_VAZIO.periodo
  );
}

/** O filtro em vigor está escondendo concluído/cancelado? */
export const escondendoConcluidos = (f: PoFiltros) => f.status === PO_STATUS_ABERTOS;

/** Filtros da tela → argumento do loader. Traduz o vocabulário da URL. */
export function filtroDoBanco(f: PoFiltros, opts: { skip: number; take: number }) {
  return {
    q: f.q || null,
    supplierId: f.supplierId || null,
    status:
      f.status === PO_STATUS_ABERTOS
        ? STATUS_ABERTOS
        : f.status
          ? // "Confirmado" arrasta o EM_TRANSITO legado junto: a tela mostra os
            // dois com o mesmo badge, então filtrar por um e esconder o outro
            // seria a lista contradizendo a coluna Status.
            f.status === "AGUARDANDO"
            ? ["AGUARDANDO", "EM_TRANSITO"]
            : [f.status]
          : undefined,
    recebimento: f.recebimento || null,
    periodoDias: f.periodo ? Number(f.periodo) : null,
    ordem: f.ordem,
    skip: opts.skip,
    take: opts.take,
  };
}
