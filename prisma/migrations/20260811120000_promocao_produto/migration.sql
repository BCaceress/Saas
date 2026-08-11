-- CreateTable
CREATE TABLE "ProductPromotion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "siteId" TEXT,
    "preco" DECIMAL(10,2) NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "nome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ProductPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPromotion_tenantId_idx" ON "ProductPromotion"("tenantId");

-- CreateIndex
CREATE INDEX "ProductPromotion_productId_idx" ON "ProductPromotion"("productId");

-- CreateIndex
CREATE INDEX "ProductPromotion_siteId_idx" ON "ProductPromotion"("siteId");

-- CreateIndex
CREATE INDEX "ProductPromotion_tenantId_ativo_inicio_fim_idx" ON "ProductPromotion"("tenantId", "ativo", "inicio", "fim");

-- AddForeignKey
ALTER TABLE "ProductPromotion" ADD CONSTRAINT "ProductPromotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPromotion" ADD CONSTRAINT "ProductPromotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPromotion" ADD CONSTRAINT "ProductPromotion_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (Camada 2) — mesma política das demais tabelas de negócio, ver
-- prisma/rls-fase4.sql. Tabela nova de tenant não nasce sem isolamento.
ALTER TABLE "ProductPromotion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPromotion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductPromotion";
CREATE POLICY tenant_isolation ON "ProductPromotion"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));
