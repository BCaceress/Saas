-- Recebimento inteligente: conciliação pedido × XML da NF-e × conferência física.

-- AlterEnum: pedido que já tem XML conciliado e está sendo conferido na porta.
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'CONFERENCIA' BEFORE 'RECEBIDO_PARCIAL';

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OK', 'FALTANDO', 'EXCEDENTE', 'NAO_FATURADO', 'NAO_PEDIDO', 'PRECO_ALTERADO');

-- CreateEnum
CREATE TYPE "ReconciliationResolucao" AS ENUM ('ACEITO', 'IGNORADO', 'AJUSTADO');

-- CreateEnum
CREATE TYPE "PurchaseEventType" AS ENUM ('PEDIDO_CRIADO', 'PEDIDO_ENVIADO', 'PEDIDO_CONFIRMADO', 'PEDIDO_EM_TRANSITO', 'XML_RECEBIDO', 'CONCILIACAO_CONCLUIDA', 'VINCULO_ALTERADO', 'DIVERGENCIA_RESOLVIDA', 'CUSTO_ACEITO', 'CONFERENCIA_CONCLUIDA', 'ESTOQUE_ATUALIZADO', 'PEDIDO_CANCELADO');

-- AlterTable
ALTER TABLE "FiscalInbound"
  ADD COLUMN "vinculoAutomatico" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scoreVinculo" INTEGER,
  ADD COLUMN "conciliadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FiscalInboundItem"
  ADD COLUMN "pedidoFornecedor" TEXT,
  ADD COLUMN "itemPedidoNumero" INTEGER;

-- CreateTable
CREATE TABLE "FiscalInboundXml" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalInboundXml_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalInboundXml_inboundId_key" ON "FiscalInboundXml"("inboundId");

-- CreateIndex
CREATE INDEX "FiscalInboundXml_tenantId_idx" ON "FiscalInboundXml"("tenantId");

-- CreateTable
CREATE TABLE "PurchaseReconciliationItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "inboundItemId" TEXT,
    "productId" TEXT,
    "codigoFornecedor" TEXT,
    "ean" TEXT,
    "descricao" TEXT NOT NULL,
    "qtdPedida" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qtdFaturada" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qtdRecebida" DECIMAL(12,3),
    "custoPedido" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "custoFaturado" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "bonificacao" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReconciliationStatus" NOT NULL,
    "resolucao" "ReconciliationResolucao",
    "motivoDivergencia" TEXT,
    "lote" TEXT,
    "validade" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReconciliationItem_tenantId_idx" ON "PurchaseReconciliationItem"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseReconciliationItem_inboundId_idx" ON "PurchaseReconciliationItem"("inboundId");

-- CreateIndex
CREATE INDEX "PurchaseReconciliationItem_purchaseOrderId_idx" ON "PurchaseReconciliationItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseReconciliationItem_productId_idx" ON "PurchaseReconciliationItem"("productId");

-- CreateTable
CREATE TABLE "PurchaseEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "inboundId" TEXT,
    "tipo" "PurchaseEventType" NOT NULL,
    "descricao" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PurchaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseEvent_tenantId_idx" ON "PurchaseEvent"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseEvent_purchaseOrderId_createdAt_idx" ON "PurchaseEvent"("purchaseOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "FiscalInboundXml" ADD CONSTRAINT "FiscalInboundXml_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_inboundItemId_fkey" FOREIGN KEY ("inboundItemId") REFERENCES "FiscalInboundItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (Camada 2) — mesma política das demais tabelas de negócio, ver
-- prisma/rls-fase4.sql. Tabela nova de tenant não nasce sem isolamento.
ALTER TABLE "FiscalInboundXml" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalInboundXml" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalInboundXml";
CREATE POLICY tenant_isolation ON "FiscalInboundXml"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

ALTER TABLE "PurchaseReconciliationItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseReconciliationItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseReconciliationItem";
CREATE POLICY tenant_isolation ON "PurchaseReconciliationItem"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

ALTER TABLE "PurchaseEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseEvent";
CREATE POLICY tenant_isolation ON "PurchaseEvent"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));
