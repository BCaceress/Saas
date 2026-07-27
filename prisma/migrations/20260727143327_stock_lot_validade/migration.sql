-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "lotId" TEXT;

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lote" TEXT,
    "validade" TIMESTAMP(3),
    "quantidade" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "custoUnitario" DECIMAL(10,2),
    "purchaseId" TEXT,
    "esgotadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLot_tenantId_idx" ON "StockLot"("tenantId");

-- CreateIndex
CREATE INDEX "StockLot_siteId_idx" ON "StockLot"("siteId");

-- CreateIndex
CREATE INDEX "StockLot_productId_idx" ON "StockLot"("productId");

-- CreateIndex
CREATE INDEX "StockLot_tenantId_siteId_productId_idx" ON "StockLot"("tenantId", "siteId", "productId");

-- CreateIndex
CREATE INDEX "StockLot_validade_idx" ON "StockLot"("validade");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
