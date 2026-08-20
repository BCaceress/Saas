import { db } from "@/lib/prisma";
import { precoEfetivo } from "@/lib/compras/comparador";
import type {
  CarrinhoPorFornecedor,
  FornecedorCard,
  ImportacaoRow,
  ItemCarrinho,
  ItemCatalogo,
  LinhaHistorico,
  ResumoEconomia,
} from "./types";

// ============================================================
// Kit de catálogo de fornecedor — leituras compartilhadas entre Compras
// (comparador, cesta, importações, histórico) e o Centro de Gestão do
// Fornecedor (aba Catálogo). Tudo roda dentro de `runWithTenant` (RSC chama o
// `db` estendido direto — ver CLAUDE.md).
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;

function inicioDoMes(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── Catálogo de um fornecedor ───────────────────────────────

export type FiltroCatalogo = {
  busca?: string;
  categoria?: string;
  apenasPromocao?: boolean;
  apenasPendentes?: boolean;
  ordem?: "descricao" | "preco" | "atualizacao";
};

export async function loadCatalogo(
  supplierId: string,
  filtro: FiltroCatalogo = {},
): Promise<{
  fornecedor: FornecedorCard | null;
  itens: ItemCatalogo[];
  categorias: string[];
  total: number;
}> {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      logoUrl: true,
      pedidoMinimo: true,
      ativo: true,
      possuiIntegracao: true,
      tipoIntegracao: true,
      situacaoIntegracao: true,
      aceitaImportacaoManual: true,
      aceitaImportacaoAutomatica: true,
      ultimaSincronizacao: true,
    },
  });
  if (!supplier) return { fornecedor: null, itens: [], categorias: [], total: 0 };

  const busca = filtro.busca?.trim();
  const itens = await db.supplierCatalogItem.findMany({
    where: {
      supplierId,
      ativo: true,
      ...(filtro.apenasPendentes ? { matchStatus: "PENDENTE" as const } : {}),
      ...(filtro.apenasPromocao ? { emPromocao: true } : {}),
      ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
      ...(busca && busca.length >= 2
        ? {
            OR: [
              { descricao: { contains: busca, mode: "insensitive" as const } },
              { ean: { contains: busca.replace(/\D/g, "") || " " } },
              { codigoFornecedor: { contains: busca, mode: "insensitive" as const } },
              { marca: { contains: busca, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy:
      filtro.ordem === "preco"
        ? { preco: "asc" }
        : filtro.ordem === "atualizacao"
          ? { ultimaAtualizacao: "desc" }
          : { descricao: "asc" },
    take: 400,
    select: {
      id: true,
      descricao: true,
      codigoFornecedor: true,
      ean: true,
      marca: true,
      categoria: true,
      imagemUrl: true,
      unidade: true,
      preco: true,
      precoPromocional: true,
      emPromocao: true,
      quantidadeMinima: true,
      estoqueDisponivel: true,
      validadeOferta: true,
      ultimaAtualizacao: true,
      productId: true,
      matchStatus: true,
      matchOrigem: true,
      ativo: true,
      product: { select: { nome: true, sku: true } },
    },
  });

  // Melhor preço de mercado dos produtos desta página — é o que transforma o
  // catálogo em decisão ("aqui está R$ 0,40 mais caro que na concorrência").
  const productIds = [...new Set(itens.map((i) => i.productId).filter((id): id is string => !!id))];
  const concorrentes =
    productIds.length > 0
      ? await db.supplierCatalogItem.findMany({
          where: { ativo: true, matchStatus: "VINCULADO", productId: { in: productIds } },
          select: {
            productId: true,
            preco: true,
            precoPromocional: true,
            validadeOferta: true,
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
          },
        })
      : [];

  const melhorPorProduto = new Map<string, { preco: number; fornecedor: string }>();
  for (const c of concorrentes) {
    if (!c.productId) continue;
    const efetivo = precoEfetivo(c);
    const atual = melhorPorProduto.get(c.productId);
    if (!atual || efetivo < atual.preco) {
      melhorPorProduto.set(c.productId, {
        preco: efetivo,
        fornecedor: c.supplier.nomeFantasia ?? c.supplier.razaoSocial,
      });
    }
  }

  const categorias = await db.supplierCatalogItem.findMany({
    where: { supplierId, ativo: true, categoria: { not: null } },
    distinct: ["categoria"],
    select: { categoria: true },
    take: 60,
  });

  const total = await db.supplierCatalogItem.count({ where: { supplierId, ativo: true } });
  const promo = await db.supplierCatalogItem.count({
    where: { supplierId, ativo: true, emPromocao: true },
  });
  const pend = await db.supplierCatalogItem.count({
    where: { supplierId, ativo: true, matchStatus: "PENDENTE" },
  });

  return {
    fornecedor: {
      id: supplier.id,
      nome: supplier.nomeFantasia ?? supplier.razaoSocial,
      logoUrl: supplier.logoUrl,
      tipoIntegracao: supplier.tipoIntegracao,
      situacaoIntegracao: supplier.situacaoIntegracao,
      possuiIntegracao: supplier.possuiIntegracao,
      aceitaImportacaoManual: supplier.aceitaImportacaoManual,
      aceitaImportacaoAutomatica: supplier.aceitaImportacaoAutomatica,
      ultimaSincronizacao: supplier.ultimaSincronizacao?.toISOString() ?? null,
      totalProdutos: total,
      emPromocao: promo,
      pendentes: pend,
      pedidoMinimo: supplier.pedidoMinimo == null ? null : Number(supplier.pedidoMinimo),
      ativo: supplier.ativo,
    },
    itens: itens.map((i) => {
      const efetivo = precoEfetivo(i);
      const melhor = i.productId ? melhorPorProduto.get(i.productId) : null;
      return {
        id: i.id,
        descricao: i.descricao,
        codigoFornecedor: i.codigoFornecedor,
        ean: i.ean,
        marca: i.marca,
        categoria: i.categoria,
        imagemUrl: i.imagemUrl,
        unidade: i.unidade,
        preco: Number(i.preco),
        precoPromocional: i.precoPromocional == null ? null : Number(i.precoPromocional),
        precoEfetivo: efetivo,
        emPromocao: efetivo < Number(i.preco),
        quantidadeMinima: i.quantidadeMinima == null ? null : Number(i.quantidadeMinima),
        estoqueDisponivel: i.estoqueDisponivel == null ? null : Number(i.estoqueDisponivel),
        validadeOferta: i.validadeOferta?.toISOString() ?? null,
        ultimaAtualizacao: i.ultimaAtualizacao.toISOString(),
        productId: i.productId,
        produtoNome: i.product?.nome ?? null,
        produtoSku: i.product?.sku ?? null,
        matchStatus: i.matchStatus,
        matchOrigem: i.matchOrigem,
        ativo: i.ativo,
        melhorPrecoMercado: melhor?.preco ?? null,
        melhorFornecedor: melhor?.fornecedor ?? null,
      };
    }),
    categorias: categorias.map((c) => c.categoria).filter((c): c is string => !!c).sort(),
    total,
  };
}

// ── Importações ─────────────────────────────────────────────

export async function loadImportacoes(limite = 80): Promise<ImportacaoRow[]> {
  const linhas = await db.supplierImport.findMany({
    orderBy: { createdAt: "desc" },
    take: limite,
    select: {
      id: true,
      supplierId: true,
      tipo: true,
      origem: true,
      arquivoNome: true,
      arquivoTamanho: true,
      status: true,
      totalLinhas: true,
      itensLidos: true,
      itensNovos: true,
      itensAtualizados: true,
      itensSemVinculo: true,
      mensagem: true,
      erros: true,
      createdBy: true,
      createdAt: true,
      concluidoEm: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
    },
  });

  const userIds = [...new Set(linhas.map((l) => l.createdBy).filter((id): id is string => !!id))];
  const usuarios =
    userIds.length > 0
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
  const nomePorUsuario = new Map(usuarios.map((u) => [u.id, u.name ?? u.email ?? null]));

  return linhas.map((l) => ({
    id: l.id,
    supplierId: l.supplierId,
    supplierNome: l.supplier.nomeFantasia ?? l.supplier.razaoSocial,
    tipo: l.tipo,
    origem: l.origem,
    arquivoNome: l.arquivoNome,
    arquivoTamanho: l.arquivoTamanho,
    status: l.status,
    totalLinhas: l.totalLinhas,
    itensLidos: l.itensLidos,
    itensNovos: l.itensNovos,
    itensAtualizados: l.itensAtualizados,
    itensSemVinculo: l.itensSemVinculo,
    mensagem: l.mensagem,
    erros: Array.isArray(l.erros) ? (l.erros as string[]) : [],
    usuario: l.createdBy ? (nomePorUsuario.get(l.createdBy) ?? null) : null,
    createdAt: l.createdAt.toISOString(),
    concluidoEm: l.concluidoEm?.toISOString() ?? null,
  }));
}

// ── Carrinho ────────────────────────────────────────────────

export async function loadCarrinho(userId: string): Promise<CarrinhoPorFornecedor[]> {
  const itens = await db.supplierCartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      supplierId: true,
      catalogItemId: true,
      productId: true,
      descricao: true,
      quantidade: true,
      precoUnitario: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true, pedidoMinimo: true } },
      catalogItem: { select: { unidade: true } },
    },
  });
  if (itens.length === 0) return [];

  const productIds = [...new Set(itens.map((i) => i.productId).filter((id): id is string => !!id))];
  const concorrentes =
    productIds.length > 0
      ? await db.supplierCatalogItem.findMany({
          where: { ativo: true, matchStatus: "VINCULADO", productId: { in: productIds } },
          select: {
            productId: true,
            supplierId: true,
            preco: true,
            precoPromocional: true,
            validadeOferta: true,
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
          },
        })
      : [];

  const melhor = new Map<string, { preco: number; supplierId: string; nome: string }>();
  for (const c of concorrentes) {
    if (!c.productId) continue;
    const efetivo = precoEfetivo(c);
    const atual = melhor.get(c.productId);
    if (!atual || efetivo < atual.preco) {
      melhor.set(c.productId, {
        preco: efetivo,
        supplierId: c.supplierId,
        nome: c.supplier.nomeFantasia ?? c.supplier.razaoSocial,
      });
    }
  }

  const grupos = new Map<string, CarrinhoPorFornecedor>();
  for (const i of itens) {
    const m = i.productId ? melhor.get(i.productId) : null;
    const linha: ItemCarrinho = {
      id: i.id,
      supplierId: i.supplierId,
      supplierNome: i.supplier.nomeFantasia ?? i.supplier.razaoSocial,
      catalogItemId: i.catalogItemId,
      productId: i.productId,
      descricao: i.descricao,
      unidade: i.catalogItem?.unidade ?? null,
      quantidade: Number(i.quantidade),
      precoUnitario: Number(i.precoUnitario),
      melhorPreco: m?.preco ?? null,
      melhorFornecedorId: m?.supplierId ?? null,
      melhorFornecedorNome: m?.nome ?? null,
    };

    const grupo = grupos.get(i.supplierId) ?? {
      supplierId: i.supplierId,
      supplierNome: linha.supplierNome,
      pedidoMinimo: i.supplier.pedidoMinimo == null ? null : Number(i.supplier.pedidoMinimo),
      itens: [],
      total: 0,
    };
    grupo.itens.push(linha);
    grupo.total += linha.quantidade * linha.precoUnitario;
    grupos.set(i.supplierId, grupo);
  }

  return [...grupos.values()]
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

// ── Histórico e economia ────────────────────────────────────

export async function loadHistorico(dias = 30): Promise<{
  linhas: LinhaHistorico[];
  resumo: ResumoEconomia;
}> {
  const desde = new Date(Date.now() - dias * DIA_MS);
  const mes = inicioDoMes();

  const [pontos, itens, pedidos] = await Promise.all([
    db.supplierPriceHistory.findMany({
      where: { data: { gte: desde } },
      orderBy: { data: "desc" },
      take: 600,
      select: {
        id: true,
        catalogItemId: true,
        supplierId: true,
        preco: true,
        precoPromocional: true,
        emPromocao: true,
        data: true,
        catalogItem: {
          select: { descricao: true, product: { select: { nome: true } } },
        },
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
    db.supplierCatalogItem.findMany({
      where: { ativo: true, matchStatus: "VINCULADO" },
      select: {
        productId: true,
        supplierId: true,
        descricao: true,
        preco: true,
        precoPromocional: true,
        validadeOferta: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    }),
    db.purchaseOrder.findMany({
      where: { status: { not: "CANCELADO" }, createdAt: { gte: mes } },
      select: { supplierId: true, valorTotal: true },
    }),
  ]);

  // Variação: para cada item, o ponto mais recente contra o anterior.
  const vistos = new Map<string, { atual: (typeof pontos)[number]; anterior?: (typeof pontos)[number] }>();
  for (const p of pontos) {
    const registro = vistos.get(p.catalogItemId);
    if (!registro) vistos.set(p.catalogItemId, { atual: p });
    else if (!registro.anterior) registro.anterior = p;
  }

  const linhas: LinhaHistorico[] = [...vistos.values()]
    .map(({ atual, anterior }) => {
      const efetivo = atual.precoPromocional != null ? Number(atual.precoPromocional) : Number(atual.preco);
      const antes = anterior
        ? anterior.precoPromocional != null
          ? Number(anterior.precoPromocional)
          : Number(anterior.preco)
        : null;
      return {
        itemId: atual.catalogItemId,
        descricao: atual.catalogItem?.descricao ?? "Item",
        supplierId: atual.supplierId,
        supplierNome: atual.supplier.nomeFantasia ?? atual.supplier.razaoSocial,
        produtoNome: atual.catalogItem?.product?.nome ?? null,
        precoAtual: efetivo,
        precoAnterior: antes,
        variacao: antes != null && antes > 0 ? Math.round(((efetivo - antes) / antes) * 1000) / 10 : null,
        emPromocao: atual.emPromocao,
        data: atual.data.toISOString(),
      };
    })
    .sort((a, b) => Math.abs(b.variacao ?? 0) - Math.abs(a.variacao ?? 0));

  // Fornecedor mais barato = quem vence mais disputas de produto.
  const porProduto = new Map<string, { supplierId: string; nome: string; preco: number }>();
  const nomeFornecedor = new Map<string, string>();
  let economiaMes = 0;
  let maiorPromocao: ResumoEconomia["maiorPromocao"] = null;

  const precosPorProduto = new Map<string, number[]>();
  for (const i of itens) {
    if (!i.productId) continue;
    const nome = i.supplier.nomeFantasia ?? i.supplier.razaoSocial;
    nomeFornecedor.set(i.supplierId, nome);
    const efetivo = precoEfetivo(i);

    const atual = porProduto.get(i.productId);
    if (!atual || efetivo < atual.preco) {
      porProduto.set(i.productId, { supplierId: i.supplierId, nome, preco: efetivo });
    }
    const lista = precosPorProduto.get(i.productId) ?? [];
    lista.push(efetivo);
    precosPorProduto.set(i.productId, lista);

    const tabela = Number(i.preco);
    if (efetivo < tabela) {
      const desconto = tabela - efetivo;
      const percentual = Math.round((desconto / tabela) * 1000) / 10;
      if (!maiorPromocao || percentual > maiorPromocao.percentual) {
        maiorPromocao = { descricao: i.descricao, supplierNome: nome, desconto, percentual };
      }
    }
  }

  for (const precos of precosPorProduto.values()) {
    if (precos.length < 2) continue;
    economiaMes += Math.max(...precos) - Math.min(...precos);
  }

  const vitorias = new Map<string, number>();
  for (const v of porProduto.values()) vitorias.set(v.supplierId, (vitorias.get(v.supplierId) ?? 0) + 1);
  const campeao = [...vitorias.entries()].sort((a, b) => b[1] - a[1])[0];

  const usoPorFornecedor = new Map<string, { pedidos: number; valor: number }>();
  for (const p of pedidos) {
    const acc = usoPorFornecedor.get(p.supplierId) ?? { pedidos: 0, valor: 0 };
    acc.pedidos++;
    acc.valor += Number(p.valorTotal);
    usoPorFornecedor.set(p.supplierId, acc);
  }
  const maisUsado = [...usoPorFornecedor.entries()].sort((a, b) => b[1].pedidos - a[1].pedidos)[0];

  const nomesFaltantes = [...usoPorFornecedor.keys()].filter((id) => !nomeFornecedor.has(id));
  if (nomesFaltantes.length > 0) {
    const extras = await db.supplier.findMany({
      where: { id: { in: nomesFaltantes } },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    });
    for (const e of extras) nomeFornecedor.set(e.id, e.nomeFantasia ?? e.razaoSocial);
  }

  return {
    linhas: linhas.slice(0, 120),
    resumo: {
      economiaMes: Math.round(economiaMes * 100) / 100,
      fornecedorMaisBarato: campeao
        ? { id: campeao[0], nome: nomeFornecedor.get(campeao[0]) ?? "Fornecedor", vitorias: campeao[1] }
        : null,
      fornecedorMaisUsado: maisUsado
        ? { id: maisUsado[0], nome: nomeFornecedor.get(maisUsado[0]) ?? "Fornecedor", pedidos: maisUsado[1].pedidos }
        : null,
      maiorPromocao,
      pedidosMes: pedidos.length,
      valorCompradoMes: Math.round(pedidos.reduce((s, p) => s + Number(p.valorTotal), 0) * 100) / 100,
    },
  };
}

/** Fornecedores para seletor (importação, carrinho, comparador). */
export async function loadFornecedoresSelect() {
  const suppliers = await db.supplier.findMany({
    where: { ativo: true },
    orderBy: { razaoSocial: "asc" },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      tipoIntegracao: true,
      possuiIntegracao: true,
      aceitaImportacaoManual: true,
    },
  });
  return suppliers.map((s) => ({
    id: s.id,
    nome: s.nomeFantasia ?? s.razaoSocial,
    tipoIntegracao: s.tipoIntegracao,
    possuiIntegracao: s.possuiIntegracao,
    aceitaImportacaoManual: s.aceitaImportacaoManual,
  }));
}
