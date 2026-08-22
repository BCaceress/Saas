import "server-only";
import { db } from "@/lib/prisma";
import { parseCteXml, ratearFrete } from "./cte-xml";
import { sincronizarFornecedorComNota } from "@/lib/fornecedores/sincronizacao-xml";
import { gerarTitulosDaNota } from "@/lib/financeiro/contas-pagar";

// ============================================================
// Entrada de CT-e — o frete que vem em documento separado.
//
// O CT-e não tem mercadoria: é despesa. Mas é despesa DA CARGA, e por isso
// pertence ao custo dela. Antes o arquivo era recusado e o valor evaporava —
// quem paga R$ 180 de entrega numa carga de R$ 3.000 tinha margem 6% menor do
// que o sistema mostrava, e nada na tela explicava a diferença.
//
// O documento entra como `FiscalInbound` modelo 57 com status SEM_ESTOQUE
// (mesmo trilho da nota de serviço: vira conta a pagar, não vira saldo), e o
// valor é rateado entre as NF-e que ele transportou.
//
// Ordem de chegada importa:
//   CT-e ANTES da entrada → o frete entra no custo quando a nota for recebida.
//   CT-e DEPOIS da entrada → fica registrado e visível, mas NÃO reprocessa o
//   custo médio. Reescrever razão fechada é pior do que mostrar a diferença.
// ============================================================

export type ResultadoCte = {
  chave: string;
  inboundId: string;
  valorFrete: number;
  /** Notas da carga que o sistema conseguiu achar. */
  notasVinculadas: { chave: string; numero: number; serie: number; parte: number; jaRecebida: boolean }[];
  /** Chaves citadas no CT-e que ainda não existem por aqui. */
  notasNaoEncontradas: number;
  /** Frete que não entrou em custo nenhum (nota já recebida, ou nota ausente). */
  freteNaoRateado: number;
};

export async function importarCte(input: {
  tenantId: string;
  siteId: string;
  xml: { nome: string; conteudo: string };
  userId?: string | null;
  cnpjDestino?: string | null;
}): Promise<ResultadoCte> {
  const { tenantId, siteId, xml, userId } = input;
  const cte = parseCteXml(xml.conteudo);

  const jaExiste = await db.fiscalInbound.findFirst({
    where: { chave: cte.chave },
    select: { id: true },
  });
  if (jaExiste) {
    throw new Error(`CT-e ${cte.numero}/${cte.serie} já foi importado.`);
  }

  // A transportadora vira fornecedor como qualquer outro emitente: é de quem a
  // loja compra o serviço de entrega, e o financeiro precisa de um dono.
  const { supplierId } = await sincronizarFornecedorComNota({
    tenantId,
    nota: {
      chave: cte.chave,
      modelo: cte.modelo,
      numero: cte.numero,
      serie: cte.serie,
      dataEmissao: cte.dataEmissao,
      valorTotal: cte.valorTotal,
      valorFrete: 0,
      valorDesconto: 0,
      emitente: {
        cnpj: cte.emitente.cnpj,
        razaoSocial: cte.emitente.razaoSocial,
        nomeFantasia: null,
        ie: null,
        uf: cte.emitente.uf,
        municipio: null,
        codigoMunicipio: null,
        cep: null,
        logradouro: null,
        numero: null,
        complemento: null,
        bairro: null,
        telefone: null,
        email: null,
        crt: null,
      },
      destinatarioCnpj: cte.tomadorCnpj,
      itens: [],
      duplicatas: [],
    },
    userId,
  });

  const criado = await db.fiscalInbound.create({
    data: {
      tenantId,
      siteId,
      supplierId,
      status: "SEM_ESTOQUE",
      semEstoqueMotivo:
        "Conhecimento de transporte (CT-e) — frete da carga. Virou conta a pagar e entrou no custo das notas transportadas.",
      chave: cte.chave,
      modelo: cte.modelo,
      numero: cte.numero,
      serie: cte.serie,
      dataEmissao: cte.dataEmissao,
      valorTotal: cte.valorTotal,
      valorFrete: cte.valorTotal,
      valorDesconto: 0,
      emitCnpj: cte.emitente.cnpj,
      emitRazaoSocial: cte.emitente.razaoSocial,
      emitUf: cte.emitente.uf,
      importadoPor: userId ?? null,
      xmlArquivo: { create: { tenantId, nomeArquivo: xml.nome, conteudo: xml.conteudo } },
    },
    select: { id: true },
  });

  // O CT-e é despesa real: vira título a pagar como qualquer nota de serviço.
  await gerarTitulosDaNota({ tenantId, inboundId: criado.id, userId });

  const rateio = await ratearFreteNasNotas({
    tenantId,
    chaveCte: cte.chave,
    valorFrete: cte.valorTotal,
    chavesNotas: cte.notasTransportadas,
  });

  return {
    chave: cte.chave,
    inboundId: criado.id,
    valorFrete: cte.valorTotal,
    ...rateio,
  };
}

/**
 * Distribui o frete entre as notas da carga. Só grava em quem ainda não virou
 * entrada: nota recebida tem custo médio fechado, e mexer nele agora faria o
 * histórico de margem mudar sozinho.
 */
export async function ratearFreteNasNotas(input: {
  tenantId: string;
  chaveCte: string;
  valorFrete: number;
  chavesNotas: string[];
}): Promise<Pick<ResultadoCte, "notasVinculadas" | "notasNaoEncontradas" | "freteNaoRateado">> {
  if (input.chavesNotas.length === 0 || input.valorFrete <= 0) {
    return {
      notasVinculadas: [],
      notasNaoEncontradas: input.chavesNotas.length,
      freteNaoRateado: input.valorFrete,
    };
  }

  const notas = await db.fiscalInbound.findMany({
    where: { chave: { in: input.chavesNotas } },
    select: { id: true, chave: true, numero: true, serie: true, valorTotal: true, status: true },
  });

  const partes = ratearFrete(
    input.valorFrete,
    notas.map((n) => ({ chave: n.chave, valorTotal: Number(n.valorTotal) })),
  );

  const vinculadas: ResultadoCte["notasVinculadas"] = [];
  let naoRateado = 0;

  for (const nota of notas) {
    const parte = partes.get(nota.chave) ?? 0;
    // VINCULADO e RECEBIDO já viraram saldo; SEM_ESTOQUE não tem mercadoria.
    const jaRecebida =
      nota.status === "RECEBIDO" || nota.status === "VINCULADO" || nota.status === "SEM_ESTOQUE";

    await db.fiscalInbound.update({
      where: { id: nota.id },
      data: {
        freteCteValor: parte,
        freteCteChave: input.chaveCte,
        // Só marca como rateado o que de fato vai entrar no custo.
        freteCteRateadoEm: jaRecebida ? null : new Date(),
      },
    });

    if (jaRecebida) naoRateado += parte;
    vinculadas.push({
      chave: nota.chave,
      numero: nota.numero,
      serie: nota.serie,
      parte,
      jaRecebida,
    });
  }

  // Frete de nota que não está por aqui não some: continua na conta a pagar,
  // só não achou custo para entrar.
  const achadas = new Set(notas.map((n) => n.chave));
  const faltando = input.chavesNotas.filter((c) => !achadas.has(c));
  if (faltando.length > 0 && notas.length === 0) naoRateado = input.valorFrete;

  return {
    notasVinculadas: vinculadas,
    notasNaoEncontradas: faltando.length,
    freteNaoRateado: Math.round(naoRateado * 100) / 100,
  };
}

/**
 * Frete de CT-e que chegou antes da entrada e ainda vai entrar no custo. Lido
 * na hora de gerar a entrada, para somar ao `valorFrete` da própria NF-e.
 */
export async function freteCteDaNota(inboundId: string): Promise<number> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: { freteCteValor: true, freteCteRateadoEm: true },
  });
  if (!nota?.freteCteRateadoEm) return 0;
  return Number(nota.freteCteValor);
}
