-- CreateIndex
CREATE INDEX "Sale_tenantId_status_paidAt_idx" ON "Sale"("tenantId", "status", "paidAt");

-- CreateIndex
CREATE INDEX "SaleItem_tenantId_productId_idx" ON "SaleItem"("tenantId", "productId");
