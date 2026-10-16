import "server-only";
import { db, basePrisma } from "@/lib/prisma";
import type { GoodsReceiptOrigem, GoodsReceiptStatus, Prisma } from "@/generated/prisma";
import { RECEBIMENTOS_ABERTOS } from "@/lib/compras/recebimento";
import { custoDeEntradaDaLinha, esperadoDaLinha } from "@/lib/compras/recebimento-regras";
import { montarPagina, periodoAplicavel, type Pagina, type RecFiltros, type RecMarca } from "./_query";

// ── Leitura de /recebimento ─────────────────────────────────────
//
// A tela abre em TODOS e o status é um filtro de seleção múltipla — mas tudo
// continua paginado no banco. Ninguém aqui busca a lista inteira para separar
// depois no navegador: o histórico de concluídos cresce para sempre, e ler o
// passado inteiro para desenhar vinte linhas é o jeito de a tela ficar lenta
// justamente na loja que mais recebe.
//
// Os recortes não mostram a mesma coisa, de propósito:
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
  /**
   * Quando a carga chegou à doca — mede há quanto tempo está parada. Sem
   * chegada registrada (a nota importada antes do caminhão), vale a abertura.
   */
  data: Date;
  /**
   * Quando foi recebido de fato — conferência concluída, mercadoria no
   * estoque. É a coluna "Recebido em". Nulo enquanto aberto.
   */
  concluidoEm: Date | null;
  supplierNome: string;
  /** Só dígitos. Nulo no fornecedor livre (avulso digitado à mão). */
  supplierCnpj: string | null;
  siteNome: string | null;
  origem: GoodsReceiptOrigem;
  /**
   * Concluído: o que entrou (recebido × custo). Aberto: o que se espera — o
   * total da NF-e ou, sem nota, o esperado das linhas. Contar zero itens não
   * faz a carga valer R$ 0,00.
   */
  valor: number;
  /** De onde vem `valor` enquanto a conferência não fecha. Nulo = já é o recebido. */
  valorOrigem: "nota" | "previsto" | null;
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
  /** Só com XML — a nota digitada à mão não guarda série. */
  notaSerie: number | null;
  /** Emissão da NF-e (só com XML) — data do fornecedor, não a do recebimento. */
  notaEmissao: Date | null;
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
  /** A previsão de entrega já passou e nada chegou ainda. */
  atrasado: boolean;
};

export type ResumoRecebimentos = {
  aguardando: number;
  /** Dos aguardando, quantos já passaram da previsão de entrega. */
  atrasados: number;
  /** A conferir + em conferência + parados em divergência. */
  emAberto: number;
  /** Abertos com diferença — só o que ainda tem como resolver. */
  divergencia: number;
  semDocumento: number;
};

/** Meia-noite de hoje: "atrasado" é previsão de ontem para trás, não de uma hora atrás. */
function inicioDeHoje(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

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

  const hoje = inicioDeHoje();
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
      atrasado: p.previsaoEntrega != null && p.previsaoEntrega < hoje,
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

const ENCERRADOS: GoodsReceiptStatus[] = ["FINALIZADO", "CANCELADO"];

/**
 * Finalizado esperando documento é a pendência que ninguém vê até a nota
 * chegar e alguém receber a mesma mercadoria pela segunda vez.
 */
const AGUARDA_NFE: Prisma.GoodsReceiptWhereInput = {
  status: "FINALIZADO",
  inboundId: null,
  entradas: { some: { aguardandoDocumento: true, chaveNfe: null } },
};

/** Cada marca restringe (E) o que o status mostrou. */
function recorteDaMarca(marca: RecMarca): Prisma.GoodsReceiptWhereInput {
  switch (marca) {
    case "divergencia":
      return RECEBIMENTO_DIVERGENTE;
    case "sem-nfe":
      return AGUARDA_NFE;
  }
}

/**
 * O WHERE dos recebimentos: o status escolhido E cada marca ligada.
 *
 * O recorte vive aqui, nunca num `filter()` depois da consulta: cortar em
 * memória o que o banco já cortou por `take` esconde linhas que existem, sem
 * avisar ninguém, e ainda faz a paginação contar errado.
 *
 * O período entra só onde recorta histórico: esconder uma conferência aberta
 * há 40 dias seria esconder justamente a que ninguém pode perder de vista.
 */
/**
 * Avulso aberto e nunca salvo não é recebimento ainda — é alguém que clicou
 * "Não tenho o XML". Entra na lista quando é salvo ou recebido.
 */
const VISIVEL: Prisma.GoodsReceiptWhereInput = { provisorio: false };

function whereRecebimentos(filtro: RecFiltros): Prisma.GoodsReceiptWhereInput {
  const termo = filtro.q.trim();
  const dias = periodoAplicavel(filtro) ? Number(filtro.periodo) : 0;
  const desde = dias > 0 ? new Date(Date.now() - dias * 86_400_000) : null;
  const noPeriodo = desde ? { iniciadoEm: { gte: desde } } : {};

  const abertos: Prisma.GoodsReceiptWhereInput = { status: { in: RECEBIMENTOS_ABERTOS } };
  const encerrados: Prisma.GoodsReceiptWhereInput = { status: { in: ENCERRADOS }, ...noPeriodo };
  const porStatus =
    filtro.status === "aberto"
      ? abertos
      : filtro.status === "concluidos"
        ? encerrados
        : // Todos: o que está aberto aparece sempre, o histórico respeita o período.
          { OR: [abertos, encerrados] };

  const and: Prisma.GoodsReceiptWhereInput[] = [
    VISIVEL,
    porStatus,
    ...filtro.marcas.map(recorteDaMarca),
  ];

  if (termo) and.push(buscaRecebimento(termo));

  return {
    ...(filtro.supplierId ? { supplierId: filtro.supplierId } : {}),
    AND: and,
  };
}

/**
 * Número do recebimento, do pedido, da NF-e (digitada ou do XML), chave,
 * fornecedor — e PRODUTO: "a Heineken já chegou?" é pergunta de doca. O item
 * guarda a descrição como apareceu (nosso nome ou o xProd da nota) e o EAN.
 */
function buscaRecebimento(termo: string): Prisma.GoodsReceiptWhereInput {
  const contem = { contains: termo, mode: "insensitive" as const };
  const numeroNota = /^\d{1,9}$/.test(termo) ? Number(termo) : null;
  return {
    OR: [
      { numero: contem },
      { numeroNota: contem },
      { fornecedorLivre: contem },
      { supplier: { razaoSocial: contem } },
      { supplier: { nomeFantasia: contem } },
      { purchaseOrder: { numero: contem } },
      { inbound: { chave: { contains: termo } } },
      ...(numeroNota != null ? [{ inbound: { numero: numeroNota } }] : []),
      { itens: { some: { OR: [{ descricao: contem }, { ean: termo }] } } },
    ],
  };
}

const selectRecebimento = {
  id: true,
  numero: true,
  status: true,
  origem: true,
  iniciadoEm: true,
  chegadaEm: true,
  finalizadoEm: true,
  numeroNota: true,
  fornecedorLivre: true,
  divergenciaMotivo: true,
  createdBy: true,
  purchaseOrderId: true,
  inboundId: true,
  supplier: { select: { razaoSocial: true, nomeFantasia: true, cnpj: true } },
  site: { select: { nome: true } },
  purchaseOrder: { select: { numero: true } },
  inbound: { select: { id: true, numero: true, serie: true, valorTotal: true, dataEmissao: true } },
  itens: {
    select: {
      status: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoPedido: true,
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
  // A mesma régua da tela e do fechamento: o que a nota não trouxe espera 0,
  // e cada linha vale pelo custo com que entra (ou entraria).
  const esperadoDe = (i: ReceiptCru["itens"][number]) => esperadoDaLinha(i);
  const recebidoDe = (i: ReceiptCru["itens"][number]) =>
    i.qtdRecebida == null ? (encerrado ? esperadoDe(i) : 0) : Number(i.qtdRecebida);

  const aberto = RECEBIMENTOS_ABERTOS.includes(r.status);
  const valorRecebido = r.itens.reduce(
    (a, i) => a + recebidoDe(i) * custoDeEntradaDaLinha(i),
    0,
  );
  const valorEsperado = r.itens.reduce(
    (a, i) => a + esperadoDe(i) * custoDeEntradaDaLinha(i),
    0,
  );

  const entradas = r.entradas;
  return {
    id: r.id,
    numero: r.numero,
    // A nota costuma ser importada dias antes do caminhão: contar dali dizia
    // "parada há 4 dias" de uma carga que acabou de encostar.
    data: r.chegadaEm ?? r.iniciadoEm,
    concluidoEm: r.finalizadoEm,
    supplierNome:
      r.supplier?.nomeFantasia || r.supplier?.razaoSocial || r.fornecedorLivre || "Sem fornecedor",
    supplierCnpj: r.supplier?.cnpj ?? null,
    siteNome: r.site?.nome ?? null,
    origem: r.origem,
    valor: aberto ? (r.inbound ? Number(r.inbound.valorTotal) : valorEsperado) : valorRecebido,
    valorOrigem: aberto ? (r.inbound ? "nota" : "previsto") : null,
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
    notaNumero: r.inbound ? String(r.inbound.numero) : r.numeroNota,
    notaSerie: r.inbound?.serie ?? null,
    notaEmissao: r.inbound?.dataEmissao ?? null,
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
 * Uma página de recebimentos dos recortes marcados (ou de todos).
 *
 * A mesma função serve "em conferência", "com divergência", "concluídos",
 * "avulsos" e "sem NF-e": o que muda entre eles é o WHERE, não a leitura.
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
      // A ordem segue a coluna "Recebido em" (conclusão). Os abertos ainda não
      // têm essa data e vêm sempre primeiro — é o trabalho da doca —, entre si
      // pela abertura.
      orderBy: [
        { finalizadoEm: { sort: filtro.ordem, nulls: "first" } },
        { iniciadoEm: filtro.ordem },
      ],
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
  const pedidosEsperando: Prisma.PurchaseOrderWhereInput = {
    status: PEDIDOS_ESPERANDO,
    ...SEM_CONFERENCIA_ABERTA,
    ...PEDIDO_COM_SALDO,
  };

  const [emAberto, divergencia, semDocumento, aguardando, atrasados] = await Promise.all([
    db.goodsReceipt.count({ where: { ...VISIVEL, status: { in: RECEBIMENTOS_ABERTOS } } }),
    // Só a divergência que ainda tem como resolver. Contar também as
    // concluídas com diferença registrada fazia o número só crescer — e um
    // indicador que nunca baixa vira papel de parede.
    db.goodsReceipt.count({
      where: { AND: [VISIVEL, { status: { in: RECEBIMENTOS_ABERTOS } }, RECEBIMENTO_DIVERGENTE] },
    }),
    db.goodsReceipt.count({ where: { AND: [VISIVEL, AGUARDA_NFE] } }),
    db.purchaseOrder.count({ where: pedidosEsperando }),
    db.purchaseOrder.count({
      where: { ...pedidosEsperando, previsaoEntrega: { lt: inicioDeHoje() } },
    }),
  ]);

  return { aguardando, atrasados, emAberto, divergencia, semDocumento };
}

export async function loadFornecedoresComRecebimento(): Promise<{ id: string; nome: string }[]> {
  const ids = await db.goodsReceipt.findMany({
    where: { ...VISIVEL, supplierId: { not: null } },
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
