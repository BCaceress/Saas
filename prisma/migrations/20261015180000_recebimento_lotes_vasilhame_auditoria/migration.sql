-- ============================================================
-- Recebimento: lotes por linha, chegada real, quem contou e vasilhame
--
-- 1. `PurchaseReconciliationItem.lotes` — a mesma linha da nota chega em mais
--    de um lote (cerveja de duas produções, validades diferentes). Um campo
--    `lote` só obrigava a escolher um e mentir no FEFO sobre o resto.
-- 2. `contadoPor` / `contadoEm` — com dois conferentes na mesma carga, "quem
--    contou 20?" precisa de resposta.
-- 3. `GoodsReceipt.chegadaEm` — `iniciadoEm` do recebimento de XML é a
--    EMISSÃO da nota; o XML que chega por e-mail dias antes do caminhão não
--    está "em aberto há N dias" na doca.
-- 4. `SupplierContainerMovement` — vasilhame com a DISTRIBUIDORA (casco de
--    retornável, barril): o espelho do `ContainerMovement` do cliente.
--
-- Tudo aditivo e anulável: o que existe hoje continua igual.
-- ============================================================

-- CreateEnum
CREATE TYPE "SupplierContainerMovementType" AS ENUM ('RECEBIDO', 'DEVOLVIDO', 'AJUSTE');

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "chegadaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseReconciliationItem" ADD COLUMN     "contadoEm" TIMESTAMP(3),
ADD COLUMN     "contadoPor" TEXT,
ADD COLUMN     "lotes" JSONB;

-- CreateTable
CREATE TABLE "SupplierContainerMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "containerTypeId" TEXT NOT NULL,
    "receiptId" TEXT,
    "tipo" "SupplierContainerMovementType" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "observacao" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierContainerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContainerMovement_tenantId_idx" ON "SupplierContainerMovement"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierContainerMovement_tenantId_supplierId_idx" ON "SupplierContainerMovement"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierContainerMovement_containerTypeId_idx" ON "SupplierContainerMovement"("containerTypeId");

-- CreateIndex
CREATE INDEX "SupplierContainerMovement_receiptId_idx" ON "SupplierContainerMovement"("receiptId");

-- AddForeignKey
ALTER TABLE "SupplierContainerMovement" ADD CONSTRAINT "SupplierContainerMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContainerMovement" ADD CONSTRAINT "SupplierContainerMovement_containerTypeId_fkey" FOREIGN KEY ("containerTypeId") REFERENCES "ContainerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContainerMovement" ADD CONSTRAINT "SupplierContainerMovement_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RLS (Camada 2) ─────────────────────────────────────────
ALTER TABLE "SupplierContainerMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierContainerMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierContainerMovement";
CREATE POLICY tenant_isolation ON "SupplierContainerMovement"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

-- Mesma rede das migrations anteriores: tabela de negócio com tenantId e sem
-- policy derruba o deploy, em vez de virar achado de auditoria.
DO $$
DECLARE
  faltantes TEXT;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO faltantes
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name = 'tenantId'
     AND c.table_name NOT IN (
       'Membership', 'MembershipAccess', 'Subscription', 'Invite',
       'QuotationLink', 'PurchaseOrderLink'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.table_name
          AND p.policyname = 'tenant_isolation'
     );

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas com tenantId e sem policy tenant_isolation: %', faltantes;
  END IF;
END $$;
