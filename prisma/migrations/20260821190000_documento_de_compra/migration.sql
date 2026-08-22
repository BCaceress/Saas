-- Documento de Compra — a espinha única de tudo que entra na loja.
--
-- Antes havia cinco portas de entrada que não conversavam: cotação→pedido,
-- pedido direto, XML no recebimento, NF-e capturada no DFe, e lançamento
-- manual no estoque. As três últimas não deixavam rastro de pedido, então
-- "de onde veio esta mercadoria?" ficava sem resposta — e a mesma nota podia
-- entrar duas vezes (uma à mão, outra pelo XML que chegava depois).
--
-- Esta migration fecha os buracos:
--   1. Purchase ganha `aguardandoDocumento`/`chaveNfe` — o lançamento manual
--      fica esperando o XML em vez de duplicar estoque.
--   2. PurchaseOrder ganha origem, cotação-mãe e resolução de saldo — pedido
--      parcial deixa de ficar em aberto para sempre.
--   3. AccountPayable nasce das duplicatas da NF-e: entrada de mercadoria
--      passa a gerar contas a pagar.
--   4. SupplierReturn dá corpo à devolução ao fornecedor (a tela existia sem
--      documento por trás).
--   5. FiscalInbound ganha SEM_ESTOQUE/VINCULADO — CT-e e nota de serviço
--      param de virar entrada de mercadoria.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "SaldoPedidoResolucao" AS ENUM ('PENDENTE', 'ENCERRADO', 'REPEDIDO');
CREATE TYPE "PurchaseOrderOrigem" AS ENUM ('MANUAL', 'COTACAO', 'REPOSICAO', 'CARRINHO', 'XML', 'DFE', 'ENTRADA_MANUAL');
CREATE TYPE "AccountPayableStatus" AS ENUM ('ABERTO', 'PAGO', 'CANCELADO');
CREATE TYPE "SupplierReturnStatus" AS ENUM ('RASCUNHO', 'CONFIRMADA', 'CANCELADA');
CREATE TYPE "SupplierReturnMotivo" AS ENUM ('AVARIA', 'VALIDADE', 'DIVERGENCIA', 'RECUSA', 'ACORDO_COMERCIAL', 'OUTRO');

ALTER TYPE "FiscalInboundStatus" ADD VALUE IF NOT EXISTS 'SEM_ESTOQUE';
ALTER TYPE "FiscalInboundStatus" ADD VALUE IF NOT EXISTS 'VINCULADO';

ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'SALDO_ENCERRADO';
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'SALDO_REPEDIDO';
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'TITULOS_GERADOS';
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'DEVOLUCAO_REGISTRADA';
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'DOCUMENTO_VINCULADO';

-- ============================================================
-- 2. Purchase — entrada que ainda espera documento fiscal
-- ============================================================
ALTER TABLE "Purchase"
  ADD COLUMN "aguardandoDocumento" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "chaveNfe" TEXT,
  ADD COLUMN "documentoVinculadoEm" TIMESTAMP(3);

CREATE INDEX "Purchase_tenantId_aguardandoDocumento_idx" ON "Purchase"("tenantId", "aguardandoDocumento");
CREATE INDEX "Purchase_chaveNfe_idx" ON "Purchase"("chaveNfe");

-- ============================================================
-- 3. PurchaseOrder — origem, cotação-mãe, saldo do parcial
-- ============================================================
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "origem" "PurchaseOrderOrigem" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "quotationId" TEXT,
  ADD COLUMN "origemPedidoId" TEXT,
  ADD COLUMN "saldoResolucao" "SaldoPedidoResolucao" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "saldoResolvidoEm" TIMESTAMP(3),
  ADD COLUMN "saldoMotivo" TEXT;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_origemPedidoId_fkey"
  FOREIGN KEY ("origemPedidoId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PurchaseOrder_quotationId_idx" ON "PurchaseOrder"("quotationId");
CREATE INDEX "PurchaseOrder_origemPedidoId_idx" ON "PurchaseOrder"("origemPedidoId");
CREATE INDEX "PurchaseOrder_tenantId_status_saldoResolucao_idx" ON "PurchaseOrder"("tenantId", "status", "saldoResolucao");

-- Backfill da cotação-mãe: o vínculo já existia em QuotationSupplier, mas só
-- na direção cotação→pedido. Sem isto, pedido antigo não sabe de onde veio.
UPDATE "PurchaseOrder" po
   SET "quotationId" = qs."quotationId",
       "origem" = 'COTACAO'
  FROM "QuotationSupplier" qs
 WHERE qs."purchaseOrderId" = po."id"
   AND qs."tenantId" = po."tenantId";

-- ============================================================
-- 4. FiscalInbound — motivo de não ter virado estoque
-- ============================================================
ALTER TABLE "FiscalInbound" ADD COLUMN "semEstoqueMotivo" TEXT;

-- ============================================================
-- 5. AccountPayable — títulos a pagar
-- ============================================================
CREATE TABLE "AccountPayable" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT,
  "purchaseId" TEXT,
  "purchaseOrderId" TEXT,
  "inboundId" TEXT,
  "numeroDocumento" TEXT,
  "parcela" TEXT,
  "descricao" TEXT NOT NULL,
  "vencimento" TIMESTAMP(3) NOT NULL,
  "valor" DECIMAL(12,2) NOT NULL,
  "valorPago" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "AccountPayableStatus" NOT NULL DEFAULT 'ABERTO',
  "pagoEm" TIMESTAMP(3),
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  CONSTRAINT "AccountPayable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountPayable_tenantId_idx" ON "AccountPayable"("tenantId");
CREATE INDEX "AccountPayable_tenantId_status_vencimento_idx" ON "AccountPayable"("tenantId", "status", "vencimento");
CREATE INDEX "AccountPayable_supplierId_idx" ON "AccountPayable"("supplierId");
CREATE INDEX "AccountPayable_purchaseId_idx" ON "AccountPayable"("purchaseId");
CREATE INDEX "AccountPayable_purchaseOrderId_idx" ON "AccountPayable"("purchaseOrderId");
CREATE INDEX "AccountPayable_inboundId_idx" ON "AccountPayable"("inboundId");

ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 6. SupplierReturn — devolução ao fornecedor
-- ============================================================
CREATE TABLE "SupplierReturn" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "numero" TEXT NOT NULL,
  "status" "SupplierReturnStatus" NOT NULL DEFAULT 'RASCUNHO',
  "motivo" "SupplierReturnMotivo" NOT NULL DEFAULT 'OUTRO',
  "purchaseId" TEXT,
  "purchaseOrderId" TEXT,
  "inboundId" TEXT,
  "numeroNota" TEXT,
  "chaveNfe" TEXT,
  "observacao" TEXT NOT NULL,
  "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "confirmadaEm" TIMESTAMP(3),
  "canceladaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierReturn_tenantId_numero_key" ON "SupplierReturn"("tenantId", "numero");
CREATE INDEX "SupplierReturn_tenantId_idx" ON "SupplierReturn"("tenantId");
CREATE INDEX "SupplierReturn_tenantId_status_idx" ON "SupplierReturn"("tenantId", "status");
CREATE INDEX "SupplierReturn_siteId_idx" ON "SupplierReturn"("siteId");
CREATE INDEX "SupplierReturn_supplierId_idx" ON "SupplierReturn"("supplierId");
CREATE INDEX "SupplierReturn_purchaseId_idx" ON "SupplierReturn"("purchaseId");

ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupplierReturnItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantidade" DECIMAL(12,3) NOT NULL,
  "custoUnitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "observacao" TEXT,
  CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierReturnItem_tenantId_idx" ON "SupplierReturnItem"("tenantId");
CREATE INDEX "SupplierReturnItem_returnId_idx" ON "SupplierReturnItem"("returnId");
CREATE INDEX "SupplierReturnItem_productId_idx" ON "SupplierReturnItem"("productId");

ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SupplierReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 7. RLS — Camada 2. Toda tabela de negócio nova entra isolada por tenant.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['AccountPayable', 'SupplierReturn', 'SupplierReturnItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
