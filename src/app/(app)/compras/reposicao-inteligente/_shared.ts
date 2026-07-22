import type { GrupoReposicao, SugestaoRow } from "../_data";

// ── Tipos e helpers compartilhados da Reposição inteligente ───
// A tela trabalha com uma lista plana de linhas (produto + fornecedor
// padrão colado) e um mapa de seleção controlado pelo operador.

/** SugestaoRow com o fornecedor padrão do grupo colado — a lista aqui é plana. */
export type Linha = SugestaoRow & {
  supplierId: string | null;
  supplierNome: string;
  supplierLogoUrl: string | null;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  leadTimeDias: number | null;
};

/** Decisão do operador sobre uma linha: incluir? quanto? de quem? */
export type Sel = { on: boolean; qtd: number; supplierId: string | null };

export type Efetivo = {
  supplierId: string | null;
  nome: string;
  logoUrl: string | null;
  custo: number | null;
  leadTime: number | null;
  telefone: string | null;
  email: string | null;
};

/** Resolve nome/custo/prazo do fornecedor efetivamente escolhido pro item (pode ter sido trocado no card). */
export function fornecedorEfetivo(l: Linha, supplierId: string | null): Efetivo {
  const f = supplierId ? l.fornecedores.find((x) => x.supplierId === supplierId) : null;
  if (f) {
    return {
      supplierId: f.supplierId,
      nome: f.nome,
      logoUrl: f.logoUrl,
      custo: f.custoUnitCompra,
      leadTime: f.leadTimeDias,
      telefone: f.telefone,
      email: f.email,
    };
  }
  return {
    supplierId: l.supplierId,
    nome: l.supplierNome,
    logoUrl: l.supplierLogoUrl,
    custo: l.custoUnitCompra,
    leadTime: l.leadTimeDias,
    telefone: l.supplierTelefone,
    email: l.supplierEmail,
  };
}

export const PESO: Record<SugestaoRow["status"], number> = { ruptura: 0, critico: 1, abaixo: 2, monitorar: 3 };

/** Nível de prioridade da tela: comprar agora × comprar em breve. */
export type Prioridade = "agora" | "breve";

export const prioridadeDe = (l: Linha): Prioridade =>
  l.status === "ruptura" || l.status === "critico" ? "agora" : "breve";

export function achatar(grupos: GrupoReposicao[]): Linha[] {
  return grupos.flatMap((g) =>
    g.itens.map((it) => ({
      ...it,
      supplierId: g.supplierId,
      supplierNome: g.supplierNome,
      supplierLogoUrl: g.supplierLogoUrl,
      supplierTelefone: g.supplierTelefone,
      supplierEmail: g.supplierEmail,
      leadTimeDias: g.leadTimeDias,
    })),
  );
}

export const ordenarLinhas = (rows: Linha[]) =>
  [...rows].sort(
    (a, b) => PESO[a.status] - PESO[b.status] || (a.coberturaDias ?? 99) - (b.coberturaDias ?? 99) || a.nome.localeCompare(b.nome),
  );

/** Subgrupo de fornecedor dentro de um nível de prioridade. */
export type SubgrupoFornecedor = {
  supplierId: string | null; // null = sem fornecedor vinculado
  nome: string;
  logoUrl: string | null;
  leadTime: number | null;
  itens: Linha[];
};

/** Agrupa linhas pelo fornecedor efetivo (respeita trocas feitas no card). */
export function agruparPorFornecedor(rows: Linha[], sel: Record<string, Sel>): SubgrupoFornecedor[] {
  const map = new Map<string, SubgrupoFornecedor>();
  for (const l of rows) {
    const eff = fornecedorEfetivo(l, sel[l.productId]?.supplierId ?? l.supplierId);
    const key = eff.supplierId ?? "__sem__";
    const g = map.get(key) ?? {
      supplierId: eff.supplierId,
      nome: eff.nome,
      logoUrl: eff.logoUrl,
      leadTime: eff.leadTime,
      itens: [],
    };
    g.itens.push(l);
    map.set(key, g);
  }
  const lista = [...map.values()];
  for (const g of lista) g.itens = ordenarLinhas(g.itens);
  lista.sort((a, b) => {
    if ((a.supplierId === null) !== (b.supplierId === null)) return a.supplierId === null ? 1 : -1;
    const grav = (g: SubgrupoFornecedor) => Math.min(...g.itens.map((i) => PESO[i.status]));
    return grav(a) - grav(b) || b.itens.length - a.itens.length || a.nome.localeCompare(b.nome);
  });
  return lista;
}
