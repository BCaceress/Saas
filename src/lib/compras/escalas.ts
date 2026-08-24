// ============================================================
// Compra por escala — quando comprar MAIS sai mais barato.
//
// A cotação de quantidade exata responde "quanto custa o que eu preciso". Ela
// deixa dinheiro na mesa: o distribuidor quase sempre tem tabela por volume
// ("5 caixas a R$ 45, 10 a R$ 41"), e essa tabela nunca chegava ao comparativo.
//
// Só que "a faixa mais barata" NÃO é a resposta. A faixa mais barata é sempre a
// maior, e comprar a maior significa capital parado, prateleira ocupada e —
// em bebida, em perecível — produto vencendo antes de vender. Por isso este
// módulo não escolhe pelo preço: ele calcula os quatro números que decidem e
// deixa a trava do comprador reprovar.
//
//   · economia    — quanto CAI o custo do que eu já ia comprar
//   · investimento— quanto sai do caixa a MAIS, hoje
//   · cobertura   — quantos dias de venda a sobra representa
//   · validade    — a sobra vence antes de a prateleira girar?
//
// Puro de propósito (sem `server-only`, sem Prisma): o comparativo é componente
// de cliente e recalcula a cada mudança de trava, e os testes precisam disto
// sem banco.
// ============================================================

/** Faixa informada pelo fornecedor, SEMPRE na embalagem do item cotado. */
export type Faixa = {
  /** A partir de quantas embalagens este preço vale. */
  quantidadeMinima: number;
  precoUnitario: number;
};

/** Travas do comprador. Sem elas, "melhor promoção" vira "compre tudo". */
export type LimitesEscala = {
  /** Dias de venda que a quantidade EXTRA pode cobrir. */
  coberturaMaxDias: number;
  /** Desconto mínimo (%) para a faixa valer o capital parado. */
  economiaMinPct: number;
  /** Teto de desembolso extra em R$. null = sem teto. */
  capitalExtraMax: number | null;
};

/**
 * Teto de faixas que a TELA do fornecedor oferece. Três já é mais tabela do
 * que qualquer vendedor digita no meio do dia; o servidor aceita um pouco
 * mais por tolerância, não por incentivo.
 */
export const MAX_FAIXAS_ITEM = 3;

export const LIMITES_PADRAO: LimitesEscala = {
  coberturaMaxDias: 45,
  economiaMinPct: 3,
  capitalExtraMax: null,
};

/** O que o item sabe sobre si — o que falta vem null e a trava é pulada. */
export type ContextoItem = {
  /** Quanto foi pedido, na embalagem do item. */
  quantidadePedida: number;
  /** Preço da resposta na quantidade pedida — a faixa implícita. */
  precoBase: number;
  /** Unidades base dentro de uma embalagem (caixa de 12 → 12). */
  fatorEmbalagem: number;
  /** Média diária de saída, em unidades base. null = sem histórico. */
  consumoDiarioUnidades: number | null;
  /** Saldo atual na loja de destino, em unidades base. */
  estoqueAtualUnidades: number | null;
  /**
   * Validade típica observada nos lotes anteriores deste produto, em dias.
   * null = nunca teve lote com data — a trava de validade não opina.
   */
  validadeTipicaDias: number | null;
};

/** Por que uma faixa foi reprovada. A tela mostra o motivo, não só o "não". */
export type MotivoRecusa = "economia" | "cobertura" | "capital" | "validade";

export type Oportunidade = {
  /** Quantidade da faixa, na embalagem do item. */
  quantidade: number;
  precoUnitario: number;
  /**
   * Quanto CAI o custo da cesta que eu já ia comprar. É o número honesto: a
   * outra conta — desconto × volume novo — credita economia em unidades que
   * ninguém tinha decidido comprar.
   */
  economia: number;
  /** O mesmo desconto aplicado ao volume inteiro, se tudo vender. */
  economiaSeVenderTudo: number;
  /** Desconto sobre o preço-base, em %. */
  economiaPct: number;
  /** Desembolso a mais, hoje, contra comprar só o pedido. */
  investimentoExtra: number;
  /** Dias de venda que a quantidade EXTRA cobre. null = sem histórico. */
  coberturaExtraDias: number | null;
  /** Cobertura total depois da entrega (estoque + compra). */
  coberturaTotalDias: number | null;
  /** Vazio = passou em todas as travas. */
  recusas: MotivoRecusa[];
  compensa: boolean;
};

const arred = (v: number) => Math.round(v * 100) / 100;

/**
 * Faixas em ordem, sem lixo. Some o que não acrescenta informação:
 *
 *  · quantidade menor ou igual à pedida (a faixa implícita já é o preço-base);
 *  · preço que SOBE conforme a quantidade sobe — é erro de digitação do
 *    fornecedor, e aceitar faria a tela recomendar comprar mais por mais caro;
 *  · quantidade repetida (fica a mais barata).
 */
export function normalizarFaixas(
  quantidadePedida: number,
  precoBase: number,
  faixas: Faixa[],
): Faixa[] {
  const porQtd = new Map<number, number>();
  for (const f of faixas) {
    if (!Number.isFinite(f.quantidadeMinima) || !Number.isFinite(f.precoUnitario)) continue;
    if (f.quantidadeMinima <= quantidadePedida || f.precoUnitario <= 0) continue;
    const atual = porQtd.get(f.quantidadeMinima);
    if (atual === undefined || f.precoUnitario < atual) porQtd.set(f.quantidadeMinima, f.precoUnitario);
  }

  const ordenadas = [...porQtd.entries()]
    .map(([quantidadeMinima, precoUnitario]) => ({ quantidadeMinima, precoUnitario }))
    .sort((a, b) => a.quantidadeMinima - b.quantidadeMinima);

  // O preço tem de cair (ou empatar) conforme o volume sobe. A referência
  // começa no preço-base e desce; qualquer faixa acima dela é descartada.
  const limpas: Faixa[] = [];
  let teto = precoBase;
  for (const f of ordenadas) {
    if (f.precoUnitario > teto) continue;
    limpas.push(f);
    teto = f.precoUnitario;
  }
  return limpas;
}

/**
 * Preço vigente numa quantidade qualquer — a faixa mais alta que ela alcança.
 * Abaixo da primeira faixa, vale o preço-base.
 */
export function precoNaQuantidade(
  ctx: Pick<ContextoItem, "quantidadePedida" | "precoBase">,
  faixas: Faixa[],
  quantidade: number,
): { preco: number; faixa: Faixa | null } {
  const limpas = normalizarFaixas(ctx.quantidadePedida, ctx.precoBase, faixas);
  let escolhida: Faixa | null = null;
  for (const f of limpas) {
    if (quantidade >= f.quantidadeMinima) escolhida = f;
  }
  return { preco: escolhida?.precoUnitario ?? ctx.precoBase, faixa: escolhida };
}

/** Cobertura em dias de uma quantidade em unidades base. */
function coberturaDias(unidades: number, consumoDiario: number | null): number | null {
  if (consumoDiario === null || consumoDiario <= 0) return null;
  return unidades / consumoDiario;
}

/** Avalia UMA faixa contra as travas do comprador. */
export function avaliarFaixa(
  ctx: ContextoItem,
  faixa: Faixa,
  limites: LimitesEscala,
): Oportunidade {
  const extraEmbalagens = faixa.quantidadeMinima - ctx.quantidadePedida;
  const extraUnidades = extraEmbalagens * ctx.fatorEmbalagem;

  const economia = (ctx.precoBase - faixa.precoUnitario) * ctx.quantidadePedida;
  const economiaSeVenderTudo = (ctx.precoBase - faixa.precoUnitario) * faixa.quantidadeMinima;
  const economiaPct =
    ctx.precoBase > 0 ? ((ctx.precoBase - faixa.precoUnitario) / ctx.precoBase) * 100 : 0;
  const investimentoExtra =
    faixa.precoUnitario * faixa.quantidadeMinima - ctx.precoBase * ctx.quantidadePedida;

  const coberturaExtraDias = coberturaDias(extraUnidades, ctx.consumoDiarioUnidades);
  const coberturaTotalDias = coberturaDias(
    (ctx.estoqueAtualUnidades ?? 0) + faixa.quantidadeMinima * ctx.fatorEmbalagem,
    ctx.consumoDiarioUnidades,
  );

  const recusas: MotivoRecusa[] = [];
  if (economiaPct < limites.economiaMinPct) recusas.push("economia");
  // Sem histórico de venda a cobertura não opina — barrar aqui esconderia toda
  // promoção de produto novo, que é justamente quando a escala interessa.
  if (coberturaExtraDias !== null && coberturaExtraDias > limites.coberturaMaxDias) {
    recusas.push("cobertura");
  }
  if (limites.capitalExtraMax !== null && investimentoExtra > limites.capitalExtraMax) {
    recusas.push("capital");
  }
  if (
    ctx.validadeTipicaDias !== null &&
    coberturaTotalDias !== null &&
    coberturaTotalDias > ctx.validadeTipicaDias
  ) {
    recusas.push("validade");
  }

  return {
    quantidade: faixa.quantidadeMinima,
    precoUnitario: faixa.precoUnitario,
    economia: arred(economia),
    economiaSeVenderTudo: arred(economiaSeVenderTudo),
    economiaPct: arred(economiaPct),
    investimentoExtra: arred(investimentoExtra),
    coberturaExtraDias: coberturaExtraDias === null ? null : Math.round(coberturaExtraDias),
    coberturaTotalDias: coberturaTotalDias === null ? null : Math.round(coberturaTotalDias),
    recusas,
    compensa: recusas.length === 0,
  };
}

/** Todas as faixas avaliadas, da menor para a maior quantidade. */
export function avaliarFaixas(
  ctx: ContextoItem,
  faixas: Faixa[],
  limites: LimitesEscala,
): Oportunidade[] {
  return normalizarFaixas(ctx.quantidadePedida, ctx.precoBase, faixas).map((f) =>
    avaliarFaixa(ctx, f, limites),
  );
}

/**
 * A faixa que a tela recomenda.
 *
 * Entre as aprovadas, ganha a de MAIOR economia — não a mais barata por
 * unidade. São coisas diferentes: a faixa de 50 caixas pode ter o menor preço
 * e mesmo assim render menos, porque a economia que conta é a da cesta que eu
 * já ia comprar, e essa é a mesma em qualquer faixa acima do pedido.
 * Empatando (o caso comum), ganha a MENOR quantidade — menos capital parado
 * pelo mesmo desconto.
 *
 * Se nenhuma passa, devolve null: quem explica o "por quê" é `avaliarFaixas`,
 * que a tela mostra ao lado.
 */
export function melhorOportunidade(
  ctx: ContextoItem,
  faixas: Faixa[],
  limites: LimitesEscala,
): Oportunidade | null {
  const aprovadas = avaliarFaixas(ctx, faixas, limites).filter((o) => o.compensa);
  if (aprovadas.length === 0) return null;
  return aprovadas.reduce((melhor, o) => {
    if (o.economia > melhor.economia) return o;
    if (o.economia === melhor.economia && o.quantidade < melhor.quantidade) return o;
    return melhor;
  });
}

/** Soma do que a lente propõe, para a faixa de decisão do topo da tela. */
export type ResumoEscala = {
  itens: number;
  economia: number;
  investimentoExtra: number;
  /** Maior cobertura entre os itens — o pior caso da compra, não a média. */
  maiorCoberturaDias: number | null;
};

export function somarOportunidades(oportunidades: Oportunidade[]): ResumoEscala {
  const coberturas = oportunidades
    .map((o) => o.coberturaTotalDias)
    .filter((d): d is number => d !== null);
  return {
    itens: oportunidades.length,
    economia: arred(oportunidades.reduce((a, o) => a + o.economia, 0)),
    investimentoExtra: arred(oportunidades.reduce((a, o) => a + o.investimentoExtra, 0)),
    maiorCoberturaDias: coberturas.length ? Math.max(...coberturas) : null,
  };
}

/** Texto do motivo — a tela nunca diz só "não compensa". */
export const TEXTO_RECUSA: Record<MotivoRecusa, string> = {
  economia: "desconto pequeno demais para o capital parado",
  cobertura: "sobra mais dias de estoque do que você aceita",
  capital: "passa do seu teto de desembolso extra",
  validade: "vence antes de a prateleira girar",
};
