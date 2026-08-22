import "server-only";
import { txComTenant } from "@/lib/prisma";
import { carregarConfigFiscal, proximoNumero, usaCsosn } from "./index";
import type { Prisma } from "@/generated/prisma";

// ============================================================
// NF-e de devolução ao fornecedor.
//
// `SupplierReturn` sabia tudo (o que volta, de qual nota, por quanto) e o
// módulo fiscal já emitia NF-e — mas os dois não se falavam: `numeroNota` e
// `chaveNfe` eram campos digitados à mão. A mercadoria saía do sistema sem sair
// legalmente, e o fisco cruzava a entrada com nada.
//
// Duas coisas fazem uma devolução ser devolução, e não uma venda esquisita:
//   1. CFOP 5202/6202 — devolução de compra de mercadoria adquirida de
//      terceiros, dentro ou fora do estado. 5949/6949 quando a entrada não foi
//      compra (bonificação, brinde): não se devolve venda que não houve.
//   2. refNFe — a chave da nota que trouxe a mercadoria. É o que amarra as
//      duas pontas; sem isso a SEFAZ autoriza e o fisco não fecha.
//
// Assíncrono como toda emissão: aqui só se ENFILEIRA. A transmissão é do
// worker (`processarFilaFiscal`), pelo mesmo caminho da NFC-e.
// ============================================================

const comTenant = <T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  txComTenant(tenantId, fn);

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export type ResultadoDevolucaoNfe =
  | { ok: true; documentId: string; jaExistia: boolean }
  | { ok: false; motivo: string };

/** Dentro do estado → 5202; fora → 6202. Entrada sem custo → 5949/6949. */
function cfopDevolucao(ufEmitente: string, ufDestino: string | null, houveCompra: boolean): string {
  const mesmoEstado = !ufDestino || ufDestino.toUpperCase() === ufEmitente.toUpperCase();
  if (!houveCompra) return mesmoEstado ? "5949" : "6949";
  return mesmoEstado ? "5202" : "6202";
}

/**
 * Enfileira a NF-e de uma devolução já CONFIRMADA. Rascunho não emite: nota
 * emitida de mercadoria que não saiu do estoque é uma correção a mais para
 * fazer depois.
 */
export async function enfileirarNfeDevolucao(
  tenantId: string,
  returnId: string,
  userId?: string | null,
): Promise<ResultadoDevolucaoNfe> {
  const idempotencyKey = `devolucao:${returnId}`;

  const existente = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({ where: { idempotencyKey }, select: { id: true } }),
  );
  if (existente) return { ok: true, documentId: existente.id, jaExistia: true };

  const dev = await comTenant(tenantId, (tx) =>
    tx.supplierReturn.findFirst({
      where: { id: returnId },
      select: {
        id: true,
        numero: true,
        siteId: true,
        supplierId: true,
        status: true,
        observacao: true,
        valorTotal: true,
        inboundId: true,
        purchaseId: true,
        inbound: { select: { chave: true, numero: true, serie: true } },
        purchase: { select: { motivo: true, chaveNfe: true } },
        items: {
          select: { productId: true, quantidade: true, custoUnitario: true },
        },
      },
    }),
  );
  if (!dev) return { ok: false, motivo: "Devolução não encontrada." };
  if (dev.status !== "CONFIRMADA") {
    return {
      ok: false,
      motivo: "Confirme a devolução antes de emitir a nota — a mercadoria precisa ter saído.",
    };
  }
  if (dev.items.length === 0) return { ok: false, motivo: "Devolução sem itens." };

  const emitente = await comTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({
      where: { siteId: dev.siteId },
      select: { id: true, cnpj: true, uf: true, regime: true },
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
      where: { siteId: dev.siteId, modelo: "NFE", ativa: true },
      select: { serie: true },
    }),
  );
  if (!serie) {
    return {
      ok: false,
      motivo: "Sem série de NF-e (modelo 55) configurada para esta loja. Devolução não sai em NFC-e.",
    };
  }

  const fornecedor = await comTenant(tenantId, (tx) =>
    tx.supplier.findFirst({
      where: { id: dev.supplierId },
      select: { razaoSocial: true, cnpj: true, uf: true, cep: true, municipio: true },
    }),
  );
  if (!fornecedor) return { ok: false, motivo: "Fornecedor não encontrado." };
  if (!fornecedor.cnpj) {
    return { ok: false, motivo: "O fornecedor está sem CNPJ — a NF-e precisa do destinatário." };
  }
  if (!fornecedor.cep || !fornecedor.municipio) {
    return {
      ok: false,
      motivo: `Endereço do fornecedor incompleto (${fornecedor.razaoSocial}). Complete o cadastro antes de emitir a devolução.`,
    };
  }

  const produtos = await comTenant(tenantId, (tx) =>
    tx.product.findMany({
      where: { id: { in: dev.items.map((i) => i.productId) } },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        unidadeBase: true,
        fiscalProfile: {
          select: { ncm: true, cest: true, origem: true, cst: true, csosn: true, aliquotaIcms: true },
        },
        subcategory: {
          select: {
            defaultFiscalProfile: {
              select: { ncm: true, cest: true, origem: true, cst: true, csosn: true, aliquotaIcms: true },
            },
          },
        },
      },
    }),
  );
  const porProduto = new Map(produtos.map((p) => [p.id, p]));

  const semNcm = dev.items
    .map((i) => porProduto.get(i.productId))
    .filter((p) => !(p?.fiscalProfile ?? p?.subcategory?.defaultFiscalProfile)?.ncm);
  if (semNcm.length > 0) {
    return {
      ok: false,
      motivo: `Sem classificação fiscal (NCM): ${semNcm
        .slice(0, 3)
        .map((p) => p?.nome ?? "produto")
        .join(", ")}${semNcm.length > 3 ? "…" : ""}.`,
    };
  }

  const cfg = await carregarConfigFiscal(tenantId);
  if (!cfg) return { ok: false, motivo: "Módulo fiscal sem configuração." };

  // Bonificação e brinde não foram compra: devolvê-los como "devolução de
  // compra" declararia um crédito que nunca existiu.
  const motivoEntrada = dev.purchase?.motivo ?? null;
  const houveCompra = motivoEntrada == null || motivoEntrada === "COMPRA_SEM_PEDIDO";
  const cfop = cfopDevolucao(emitente.uf, fornecedor.uf, houveCompra);
  const csosn = usaCsosn(emitente.regime);

  // A chave que veio da entrada. Sem ela a nota sai, mas solta.
  const chaveReferenciada = dev.inbound?.chave ?? dev.purchase?.chaveNfe ?? null;

  const numero = await proximoNumero({
    tenantId,
    siteId: dev.siteId,
    modelo: "NFE",
    serie: serie.serie,
  });

  const valorProdutos = dev.items.reduce(
    (a, i) => a + num(i.quantidade) * num(i.custoUnitario),
    0,
  );

  const referencia = dev.inbound
    ? `Devolucao ref. NF-e ${dev.inbound.numero}/${dev.inbound.serie}`
    : "Devolucao de mercadoria";

  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.create({
      data: {
        tenantId,
        siteId: dev.siteId,
        modelo: "NFE",
        // Devolução de COMPRA é saída: a mercadoria sai da nossa loja. Marcar
        // como ENTRADA (por ser "devolução") inverteria o sentido no extrato.
        direcao: "SAIDA",
        status: "PENDENTE",
        ambiente: cfg.ambiente,
        serie: serie.serie,
        numero,
        idempotencyKey,
        naturezaOperacao: houveCompra
          ? "Devolucao de compra"
          : "Devolucao de mercadoria recebida sem custo",
        chaveReferenciada,
        supplierId: dev.supplierId,
        purchaseId: dev.purchaseId,
        destNome: fornecedor.razaoSocial,
        destDocumento: fornecedor.cnpj,
        valorProdutos,
        valorDesconto: 0,
        valorTotal: valorProdutos,
        createdBy: userId ?? null,
        items: {
          create: dev.items.map((item, idx) => {
            const p = porProduto.get(item.productId);
            const perfil = p?.fiscalProfile ?? p?.subcategory?.defaultFiscalProfile;
            const qtd = num(item.quantidade);
            const unit = num(item.custoUnitario);
            return {
              tenantId,
              ordem: idx + 1,
              productId: item.productId,
              codigo: p?.sku ?? item.productId,
              descricao: p?.nome ?? "Produto",
              gtin: p?.ean ?? null,
              ncm: perfil?.ncm ?? "",
              cest: perfil?.cest ?? null,
              cfop,
              origem: perfil?.origem ?? "0",
              cst: csosn ? null : (perfil?.cst ?? null),
              csosn: csosn ? (perfil?.csosn ?? null) : null,
              unidade: p?.unidadeBase ?? "UN",
              quantidade: qtd,
              // Devolução sai pelo MESMO valor que entrou. Usar o preço de
              // venda daria lucro numa operação que não é venda, e o fornecedor
              // recusaria a nota.
              valorUnitario: unit,
              valorTotal: qtd * unit,
              valorDesconto: 0,
              aliquotaIcms: perfil?.aliquotaIcms ?? null,
            };
          }),
        },
      },
      select: { id: true, numero: true, serie: true },
    }),
  );

  await comTenant(tenantId, (tx) =>
    tx.supplierReturn.update({
      where: { id: dev.id },
      data: {
        fiscalDocumentId: doc.id,
        numeroNota: `${doc.numero}/${doc.serie}`,
        observacao: `${dev.observacao} · ${referencia}`,
      },
    }),
  );

  return { ok: true, documentId: doc.id, jaExistia: false };
}

/**
 * Carimba na devolução a chave que a SEFAZ autorizou. Chamado pelo worker
 * depois da transmissão — antes disso `chaveNfe` seria uma promessa.
 */
export async function registrarChaveDevolucao(tenantId: string, documentId: string): Promise<void> {
  const doc = await comTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: { chave: true, status: true, devolucao: { select: { id: true } } },
    }),
  );
  if (!doc?.devolucao || !doc.chave || doc.status !== "AUTORIZADO") return;

  await comTenant(tenantId, (tx) =>
    tx.supplierReturn.update({
      where: { id: doc.devolucao!.id },
      data: { chaveNfe: doc.chave },
    }),
  );
}

/** Existe série de NF-e nesta loja? A tela usa para não oferecer o que não dá. */
export async function podeEmitirDevolucao(tenantId: string, siteId: string): Promise<boolean> {
  const serie = await comTenant(tenantId, (tx) =>
    tx.fiscalSerie.findFirst({
      where: { siteId, modelo: "NFE", ativa: true },
      select: { serie: true },
    }),
  );
  if (!serie) return false;
  const emitente = await comTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({ where: { siteId }, select: { id: true } }),
  );
  return Boolean(emitente);
}
