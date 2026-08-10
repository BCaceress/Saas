-- Busca por trecho do nome vira ILIKE '%…%', que nenhum B-tree serve.
-- Trigramas resolvem — e o índice GIN abaixo depende desta extensão.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "ProductView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "nome" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductView_tenantId_idx" ON "ProductView"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductView_tenantId_userId_nome_key" ON "ProductView"("tenantId", "userId", "nome");

-- CreateIndex
CREATE INDEX "Product_tenantId_ativo_nome_idx" ON "Product"("tenantId", "ativo", "nome");

-- CreateIndex
CREATE INDEX "Product_nome_idx" ON "Product" USING GIN ("nome" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Camada 2) — mesma política das demais tabelas de negócio, ver
-- prisma/rls-fase4.sql. Tabela nova de tenant não nasce sem isolamento:
-- runWithTenant/comTenant já definem app.current_tenant em toda query.
ALTER TABLE "ProductView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductView" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductView";
CREATE POLICY tenant_isolation ON "ProductView"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));
