-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "numero" TEXT;

-- CreateIndex
CREATE INDEX "Purchase_tenantId_numero_idx" ON "Purchase"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_data_idx" ON "Purchase"("tenantId", "data");
