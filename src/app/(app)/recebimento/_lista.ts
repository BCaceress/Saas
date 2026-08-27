import "server-only";
import { db, basePrisma } from "@/lib/prisma";
import type { GoodsReceiptOrigem, GoodsReceiptStatus, Prisma } from "@/generated/prisma";
import { RECEBIMENTOS_ABERTOS } from "@/lib/compras/recebimento";
import { montarPagina, periodoAplicavel, type Pagina, type RecFiltros } from "./_query";

// ── Leitura de /recebimento ─────────────────────────────────────
//
// A tela é UMA ABA POR VEZ, e cada aba é uma consulta própria, paginada no
// banco. Ninguém aqui busca "tudo" para separar depois no navegador: o
// histórico de concluídos cresce para sempre, e ler o passado inteiro para
// desenhar vinte linhas é o jeito de a tela ficar lenta justamente na loja que
// mais recebe.
//
// As abas não mostram a mesma coisa, de propósito:
//
//  1. Aguardando — PEDIDOS com mercadoria esperada e nenhuma conferência
//     aberta. Não é recebimento nenhum: é o que está prestes a virar um. E é
//     VISÃO, não status — nada é gravado no pedido para ele entrar ou sair
//     daqui; um status gravado precisaria ser mantido em sincronia por todo
//     lugar que mexe em recebimento, e um dia não estaria.
//  2. Em conferência / Com divergência — recebimentos abertos. Trabalho:
//     esvazia, não cresce.
//  3. Concluídos / Avulsos — histórico.
//
// Cada linha de recebimento é UM RECEBIMENTO — não um pedido, não uma nota. O
// mesmo pedido aparece em duas linhas quando chegou em dois caminhões, e é
// exatamente isso que a tela precisa mostrar: o pedido responde "o que eu
// comprei?", esta tela responde "o que chegou?".

export type RecebimentoRow = {
  id: string;
  numero: string;
  data: Date;
  supplierNome: string;
  siteNome: string | null;
  origem: GoodsReceiptOrigem;
  valor: number;
  /** Linhas de produto. */
  itens: number;
  /** Quantidade total, em unidade base. */
  unidades: number;
  /** Quanto se esperava — o denominador do "60/100". */
  esperado: number;
  status: GoodsReceiptStatus | "ESTORNADO";
  pedidoId: string | null;
  pedidoNumero: string | null;
  /** Sem pedido por trás — nem antes, nem depois. */
  avulso: boolean;
  inboundId: string | null;
  notaNumero: string | null;
  divergencias: number;
  /** Entrou sem documento fiscal e ainda espera o XML. */
  semDocumento: boolean;
  temBonificacao: boolean;
  divergenciaMotivo: string | null;
  estornoMotivo: string | null;
  usuario: string | null;
  href: string;
};

/** Um pedido que espera mercadoria e ainda não teve recebimento aberto. */
export type AguardandoRow = {
  pedidoId: string;
  numero: string;
  supplierNome: string;
  siteNome: string;
  previsaoEntrega: Date | null;
  /** Total pedido e total já recebido, na unidade de compra. */
  pedido: number;
  recebido: number;
  itens: number;
  /** Dinheiro do que ainda não chegou. */
  valorSaldo: number;
  /** Já houve recebimento antes (é a segunda entrega deste pedido). */
  recebimentosAnteriores: number;
};

export type ResumoRecebimentos = {
  aguardando: number;
  emConferencia: number;
  divergencia: number;
  recebidosHoje: number;
  semDocumento: number;
};

// ── Aguardando recebimento (pedidos, não recebimentos) ──────────

const PEDIDOS_ESPERANDO: Prisma.EnumPurchaseOrderStatusFilter = {
  in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"],
};

/**
 * O pedido ainda tem saldo a chegar?
 *
 * Comparado NO BANCO (referência de campo), não em memória: filtrar depois da
 * consulta faria a contagem e a paginação mentirem — a página 2 pularia linhas
 * que a página 1 descartou. `some(recebida < pedida)` é exatamente o mesmo
 * corte que somar `min(recebida, pedida)` e comparar com o total pedido.
 */
const PEDIDO_COM_SALDO: Prisma.PurchaseOrderWhereInput = {
  items: { some: { qtdRecebida: { lt: db.purchaseOrderItem.fields.qtdPedida } } },
};

/** O corte que define a aba: nenhuma conferência aberta neste pedido. */
const SEM_CONFERENCIA_ABERTA: Prisma.PurchaseOrderWhereInput = {
  // Quem já está sendo conferido aparece em "Em conferência" — nunca nas duas
  // listas ao mesmo tempo.
  recebimentos: { none: { status: { in: RECEBIMENTOS_ABERTOS } } },
};

async function whereAguardando(filtro: RecFiltros): Promise<Prisma.PurchaseOrderWhereInput> {
  const termo = filtro.q.trim();
  const and: Prisma.PurchaseOrderWhereInput[] = [PEDIDO_COM_SALDO];

  if (termo) {
    // O pedido não guarda o nome do produto — quem guarda é o catálogo. Sem
    // esta ponte, buscar "heineken" na aba de pedidos não acharia nada.
    const produtos = await db.product.findMany({
      where: {
        OR: [
          { nome: { contains: termo, mode: "insensitive" } },
          { sku: { contains: termo, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 200,
    });

    and.push({
      OR: [
        { numero: { contains: termo, mode: "insensitive" } },
        { supplier: { razaoSocial: { contains: termo, mode: "insensitive" } } },
        { supplier: { nomeFantasia: { contains: termo, mode: "insensitive" } } },
        ...(produtos.length > 0
          ? [{ items: { some: { productId: { in: produtos.map((p) => p.id) } } } }]
          : []),
      ],
    });
  }

  return {
    status: PEDIDOS_ESPERANDO,
    ...SEM_CONFERENCIA_ABERTA,
    ...(filtro.supplierId ? { supplierId: filtro.supplierId } : {}),
    AND: and,
  };
}

/** Uma página de pedidos aguardando mercadoria — e só ela. */
export async function loadAguardandoRecebimento(
  filtro: RecFiltros,
  opts: { skip: number; take: number },
): Promise<Pagina<AguardandoRow>> {
  const where = await whereAguardando(filtro);
  const [total, pedidos] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({
      where,
      select: {
        id: true,
        numero: true,
        previsaoEntrega: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        site: { select: { nome: true } },
        items: { select: { qtdPedida: true, qtdRecebida: true, custoUnitario: true, tipo: true } },
        _count: { select: { recebimentos: true } },
      },
      orderBy: [{ previsaoEntrega: "asc" }, { createdAt: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  ]);

  const rows = pedidos.map((p): AguardandoRow => {
    const pedido = p.items.reduce((a, i) => a + Number(i.qtdPedida), 0);
    const recebido = p.items.reduce(
      (a, i) => a + Math.min(Number(i.qtdRecebida), Number(i.qtdPedida)),
      0,
    );
    return {
      pedidoId: p.id,
      numero: p.numero,
      supplierNome: p.supplier?.nomeFantasia || p.supplier?.razaoSocial || "—",
      siteNome: p.site.nome,
      previsaoEntrega: p.previsaoEntrega,
      pedido,
      recebido,
      itens: p.items.length,
      valorSaldo: p.items.reduce(
        (a, i) =>
          i.tipo === "COMPRA"
            ? a + Math.max(0, Number(i.qtdPedida) - Number(i.qtdRecebida)) * Number(i.custoUnitario)
            : a,
        0,
      ),
      recebimentosAnteriores: p._count.recebimentos,
    };
  });

  return montarPagina(rows, total, filtro);
}

// ── Recebimentos ────────────────────────────────────────────────

/** Chegou diferente do que se esperava — no cabeçalho ou em alguma linha. */
const RECEBIMENTO_DIVERGENTE: Prisma.GoodsReceiptWhereInput = {
  OR: [
    { status: "DIVERGENCIA" },
    { divergenciaMotivo: { not: null } },
    {
      itens: {
        some: { OR: [{ resolucao: { not: null } }, { motivoDivergencia: { not: null } }] },
      },
    },
  ],
};

const ABERTOS_E_FINALIZADO: GoodsReceiptStatus[] = [...RECEBIMENTOS_ABERTOS, "FINALIZADO"];

/**
 * O WHERE da aba de recebimentos.
 *
 * O recorte vive aqui, nunca num `filter()` depois da consulta: cortar em
 * memória o que o banco já cortou por `take` esconde linhas que existem, sem
 * avisar ninguém, e ainda faz a paginação contar errado.
 */
function whereRecebimentos(filtro: RecFiltros): Prisma.GoodsReceiptWhereInput {
  const termo = filtro.q.trim();
  const and: Prisma.GoodsReceiptWhereInput[] = [];
  const where: Prisma.GoodsReceiptWhereInput = {
    ...(filtro.supplierId ? { supplierId: filtro.supplierId } : {}),
  };

  switch (filtro.aba) {
    case "andamento":
      where.status = { in: RECEBIMENTOS_ABERTOS };
      break;
    case "divergencia":
      // Divergência não é só a conferência parada nela: a que foi finalizada
      // com diferença registrada continua sendo problema de alguém.
      where.status = { in: ABERTOS_E_FINALIZADO };
      and.push(RECEBIMENTO_DIVERGENTE);
      break;
    case "concluidos":
      where.status = { in: ["FINALIZADO", "CANCELADO"] };
      break;
    case "avulsos":
      // Avulso é origem, não estado — vale aberto e finalizado.
      where.purchaseOrderId = null;
      where.status = { in: ABERTOS_E_FINALIZADO };
      break;
    case "sem-nfe":
      // Finalizado esperando documento é a pendência que ninguém vê até a nota
      // chegar e alguém receber a mesma mercadoria pela segunda vez.
      where.status = "FINALIZADO";
      where.inboundId = null;
      where.entradas = { some: { aguardandoDocumento: true, chaveNfe: null } };
      break;
    default:
      where.status = { in: ABERTOS_E_FINALIZADO };
  }

  // O período recorta histórico, não trabalho: esconder uma conferência aberta
  // há 40 dias seria esconder justamente a que ninguém pode perder de vista.
  if (periodoAplicavel(filtro.aba) && filtro.periodo) {
    const dias = Number(filtro.periodo);
    if (dias > 0) where.iniciadoEm = { gte: new Date(Date.now() - dias * 86_400_000) };
  }

  if (termo) {
    and.push({
      OR: [
        { numero: { contains: termo, mode: "insensitive" } },
        { numeroNota: { contains: termo, mode: "insensitive" } },
        { fornecedorLivre: { contains: termo, mode: "insensitive" } },
        { supplier: { razaoSocial: { contains: termo, mode: "insensitive" } } },
        { supplier: { nomeFantasia: { contains: termo, mode: "insensitive" } } },
        { purchaseOrder: { numero: { contains: termo, mode: "insensitive" } } },
        { inbound: { chave: { contains: termo } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

const selectRecebimento = {
  id: true,
  numero: true,
  status: true,
  origem: true,
  iniciadoEm: true,
  finalizadoEm: true,
  numeroNota: true,
  fornecedorLivre: true,
  divergenciaMotivo: true,
  createdBy: true,
  purchaseOrderId: true,
  inboundId: true,
  supplier: { select: { razaoSocial: true, nomeFantasia: true } },
  site: { select: { nome: true } },
  purchaseOrder: { select: { numero: true } },
  inbound: { select: { id: true, numero: true, serie: true } },
  itens: {
    select: {
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoFaturado: true,
      bonificacao: true,
      resolucao: true,
      motivoDivergencia: true,
    },
  },
  entradas: {
    select: { estornadaEm: true, estornoMotivo: true, aguardandoDocumento: true, chaveNfe: true },
  },
} satisfies Prisma.GoodsReceiptSelect;

type ReceiptCru = Prisma.GoodsReceiptGetPayload<{ select: typeof selectRecebimento }>;

function paraLinha(r: ReceiptCru, usuarios: Map<string, string>): RecebimentoRow {
  const encerrado = r.status === "FINALIZADO";
  const esperadoDe = (i: ReceiptCru["itens"][number]) =>
    Number(i.qtdFaturada) || Number(i.qtdPedida);
  const recebidoDe = (i: ReceiptCru["itens"][number]) =>
    i.qtdRecebida == null ? (encerrado ? esperadoDe(i) : 0) : Number(i.qtdRecebida);

  const entradas = r.entradas;
  return {
    id: r.id,
    numero: r.numero,
    data: r.finalizadoEm ?? r.iniciadoEm,
    supplierNome:
      r.supplier?.nomeFantasia || r.supplier?.razaoSocial || r.fornecedorLivre || "Sem fornecedor",
    siteNome: r.site?.nome ?? null,
    origem: r.origem,
    valor: r.itens.reduce(
      (a, i) => a + (i.bonificacao ? 0 : recebidoDe(i) * Number(i.custoFaturado)),
      0,
    ),
    itens: r.itens.length,
    unidades: r.itens.reduce((a, i) => a + recebidoDe(i), 0),
    esperado: r.itens.reduce((a, i) => a + esperadoDe(i), 0),
    status:
      entradas.length > 0 && entradas.every((e) => e.estornadaEm)
        ? "ESTORNADO"
        : r.status,
    pedidoId: r.purchaseOrderId,
    pedidoNumero: r.purchaseOrder?.numero ?? null,
    avulso: !r.purchaseOrderId,
    inboundId: r.inboundId,
    notaNumero: r.inbound ? `${r.inbound.numero}/${r.inbound.serie}` : r.numeroNota,
    divergencias: r.itens.filter((i) => i.resolucao || i.motivoDivergencia).length,
    // Sem a marca `aguardandoDocumento` não há espera nenhuma — é só uma carga
    // que nunca teve nota, e nunca vai ter.
    semDocumento:
      encerrado && !r.inboundId && entradas.some((e) => e.aguardandoDocumento && !e.chaveNfe),
    temBonificacao: r.itens.some((i) => i.bonificacao),
    divergenciaMotivo: r.divergenciaMotivo,
    estornoMotivo: entradas.find((e) => e.estornoMotivo)?.estornoMotivo ?? null,
    usuario: r.createdBy ? (usuarios.get(r.createdBy) ?? null) : null,
    href: `/recebimento/${r.id}`,
  };
}

/**
 * Uma página de recebimentos da aba pedida — e só dela.
 *
 * A mesma função serve "em conferência", "com divergência", "concluídos",
 * "avulsos" e "sem NF-e": o que muda entre elas é o WHERE, não a leitura.
 */
export async function loadRecebimentos(
  filtro: RecFiltros,
  opts: { skip: number; take: number },
): Promise<Pagina<RecebimentoRow>> {
  const where = whereRecebimentos(filtro);
  const [total, rows] = await Promise.all([
    db.goodsReceipt.count({ where }),
    db.goodsReceipt.findMany({
      where,
      select: selectRecebimento,
      orderBy: { iniciadoEm: "desc" },
      skip: opts.skip,
      take: opts.take,
    }),
  ]);
  const usuarios = await nomesDeUsuario(rows.map((r) => r.createdBy));
  return montarPagina(
    rows.map((r) => paraLinha(r, usuarios)),
    total,
    filtro,
  );
}

// ── Resumo ──────────────────────────────────────────────────────

/**
 * Os indicadores do topo. São do TENANT, não da página: números que mudam a
 * cada filtro não são resumo, são ruído.
 *
 * Só entra aqui indicador operacional — o que pede ação hoje. "Quanto entrou no
 * mês" é pergunta de relatório, não de doca: ocupava a faixa sem mudar o que
 * alguém faz a seguir.
 */
export async function resumoRecebimentos(): Promise<ResumoRecebimentos> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const [emConferencia, divergencia, recebidosHoje, semDocumento, aguardando] = await Promise.all([
    db.goodsReceipt.count({ where: { status: { in: RECEBIMENTOS_ABERTOS } } }),
    db.goodsReceipt.count({
      where: { status: { in: ABERTOS_E_FINALIZADO }, ...RECEBIMENTO_DIVERGENTE },
    }),
    db.goodsReceipt.count({ where: { status: "FINALIZADO", finalizadoEm: { gte: hoje } } }),
    db.goodsReceipt.count({
      where: {
        status: "FINALIZADO",
        inboundId: null,
        entradas: { some: { aguardandoDocumento: true, chaveNfe: null } },
      },
    }),
    db.purchaseOrder.count({
      where: { status: PEDIDOS_ESPERANDO, ...SEM_CONFERENCIA_ABERTA, ...PEDIDO_COM_SALDO },
    }),
  ]);

  return { aguardando, emConferencia, divergencia, recebidosHoje, semDocumento };
}

export async function loadFornecedoresComRecebimento(): Promise<{ id: string; nome: string }[]> {
  const ids = await db.goodsReceipt.findMany({
    where: { supplierId: { not: null } },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });
  const validos = ids.map((i) => i.supplierId).filter((i): i is string => !!i);
  if (validos.length === 0) return [];

  const fornecedores = await db.supplier.findMany({
    where: { id: { in: validos } },
    select: { id: true, razaoSocial: true, nomeFantasia: true },
    orderBy: { razaoSocial: "asc" },
  });
  return fornecedores.map((f) => ({ id: f.id, nome: f.nomeFantasia || f.razaoSocial }));
}

// ── Detalhe de um recebimento (para o painel da linha) ──────────

export type ItemRecebido = {
  nome: string;
  sku: string;
  imagemUrl: string | null;
  quantidade: number;
  esperado: number;
  custoTotal: number;
  bonificacao: boolean;
};

export async function loadItensDoRecebimento(receiptId: string): Promise<ItemRecebido[]> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: receiptId },
    select: { status: true },
  });
  if (!receipt) return [];

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { receiptId },
    select: {
      productId: true,
      descricao: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoFaturado: true,
      bonificacao: true,
    },
    orderBy: { descricao: "asc" },
  });
  if (linhas.length === 0) return [];

  const produtoIds = [...new Set(linhas.map((l) => l.productId).filter((v): v is string => !!v))];
  const produtos = produtoIds.length
    ? await db.product.findMany({
        where: { id: { in: produtoIds } },
        select: { id: true, nome: true, sku: true, imagemUrl: true },
      })
    : [];
  const porProduto = new Map(produtos.map((p) => [p.id, p]));

  return linhas.map((l): ItemRecebido => {
    const p = l.productId ? porProduto.get(l.productId) : null;
    const esperado = Number(l.qtdFaturada) || Number(l.qtdPedida);
    const quantidade =
      l.qtdRecebida == null ? (receipt.status === "FINALIZADO" ? esperado : 0) : Number(l.qtdRecebida);
    return {
      nome: p?.nome ?? l.descricao,
      sku: p?.sku ?? "—",
      imagemUrl: p?.imagemUrl ?? null,
      quantidade,
      esperado,
      custoTotal: l.bonificacao ? 0 : quantidade * Number(l.custoFaturado),
      bonificacao: l.bonificacao,
    };
  });
}

// ── Auxiliares ──────────────────────────────────────────────────

async function nomesDeUsuario(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((v): v is string => !!v))];
  if (unicos.length === 0) return new Map();
  const users = await basePrisma.user.findMany({
    where: { id: { in: unicos } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? u.email ?? "—"]));
}
