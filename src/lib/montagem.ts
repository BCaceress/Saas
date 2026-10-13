/**
 * Montagem de produto composto (PRD Fase 4 §4) — funções PURAS.
 *
 * Dado o que a ficha entrega sem escolha (itens fixos), os grupos de escolha e
 * o que o cliente marcou, devolve as CAMADAS da montagem: o que vai no copo da
 * receita ou nos vãos da caixa do kit. O tamanho escolhido escala tudo pelo
 * fator da variação, como na baixa de estoque.
 *
 * Fica fora do componente porque PDV e totem montam a mesma coisa e porque
 * esta é a parte testável: ordem das camadas, escala e volume.
 */

export type CamadaMontagem = {
  /** Identidade estável — dá a cor e a key da camada. */
  componentProductId: string;
  nome: string;
  /** Quantidade na `unidade`, já escalada pelo tamanho. */
  quantidade: number;
  unidade: string;
  /** Item fixo da ficha (não foi escolha do cliente). */
  fixo: boolean;
};

type ItemFixo = {
  componentProductId: string;
  nome: string;
  quantidade: number;
  unidade: string;
};

type GrupoMontagem = {
  id: string;
  items: {
    componentProductId: string;
    nome: string;
    quantidade: number;
    unidade: string;
  }[];
};

/**
 * Camadas da montagem, fixos primeiro e escolhas na ordem dos grupos.
 * `fator` ≤ 0 é tratado como 1 — tamanho sem fator não some com a ficha.
 */
export function montarCamadas(
  fixos: ItemFixo[],
  grupos: GrupoMontagem[],
  selecoes: Record<string, string[]>,
  fator = 1,
): CamadaMontagem[] {
  const escala = fator > 0 ? fator : 1;
  const camadas: CamadaMontagem[] = fixos.map((c) => ({
    componentProductId: c.componentProductId,
    nome: c.nome,
    quantidade: c.quantidade * escala,
    unidade: c.unidade,
    fixo: true,
  }));

  for (const g of grupos) {
    const marcados = selecoes[g.id] ?? [];
    for (const item of g.items) {
      if (!marcados.includes(item.componentProductId)) continue;
      camadas.push({
        componentProductId: item.componentProductId,
        nome: item.nome,
        quantidade: item.quantidade * escala,
        unidade: item.unidade,
        fixo: false,
      });
    }
  }

  return camadas;
}

/** Volume no copo: só o que é dose (ML/G). UN num drink é guarnição. */
export function volumeDasCamadas(camadas: CamadaMontagem[]): number {
  return camadas
    .filter((c) => c.unidade !== "UN")
    .reduce((s, c) => s + c.quantidade, 0);
}

/** Vãos ocupados na caixa do kit: cada unidade é um vão. */
export function vaosDasCamadas(camadas: CamadaMontagem[]): number {
  return camadas.reduce(
    (s, c) => s + (c.unidade === "UN" ? Math.max(1, Math.round(c.quantidade)) : 1),
    0,
  );
}
