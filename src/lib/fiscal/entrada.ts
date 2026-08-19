import "server-only";
import { db } from "@/lib/prisma";
import { registrarEntrada, type EntradaItem } from "@/lib/estoque";
import {
  parseNotaXml,
  extrairXmls,
  XmlInvalidoError,
  type ItemNotaXml,
  type NotaXml,
} from "./nfe-xml";
import { fatorDaNota } from "./fator";
import { custoDoItem } from "./custo";
import { ratearTotaisDaNota } from "./rateio";
import { enriquecerProdutoComNota, atualizarCustoDeReferencia } from "./enriquecer-produto";
import { conciliarComPedidoSugerido } from "@/lib/compras/conciliacao";
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
  /** Id da nota importada — leva direto ao recebimento inteligente. */
  inboundId?: string;
  /** Itens que já nasceram relacionados pelo de-para. */
  itensResolvidos?: number;
  itensTotal?: number;
  /** Pedido que a nota conciliou sozinha (quando um se destacou). */
  pedidoNumero?: string | null;
  /** Havia pedido candidato, mas nenhum se destacou — a tela pergunta. */
  pedidosCandidatos?: number;
  motivo?: string;
};

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
 *   2. GTIN = EAN de uma embalagem (fardo/caixa) — traz o fator do cadastro;
 *   3. GTIN do item = EAN de um produto.
 * Sem match, fica null e a nota nasce PENDENTE.
 *
 * O fator, quando não vem de um cadastro nosso, vem da própria nota
 * (`qTrib/qCom`). Sem isso, uma nota de distribuidor com 5 CX de long neck
 * entraria como 5 garrafas em vez de 120 — e o de-para que o operador salvasse
 * em cima disso repetiria o erro em toda nota seguinte.
 */
async function resolverItem(supplierId: string, item: ItemNotaXml): Promise<ItemResolvido> {
  const daNota = fatorDaNota(item) ?? 1;

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
    // Embalagem antes de produto: o GTIN de um fardo cadastrado responde a
    // pergunta "quantas unidades vêm aqui" melhor do que a nota.
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

    const produto = await db.product.findFirst({
      where: { ean: item.gtin, ativo: true },
      select: { id: true },
    });
    // EAN de unidade numa linha vendida em caixa: quem desempata é o qTrib.
    if (produto) return { productId: produto.id, packagingId: null, fatorConversao: daNota };
  }

  return { productId: null, packagingId: null, fatorConversao: daNota };
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

  // Frete e desconto que o emitente lançou só no total da nota são rateados
  // pelos itens agora: o custo médio nasce do que foi PAGO, e reconstruir isso
  // depois exigiria reprocessar nota velha. O XML cru continua guardado inteiro
  // — a fidelidade ao documento mora lá, não nesta coluna.
  const rateio = ratearTotaisDaNota(nota.itens, {
    frete: nota.valorFrete,
    desconto: nota.valorDesconto,
  });

  const resolvidos = await Promise.all(
    nota.itens.map(async (item, i) => ({
      item,
      encargos: rateio[i],
      resolucao: await resolverItem(supplierId, item),
    })),
  );

  const criada = await db.fiscalInbound.create({
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
      valorFrete: nota.valorFrete,
      valorDesconto: nota.valorDesconto,
      emitCnpj: nota.emitente.cnpj,
      emitRazaoSocial: nota.emitente.razaoSocial,
      emitUf: nota.emitente.uf,
      importadoPor: userId ?? null,
      // O XML cru fica guardado inteiro: é a prova do que o fornecedor cobrou,
      // e a conciliação pode ser refeita a partir dele quando o de-para muda.
      xmlArquivo: { create: { tenantId, nomeArquivo: xml.nome, conteudo: xml.conteudo } },
      // Parcelas do boleto. Hoje só informativas na tela; é o que faz contas a
      // pagar nascer pronto quando o financeiro existir, sem reler nota velha.
      duplicatas: {
        create: nota.duplicatas.map((d) => ({
          tenantId,
          numero: d.numero,
          vencimento: d.vencimento,
          valor: d.valor,
        })),
      },
      items: {
        create: resolvidos.map(({ item, encargos, resolucao }) => ({
          tenantId,
          ordem: item.ordem,
          codigoFornecedor: item.codigoFornecedor,
          gtin: item.gtin,
          descricao: item.descricao,
          ncm: item.ncm,
          cest: item.cest,
          cfop: item.cfop,
          unidade: item.unidade,
          quantidade: item.quantidade,
          unidadeTributavel: item.unidadeTributavel,
          quantidadeTributavel: item.quantidadeTributavel,
          valorUnitario: item.valorUnitario,
          valorTotal: item.valorTotal,
          valorDesconto: encargos.valorDesconto,
          valorIcmsSt: item.valorIcmsSt,
          valorFcpSt: item.valorFcpSt,
          valorIpi: item.valorIpi,
          valorFrete: encargos.valorFrete,
          bonificacao: item.bonificacao,
          pedidoFornecedor: item.pedidoFornecedor,
          itemPedidoNumero: item.itemPedidoNumero,
          productId: resolucao.productId,
          packagingId: resolucao.packagingId,
          fatorConversao: resolucao.fatorConversao,
        })),
      },
    },
    select: { id: true },
  });

  // Achar o pedido é trabalho do sistema, não do operador: quando um candidato
  // se destaca com folga, a nota já nasce conciliada.
  const vinculo = await conciliarComPedidoSugerido({
    tenantId,
    inboundId: criada.id,
    userId,
  });

  return {
    arquivo: xml.nome,
    status: "IMPORTADA",
    chave: nota.chave,
    inboundId: criada.id,
    itensResolvidos: resolvidos.filter((r) => r.resolucao.productId).length,
    itensTotal: resolvidos.length,
    pedidoNumero: vinculo.numero,
    pedidosCandidatos: vinculo.sugestoes.length,
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
}): Promise<{ preenchidos: string[] }> {
  const { tenantId, itemId, productId } = input;
  const fatorConversao = input.fatorConversao && input.fatorConversao > 0 ? input.fatorConversao : 1;

  const item = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: {
      id: true,
      codigoFornecedor: true,
      gtin: true,
      unidade: true,
      quantidade: true,
      unidadeTributavel: true,
      quantidadeTributavel: true,
      valorTotal: true,
      valorDesconto: true,
      valorIcmsSt: true,
      valorFcpSt: true,
      valorIpi: true,
      valorFrete: true,
      bonificacao: true,
      inbound: { select: { id: true, status: true, supplierId: true } },
    },
  });
  if (!item) throw new Error("Item não encontrado.");
  if (item.inbound.status === "RECEBIDO") {
    throw new Error("Esta nota já gerou entrada de estoque — não dá para trocar o produto.");
  }

  // A nota sabe em que embalagem o fornecedor vende, com que código de barras
  // e por quanto. Aproveitamos isso no cadastro ANTES de gravar o de-para: se
  // a embalagem de compra nasce aqui, é o id dela que fica registrado.
  const enriquecimento = await enriquecerProdutoComNota({
    tenantId,
    productId,
    packagingId: input.packagingId || null,
    fatorConversao,
    supplierId: item.inbound.supplierId,
    item: {
      codigoFornecedor: item.codigoFornecedor,
      gtin: item.gtin,
      unidade: item.unidade,
      quantidade: Number(item.quantidade),
      unidadeTributavel: item.unidadeTributavel,
      quantidadeTributavel:
        item.quantidadeTributavel == null ? null : Number(item.quantidadeTributavel),
      valorTotal: Number(item.valorTotal),
      valorDesconto: Number(item.valorDesconto),
      valorIcmsSt: Number(item.valorIcmsSt),
      valorFcpSt: Number(item.valorFcpSt),
      valorIpi: Number(item.valorIpi),
      valorFrete: Number(item.valorFrete),
      bonificacao: item.bonificacao,
    },
  });
  const packagingId = enriquecimento.packagingId;

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

  return { preenchidos: enriquecimento.preenchidos };
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
          valorFcpSt: true,
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
      valorFcpSt: Number(i.valorFcpSt),
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

  // O que a nota cobrou vira o custo de referência do produto — mesma regra do
  // recebimento conciliado, para os dois caminhos deixarem o cadastro igual.
  await atualizarCustoDeReferencia(
    itens.map((i, idx) => ({
      productId: i.productId,
      custoUnitarioBase:
        !nota.items[idx].bonificacao && i.quantidade > 0 ? i.custoTotal / i.quantidade : 0,
    })),
  );

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
