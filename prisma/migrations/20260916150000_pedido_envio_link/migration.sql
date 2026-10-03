-- Envio real do pedido + link público de confirmação (/pedido/<token>).
--
-- PurchaseOrderLink é tabela de CONTROLE (igual QuotationLink): o token é quem
-- revela o tenant, por isso é lida por basePrisma e fica SEM RLS de propósito.

-- AlterEnum
ALTER TYPE "PurchaseEventType" ADD VALUE 'PEDIDO_CONTESTADO';

-- CreateTable
CREATE TABLE "PurchaseOrderLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "abertoEm" TIMESTAMP(3),
    "confirmadoEm" TIMESTAMP(3),
    "contestadoEm" TIMESTAMP(3),
    "contestacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLink_purchaseOrderId_key" ON "PurchaseOrderLink"("purchaseOrderId");
CREATE UNIQUE INDEX "PurchaseOrderLink_token_key" ON "PurchaseOrderLink"("token");
CREATE INDEX "PurchaseOrderLink_tenantId_idx" ON "PurchaseOrderLink"("tenantId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderLink" ADD CONSTRAINT "PurchaseOrderLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLink" ADD CONSTRAINT "PurchaseOrderLink_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
