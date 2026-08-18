import type { Prisma, SupplierIntegrationKind } from "@/generated/prisma";
import { db } from "@/lib/prisma";
import { getTenantId } from "@/lib/tenant-context";
import { getConector } from "./connectors";
import { carregarIndice, chaveNome, vincular } from "./matching";
import { ConectorError, type Fonte, type OfertaBruta } from "./types";

// ============================================================
// Ingestão: pega o que o conector leu e escreve no catálogo do fornecedor.
//
// Duas garantias que o resto do módulo assume:
//   • item não duplica  — a `chave` (código → EAN → nome normalizado) é
//     estável entre reimportações da mesma tabela;
//   • histórico só cresce quando o preço MUDA — reimportar a mesma tabela três
//     vezes no dia não vira três pontos no gráfico, senão "promoção" perde o
//     sentido.
// ============================================================

export type ResultadoIngestao = {
  importId: string;
  catalogId: string;
  itensLidos: number;
  itensNovos: number;
  itensAtualizados: number;
  itensSemVinculo: number;
  itensDesativados: number;
  avisos: string[];
};

export type ParametrosIngestao = {
  supplierId: string;
  kind: SupplierIntegrationKind;
  fonte: Fonte;
  /**
   * manual (upload/digitação) | api (sincronizar agora) | agendado (job) |
   * cotacao (resposta de RFQ virando preço vigente).
   *
   * `cotacao` existe para a Central de Respostas não mostrar o mesmo fato duas
   * vezes: a linha da cotação já conta essa história, a importação é só o
   * rastro de como o preço entrou no catálogo.
   */
  origem?: "manual" | "api" | "agendado" | "cotacao";
  /** Tabela do fornecedor. Só quem manda tabela por região usa outra. */
  referencia?: string;
  arquivo?: { nome: string; tamanho: number; mimeType: string } | null;
  userId?: string | null;
  /** Item que não veio nesta tabela sai de linha (ativo=false). */
  substituirCatalogo?: boolean;
};

/** Tenant do contexto async. Explode cedo se alguém chamar fora do escopo. */
function tenantAtual(): string {
  const tenantId = getTenantId();
  if (!tenantId) throw new Error("Ingestão de catálogo fora do contexto de tenant.");
  return tenantId;
}

/** Roda dentro de `runWithTenant`. */
export async function ingerir(p: ParametrosIngestao): Promise<ResultadoIngestao> {
  const tenantId = tenantAtual();
  const supplier = await db.supplier.findFirst({
    where: { id: p.supplierId },
    select: { id: true, razaoSocial: true },
  });
  if (!supplier) throw new ConectorError("Fornecedor não encontrado.");

  const importacao = await db.supplierImport.create({
    data: {
      tenantId,
      supplierId: p.supplierId,
      tipo: p.kind,
      origem: p.origem ?? "manual",
      arquivoNome: p.arquivo?.nome ?? null,
      arquivoTamanho: p.arquivo?.tamanho ?? null,
      mimeType: p.arquivo?.mimeType ?? null,
      status: "PROCESSANDO",
      createdBy: p.userId ?? null,
    },
    select: { id: true },
  });

  try {
    const integracao = await db.supplierIntegration.findFirst({
      where: { supplierId: p.supplierId },
      select: { mapeamento: true },
    });

    const leitura = await getConector(p.kind).ler(p.fonte, {
      supplierId: p.supplierId,
      mapeamento: (integracao?.mapeamento as Record<string, string> | null) ?? null,
    });

    const catalogo = await garantirCatalogo(p.supplierId, p.referencia ?? "padrao", p.kind);
    const gravado = await gravarOfertas({
      supplierId: p.supplierId,
      catalogId: catalogo.id,
      importId: importacao.id,
      ofertas: leitura.ofertas,
      substituirCatalogo: p.substituirCatalogo ?? true,
    });

    const comProblema = leitura.avisos.length > 0 || gravado.itensSemVinculo > 0;

    await db.supplierImport.update({
      where: { id: importacao.id },
      data: {
        status: comProblema ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA",
        totalLinhas: leitura.totalLinhas,
        itensLidos: leitura.ofertas.length,
        itensNovos: gravado.itensNovos,
        itensAtualizados: gravado.itensAtualizados,
        itensSemVinculo: gravado.itensSemVinculo,
        catalogId: catalogo.id,
        erros: leitura.avisos.length > 0 ? (leitura.avisos as Prisma.InputJsonValue) : undefined,
        mensagem: leitura.avisos[0] ?? null,
        concluidoEm: new Date(),
      },
    });

    const total = await db.supplierCatalogItem.count({
      where: { catalogId: catalogo.id, ativo: true },
    });
    await db.supplierCatalog.update({
      where: { id: catalogo.id },
      data: { totalItens: total, atualizadoEm: new Date(), origem: p.kind },
    });
    await db.supplier.update({
      where: { id: p.supplierId },
      data: {
        ultimaSincronizacao: new Date(),
        situacaoIntegracao: p.kind === "API" ? "ONLINE" : undefined,
      },
    });

    return {
      importId: importacao.id,
      catalogId: catalogo.id,
      itensLidos: leitura.ofertas.length,
      avisos: leitura.avisos,
      ...gravado,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao importar.";
    await db.supplierImport.update({
      where: { id: importacao.id },
      data: { status: "FALHOU", mensagem, concluidoEm: new Date() },
    });
    if (p.kind === "API") {
      await db.supplier.update({
        where: { id: p.supplierId },
        data: { situacaoIntegracao: "ERRO" },
      });
      await db.supplierIntegration.updateMany({
        where: { supplierId: p.supplierId },
        data: { status: "ERRO", ultimoErro: mensagem },
      });
    }
    throw e;
  }
}

export async function garantirCatalogo(
  supplierId: string,
  referencia: string,
  origem: SupplierIntegrationKind,
) {
  const existente = await db.supplierCatalog.findFirst({
    where: { supplierId, referencia },
    select: { id: true },
  });
  if (existente) return existente;

  return db.supplierCatalog.create({
    data: {
      tenantId: tenantAtual(),
      supplierId,
      referencia,
      nome: referencia === "padrao" ? "Tabela geral" : referencia,
      origem,
    },
    select: { id: true },
  });
}

/** Código do fornecedor → EAN → nome normalizado. Nessa ordem, sempre. */
export function chaveDoItem(oferta: OfertaBruta): string {
  if (oferta.codigoFornecedor) return `c:${oferta.codigoFornecedor.trim().toUpperCase()}`;
  if (oferta.ean) return `e:${oferta.ean}`;
  return `n:${chaveNome(oferta.descricao ?? "")}`;
}

async function gravarOfertas(args: {
  supplierId: string;
  catalogId: string;
  importId: string;
  ofertas: OfertaBruta[];
  substituirCatalogo: boolean;
}) {
  const { supplierId, catalogId, importId, ofertas, substituirCatalogo } = args;
  // O `db` injeta o tenantId em runtime; o tipo do Prisma continua exigindo o
  // campo, então ele vai explícito — mesma convenção dos outros módulos.
  const tenantId = tenantAtual();

  // Tabela com a mesma linha repetida acontece (aba com preço por região):
  // a última vale.
  const porChave = new Map<string, OfertaBruta>();
  for (const o of ofertas) {
    const chave = chaveDoItem(o);
    if (chave && chave !== "n:") porChave.set(chave, o);
  }

  const [existentes, indice] = await Promise.all([
    db.supplierCatalogItem.findMany({
      where: { catalogId },
      select: {
        id: true,
        chave: true,
        preco: true,
        precoPromocional: true,
        descricao: true,
        estoqueDisponivel: true,
        quantidadeMinima: true,
        validadeOferta: true,
        productId: true,
        matchStatus: true,
        matchOrigem: true,
        ativo: true,
      },
    }),
    carregarIndice(supplierId),
  ]);
  const porChaveExistente = new Map(existentes.map((i) => [i.chave, i]));

  const agora = new Date();
  const historico: Prisma.SupplierPriceHistoryCreateManyInput[] = [];
  const ofertasNovas: Prisma.SupplierOfferCreateManyInput[] = [];
  const vistos: string[] = [];
  /** Itens idênticos aos da última tabela — só levam um "visto agora" em lote. */
  const inalterados: string[] = [];
  const novos: Array<{ chave: string; data: Prisma.SupplierCatalogItemCreateManyInput }> = [];
  /** chave → dados para o histórico, resolvido depois que os ids existirem. */
  const historicoNovos = new Map<
    string,
    { productId: string | null; preco: number; promo: number | null; emPromocao: boolean; quantidadeMinima: number | null; validade: Date | null }
  >();

  let itensNovos = 0;
  let itensAtualizados = 0;
  let itensSemVinculo = 0;

  for (const [chave, oferta] of porChave) {
    const vinculo = vincular(oferta, indice);
    if (!vinculo) itensSemVinculo++;

    const preco = arredondar(oferta.preco);
    const promo = oferta.precoPromocional != null ? arredondar(oferta.precoPromocional) : null;
    const emPromocao = promo != null && promo < preco;

    const base = {
      supplierId,
      codigoFornecedor: oferta.codigoFornecedor ?? null,
      ean: oferta.ean ?? null,
      descricao: oferta.descricao?.slice(0, 300) || "Item sem descrição",
      marca: oferta.marca ?? null,
      categoria: oferta.categoria ?? null,
      imagemUrl: oferta.imagemUrl ?? null,
      unidade: oferta.unidade ?? null,
      fatorConversao: oferta.fatorConversao && oferta.fatorConversao > 0 ? oferta.fatorConversao : 1,
      preco,
      precoPromocional: promo,
      emPromocao,
      quantidadeMinima: oferta.quantidadeMinima ?? null,
      estoqueDisponivel: oferta.estoqueDisponivel ?? null,
      validadeOferta: oferta.validadeOferta ?? null,
      ativo: true,
      ultimaAtualizacao: agora,
    };

    const anterior = porChaveExistente.get(chave);

    if (!anterior) {
      itensNovos++;
      novos.push({
        chave,
        data: {
          ...base,
          tenantId,
          catalogId,
          chave,
          productId: vinculo?.productId ?? null,
          matchStatus: vinculo ? "VINCULADO" : "PENDENTE",
          matchOrigem: vinculo?.origem ?? null,
        },
      });
      historicoNovos.set(chave, {
        productId: vinculo?.productId ?? null,
        preco,
        promo,
        emPromocao,
        quantidadeMinima: oferta.quantidadeMinima ?? null,
        validade: oferta.validadeOferta ?? null,
      });
      continue;
    }

    vistos.push(anterior.id);
    const mudouPreco =
      Number(anterior.preco) !== preco ||
      Number(anterior.precoPromocional ?? 0) !== Number(promo ?? 0);

    const mudouResto =
      anterior.descricao !== base.descricao ||
      !anterior.ativo ||
      numeroOuNulo(anterior.estoqueDisponivel) !== (base.estoqueDisponivel ?? null) ||
      numeroOuNulo(anterior.quantidadeMinima) !== (base.quantidadeMinima ?? null) ||
      (anterior.validadeOferta?.getTime() ?? null) !== (base.validadeOferta?.getTime() ?? null);

    // Vínculo feito à mão na revisão manda: reimportar não desfaz o trabalho
    // de quem revisou. Só item ainda PENDENTE recebe vínculo automático.
    const manterVinculo = anterior.matchOrigem === "MANUAL" || anterior.matchStatus === "IGNORADO";
    const vaiVincular = !manterVinculo && !!vinculo && anterior.productId !== vinculo.productId;

    if (!mudouPreco && !mudouResto && !vaiVincular) {
      inalterados.push(anterior.id);
      continue;
    }

    await db.supplierCatalogItem.update({
      where: { id: anterior.id },
      data: {
        ...base,
        ...(vaiVincular
          ? {
              productId: vinculo!.productId,
              matchStatus: "VINCULADO" as const,
              matchOrigem: vinculo!.origem,
            }
          : {}),
      },
    });
    if (mudouPreco || !anterior.ativo) itensAtualizados++;

    if (mudouPreco) {
      historico.push({
        tenantId,
        supplierId,
        catalogItemId: anterior.id,
        productId: anterior.productId ?? vinculo?.productId ?? null,
        preco,
        precoPromocional: promo,
        emPromocao,
        data: agora,
        importId,
      });
      if (emPromocao) {
        ofertasNovas.push({
          tenantId,
          supplierId,
          catalogItemId: anterior.id,
          preco,
          precoPromocional: promo,
          quantidadeMinima: oferta.quantidadeMinima ?? null,
          inicio: agora,
          fim: oferta.validadeOferta ?? null,
          importId,
        });
      }
    }
  }

  // Item novo entra em lote e só depois busca id — 2.000 linhas não podem
  // virar 2.000 idas ao banco.
  if (novos.length > 0) {
    await db.supplierCatalogItem.createMany({ data: novos.map((n) => n.data) });
    const criados = await db.supplierCatalogItem.findMany({
      where: { catalogId, chave: { in: novos.map((n) => n.chave) } },
      select: { id: true, chave: true },
    });
    for (const criado of criados) {
      vistos.push(criado.id);
      const h = historicoNovos.get(criado.chave);
      if (!h) continue;
      historico.push({
        tenantId,
        supplierId,
        catalogItemId: criado.id,
        productId: h.productId,
        preco: h.preco,
        precoPromocional: h.promo,
        emPromocao: h.emPromocao,
        data: agora,
        importId,
      });
      if (h.emPromocao) {
        ofertasNovas.push({
          tenantId,
          supplierId,
          catalogItemId: criado.id,
          preco: h.preco,
          precoPromocional: h.promo,
          quantidadeMinima: h.quantidadeMinima,
          inicio: agora,
          fim: h.validade,
          importId,
        });
      }
    }
  }

  if (inalterados.length > 0) {
    await db.supplierCatalogItem.updateMany({
      where: { id: { in: inalterados } },
      data: { ultimaAtualizacao: agora },
    });
  }

  if (historico.length > 0) await db.supplierPriceHistory.createMany({ data: historico });
  if (ofertasNovas.length > 0) {
    // Promoção anterior do item deixa de valer quando chega preço novo.
    await db.supplierOffer.updateMany({
      where: { catalogItemId: { in: ofertasNovas.map((o) => o.catalogItemId) }, ativa: true },
      data: { ativa: false, fim: agora },
    });
    await db.supplierOffer.createMany({ data: ofertasNovas });
  }

  let itensDesativados = 0;
  if (substituirCatalogo && vistos.length > 0) {
    const { count } = await db.supplierCatalogItem.updateMany({
      where: { catalogId, ativo: true, id: { notIn: vistos } },
      data: { ativo: false },
    });
    itensDesativados = count;
  }

  return { itensNovos, itensAtualizados, itensSemVinculo, itensDesativados };
}

/** Preço com 4 casas — tabela de distribuidor tem centavo fracionado. */
function arredondar(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Decimal do Prisma → number comparável (null continua null). */
function numeroOuNulo(v: { toString(): string } | null): number | null {
  return v == null ? null : Number(v.toString());
}
