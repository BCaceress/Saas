import "server-only";
import { db } from "@/lib/prisma";
import { registrarEntrada, type EntradaItem } from "@/lib/estoque";
import { parseNotaXml, extrairXmls, XmlInvalidoError, type NotaXml } from "./nfe-xml";
import type { FiscalInboundStatus } from "@/generated/prisma";

// ============================================================
// Entrada de mercadoria por XML de fornecedor.
//
// Fluxo: XML → FiscalInbound (+ itens) → operador relaciona cada item a um
// produto → gera Purchase pelo serviço de estoque (custo médio e razão saem
// de graça, exatamente como no recebimento manual).
//
// O de-para (SupplierItemMap) é o coração disto: na primeira nota o operador
// relaciona à mão; da segunda em diante a mesma mercadoria entra sozinha.
//
// Todas as funções assumem contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

export type ResultadoImportacao = {
  arquivo: string;
  status: "IMPORTADA" | "DUPLICADA" | "ERRO";
  chave?: string;
  /** Itens que já nasceram relacionados pelo de-para. */
  itensResolvidos?: number;
  itensTotal?: number;
  motivo?: string;
};

/**
 * Custo real da mercadoria: o que entra no estoque não é só `vProd`.
 * ICMS-ST, IPI e frete são pagos ao fornecedor e fazem parte do custo; ignorá-los
 * dá margem falsamente alta na venda. Bonificação entra com custo zero.
 */
function custoDoItem(i: {
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
}): number {
  if (i.bonificacao) return 0;
  return Math.max(
    0,
    i.valorTotal - i.valorDesconto + i.valorIcmsSt + i.valorIpi + i.valorFrete,
  );
}

/** Fornecedor do XML: acha pelo CNPJ ou cria com o que a nota já traz. */
async function resolverFornecedor(tenantId: string, emit: NotaXml["emitente"]): Promise<string> {
  const existente = await db.supplier.findFirst({
    where: { cnpj: emit.cnpj },
    select: { id: true, ie: true, codigoMunicipio: true },
  });

  if (existente) {
    // Completa lacunas fiscais sem sobrescrever o que o operador já ajustou.
    if ((!existente.ie && emit.ie) || (!existente.codigoMunicipio && emit.codigoMunicipio)) {
      await db.supplier.update({
        where: { id: existente.id },
        data: {
          ie: existente.ie ?? emit.ie,
          codigoMunicipio: existente.codigoMunicipio ?? emit.codigoMunicipio,
        },
      });
    }
    return existente.id;
  }

  // Cadastrar na mão só para importar a nota seria atrito puro — o XML já tem
  // tudo o que o cadastro pede.
  const novo = await db.supplier.create({
    data: {
      tenantId,
      cnpj: emit.cnpj,
      razaoSocial: emit.razaoSocial,
      nomeFantasia: emit.nomeFantasia,
      ie: emit.ie,
      cep: emit.cep,
      logradouro: emit.logradouro,
      numero: emit.numero,
      complemento: emit.complemento,
      bairro: emit.bairro,
      municipio: emit.municipio,
      codigoMunicipio: emit.codigoMunicipio,
      uf: emit.uf,
      telefone: emit.telefone,
    },
    select: { id: true },
  });
  return novo.id;
}

type ItemResolvido = {
  productId: string | null;
  packagingId: string | null;
  fatorConversao: number;
};

/**
 * Tenta resolver um item do XML no catálogo, em ordem de confiança:
 *   1. de-para salvo para este fornecedor (o operador já decidiu antes);
 *   2. GTIN do item = EAN de um produto;
 *   3. GTIN = EAN de uma embalagem (fardo/caixa) — traz o fator junto.
 * Sem match, fica null e a nota nasce PENDENTE.
 */
async function resolverItem(
  supplierId: string,
  item: { codigoFornecedor: string; gtin: string | null },
): Promise<ItemResolvido> {
  const mapeado = await db.supplierItemMap.findFirst({
    where: { supplierId, codigoFornecedor: item.codigoFornecedor },
    select: { productId: true, packagingId: true, fatorConversao: true },
  });
  if (mapeado) {
    return {
      productId: mapeado.productId,
      packagingId: mapeado.packagingId,
      fatorConversao: Number(mapeado.fatorConversao),
    };
  }

  if (item.gtin) {
    const produto = await db.product.findFirst({
      where: { ean: item.gtin, ativo: true },
      select: { id: true },
    });
    if (produto) return { productId: produto.id, packagingId: null, fatorConversao: 1 };

    const embalagem = await db.productPackaging.findFirst({
      where: { ean: item.gtin },
      select: { id: true, productId: true, fatorConversao: true },
    });
    if (embalagem) {
      return {
        productId: embalagem.productId,
        packagingId: embalagem.id,
        fatorConversao: Number(embalagem.fatorConversao),
      };
    }
  }

  return { productId: null, packagingId: null, fatorConversao: 1 };
}

/** PENDENTE enquanto houver item sem produto; CONCILIADO quando todos têm. */
function statusPorItens(itens: { productId: string | null }[]): FiscalInboundStatus {
  return itens.every((i) => i.productId) ? "CONCILIADO" : "PENDENTE";
}

export async function importarNotasXml(input: {
  tenantId: string;
  siteId: string;
  arquivos: { nome: string; bytes: Uint8Array }[];
  userId?: string | null;
  /** CNPJ do emitente desta loja — confere se a nota é mesmo para nós. */
  cnpjDestino?: string | null;
}): Promise<ResultadoImportacao[]> {
  const { tenantId, siteId, arquivos, userId, cnpjDestino } = input;
  const saida: ResultadoImportacao[] = [];

  for (const arquivo of arquivos) {
    let xmls: { nome: string; conteudo: string }[];
    try {
      xmls = extrairXmls(arquivo.bytes, arquivo.nome);
    } catch (e) {
      saida.push({
        arquivo: arquivo.nome,
        status: "ERRO",
        motivo: e instanceof Error ? e.message : "Falha ao ler o arquivo.",
      });
      continue;
    }

    for (const xml of xmls) {
      try {
        saida.push(await importarUmXml({ tenantId, siteId, xml, userId, cnpjDestino }));
      } catch (e) {
        saida.push({
          arquivo: xml.nome,
          status: "ERRO",
          motivo:
            e instanceof XmlInvalidoError
              ? e.message
              : e instanceof Error
                ? e.message
                : "Falha ao importar.",
        });
      }
    }
  }

  return saida;
}

async function importarUmXml(input: {
  tenantId: string;
  siteId: string;
  xml: { nome: string; conteudo: string };
  userId?: string | null;
  cnpjDestino?: string | null;
}): Promise<ResultadoImportacao> {
  const { tenantId, siteId, xml, userId, cnpjDestino } = input;
  const nota = parseNotaXml(xml.conteudo);

  // Mesma nota duas vezes = estoque dobrado. A chave é a trava.
  const jaExiste = await db.fiscalInbound.findFirst({
    where: { chave: nota.chave },
    select: { id: true },
  });
  if (jaExiste) {
    return { arquivo: xml.nome, status: "DUPLICADA", chave: nota.chave };
  }

  if (cnpjDestino && nota.destinatarioCnpj && nota.destinatarioCnpj !== cnpjDestino) {
    return {
      arquivo: xml.nome,
      status: "ERRO",
      chave: nota.chave,
      motivo: `Nota emitida para o CNPJ ${nota.destinatarioCnpj}, que não é o desta loja.`,
    };
  }

  const supplierId = await resolverFornecedor(tenantId, nota.emitente);

  const resolvidos = await Promise.all(
    nota.itens.map(async (item) => ({ item, resolucao: await resolverItem(supplierId, item) })),
  );

  await db.fiscalInbound.create({
    data: {
      tenantId,
      siteId,
      supplierId,
      status: statusPorItens(resolvidos.map((r) => r.resolucao)),
      chave: nota.chave,
      modelo: nota.modelo,
      numero: nota.numero,
      serie: nota.serie,
      dataEmissao: nota.dataEmissao,
      valorTotal: nota.valorTotal,
      emitCnpj: nota.emitente.cnpj,
      emitRazaoSocial: nota.emitente.razaoSocial,
      emitUf: nota.emitente.uf,
      importadoPor: userId ?? null,
      items: {
        create: resolvidos.map(({ item, resolucao }) => ({
          tenantId,
          ordem: item.ordem,
          codigoFornecedor: item.codigoFornecedor,
          gtin: item.gtin,
          descricao: item.descricao,
          ncm: item.ncm,
          cfop: item.cfop,
          unidade: item.unidade,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorTotal: item.valorTotal,
          valorDesconto: item.valorDesconto,
          valorIcmsSt: item.valorIcmsSt,
          valorIpi: item.valorIpi,
          valorFrete: item.valorFrete,
          bonificacao: item.bonificacao,
          productId: resolucao.productId,
          packagingId: resolucao.packagingId,
          fatorConversao: resolucao.fatorConversao,
        })),
      },
    },
    select: { id: true },
  });

  return {
    arquivo: xml.nome,
    status: "IMPORTADA",
    chave: nota.chave,
    itensResolvidos: resolvidos.filter((r) => r.resolucao.productId).length,
    itensTotal: resolvidos.length,
  };
}

/**
 * Relaciona um item do XML a um produto e GRAVA O DE-PARA. É o que faz a
 * próxima nota deste fornecedor entrar sem trabalho manual.
 */
export async function relacionarItemInbound(input: {
  tenantId: string;
  itemId: string;
  productId: string;
  packagingId?: string | null;
  fatorConversao?: number;
}): Promise<void> {
  const { tenantId, itemId, productId } = input;
  const fatorConversao = input.fatorConversao && input.fatorConversao > 0 ? input.fatorConversao : 1;
  const packagingId = input.packagingId || null;

  const item = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: {
      id: true,
      codigoFornecedor: true,
      gtin: true,
      inbound: { select: { id: true, status: true, supplierId: true } },
    },
  });
  if (!item) throw new Error("Item não encontrado.");
  if (item.inbound.status === "RECEBIDO") {
    throw new Error("Esta nota já gerou entrada de estoque — não dá para trocar o produto.");
  }

  await db.fiscalInboundItem.update({
    where: { id: itemId },
    data: { productId, packagingId, fatorConversao },
  });

  if (item.inbound.supplierId) {
    const mapa = await db.supplierItemMap.findFirst({
      where: { supplierId: item.inbound.supplierId, codigoFornecedor: item.codigoFornecedor },
      select: { id: true },
    });
    const dados = { productId, packagingId, fatorConversao, gtin: item.gtin };
    if (mapa) {
      await db.supplierItemMap.update({ where: { id: mapa.id }, data: dados });
    } else {
      await db.supplierItemMap.create({
        data: {
          tenantId,
          supplierId: item.inbound.supplierId,
          codigoFornecedor: item.codigoFornecedor,
          ...dados,
        },
      });
    }
  }

  const itens = await db.fiscalInboundItem.findMany({
    where: { inboundId: item.inbound.id },
    select: { productId: true },
  });
  await db.fiscalInbound.update({
    where: { id: item.inbound.id },
    data: { status: statusPorItens(itens) },
  });
}

/** Vincula (ou desvincula) a nota a um pedido de compra, para conferência. */
export async function vincularPedidoInbound(input: {
  inboundId: string;
  purchaseOrderId: string | null;
}): Promise<void> {
  await db.fiscalInbound.update({
    where: { id: input.inboundId },
    data: { purchaseOrderId: input.purchaseOrderId },
  });
}

/**
 * Gera a entrada de estoque da nota. Reusa `registrarEntrada` — mesmo caminho
 * do recebimento manual, então razão, custo médio e saldos ficam idênticos.
 */
export async function gerarEntradaDaNota(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<string> {
  const { tenantId, inboundId, userId } = input;

  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      siteId: true,
      status: true,
      numero: true,
      serie: true,
      supplierId: true,
      purchaseOrderId: true,
      emitRazaoSocial: true,
      items: {
        select: {
          productId: true,
          quantidade: true,
          fatorConversao: true,
          valorTotal: true,
          valorDesconto: true,
          valorIcmsSt: true,
          valorIpi: true,
          valorFrete: true,
          bonificacao: true,
          descricao: true,
        },
      },
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status === "RECEBIDO") throw new Error("Esta nota já gerou entrada de estoque.");
  if (nota.status === "DESCARTADO") throw new Error("Esta nota foi descartada.");

  const semProduto = nota.items.filter((i) => !i.productId);
  if (semProduto.length > 0) {
    throw new Error(
      `Relacione todos os itens antes de receber. Faltam ${semProduto.length}: ${semProduto
        .slice(0, 3)
        .map((i) => i.descricao)
        .join(", ")}${semProduto.length > 3 ? "…" : ""}`,
    );
  }

  const itens: EntradaItem[] = nota.items.map((i) => ({
    productId: i.productId as string,
    // Convertemos aqui e mandamos packagingId null de propósito: o fator do
    // de-para pode divergir do cadastro da embalagem (fornecedor muda o fardo),
    // e deixar `registrarEntrada` converter de novo dobraria a quantidade.
    quantidade: Number(i.quantidade) * Number(i.fatorConversao),
    custoTotal: custoDoItem({
      valorTotal: Number(i.valorTotal),
      valorDesconto: Number(i.valorDesconto),
      valorIcmsSt: Number(i.valorIcmsSt),
      valorIpi: Number(i.valorIpi),
      valorFrete: Number(i.valorFrete),
      bonificacao: i.bonificacao,
    }),
    packagingId: null,
  }));

  const soBonificacao = nota.items.every((i) => i.bonificacao);

  const purchaseId = await registrarEntrada(tenantId, nota.siteId, itens, {
    tipo: "FORNECEDOR",
    motivo: soBonificacao ? "BONIFICACAO" : nota.purchaseOrderId ? null : "COMPRA_SEM_PEDIDO",
    supplierId: nota.supplierId,
    purchaseOrderId: nota.purchaseOrderId,
    numeroNota: `${nota.numero}/${nota.serie}`,
    observacao: `Entrada por XML — ${nota.emitRazaoSocial}`,
    createdBy: userId ?? undefined,
  });

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: { status: "RECEBIDO", purchaseId },
  });

  return purchaseId;
}

/** Nota que não vira entrada (já lançada à mão, devolvida, veio errada). */
export async function descartarNota(input: {
  inboundId: string;
  motivo: string;
}): Promise<void> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: { status: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status === "RECEBIDO") {
    throw new Error(
      "Esta nota já movimentou estoque. Para desfazer, registre uma devolução ou um ajuste.",
    );
  }
  await db.fiscalInbound.update({
    where: { id: input.inboundId },
    data: { status: "DESCARTADO", observacao: input.motivo },
  });
}
