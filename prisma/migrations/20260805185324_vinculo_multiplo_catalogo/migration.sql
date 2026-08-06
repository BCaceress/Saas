-- CreateTable
CREATE TABLE "SupplierCatalogItemProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCatalogItemProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCatalogItemProduct_tenantId_idx" ON "SupplierCatalogItemProduct"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierCatalogItemProduct_productId_idx" ON "SupplierCatalogItemProduct"("productId");

-- CreateIndex
CREATE INDEX "SupplierCatalogItemProduct_catalogItemId_idx" ON "SupplierCatalogItemProduct"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCatalogItemProduct_catalogItemId_productId_key" ON "SupplierCatalogItemProduct"("catalogItemId", "productId");

-- AddForeignKey
ALTER TABLE "SupplierCatalogItemProduct" ADD CONSTRAINT "SupplierCatalogItemProduct_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCatalogItemProduct" ADD CONSTRAINT "SupplierCatalogItemProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
