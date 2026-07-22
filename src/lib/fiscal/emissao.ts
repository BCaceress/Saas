import "server-only";
import { basePrisma, txComTenant } from "@/lib/prisma";
import { carregarConfigFiscal, proximoNumero, CRT_POR_REGIME, usaCsosn } from "./index";
import { fiscalSimuladoProvider } from "./simulado";
import type {
  DocumentoParaEmitir,
  FiscalProvider,
  ItemFiscal,
  PagamentoFiscal,
  ResultadoFiscal,
} from "./types";
import type {
  FiscalStatus,
  PaymentMethod,
  FiscalProviderKind,
  FiscalAmbiente,
  Prisma,
} from "@/generated/prisma";

// ============================================================
// Emissão de NFC-e a partir da venda. ASSÍNCRONA POR DESENHO.
//
// A venda NUNCA espera a SEFAZ. `finalizarVenda` só ENFILEIRA: grava um
// FiscalDocument PENDENTE com o snapshot dos itens e devolve o caixa ao
// operador. A transmissão acontece depois, empurrada por:
//   1. o polling da própria tela do PDV (quem acabou de vender está olhando);
//   2. o job /api/jobs/fila-fiscal (rede de segurança para o que ficou para trás).
//
// SEFAZ fora do ar não pode fechar a loja. Falha de transporte volta para a
// fila; depois de MAX_TENTATIVAS a nota vira CONTINGENCIA — o cupom vale, a
// transmissão fica pendente.
//
// Usa basePrisma + set_config explícito (mesmo padrão de lib/vendas e
// lib/pagamentos): é chamada de dentro do fluxo de venda, que não roda em
// runWithTenant.
// ============================================================

/** Depois disto, para de tentar online e assume contingência. */
const MAX_TENTATIVAS = 3;

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Atalho local: aqui quase toda operação é uma sequência (lê o documento, monta,
 * grava o resultado), então o padrão é a transação interativa de lib/prisma.
 */
const comTenant = <T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  txComTenant(tenantId, fn);

function buildProvider(cfg: {
  provider: FiscalProviderKind;
  apiToken: string | null;
  ambiente: FiscalAmbiente;
}): FiscalProvider {
  if (cfg.provider === "SIMULADO") return fiscalSimuladoProvider();
  throw new Error(
    `Provedor fiscal ${cfg.provider} ainda não implementado. Use SIMULADO em desenvolvimento.`,
  );
}

/** tPag da SEFAZ a partir do método de pagamento do PDV. */
const FORMA_POR_METODO: Record<PaymentMethod, PagamentoFiscal["forma"]> = {
  DINHEIRO: "DINHEIRO",
  CARTAO_CREDITO: "CARTAO_CREDITO",
  CARTAO_DEBITO: "CARTAO_DEBITO",
  PIX: "PIX",
  OUTRO: "OUTROS",
};

export type ResultadoEnfileiramento =
  | { ok: true; documentId: string; jaExistia: boolean }
  | { ok: false; motivo: string };

/**
 * Enfileira a NFC-e de uma venda paga. Rápido de propósito: só valida e grava.
 *
 * Valida ANTES de puxar número da série. Número consumido em nota que nem foi
 * montada vira buraco na numeração — que depois só se resolve com inutilização.
 */
export async function enfileirarNfceDaVenda(
  tenantId: string,
  saleId: string,
  userId?: string | null,
): Promise<ResultadoEnfileiramento> {
  const idempotencyKey = `venda:${saleId}`;

  const existente = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    }),
  );
  if (existente) return { ok: true, documentId: existente.id, jaExistia: true };

  const venda = await comTenant(tenantId, (tx) =>
    tx.sale.findFirst({
      where: { id: saleId },
      select: {
        id: true,
        siteId: true,
        status: true,
        subtotal: true,
        desconto: true,
        total: true,
        customerId: true,
        items: {
          select: {
            productId: true,
            quantidade: true,
            precoUnitario: true,
            desconto: true,
            total: true,
          },
        },
        payments: {
          where: { status: "CONFIRMADO" },
          select: { metodo: true, valor: true, troco: true },
        },
      },
    }),
  );
  if (!venda) return { ok: false, motivo: "Venda não encontrada." };
  if (venda.status !== "PAGA") return { ok: false, motivo: "A venda ainda não está paga." };

  const emitente = await comTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({
      where: { siteId: venda.siteId },
      select: { id: true, cnpj: true, regime: true, certificadoId: true, csc: true },
    }),
  );
  if (!emitente) {
    return {
      ok: false,
      motivo: "Esta loja não tem emitente fiscal. Configure em Configurações → Fiscal.",
    };
  }

  const serie = await comTenant(tenantId, (tx) =>
    tx.fiscalSerie.findFirst({
      where: { siteId: venda.siteId, modelo: "NFCE", ativa: true },
      select: { serie: true },
    }),
  );
  if (!serie) {
    return {
      ok: false,
      motivo: "Sem série de NFC-e configurada para esta loja.",
    };
  }

  // Produtos + perfil fiscal. Sem NCM a SEFAZ rejeita — melhor barrar aqui,
  // com o nome do produto na mensagem, do que queimar número numa rejeição.
  const produtos = await comTenant(tenantId, (tx) =>
    tx.product.findMany({
      where: { id: { in: venda.items.map((i) => i.productId) } },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        unidadeBase: true,
        gtinTributavel: true,
        unidadeTributavel: true,
        fatorConversaoTrib: true,
        codigoAnp: true,
        fiscalProfile: {
          select: {
            ncm: true,
            cest: true,
            origem: true,
            cst: true,
            csosn: true,
            cfopSaida: true,
            aliquotaIcms: true,
            codigoBeneficio: true,
          },
        },
        subcategory: {
          select: {
            defaultFiscalProfile: {
              select: {
                ncm: true,
                cest: true,
                origem: true,
                cst: true,
                csosn: true,
                cfopSaida: true,
                aliquotaIcms: true,
                codigoBeneficio: true,
              },
            },
          },
        },
      },
    }),
  );
  const porProduto = new Map(produtos.map((p) => [p.id, p]));

  const semFiscal = venda.items
    .map((i) => porProduto.get(i.productId))
    .filter((p) => {
      const perfil = p?.fiscalProfile ?? p?.subcategory?.defaultFiscalProfile;
      return !perfil?.ncm;
    });
  if (semFiscal.length > 0) {
    const nomes = semFiscal
      .slice(0, 3)
      .map((p) => p?.nome ?? "produto")
      .join(", ");
    const motivo = `Sem classificação fiscal (NCM): ${nomes}${semFiscal.length > 3 ? "…" : ""}.`;
    // Sem documento não há onde pendurar o erro — o evento é o registro de que
    // esta venda ficou sem nota, e aparece no histórico fiscal.
    await registrarEvento(tenantId, {
      documentId: null,
      tipo: "REJEICAO",
      mensagem: motivo,
      motivo: `Venda ${saleId}`,
      userId,
    });
    return { ok: false, motivo };
  }

  const cfg = await carregarConfigFiscal(tenantId);
  if (!cfg) return { ok: false, motivo: "Módulo fiscal sem configuração." };

  const csosn = usaCsosn(emitente.regime);
  const numero = await proximoNumero({
    tenantId,
    siteId: venda.siteId,
    modelo: "NFCE",
    serie: serie.serie,
  });

  const cliente = venda.customerId
    ? await comTenant(tenantId, (tx) =>
        tx.customer.findFirst({
          where: { id: venda.customerId as string },
          select: { nome: true, cpf: true, cnpj: true },
        }),
      )
    : null;

  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.create({
      data: {
        tenantId,
        siteId: venda.siteId,
        modelo: "NFCE",
        direcao: "SAIDA",
        status: "PENDENTE",
        ambiente: cfg.ambiente,
        serie: serie.serie,
        numero,
        idempotencyKey,
        naturezaOperacao: "Venda ao consumidor",
        saleId: venda.id,
        customerId: venda.customerId,
        destNome: cliente?.nome ?? null,
        destDocumento: cliente?.cpf ?? cliente?.cnpj ?? null,
        valorProdutos: num(venda.subtotal),
        valorDesconto: num(venda.desconto),
        valorTotal: num(venda.total),
        createdBy: userId ?? null,
        items: {
          create: venda.items.map((item, idx) => {
            const p = porProduto.get(item.productId);
            const perfil = p?.fiscalProfile ?? p?.subcategory?.defaultFiscalProfile;
            return {
              tenantId,
              ordem: idx + 1,
              productId: item.productId,
              codigo: p?.sku ?? item.productId,
              descricao: p?.nome ?? "Produto",
              gtin: p?.gtinTributavel ?? p?.ean ?? null,
              ncm: perfil?.ncm ?? "",
              cest: perfil?.cest ?? null,
              // 5102 = venda de mercadoria adquirida de terceiros, dentro do
              // estado. É o CFOP do balcão quando o perfil não define outro.
              cfop: perfil?.cfopSaida ?? "5102",
              origem: perfil?.origem ?? "0",
              cst: csosn ? null : (perfil?.cst ?? null),
              csosn: csosn ? (perfil?.csosn ?? null) : null,
              unidade: p?.unidadeBase ?? "UN",
              quantidade: num(item.quantidade),
              valorUnitario: num(item.precoUnitario),
              valorTotal: num(item.total),
              valorDesconto: num(item.desconto),
              aliquotaIcms: perfil?.aliquotaIcms ?? null,
            };
          }),
        },
      },
      select: { id: true },
    }),
  );

  return { ok: true, documentId: doc.id, jaExistia: false };
}

/** Grava uma linha na trilha fiscal. Append-only — nunca atualize. */
async function registrarEvento(
  tenantId: string,
  e: {
    documentId: string | null;
    tipo: "EMISSAO" | "REJEICAO" | "CONTINGENCIA" | "CANCELAMENTO";
    codigo?: string | null;
    mensagem?: string | null;
    motivo?: string | null;
    protocolo?: string | null;
    payload?: unknown;
    userId?: string | null;
  },
): Promise<void> {
  await comTenant(tenantId, (tx) =>
    tx.fiscalEvent.create({
      data: {
        tenantId,
        documentId: e.documentId,
        tipo: e.tipo,
        codigo: e.codigo ?? null,
        mensagem: e.mensagem ?? null,
        motivo: e.motivo ?? null,
        protocolo: e.protocolo ?? null,
        payload: e.payload === undefined ? undefined : JSON.parse(JSON.stringify(e.payload)),
        userId: e.userId ?? null,
      },
    }),
  );
}

/** Monta o payload do provedor a partir do documento já persistido. */
async function montarDocumento(
  tenantId: string,
  documentId: string,
): Promise<DocumentoParaEmitir | null> {
  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: {
        id: true,
        siteId: true,
        modelo: true,
        serie: true,
        numero: true,
        naturezaOperacao: true,
        dataEmissao: true,
        idempotencyKey: true,
        status: true,
        saleId: true,
        destNome: true,
        destDocumento: true,
        valorProdutos: true,
        valorDesconto: true,
        valorTotal: true,
        items: { orderBy: { ordem: "asc" } },
      },
    }),
  );
  if (!doc) return null;

  const emitente = await comTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({ where: { siteId: doc.siteId } }),
  );
  if (!emitente) return null;

  const pagamentos = doc.saleId
    ? await comTenant(tenantId, (tx) =>
        tx.payment.findMany({
          where: { saleId: doc.saleId as string, status: "CONFIRMADO" },
          select: { metodo: true, valor: true, troco: true },
        }),
      )
    : [];

  const itens: ItemFiscal[] = doc.items.map((i) => ({
    ordem: i.ordem,
    codigo: i.codigo,
    descricao: i.descricao,
    gtin: i.gtin,
    ncm: i.ncm,
    cest: i.cest,
    cfop: i.cfop,
    origem: i.origem,
    cst: i.cst,
    csosn: i.csosn,
    unidade: i.unidade,
    quantidade: num(i.quantidade),
    valorUnitario: num(i.valorUnitario),
    valorTotal: num(i.valorTotal),
    valorDesconto: num(i.valorDesconto),
    aliquotaIcms: i.aliquotaIcms == null ? null : num(i.aliquotaIcms),
    unidadeTributavel: null,
    quantidadeTributavel: null,
    codigoBeneficio: null,
    codigoAnp: null,
  }));

  return {
    modelo: doc.modelo,
    serie: doc.serie,
    numero: doc.numero,
    naturezaOperacao: doc.naturezaOperacao,
    dataEmissao: doc.dataEmissao,
    emitente: {
      cnpj: emitente.cnpj,
      razaoSocial: emitente.razaoSocial,
      nomeFantasia: emitente.nomeFantasia,
      ie: emitente.ie,
      im: emitente.im,
      crt: CRT_POR_REGIME[emitente.regime],
      cep: emitente.cep,
      logradouro: emitente.logradouro,
      numero: emitente.numero,
      complemento: emitente.complemento,
      bairro: emitente.bairro,
      municipio: emitente.municipio,
      codigoMunicipio: emitente.codigoMunicipio,
      uf: emitente.uf,
      telefone: emitente.telefone,
      certificadoId: emitente.certificadoId,
      cscId: emitente.cscId,
      csc: emitente.csc,
    },
    // NFC-e aceita consumidor não identificado — o caso normal no balcão.
    destinatario: doc.destDocumento
      ? {
          documento: doc.destDocumento,
          nome: doc.destNome,
          email: null,
          ie: null,
          indicadorIE: 9,
          endereco: null,
        }
      : null,
    itens,
    pagamentos: pagamentos.map(
      (p): PagamentoFiscal => ({
        forma: FORMA_POR_METODO[p.metodo],
        valor: num(p.valor),
        troco: p.troco == null ? undefined : num(p.troco),
      }),
    ),
    valorProdutos: num(doc.valorProdutos),
    valorDesconto: num(doc.valorDesconto),
    valorTotal: num(doc.valorTotal),
    informacoesComplementares: null,
    idempotencyKey: doc.idempotencyKey,
    contingencia: doc.status === "CONTINGENCIA",
  };
}

/** Aplica ao documento o que o provedor devolveu. */
async function aplicarResultado(
  tenantId: string,
  documentId: string,
  r: ResultadoFiscal,
): Promise<FiscalStatus> {
  const status: FiscalStatus = r.status;
  // cStat/xMotivo só viram "rejeição" quando a nota não passou. Em nota
  // autorizada o mesmo par significa "Autorizado o uso" — guardar isso no
  // campo de rejeição faria a tela acusar erro numa venda que deu certo.
  const recusada = status === "REJEITADO" || status === "DENEGADO";

  await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.update({
      where: { id: documentId },
      data: {
        status,
        externalId: r.externalId ?? undefined,
        chave: r.chave ?? undefined,
        protocolo: r.protocolo ?? undefined,
        dataAutorizacao: r.dataAutorizacao ?? undefined,
        codigoRejeicao: recusada ? r.codigo : null,
        motivoRejeicao: recusada ? r.mensagem : null,
        qrCodeUrl: r.qrCodeUrl ?? undefined,
        urlConsulta: r.urlConsulta ?? undefined,
        contingencia: status === "CONTINGENCIA",
      },
    }),
  );

  if (status === "AUTORIZADO") {
    await registrarEvento(tenantId, {
      documentId,
      tipo: "EMISSAO",
      codigo: r.codigo,
      mensagem: r.mensagem,
      protocolo: r.protocolo,
      payload: r.payload,
    });
  } else if (recusada) {
    await registrarEvento(tenantId, {
      documentId,
      tipo: "REJEICAO",
      codigo: r.codigo,
      mensagem: r.mensagem,
      payload: r.payload,
    });
  }

  return status;
}

/**
 * Transmite (ou consulta) um documento. Idempotente por status: já autorizado,
 * cancelado ou denegado, não faz nada.
 */
export async function transmitirDocumento(
  tenantId: string,
  documentId: string,
): Promise<FiscalStatus> {
  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: { id: true, status: true, tentativas: true, externalId: true, modelo: true },
    }),
  );
  if (!doc) throw new Error("Documento fiscal não encontrado.");

  if (doc.status === "AUTORIZADO" || doc.status === "CANCELADO" || doc.status === "DENEGADO") {
    return doc.status;
  }

  const cfg = await carregarConfigFiscal(tenantId);
  if (!cfg || !cfg.ativo) return doc.status; // emissão desligada: fica na fila

  const provider = buildProvider(cfg);

  // Já transmitido antes: consultar em vez de reenviar. Reenviar geraria
  // duplicidade — é justamente o que a idempotência evita.
  if (doc.status === "PROCESSANDO" && doc.externalId) {
    try {
      const r = await provider.consultarNota({
        externalId: doc.externalId,
        modelo: doc.modelo,
      });
      return await aplicarResultado(tenantId, documentId, r);
    } catch {
      return doc.status; // provedor fora do ar: tenta de novo no próximo ciclo
    }
  }

  if (doc.status === "REJEITADO") {
    // Rejeitada não se reenvia sozinha: o operador corrige o cadastro e a
    // reemissão sai com número novo (a rejeitada vira inutilização, Fase 5).
    return doc.status;
  }

  const payload = await montarDocumento(tenantId, documentId);
  if (!payload) return doc.status;

  await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.update({
      where: { id: documentId },
      data: { status: "PROCESSANDO", tentativas: { increment: 1 } },
    }),
  );

  try {
    const r =
      payload.modelo === "NFCE"
        ? await provider.emitirNFCe(payload)
        : await provider.emitirNFe(payload);
    return await aplicarResultado(tenantId, documentId, r);
  } catch (e) {
    // Falha de TRANSPORTE (rede, credencial, SEFAZ fora) — não é rejeição.
    const tentativas = doc.tentativas + 1;
    const virouContingencia = tentativas >= MAX_TENTATIVAS;
    const mensagem = e instanceof Error ? e.message : "Falha ao transmitir.";

    await comTenant(tenantId, (tx) =>
      tx.fiscalDocument.update({
        where: { id: documentId },
        data: {
          status: virouContingencia ? "CONTINGENCIA" : "PENDENTE",
          contingencia: virouContingencia,
          motivoRejeicao: mensagem,
        },
      }),
    );

    if (virouContingencia) {
      await registrarEvento(tenantId, {
        documentId,
        tipo: "CONTINGENCIA",
        mensagem,
        motivo: `Falhou ${tentativas} vez(es) ao transmitir`,
      });
    }

    return virouContingencia ? "CONTINGENCIA" : "PENDENTE";
  }
}

/**
 * Empurra a fila de um tenant. Pega PENDENTE, CONTINGENCIA e PROCESSANDO —
 * as duas primeiras para transmitir, a última para consultar o desfecho.
 */
export async function processarFilaFiscal(
  tenantId: string,
  opts: { limite?: number } = {},
): Promise<{ processados: number; autorizados: number; pendentes: number }> {
  const limite = opts.limite ?? 25;

  const docs = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findMany({
      where: { status: { in: ["PENDENTE", "CONTINGENCIA", "PROCESSANDO"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limite,
    }),
  );

  let autorizados = 0;
  let pendentes = 0;
  for (const d of docs) {
    try {
      const status = await transmitirDocumento(tenantId, d.id);
      if (status === "AUTORIZADO") autorizados++;
      else if (status !== "REJEITADO" && status !== "DENEGADO") pendentes++;
    } catch {
      pendentes++;
    }
  }

  return { processados: docs.length, autorizados, pendentes };
}

/** Fila de todos os tenants com módulo fiscal ligado — usado pelo job. */
export async function processarFilaFiscalTodos(): Promise<{
  tenants: number;
  processados: number;
  autorizados: number;
}> {
  const tenants = await basePrisma.tenant.findMany({
    where: { moduloFiscal: true, fiscalConfig: { ativo: true } },
    select: { id: true },
  });

  let processados = 0;
  let autorizados = 0;
  for (const t of tenants) {
    try {
      const r = await processarFilaFiscal(t.id, { limite: 50 });
      processados += r.processados;
      autorizados += r.autorizados;
    } catch {
      // Um tenant mal configurado não pode travar a fila dos outros.
    }
  }

  return { tenants: tenants.length, processados, autorizados };
}

export type StatusFiscalVenda = {
  documentId: string;
  status: FiscalStatus;
  numero: number;
  serie: number;
  chave: string | null;
  protocolo: string | null;
  qrCodeUrl: string | null;
  urlConsulta: string | null;
  motivo: string | null;
} | null;

/**
 * Situação da nota de uma venda. É o que o PDV consulta — e, de quebra, empurra
 * a transmissão: quem acabou de vender está olhando a tela, então esse é o
 * melhor momento para gastar o tempo de rede.
 */
export async function statusFiscalDaVenda(
  tenantId: string,
  saleId: string,
  opts: { empurrar?: boolean } = {},
): Promise<StatusFiscalVenda> {
  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { saleId },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (!doc) return null;

  if (opts.empurrar !== false && ["PENDENTE", "CONTINGENCIA", "PROCESSANDO"].includes(doc.status)) {
    try {
      await transmitirDocumento(tenantId, doc.id);
    } catch {
      // Falhou agora, tenta no próximo poll ou no job. Nunca quebra a tela.
    }
  }

  const atual = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: doc.id },
      select: {
        id: true,
        status: true,
        numero: true,
        serie: true,
        chave: true,
        protocolo: true,
        qrCodeUrl: true,
        urlConsulta: true,
        motivoRejeicao: true,
      },
    }),
  );
  if (!atual) return null;

  return {
    documentId: atual.id,
    status: atual.status,
    numero: atual.numero,
    serie: atual.serie,
    chave: atual.chave,
    protocolo: atual.protocolo,
    qrCodeUrl: atual.qrCodeUrl,
    urlConsulta: atual.urlConsulta,
    motivo: atual.motivoRejeicao,
  };
}
