-- Fase 7 (Analytics) — StockSnapshot: foto diária de saldo/valor por (produto × site).
-- Tabela de negócio de alto volume com tenantId escalar (alinhada a StockMovement).
-- Camada 1 (extension lib/prisma.ts) injeta tenantId; segue o padrão das tabelas
-- das Fases 3-4, que também não entram na lista de RLS forçado.

CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "saldoFechado" DECIMAL(12,3) NOT NULL,
    "saldoAberto" DECIMAL(12,3) NOT NULL,
    "custoMedio" DECIMAL(10,2),
    "valorEstoque" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockSnapshot_siteId_productId_data_key" ON "StockSnapshot"("siteId", "productId", "data");
CREATE INDEX "StockSnapshot_tenantId_idx" ON "StockSnapshot"("tenantId");
CREATE INDEX "StockSnapshot_siteId_data_idx" ON "StockSnapshot"("siteId", "data");
CREATE INDEX "StockSnapshot_data_idx" ON "StockSnapshot"("data");
