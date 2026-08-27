import "server-only";
import { db } from "@/lib/prisma";
import { registrarEntrada, type EntradaItem } from "@/lib/estoque";
import {
  parseNotaXml,
  extrairXmls,
  XmlInvalidoError,
  type ItemNotaXml,
} from "./nfe-xml";
import { fatorDaNota } from "./fator";
import { fatorDaUnidade, unidadesParaEstoque } from "./unidades";
import { custoDoItem } from "./custo";
import { ratearTotaisDaNota } from "./rateio";
import { enriquecerProdutoComNota, atualizarCustoDeReferencia } from "./enriquecer-produto";
import { conciliarComPedidoSugerido } from "@/lib/compras/conciliacao";
import { garantirRecebimentoDaNota } from "@/lib/compras/recebimento";
import { classificarDocumento, ehConhecimentoDeTransporte } from "./tipo-documento";
import { importarCte, freteCteDaNota } from "./cte-entrada";
import {
  entradasAguardandoDocumento,
  type CandidatoEntradaManual,
} from "@/lib/compras/documento";
import { gerarTitulosDaNota } from "@/lib/financeiro/contas-pagar";
import {
  sincronizarFornecedorComNota,
  vincularSincronizacaoAoInbound,
  type ResumoSincronizacao,
} from "@/lib/fornecedores/sincronizacao-xml";
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
  /** Recebimento aberto para esta nota — é ele que a tela abre. */
  receiptId?: string;
  /** Itens que já nasceram relacionados pelo de-para. */
  itensResolvidos?: number;
  itensTotal?: number;
  /** Pedido que a nota conciliou sozinha (quando um se destacou). */
  pedidoNumero?: string | null;
  /** Havia pedido candidato, mas nenhum se destacou — a tela pergunta. */
  pedidosCandidatos?: number;
  /** O que a nota fez pelo cadastro do fornecedor — vira o painel de revisão. */
  sincronizacao?: ResumoSincronizacao;
  /**
   * Documento sem mercadoria (CT-e, nota de serviço): entrou como despesa, não
   * como estoque. A tela precisa dizer isso — senão o operador procura os itens.
   */
  semEstoque?: string | null;
  /** CT-e: quanto de frete entrou e em quantas notas da carga ele coube. */
  frete?: {
    valor: number;
    notasRateadas: number;
    notasNaoEncontradas: number;
    naoRateado: number;
  };
  /**
   * Entradas lançadas à mão que esta nota pode estar documentando. Enquanto
   * houver candidata, receber a nota duplicaria estoque — a tela pergunta antes.
   */
  candidatasManuais?: CandidatoEntradaManual[];
  motivo?: string;
};

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
 *
 * Sem match, fica null e a nota nasce PENDENTE.
 *
 * O fator, quando não vem de um cadastro nosso, vem da própria nota
 * (`qTrib/qCom`) e, na falta dela, do que a SIGLA da unidade já diz sozinha —
 * milheiro é mil. Sem isso, uma nota de distribuidor com 5 CX de long neck
 * entraria como 5 garrafas em vez de 120, e 0,6 MI de cigarro como 0,6 maço —
 * e o de-para que o operador salvasse em cima disso repetiria o erro em toda
 * nota seguinte.
 */
async function resolverItem(
  tenantId: string,
  supplierId: string,
  item: ItemNotaXml,
): Promise<ItemResolvido> {
  const daNota = fatorDaNota(item) ?? fatorDaUnidade(item.unidade) ?? 1;

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
    if (produto) {
      return { productId: produto.id, packagingId: null, fatorConversao: daNota };
    }
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

  // CT-e vem no mesmo e-mail da nota e o operador sobe os dois. Não tem
  // mercadoria — mas o frete É custo da carga, então entra por um caminho
  // próprio: vira despesa e se rateia entre as notas que ele transportou.
  if (ehConhecimentoDeTransporte(xml.conteudo)) {
    const cte = await importarCte({ tenantId, siteId, xml, userId, cnpjDestino });
    const rateadas = cte.notasVinculadas.filter((n) => !n.jaRecebida).length;
    return {
      arquivo: xml.nome,
      status: "IMPORTADA",
      chave: cte.chave,
      inboundId: cte.inboundId,
      itensResolvidos: 0,
      itensTotal: 0,
      semEstoque:
        `Frete de ${fmtMoeda(cte.valorFrete)} — ` +
        (rateadas > 0
          ? `rateado entre ${rateadas} nota(s) da carga e virou conta a pagar.`
          : cte.freteNaoRateado > 0
            ? `as notas desta carga já viraram entrada, então o valor entrou só como conta a pagar.`
            : "entrou como conta a pagar."),
      frete: {
        valor: cte.valorFrete,
        notasRateadas: rateadas,
        notasNaoEncontradas: cte.notasNaoEncontradas,
        naoRateado: cte.freteNaoRateado,
      },
    };
  }

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

  // O cadastro do fornecedor é sincronizado com o XML aqui: dado oficial entra
  // sozinho, canal de contato vira sugestão e a compra alimenta o histórico
  // que as cotações leem depois (ver lib/fornecedores/sincronizacao-xml.ts).
  const { supplierId, resumo: sincronizacao } = await sincronizarFornecedorComNota({
    tenantId,
    nota,
    userId,
  });

  // Frete e desconto que o emitente lançou só no total da nota são rateados
  // pelos itens agora: o custo médio nasce do que foi PAGO, e reconstruir isso
  // depois exigiria reprocessar nota velha. O XML cru continua guardado inteiro
  // — a fidelidade ao documento mora lá, não nesta coluna.
  const rateio = ratearTotaisDaNota(nota.itens, {
    frete: nota.valorFrete,
    desconto: nota.valorDesconto,
  });

  // Nota de serviço não tem mercadoria: guardamos o documento (é despesa real,
  // com duplicata a pagar) mas ele não entra na fila de relacionar itens.
  const classificacao = classificarDocumento({ modelo: nota.modelo, itens: nota.itens });

  const resolvidos = await Promise.all(
    nota.itens.map(async (item, i) => ({
      item,
      encargos: rateio[i],
      resolucao: classificacao.movimentaEstoque
        ? await resolverItem(tenantId, supplierId, item)
        : { productId: null, packagingId: null, fatorConversao: 1 },
    })),
  );

  const criada = await db.fiscalInbound.create({
    data: {
      tenantId,
      siteId,
      supplierId,
      status: classificacao.movimentaEstoque
        ? statusPorItens(resolvidos.map((r) => r.resolucao))
        : "SEM_ESTOQUE",
      semEstoqueMotivo: classificacao.motivo,
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

  // A trilha de sincronização nasce antes da nota (o fornecedor tem de existir
  // para o inbound apontar para ele); agora que a nota existe, ela ganha a
  // origem — é o que liga "endereço atualizado" ao documento que o mudou.
  await vincularSincronizacaoAoInbound(nota.chave, criada.id);

  // Documento de despesa termina aqui: vira título a pagar e não volta a
  // pedir atenção do operador. Não há pedido para conciliar nem item para
  // relacionar — insistir nisso é o que fazia essas notas ficarem PENDENTE
  // para sempre.
  if (!classificacao.movimentaEstoque) {
    await gerarTitulosDaNota({ tenantId, inboundId: criada.id, userId });
    return {
      arquivo: xml.nome,
      status: "IMPORTADA",
      chave: nota.chave,
      inboundId: criada.id,
      itensResolvidos: 0,
      itensTotal: resolvidos.length,
      semEstoque: classificacao.motivo,
      sincronizacao,
    };
  }

  // Achar o pedido é trabalho do sistema, não do operador: quando um candidato
  // se destaca com folga, a nota já nasce conciliada.
  const vinculo = await conciliarComPedidoSugerido({
    tenantId,
    inboundId: criada.id,
    userId,
  });

  // Esta nota pode estar documentando algo que já foi lançado à mão. Perguntar
  // agora custa uma tela; descobrir depois custa um inventário.
  const candidatasManuais = await entradasAguardandoDocumento({
    supplierId,
    siteId,
    dataEmissao: nota.dataEmissao,
    valorTotal: nota.valorTotal,
    produtoIds: resolvidos
      .map((r) => r.resolucao.productId)
      .filter((id): id is string => Boolean(id)),
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
    candidatasManuais,
    sincronizacao,
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
  /** Sabor/cor que esta linha do XML representa. Não cria saldo próprio. */
  packagingId?: string | null;
  fatorConversao?: number;
}): Promise<{ preenchidos: string[] }> {
  const { tenantId, itemId, productId } = input;
  // A variação só vale se for do produto escolhido — a tela manda os dois, e
  // trocar o produto sem trocar o sabor é o erro mais fácil de cometer ali.
  const fatorConversao = input.fatorConversao && input.fatorConversao > 0 ? input.fatorConversao : 1;

  const item = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: {
      id: true,
      codigoFornecedor: true,
      gtin: true,
      ncm: true,
      cest: true,
      cfop: true,
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
  if (item.inbound.status === "SEM_ESTOQUE") {
    throw new Error("Este documento é de serviço/frete: não há mercadoria para relacionar.");
  }
  if (item.inbound.status === "VINCULADO") {
    throw new Error("Esta nota documenta uma entrada já lançada — o de-para dela não muda o saldo.");
  }

  // A conversão tem de fechar em peça inteira ANTES de virar de-para: gravada,
  // ela se repete em toda nota seguinte deste fornecedor (SupplierItemMap) e o
  // erro sai de uma linha para o cadastro inteiro.
  unidadesParaEstoque(
    Number(item.quantidade),
    fatorConversao,
    `Item ${item.codigoFornecedor}`,
  );

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
      ncm: item.ncm,
      cest: item.cest,
      cfop: item.cfop,
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

  // O histórico do fornecedor guarda o item como o XML mandou; relacionar aqui
  // é o que faz "quem já me vendeu este produto?" achar por productId, e não só
  // por código de barras.
  if (item.inbound.supplierId) {
    await db.supplierProductHistory.updateMany({
      where: { supplierId: item.inbound.supplierId, codigoFornecedor: item.codigoFornecedor },
      data: { productId },
    });
  }

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

/**
 * Desfaz o de-para de uma linha. Não basta limpar o item: o mapa do fornecedor
 * e o histórico apontam para o produto errado, e na próxima nota do mesmo
 * fornecedor o erro voltaria sozinho. Desfazer tem de desfazer.
 */
export async function desrelacionarItemInbound(input: {
  itemId: string;
}): Promise<void> {
  const item = await db.fiscalInboundItem.findFirst({
    where: { id: input.itemId },
    select: {
      id: true,
      codigoFornecedor: true,
      inbound: { select: { id: true, status: true, supplierId: true } },
    },
  });
  if (!item) throw new Error("Item não encontrado.");
  if (item.inbound.status !== "PENDENTE" && item.inbound.status !== "CONCILIADO") {
    throw new Error("Esta nota já foi processada — o de-para dela não muda mais.");
  }

  await db.fiscalInboundItem.update({
    where: { id: item.id },
    data: { productId: null, packagingId: null, fatorConversao: 1 },
  });

  if (item.inbound.supplierId) {
    await db.supplierItemMap.deleteMany({
      where: { supplierId: item.inbound.supplierId, codigoFornecedor: item.codigoFornecedor },
    });
    await db.supplierProductHistory.updateMany({
      where: { supplierId: item.inbound.supplierId, codigoFornecedor: item.codigoFornecedor },
      data: { productId: null },
    });
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

/**
 * Linhas ainda pendentes da MESMA nota com o mesmo código do fornecedor.
 *
 * Nota de distribuidor repete o mesmo item em várias linhas (lotes, validades,
 * descontos diferentes). Mesmo código do fornecedor é o mesmo produto por
 * definição — pedir o de-para três vezes é imposto de tempo.
 */
export async function irmaosPendentesDoItem(itemId: string): Promise<string[]> {
  const item = await db.fiscalInboundItem.findFirst({
    where: { id: itemId },
    select: { id: true, inboundId: true, codigoFornecedor: true },
  });
  if (!item || !item.codigoFornecedor.trim()) return [];
  const irmaos = await db.fiscalInboundItem.findMany({
    where: {
      inboundId: item.inboundId,
      codigoFornecedor: item.codigoFornecedor,
      productId: null,
      id: { not: item.id },
    },
    select: { id: true },
  });
  return irmaos.map((i) => i.id);
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
  /** De onde a nota veio — define a origem do pedido criado retroativamente. */
  origem?: "XML" | "DFE";
  /**
   * O operador viu a lista de entradas manuais candidatas e disse que esta nota
   * não é nenhuma delas. Sem esta confirmação, uma candidata forte barra a
   * entrada — duplicar estoque em silêncio é pior do que uma pergunta a mais.
   */
  ignorarDuplicidade?: boolean;
}): Promise<string> {
  const { tenantId, inboundId, userId } = input;

  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      siteId: true,
      status: true,
      chave: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      valorTotal: true,
      supplierId: true,
      purchaseOrderId: true,
      conciliadoEm: true,
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
  if (nota.status === "VINCULADO") {
    throw new Error(
      "Esta nota documenta uma entrada lançada à mão — o estoque já subiu por ela.",
    );
  }
  // Alguém já abriu a conferência sem pedido para esta nota. Dar entrada por
  // aqui pularia a contagem em andamento e ainda criaria um pedido retroativo
  // que o operador decidiu explicitamente não ter.
  if (!nota.purchaseOrderId && nota.conciliadoEm) {
    throw new Error(
      "Esta nota está em conferência sem pedido — dê entrada pela tela de recebimento.",
    );
  }
  if (nota.status === "SEM_ESTOQUE") {
    throw new Error(
      "Este documento não tem mercadoria (serviço/frete). Ele já virou conta a pagar.",
    );
  }

  const semProduto = nota.items.filter((i) => !i.productId);
  if (semProduto.length > 0) {
    throw new Error(
      `Relacione todos os itens antes de receber. Faltam ${semProduto.length}: ${semProduto
        .slice(0, 3)
        .map((i) => i.descricao)
        .join(", ")}${semProduto.length > 3 ? "…" : ""}`,
    );
  }

  // Frete que veio em CT-e separado, já rateado para esta nota. É custo da
  // mercadoria como o frete da própria NF-e: quem paga a entrega em documento
  // à parte não paga menos pela carga.
  const freteCte = await freteCteDaNota(inboundId);
  const baseRateio = nota.items.reduce((a, i) => a + Number(i.valorTotal), 0);

  const itens: EntradaItem[] = nota.items.map((i) => {
    // Proporcional ao valor do item, mesma régua do rateio da nota. Bonificação
    // fica de fora: item sem custo não pode ganhar custo pelo frete.
    const parteCte =
      freteCte > 0 && baseRateio > 0 && !i.bonificacao
        ? (freteCte * Number(i.valorTotal)) / baseRateio
        : 0;

    return {
      productId: i.productId as string,
      // O sabor comprado sobrevive na linha da entrada; o saldo continua sendo
      // um só, o do produto principal.
      // Convertemos aqui e mandamos packagingId null de propósito: o fator do
      // de-para pode divergir do cadastro da embalagem (fornecedor muda o fardo),
      // e deixar `registrarEntrada` converter de novo dobraria a quantidade.
      // Peça inteira ou erro: meia garrafa não entra no saldo.
      quantidade: unidadesParaEstoque(
        Number(i.quantidade),
        Number(i.fatorConversao),
        `Item ${i.descricao}`,
      ),
      custoTotal: custoDoItem({
        valorTotal: Number(i.valorTotal),
        valorDesconto: Number(i.valorDesconto),
        valorIcmsSt: Number(i.valorIcmsSt),
        valorFcpSt: Number(i.valorFcpSt),
        valorIpi: Number(i.valorIpi),
        valorFrete: Number(i.valorFrete) + parteCte,
        bonificacao: i.bonificacao,
      }),
      packagingId: null,
    };
  });

  // Antes de somar no estoque: esta mercadoria já entrou à mão? A pergunta só
  // é cara aqui; depois vira divergência de inventário que ninguém explica.
  if (!input.ignorarDuplicidade) {
    const candidatas = await entradasAguardandoDocumento({
      supplierId: nota.supplierId,
      siteId: nota.siteId,
      dataEmissao: nota.dataEmissao,
      valorTotal: Number(nota.valorTotal),
      produtoIds: nota.items.map((i) => i.productId as string),
    });
    const forte = candidatas.find((c) => c.score >= 80);
    if (forte) {
      throw new Error(
        `Há uma entrada lançada à mão em ${forte.data.toLocaleDateString("pt-BR")} que parece ser esta mesma nota. Vincule as duas ou confirme que são compras diferentes antes de receber.`,
      );
    }
  }

  // Nota sem pedido segue sem pedido: quem documenta o que entrou é o
  // RECEBIMENTO, criado logo abaixo. Antes daqui saía um PurchaseOrder
  // retroativo, e /pedidos passava a listar compras que ninguém fez —
  // misturando "o que eu comprei" com "o que chegou".
  const purchaseOrderId = nota.purchaseOrderId;

  const soBonificacao = nota.items.every((i) => i.bonificacao);

  // Mesmo o atalho do escritório ("dar entrada direto pela nota", sem contar
  // caixa na porta) gera um RECEBIMENTO. Sem isto, a mercadoria entraria no
  // estoque sem aparecer na tela que responde "o que chegou?" — e o operador
  // procuraria pela carga num lugar onde ela nunca esteve.
  const receipt = await garantirRecebimentoDaNota({ tenantId, inboundId, userId });

  const purchaseId = await registrarEntrada(tenantId, nota.siteId, itens, {
    tipo: "FORNECEDOR",
    motivo: soBonificacao ? "BONIFICACAO" : purchaseOrderId ? null : "COMPRA_SEM_PEDIDO",
    supplierId: nota.supplierId,
    purchaseOrderId,
    receiptId: receipt.id,
    numero: receipt.numero,
    numeroNota: `${nota.numero}/${nota.serie}`,
    observacao: `Recebimento ${receipt.numero} — entrada direta pela NF-e ${nota.emitRazaoSocial}`,
    createdBy: userId ?? undefined,
    chaveNfe: nota.chave,
  });

  await db.goodsReceipt.update({
    where: { id: receipt.id },
    data: {
      status: "FINALIZADO",
      finalizadoEm: new Date(),
      purchaseOrderId,
      supplierId: nota.supplierId,
      observacao:
        "Entrada gerada direto da NF-e, sem conferência física item a item.",
    },
  });

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: { status: "RECEBIDO", purchaseId, purchaseOrderId },
  });

  // O dinheiro que vai sair nasce junto com a mercadoria que entrou: uma linha
  // por duplicata da nota, ou parcela única quando o fornecedor não parcelou.
  await gerarTitulosDaNota({ tenantId, inboundId, purchaseId, userId });

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
  if (nota.status === "VINCULADO") {
    throw new Error(
      "Esta nota documenta uma entrada já lançada. Descartá-la deixaria a entrada sem documento.",
    );
  }
  if (nota.status === "SEM_ESTOQUE") {
    throw new Error(
      "Este documento virou conta a pagar. Cancele o título em Contas a pagar, não a nota.",
    );
  }
  await db.fiscalInbound.update({
    where: { id: input.inboundId },
    data: { status: "DESCARTADO", observacao: input.motivo },
  });
}
