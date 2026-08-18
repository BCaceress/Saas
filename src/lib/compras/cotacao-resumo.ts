// ============================================================
// Resumo da cotação — o painel que lê o comparativo em voz alta.
//
// 100% determinístico, igual ao motor de insights do /inicio: regras sobre
// números que já vieram do banco. Nenhuma chamada de LLM, e por um motivo que
// não é economia — um resumo de preço que inventa um número vira decisão de
// compra errada. Todo texto daqui cita um valor que existe.
//
// Função pura sobre DTOs: quem carrega os dados é o loader da tela.
// ============================================================

export type TomResumo = "oportunidade" | "alerta" | "info" | "sucesso";

export type ItemResumo = {
  id: string;
  tom: TomResumo;
  texto: string;
  /** R$ em jogo — ordena os avisos por dinheiro, não por ordem de escrita. */
  impacto?: number;
};

export type ResumoCotacao = {
  /** Diferença entre a melhor e a pior cesta completa. 0 = ninguém disputou. */
  economia: number;
  melhorFornecedor: string | null;
  melhorTotal: number | null;
  itens: ItemResumo[];
};

export type RespostaResumo = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: number;
};

export type ConviteResumo = {
  id: string;
  supplierNome: string;
  supplierId: string;
  status: "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";
  frete: number | null;
  prazoEntregaDias: number | null;
  respostas: RespostaResumo[];
};

export type ItemCotacaoResumo = {
  id: string;
  descricao: string;
  quantidade: number;
  productId: string | null;
};

export type EntradaResumo = {
  itens: ItemCotacaoResumo[];
  convites: ConviteResumo[];
  prazoResposta: string | null;
  /**
   * Preço que ESTE fornecedor praticava neste produto antes desta cotação,
   * por `${supplierId}:${productId}`. Vem do histórico de preço — é o que
   * transforma "R$ 138" em "R$ 138, 8% acima da última vez".
   */
  referencias: Record<string, number>;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${Math.abs(Math.round(v))}%`;

/** Variação mínima para virar notícia — 2% é ruído de arredondamento. */
const VARIACAO_MINIMA = 2;

type Cesta = {
  convite: ConviteResumo;
  total: number;
  cobertos: number;
};

function montarCestas(e: EntradaResumo): Cesta[] {
  const qtd = new Map(e.itens.map((i) => [i.id, i.quantidade]));
  return e.convites
    .filter((c) => c.status === "RESPONDIDA")
    .map((convite) => {
      const disponiveis = convite.respostas.filter((r) => r.disponivel);
      const total =
        disponiveis.reduce(
          (acc, r) => acc + r.precoUnitario * (qtd.get(r.quotationItemId) ?? 0),
          0,
        ) + (convite.frete ?? 0);
      return { convite, total, cobertos: disponiveis.length };
    });
}

export function resumirCotacao(e: EntradaResumo): ResumoCotacao {
  const itens: ItemResumo[] = [];
  const qtd = new Map(e.itens.map((i) => [i.id, i.quantidade]));
  const cestas = montarCestas(e);

  // Só quem cotou a lista INTEIRA disputa o "fornecedor único" — comparar
  // cesta cheia com cesta pela metade produz uma economia que não existe.
  const completas = cestas
    .filter((c) => c.cobertos === e.itens.length && e.itens.length > 0)
    .sort((a, b) => a.total - b.total);

  const melhor = completas[0] ?? null;
  const pior = completas.length > 1 ? completas[completas.length - 1] : null;
  const economia = melhor && pior ? pior.total - melhor.total : 0;

  // ── 1. Quem fecha a lista mais barato ─────────────────────
  if (melhor && completas.length > 1) {
    const segundo = completas[1];
    itens.push({
      id: "melhor-cesta",
      tom: "sucesso",
      texto: `${melhor.convite.supplierNome} fecha a lista inteira por ${brl(melhor.total)} — ${brl(
        segundo.total - melhor.total,
      )} abaixo de ${segundo.convite.supplierNome}.`,
      impacto: segundo.total - melhor.total,
    });
  } else if (melhor) {
    itens.push({
      id: "melhor-cesta",
      tom: "info",
      texto: `${melhor.convite.supplierNome} é o único que cotou a lista inteira: ${brl(
        melhor.total,
      )}. Com um só preço na mesa não há disputa — vale insistir com quem ainda não respondeu.`,
    });
  }

  // ── 2. Dividir o pedido compensa? ─────────────────────────
  // Somar o menor preço item a item quase sempre bate o melhor fornecedor
  // único; a pergunta é se a diferença paga o custo de dois pedidos.
  let totalDividido = 0;
  let itensComOferta = 0;
  const fornecedoresNoDividido = new Set<string>();
  for (const item of e.itens) {
    let menor: { preco: number; convite: ConviteResumo } | null = null;
    for (const c of cestas) {
      const r = c.convite.respostas.find((x) => x.quotationItemId === item.id && x.disponivel);
      if (!r) continue;
      if (!menor || r.precoUnitario < menor.preco) menor = { preco: r.precoUnitario, convite: c.convite };
    }
    if (!menor) continue;
    itensComOferta++;
    totalDividido += menor.preco * (qtd.get(item.id) ?? 0);
    fornecedoresNoDividido.add(menor.convite.supplierId);
  }

  if (melhor && itensComOferta === e.itens.length && fornecedoresNoDividido.size > 1) {
    const ganho = melhor.total - totalDividido;
    if (ganho > 0) {
      itens.push({
        id: "dividir",
        tom: "oportunidade",
        texto: `Dividindo entre ${fornecedoresNoDividido.size} fornecedores, a mesma lista sai por ${brl(
          totalDividido,
        )} — ${brl(ganho)} a menos que o melhor pedido único (frete à parte).`,
        impacto: ganho,
      });
    }
  }

  // ── 3. Preço que mexeu desde a última vez ─────────────────
  const variacoes: { texto: string; delta: number; impacto: number; subiu: boolean }[] = [];
  const descricaoPorItem = new Map(e.itens.map((i) => [i.id, i.descricao]));
  const productPorItem = new Map(e.itens.map((i) => [i.id, i.productId]));

  for (const c of e.convites) {
    if (c.status !== "RESPONDIDA") continue;
    for (const r of c.respostas) {
      if (!r.disponivel) continue;
      const productId = productPorItem.get(r.quotationItemId);
      if (!productId) continue;
      const anterior = e.referencias[`${c.supplierId}:${productId}`];
      if (!anterior || anterior <= 0) continue;

      const delta = ((r.precoUnitario - anterior) / anterior) * 100;
      if (Math.abs(delta) < VARIACAO_MINIMA) continue;

      const quantidade = qtd.get(r.quotationItemId) ?? 0;
      variacoes.push({
        subiu: delta > 0,
        delta,
        impacto: Math.abs(r.precoUnitario - anterior) * quantidade,
        texto: `${c.supplierNome} ${delta > 0 ? "subiu" : "baixou"} ${descricaoPorItem.get(
          r.quotationItemId,
        )} em ${pct(delta)} — de ${brl(anterior)} para ${brl(r.precoUnitario)}.`,
      });
    }
  }

  const maiorAlta = variacoes.filter((v) => v.subiu).sort((a, b) => b.impacto - a.impacto)[0];
  const maiorQueda = variacoes.filter((v) => !v.subiu).sort((a, b) => b.impacto - a.impacto)[0];
  if (maiorAlta) {
    itens.push({ id: "alta", tom: "alerta", texto: maiorAlta.texto, impacto: maiorAlta.impacto });
  }
  if (maiorQueda) {
    itens.push({
      id: "queda",
      tom: "oportunidade",
      texto: maiorQueda.texto,
      impacto: maiorQueda.impacto,
    });
  }

  // ── 4. Item que ninguém tem ───────────────────────────────
  const respondentes = e.convites.filter((c) => c.status === "RESPONDIDA");
  if (respondentes.length > 0) {
    const semNinguem = e.itens.filter(
      (i) =>
        !respondentes.some((c) =>
          c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
        ),
    );
    if (semNinguem.length > 0) {
      itens.push({
        id: "sem-oferta",
        tom: "alerta",
        texto:
          semNinguem.length === 1
            ? `Ninguém cotou ${semNinguem[0].descricao}. Esse item precisa de outro fornecedor.`
            : `${semNinguem.length} itens não foram cotados por ninguém — inclusive ${semNinguem[0].descricao}.`,
      });
    }
  }

  // ── 5. Quem ainda deve resposta ───────────────────────────
  const aguardando = e.convites.filter((c) => c.status === "ENVIADA");
  if (aguardando.length > 0) {
    const prazo = e.prazoResposta ? new Date(e.prazoResposta) : null;
    const vencido = prazo !== null && prazo.getTime() < Date.now();
    const nomes = aguardando.slice(0, 3).map((c) => c.supplierNome).join(", ");
    itens.push({
      id: "aguardando",
      tom: vencido ? "alerta" : "info",
      texto: vencido
        ? `O prazo venceu e ${aguardando.length === 1 ? nomes + " não respondeu" : `${aguardando.length} fornecedores não responderam (${nomes})`}. Dá para encerrar e decidir com o que já veio.`
        : `Ainda faltam ${aguardando.length === 1 ? nomes : `${aguardando.length} respostas (${nomes})`}.`,
    });
  }

  // ── 6. O frete que vira o jogo ────────────────────────────
  // Um fornecedor pode ganhar em todos os itens e perder no total. É o erro
  // mais caro de quem compara olhando só a coluna de preço.
  if (completas.length > 1) {
    const semFrete = [...completas].sort(
      (a, b) => a.total - (a.convite.frete ?? 0) - (b.total - (b.convite.frete ?? 0)),
    )[0];
    if (melhor && semFrete.convite.id !== melhor.convite.id) {
      itens.push({
        id: "frete",
        tom: "alerta",
        texto: `${semFrete.convite.supplierNome} tem os melhores preços, mas o frete de ${brl(
          semFrete.convite.frete ?? 0,
        )} joga o total para cima de ${melhor.convite.supplierNome}.`,
        impacto: semFrete.total - melhor.total,
      });
    }
  }

  return {
    economia,
    melhorFornecedor: melhor?.convite.supplierNome ?? null,
    melhorTotal: melhor?.total ?? null,
    // Dinheiro primeiro; o que não tem número medido segue na ordem escrita.
    itens: itens.sort((a, b) => (b.impacto ?? 0) - (a.impacto ?? 0)),
  };
}
