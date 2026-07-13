import "server-only";
import { basePrisma } from "./prisma";
import { aplicarMovimento, registrarProducao } from "./estoque";
import { emitirHookFiscal } from "./fiscal";
import { defaultPaymentMethods } from "./presets";
import type { PaymentMethod } from "@/generated/prisma";

// ============================================================
// Serviço de vendas (PRD Fase 4). O carrinho (Sale ABERTA) é montado pelas
// actions; aqui ficam a RESOLUÇÃO DE PREÇO, o MOTOR DE BAIXA (§5) reusando o
// motor de produção da Fase 3, a FINALIZAÇÃO (§4) e o ESTORNO (§9).
//
// Como na Fase 3, cada movimento é uma transação própria (set_config local por
// query sob o pooler do Neon). Usa basePrisma com tenantId explícito.
// ============================================================

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ── Resolução de preço (§4) ─────────────────────────────────
// Variação tem prioridade: ProductVariant.precoVenda, ou derivado pelo fator
// de escala sobre o preço base; senão Product.precoVenda.
export function resolvePreco(
  product: { precoVenda: unknown },
  variant: { precoVenda: unknown; fatorEscala: unknown } | null
): number {
  const base = num(product.precoVenda);
  if (!variant) return base;
  if (variant.precoVenda != null) return num(variant.precoVenda);
  return base * num(variant.fatorEscala);
}

// ── Disponibilidade (§4) — best-effort p/ UI; o motor de baixa é a verdade ──
export async function disponibilidadeSimples(
  tenantId: string,
  siteId: string,
  productId: string
): Promise<number> {
  const stock = await basePrisma.stock.findFirst({
    where: { productId, siteId, tenantId },
    select: { estoqueFechado: true },
  });
  return num(stock?.estoqueFechado);
}

// ── Métodos de pagamento por site (§6) — cria defaults na 1ª leitura ──
export async function listSitePaymentMethods(
  tenantId: string,
  siteId: string
): Promise<{ id: string; metodo: PaymentMethod; ativo: boolean }[]> {
  const existing = await basePrisma.sitePaymentMethod.findMany({
    where: { tenantId, siteId },
    select: { id: true, metodo: true, ativo: true },
  });
  if (existing.length > 0) return existing;

  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { atendimento: true },
  });
  const defaults = defaultPaymentMethods(tenant?.atendimento ?? null);

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    await tx.sitePaymentMethod.createMany({
      data: defaults.map((metodo) => ({ tenantId, siteId, metodo })),
      skipDuplicates: true,
    });
  });

  return basePrisma.sitePaymentMethod.findMany({
    where: { tenantId, siteId },
    select: { id: true, metodo: true, ativo: true },
  });
}

// ── Criação da venda (carrinho persistido) ──────────────────
// Preço resolvido no SERVIDOR (não confia no cliente). Cria Sale + itens +
// pagamentos numa transação. Retorna o id; a baixa só ocorre em finalizarVenda.
export type NovoItemVenda = {
  productId: string;
  variantId?: string | null;
  quantidade: number;
  desconto?: number;
  /** PERSONALIZADO: componentes escolhidos no PDV (guiam preço e baixa). */
  selecoes?: string[];
};
export type NovoPagamento = {
  metodo: PaymentMethod;
  valor: number;
  troco?: number | null;
  status?: "PENDENTE" | "CONFIRMADO";
};

/** Resolve preço/total de cada item no servidor (não confia no cliente). */
async function resolverItensVenda(tenantId: string, items: NovoItemVenda[]) {
  if (items.length === 0) throw new Error("Adicione ao menos um item.");

  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = items.map((i) => i.variantId).filter(Boolean) as string[];
  const selecaoIds = [...new Set(items.flatMap((i) => i.selecoes ?? []))];

  const [products, variants, selComps] = await Promise.all([
    basePrisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true, precoVenda: true },
    }),
    variantIds.length
      ? basePrisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId },
          select: { id: true, precoVenda: true, fatorEscala: true },
        })
      : Promise.resolve([]),
    selecaoIds.length
      ? basePrisma.productComponent.findMany({
          where: {
            tenantId,
            parentProductId: { in: productIds },
            componentProductId: { in: selecaoIds },
          },
          select: { parentProductId: true, componentProductId: true, acrescimoPreco: true },
        })
      : Promise.resolve([]),
  ]);
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const varMap = new Map(variants.map((v) => [v.id, v]));
  // Acréscimo por (produto pai → componente escolhido).
  const acrescimoMap = new Map<string, number>();
  for (const c of selComps) {
    acrescimoMap.set(`${c.parentProductId}:${c.componentProductId}`, num(c.acrescimoPreco));
  }

  const itensResolvidos = items.map((i) => {
    const p = prodMap.get(i.productId);
    if (!p) throw new Error("Produto da venda não encontrado.");
    const v = i.variantId ? varMap.get(i.variantId) ?? null : null;
    const selecoes = i.selecoes ?? [];
    const acrescimo = selecoes.reduce(
      (s, cid) => s + (acrescimoMap.get(`${i.productId}:${cid}`) ?? 0),
      0,
    );
    const preco = resolvePreco(p, v) + acrescimo;
    const desconto = i.desconto ?? 0;
    const total = preco * i.quantidade - desconto;
    return {
      productId: i.productId,
      variantId: i.variantId ?? null,
      quantidade: i.quantidade,
      precoUnitario: preco,
      desconto,
      total,
      selectedComponentIds: selecoes,
    };
  });

  const subtotal = itensResolvidos.reduce((s, i) => s + i.total, 0);
  return { itensResolvidos, subtotal };
}

export async function criarVenda(
  tenantId: string,
  input: {
    siteId: string;
    origem: "PDV" | "TOTEM" | "APP";
    cashSessionId?: string | null;
    operatorUserId?: string | null;
    customerId?: string | null;
    totemDeviceId?: string | null;
    items: NovoItemVenda[];
    descontoVenda?: number;
    maiorIdadeConfirmada?: boolean;
    pagamentos?: NovoPagamento[];
    /** Totem/self-service: gera 1 pagamento PENDENTE pelo total calculado. */
    pagamentoIntegralPendente?: PaymentMethod;
  }
): Promise<string> {
  const { itensResolvidos, subtotal } = await resolverItensVenda(tenantId, input.items);
  const descontoVenda = input.descontoVenda ?? 0;
  const total = Math.max(0, subtotal - descontoVenda);

  const pagamentos: NovoPagamento[] = input.pagamentos ? [...input.pagamentos] : [];
  if (input.pagamentoIntegralPendente) {
    pagamentos.push({ metodo: input.pagamentoIntegralPendente, valor: total, status: "PENDENTE" });
  }

  const sale = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.sale.create({
      data: {
        tenantId,
        siteId: input.siteId,
        origem: input.origem,
        status: "ABERTA",
        cashSessionId: input.cashSessionId ?? null,
        operatorUserId: input.operatorUserId ?? null,
        customerId: input.customerId ?? null,
        totemDeviceId: input.totemDeviceId ?? null,
        subtotal,
        desconto: descontoVenda,
        total,
        maiorIdadeConfirmada: input.maiorIdadeConfirmada ?? false,
        items: { create: itensResolvidos.map((i) => ({ tenantId, ...i })) },
        payments: pagamentos.length
          ? {
              create: pagamentos.map((p) => ({
                tenantId,
                metodo: p.metodo,
                valor: p.valor,
                troco: p.troco ?? null,
                status: p.status ?? "CONFIRMADO",
              })),
            }
          : undefined,
      },
    });
  });

  return sale.id;
}

// ── Motor de baixa (§5) ─────────────────────────────────────
// Para cada item, no site da venda: SIMPLES -> SAIDA; COMBO -> SAIDA por
// componente; PERSONALIZADO -> Production (motor de saldo aberto da Fase 3).
async function aplicarBaixaItem(
  tenantId: string,
  siteId: string,
  item: {
    productId: string;
    variantId: string | null;
    quantidade: number;
    selectedComponentIds?: string[];
  },
  saleId: string,
  createdBy?: string
) {
  const product = await basePrisma.product.findFirst({
    where: { id: item.productId, tenantId },
    select: {
      id: true,
      nome: true,
      tipo: true,
      custoMedio: true,
      components: {
        where: { groupId: null },
        select: {
          quantidade: true,
          unidade: true,
          component: { select: { id: true, custoMedio: true } },
        },
      },
    },
  });
  if (!product) throw new Error("Produto da venda não encontrado.");

  const qtd = item.quantidade;

  if (product.tipo === "PERSONALIZADO") {
    // dispara o motor de produção (consome insumos via saldo aberto)
    await registrarProducao(tenantId, siteId, product.id, item.variantId, Math.round(qtd), {
      saleId,
      createdBy,
      observacao: "Baixa de venda",
      selectedComponentIds: item.selectedComponentIds,
    });
    return;
  }

  if (product.tipo === "COMBO") {
    for (const comp of product.components) {
      const dose = num(comp.quantidade) * qtd;
      const isUn = comp.unidade === "UN";
      const saldo = await disponibilidadeSimples(tenantId, siteId, comp.component.id);
      if (isUn && saldo < dose) {
        throw new Error(`Saldo insuficiente de um componente do combo — disponível: ${saldo}`);
      }
      await aplicarMovimento(
        tenantId,
        siteId,
        comp.component.id,
        "SAIDA",
        isUn ? { deltaFechado: -dose } : { deltaAberto: -dose },
        { saleId, custoUnitario: num(comp.component.custoMedio), createdBy }
      );
    }
    return;
  }

  // SIMPLES / INSUMO — baixa unidade fechada
  const saldo = await disponibilidadeSimples(tenantId, siteId, product.id);
  if (saldo < qtd) {
    throw new Error(`Saldo insuficiente: ${saldo} disponíveis de "${product.nome}".`);
  }
  await aplicarMovimento(tenantId, siteId, product.id, "SAIDA", { deltaFechado: -qtd }, {
    saleId,
    custoUnitario: num(product.custoMedio),
    createdBy,
  });
}

// ── Finalização (§4) ────────────────────────────────────────
export async function finalizarVenda(
  tenantId: string,
  saleId: string,
  createdBy?: string
): Promise<void> {
  const sale = await basePrisma.sale.findFirst({
    where: { id: saleId, tenantId },
    include: {
      items: {
        select: {
          productId: true,
          variantId: true,
          quantidade: true,
          selectedComponentIds: true,
        },
      },
      payments: { select: { status: true, valor: true } },
    },
  });
  if (!sale) throw new Error("Venda não encontrada.");
  if (sale.status !== "ABERTA") throw new Error("Venda já finalizada ou cancelada.");
  if (sale.items.length === 0) throw new Error("Adicione itens antes de finalizar.");

  // +18 (§4): só exige confirmação se a loja tiver o controle de idade ativado
  const site = await basePrisma.site.findFirst({
    where: { id: sale.siteId, tenantId },
    select: { controleIdade: true },
  });
  if (site?.controleIdade) {
    const restritos = await basePrisma.product.count({
      where: { tenantId, restricaoIdade: true, id: { in: sale.items.map((i) => i.productId) } },
    });
    if (restritos > 0 && !sale.maiorIdadeConfirmada) {
      throw new Error("Confirme a maioridade do cliente para vender itens +18.");
    }
  }

  // pagamentos confirmados cobrem o total?
  const pago = sale.payments
    .filter((p) => p.status === "CONFIRMADO")
    .reduce((s, p) => s + num(p.valor), 0);
  if (pago + 0.005 < num(sale.total)) {
    throw new Error(`Pagamento insuficiente: faltam R$ ${(num(sale.total) - pago).toFixed(2)}.`);
  }

  // motor de baixa
  for (const item of sale.items) {
    await aplicarBaixaItem(
      tenantId,
      sale.siteId,
      {
        productId: item.productId,
        variantId: item.variantId,
        quantidade: num(item.quantidade),
        selectedComponentIds: item.selectedComponentIds,
      },
      saleId,
      createdBy
    );
  }

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.sale.update({
      where: { id: saleId },
      data: { status: "PAGA", paidAt: new Date() },
    }),
  ]);

  // hook fiscal pós-pagamento (§11) — no-op nesta fase
  await emitirHookFiscal(tenantId, saleId);
}

// ── Confirmação de pagamento self-service (§6/§8) — idempotente ──
export async function confirmarPagamentoVenda(
  tenantId: string,
  saleId: string,
  createdBy?: string
): Promise<{ already: boolean }> {
  const sale = await basePrisma.sale.findFirst({
    where: { id: saleId, tenantId },
    select: { status: true },
  });
  if (!sale) throw new Error("Venda não encontrada.");
  if (sale.status === "PAGA") return { already: true }; // idempotente
  if (sale.status === "CANCELADA") throw new Error("Venda cancelada.");

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.payment.updateMany({
      where: { saleId, tenantId, status: "PENDENTE" },
      data: { status: "CONFIRMADO" },
    }),
  ]);

  await finalizarVenda(tenantId, saleId, createdBy);
  return { already: false };
}

// ── Recebimento no caixa de venda do autoatendimento (Modo B) ──
// O cliente montou o carrinho no totem e escolheu pagar no caixa; o operador
// confere (pode ajustar itens) e recebe. Reprecifica no servidor, vincula a
// venda ao caixa/operador, registra os pagamentos e finaliza (baixa + fiscal).
export async function receberVendaTotem(
  tenantId: string,
  input: {
    saleId: string;
    cashSessionId: string;
    operatorUserId: string;
    customerId?: string | null;
    items: NovoItemVenda[];
    maiorIdadeConfirmada?: boolean;
    pagamentos: NovoPagamento[];
  }
): Promise<void> {
  const sale = await basePrisma.sale.findFirst({
    where: { id: input.saleId, tenantId },
    select: { id: true, status: true, origem: true },
  });
  if (!sale) throw new Error("Venda não encontrada.");
  if (sale.status !== "ABERTA") throw new Error("Esta venda já foi recebida ou cancelada.");
  if (sale.origem === "PDV") throw new Error("Venda não é do autoatendimento.");

  const { itensResolvidos, subtotal } = await resolverItensVenda(tenantId, input.items);

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    await tx.saleItem.deleteMany({ where: { saleId: input.saleId, tenantId } });
    await tx.payment.deleteMany({ where: { saleId: input.saleId, tenantId, status: "PENDENTE" } });
    await tx.sale.update({
      where: { id: input.saleId },
      data: {
        cashSessionId: input.cashSessionId,
        operatorUserId: input.operatorUserId,
        customerId: input.customerId ?? undefined,
        subtotal,
        total: subtotal,
        maiorIdadeConfirmada: input.maiorIdadeConfirmada ?? false,
        items: { create: itensResolvidos.map((i) => ({ tenantId, ...i })) },
        payments: {
          create: input.pagamentos.map((p) => ({
            tenantId,
            metodo: p.metodo,
            valor: p.valor,
            troco: p.troco ?? null,
            status: "CONFIRMADO",
          })),
        },
      },
    });
  });

  await finalizarVenda(tenantId, input.saleId, input.operatorUserId);
}

// ── Cancelamento / estorno (§9) ─────────────────────────────
// Venda PAGA: movimentos compensatórios (devolve saldo) + pagamentos ESTORNADO.
export async function cancelarVenda(
  tenantId: string,
  saleId: string,
  createdBy?: string
): Promise<void> {
  const sale = await basePrisma.sale.findFirst({
    where: { id: saleId, tenantId },
    select: { id: true, status: true, siteId: true },
  });
  if (!sale) throw new Error("Venda não encontrada.");
  if (sale.status === "CANCELADA") throw new Error("Venda já cancelada.");

  if (sale.status === "PAGA") {
    // Agrega os deltas aplicados pela venda por produto e aplica o inverso.
    // Reverter ABERTURA (fechado-1, aberto+conteudo) pelo inverso devolve a
    // garrafa ao fechado — compensação exata sem reconstruir o passo a passo.
    const movs = await basePrisma.stockMovement.findMany({
      where: { saleId, tenantId },
      select: { productId: true, deltaFechado: true, deltaAberto: true },
    });
    const agg = new Map<string, { f: number; a: number }>();
    for (const m of movs) {
      const cur = agg.get(m.productId) ?? { f: 0, a: 0 };
      cur.f += num(m.deltaFechado);
      cur.a += num(m.deltaAberto);
      agg.set(m.productId, cur);
    }
    for (const [productId, d] of agg) {
      if (Math.abs(d.f) < 1e-9 && Math.abs(d.a) < 1e-9) continue;
      await aplicarMovimento(tenantId, sale.siteId, productId, "AJUSTE", {
        deltaFechado: -d.f,
        deltaAberto: -d.a,
      }, { saleId, observacao: "Estorno de venda", createdBy });
    }
  }

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.payment.updateMany({
      where: { saleId, tenantId, status: "CONFIRMADO" },
      data: { status: "ESTORNADO" },
    }),
    basePrisma.sale.update({ where: { id: saleId }, data: { status: "CANCELADA" } }),
  ]);
}
