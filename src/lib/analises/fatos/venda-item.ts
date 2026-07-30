import "server-only";
import { db } from "@/lib/prisma";
import { chaveTempo, chaveDiaSemana } from "./tempo";
import type { CarregarArgs, LinhaFato, ResultadoFato } from "./tipos";

/**
 * Fato `venda-item` — uma linha por item de venda PAGA.
 *
 * É o grão mais fino do faturamento: dele saem receita, quantidade, desconto,
 * ticket, CMV e margem, quebrados por qualquer dimensão do catálogo. Só busca
 * (e só faz JOIN de) o que a consulta pediu — perguntar "receita por produto"
 * não vai atrás de cliente nem de forma de pagamento.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Dimensões que só existem depois de ler a tabela de produtos. */
const CAMPOS_PRODUTO = ["produto", "sku", "categoria", "subcategoria", "marca", "fornecedor"];

export async function carregarVendaItem(a: CarregarArgs): Promise<ResultadoFato> {
  const precisa = (c: string) => a.campos.has(c);
  const precisaProduto = CAMPOS_PRODUTO.some(precisa);

  const saleWhere = {
    status: "PAGA" as const,
    paidAt: { gte: a.range.inicio, lt: a.range.fim },
    ...(a.siteIds ? { siteId: { in: a.siteIds } } : {}),
  };

  const itens = await db.saleItem.findMany({
    where: { sale: { is: saleWhere } },
    select: {
      saleId: true,
      productId: true,
      quantidade: true,
      total: true,
      desconto: true,
      sale: {
        select: {
          paidAt: true,
          siteId: true,
          origem: true,
          customerId: true,
          operatorUserId: true,
        },
      },
    },
    // +1 para saber que estourou sem precisar de um count separado.
    take: a.limite + 1,
  });

  const truncado = itens.length > a.limite;
  const linhasFonte = truncado ? itens.slice(0, a.limite) : itens;
  if (linhasFonte.length === 0) return { linhas: [], truncado };

  const productIds = [...new Set(linhasFonte.map((i) => i.productId))];

  const [produtos, sites, operadores, clientes, pagamentos, custos] = await Promise.all([
    precisaProduto ? carregarProdutos(productIds) : Promise.resolve(new Map()),
    precisa("site") ? carregarSites() : Promise.resolve(new Map<string, string>()),
    precisa("operador")
      ? carregarOperadores(idsDe(linhasFonte, (i) => i.sale?.operatorUserId))
      : Promise.resolve(new Map<string, string>()),
    precisa("cliente")
      ? carregarClientes(idsDe(linhasFonte, (i) => i.sale?.customerId))
      : Promise.resolve(new Map<string, string>()),
    precisa("pagamento") ? carregarPagamentoPrincipal(saleWhere) : Promise.resolve(new Map<string, string>()),
    precisa("cmv") ? carregarCusto(a) : Promise.resolve(new Map<string, number>()),
  ]);

  // Rateio do CMV: o custo é apurado por (venda × produto), mas a mesma venda
  // pode ter dois itens do mesmo produto. Distribui proporcional à quantidade
  // para que a soma das linhas continue igual ao CMV do período.
  const qtdPorChave = new Map<string, number>();
  if (custos.size > 0) {
    for (const i of linhasFonte) {
      const k = `${i.saleId}|${i.productId}`;
      qtdPorChave.set(k, (qtdPorChave.get(k) ?? 0) + n(i.quantidade));
    }
  }

  const linhas: LinhaFato[] = linhasFonte.map((i) => {
    const p = produtos.get(i.productId);
    const quantidade = n(i.quantidade);
    const dims: Record<string, string | null> = {};

    if (precisa("produto")) dims.produto = p?.nome ?? "Produto removido";
    if (precisa("sku")) dims.sku = p?.sku ?? "—";
    if (precisa("categoria")) dims.categoria = p?.categoria ?? null;
    if (precisa("subcategoria")) dims.subcategoria = p?.subcategoria ?? null;
    if (precisa("marca")) dims.marca = p?.marca ?? null;
    if (precisa("fornecedor")) dims.fornecedor = p?.fornecedor ?? null;
    if (precisa("site")) dims.site = sites.get(i.sale?.siteId ?? "") ?? null;
    if (precisa("operador")) {
      dims.operador = i.sale?.operatorUserId
        ? (operadores.get(i.sale.operatorUserId) ?? "Usuário removido")
        : null;
    }
    if (precisa("cliente")) {
      dims.cliente = i.sale?.customerId ? (clientes.get(i.sale.customerId) ?? null) : null;
    }
    if (precisa("origem")) dims.origem = ORIGEM_LABEL[i.sale?.origem ?? ""] ?? null;
    if (precisa("pagamento")) dims.pagamento = pagamentos.get(i.saleId) ?? null;
    if (precisa("tempo")) {
      dims.tempo = i.sale?.paidAt ? chaveTempo(i.sale.paidAt, a.granularidade) : null;
    }
    if (precisa("diaSemana")) {
      dims.diaSemana = i.sale?.paidAt ? chaveDiaSemana(i.sale.paidAt) : null;
    }

    const vals: Record<string, number> = {
      receita: n(i.total),
      quantidade,
      desconto: n(i.desconto),
    };

    if (custos.size > 0) {
      const k = `${i.saleId}|${i.productId}`;
      const totalQtd = qtdPorChave.get(k) ?? 0;
      const totalCusto = custos.get(k) ?? 0;
      vals.cmv = totalQtd > 0 ? (totalCusto * quantidade) / totalQtd : totalCusto;
    } else {
      vals.cmv = 0;
    }

    return { dims, vals, chaves: { venda: i.saleId } };
  });

  return { linhas, truncado };
}

// ── Enriquecimento (só o que a consulta pediu) ──────────────

function idsDe<T>(linhas: T[], pega: (l: T) => string | null | undefined): string[] {
  const ids = new Set<string>();
  for (const l of linhas) {
    const id = pega(l);
    if (id) ids.add(id);
  }
  return [...ids];
}

const ORIGEM_LABEL: Record<string, string> = {
  PDV: "PDV",
  TOTEM: "Autoatendimento",
  APP: "App",
};

const METODO_LABEL: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  PIX: "Pix",
  OUTRO: "Outro",
};

type ProdutoDims = {
  nome: string;
  sku: string;
  categoria: string | null;
  subcategoria: string | null;
  marca: string | null;
  fornecedor: string | null;
};

async function carregarProdutos(ids: string[]): Promise<Map<string, ProdutoDims>> {
  if (ids.length === 0) return new Map();
  const prods = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nome: true,
      sku: true,
      brand: { select: { nome: true } },
      subcategory: { select: { nome: true, category: { select: { nome: true } } } },
      suppliers: {
        where: { isPrincipal: true },
        take: 1,
        select: { supplier: { select: { nomeFantasia: true, razaoSocial: true } } },
      },
    },
  });
  return new Map(
    prods.map((p) => [
      p.id,
      {
        nome: p.nome,
        sku: p.sku,
        categoria: p.subcategory?.category?.nome ?? null,
        subcategoria: p.subcategory?.nome ?? null,
        marca: p.brand?.nome ?? null,
        fornecedor:
          p.suppliers[0]?.supplier?.nomeFantasia ??
          p.suppliers[0]?.supplier?.razaoSocial ??
          null,
      },
    ]),
  );
}

async function carregarSites(): Promise<Map<string, string>> {
  const sites = await db.site.findMany({ select: { id: true, nome: true } });
  return new Map(sites.map((s) => [s.id, s.nome]));
}

/**
 * Nome do operador via Membership — nunca lendo User direto. Assim só aparece
 * quem é membro DESTE tenant (o `db` injeta o tenantId no membership).
 */
async function carregarOperadores(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const membros = await db.membership.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return new Map(membros.map((m) => [m.userId, m.user.name ?? m.user.email]));
}

async function carregarClientes(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const clientes = await db.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true },
  });
  return new Map(clientes.map((c) => [c.id, c.nome]));
}

/**
 * Forma de pagamento da venda. Venda dividida (parte pix, parte dinheiro) conta
 * pelo método de MAIOR valor — atribuir o item a dois métodos duplicaria a
 * receita, e o "principal" é o que o operador reconhece como a forma da venda.
 */
async function carregarPagamentoPrincipal(
  saleWhere: Record<string, unknown>,
): Promise<Map<string, string>> {
  const pgs = await db.payment.findMany({
    where: { status: "CONFIRMADO", sale: { is: saleWhere } },
    select: { saleId: true, metodo: true, valor: true },
  });
  const maior = new Map<string, { metodo: string; valor: number }>();
  for (const p of pgs) {
    const atual = maior.get(p.saleId);
    const valor = n(p.valor);
    if (!atual || valor > atual.valor) maior.set(p.saleId, { metodo: p.metodo, valor });
  }
  return new Map(
    [...maior.entries()].map(([saleId, m]) => [saleId, METODO_LABEL[m.metodo] ?? m.metodo]),
  );
}

/**
 * Custo por (venda × produto) a partir dos movimentos de estoque da venda —
 * mesma apuração do CMV de `_data.ts`, só que descendo ao grão do item: cada
 * StockMovement de venda carrega o `custoUnitario` que o FEFO consumiu, e o
 * consumo em aberto (ml/g) vira fração de unidade por `conteudoPorUnidade`.
 *
 * Filtra por `createdAt` (e não pelos saleIds carregados) para bater com o
 * número das telas fixas. Efeito colateral conhecido: venda offline
 * sincronizada em outro dia entra no CMV do dia da sincronização.
 */
async function carregarCusto(a: CarregarArgs): Promise<Map<string, number>> {
  const movs = await db.stockMovement.findMany({
    where: {
      tipo: { in: ["SAIDA", "PRODUCAO"] },
      saleId: { not: null },
      createdAt: { gte: a.range.inicio, lt: a.range.fim },
      ...(a.siteIds ? { siteId: { in: a.siteIds } } : {}),
    },
    select: {
      saleId: true,
      productId: true,
      deltaFechado: true,
      deltaAberto: true,
      custoUnitario: true,
    },
  });
  if (movs.length === 0) return new Map();

  const prods = await db.product.findMany({
    where: { id: { in: [...new Set(movs.map((m) => m.productId))] } },
    select: { id: true, conteudoPorUnidade: true },
  });
  const conteudo = new Map(
    prods.map((p) => [p.id, p.conteudoPorUnidade ? n(p.conteudoPorUnidade) : null]),
  );

  const custos = new Map<string, number>();
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    if (cu === 0 || !m.saleId) continue;
    const cpu = conteudo.get(m.productId);
    const unidadesAbertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    const add = cu * (Math.abs(n(m.deltaFechado)) + unidadesAbertas);
    const k = `${m.saleId}|${m.productId}`;
    custos.set(k, (custos.get(k) ?? 0) + add);
  }
  return custos;
}
