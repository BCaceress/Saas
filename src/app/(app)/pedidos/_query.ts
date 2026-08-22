// Filtros de /pedidos — lidos da URL, aplicados no banco.
//
// Módulo client-safe (sem `server-only`): a página monta o filtro a partir dos
// searchParams e o client monta a URL de volta. Um só vocabulário nos dois
// lados evita a divergência clássica em que a tela mostra um recorte e o
// servidor devolve outro.

export const PO_STATUS_ABERTOS = "abertos";

/** Todo status que ainda dá trabalho — o padrão da tela. */
export const STATUS_ABERTOS = [
  "RASCUNHO",
  "ENVIADO",
  "AGUARDANDO",
  "EM_TRANSITO",
  "CONFERENCIA",
  "RECEBIDO_PARCIAL",
];

export type PoOrdem = "recentes" | "entrega" | "valor-desc" | "valor-asc" | "numero";

export type PoFiltros = {
  q: string;
  supplierId: string;
  /** "abertos" (padrão) | "" = todos | "saldo" | um status específico */
  status: string;
  /** dias de criação: "" | "7" | "30" | "90" */
  periodo: string;
  ordem: PoOrdem;
  pagina: number;
};

/** Recorte especial: parcial cuja pendência ninguém resolveu. */
export const PO_STATUS_SALDO = "saldo";

export const PO_FILTROS_VAZIO: PoFiltros = {
  q: "",
  supplierId: "",
  status: PO_STATUS_ABERTOS,
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

  return {
    q,
    supplierId: um("fornecedor"),
    // Chegou com busca na URL? A pessoa procura UM pedido, que pode muito bem
    // estar concluído — esconder o que ela veio buscar seria a tela mentindo.
    status: statusBruto || (q ? "" : PO_FILTROS_VAZIO.status),
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
        : f.status && f.status !== PO_STATUS_SALDO
          ? [f.status]
          : undefined,
    saldoPendente: f.status === PO_STATUS_SALDO,
    periodoDias: f.periodo ? Number(f.periodo) : null,
    ordem: f.ordem,
    skip: opts.skip,
    take: opts.take,
  };
}
