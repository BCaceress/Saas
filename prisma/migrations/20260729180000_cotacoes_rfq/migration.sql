-- ============================================================
-- Cotações (RFQ) — pedir preço a vários fornecedores e comparar
--
-- Quotation (a pergunta) × QuotationItem (o que se quer) ×
-- QuotationSupplier (a quem foi perguntado) × QuotationResponse (o preço
-- que voltou). Tabelas novas nascem com RLS ligada (Camada 2).
-- ============================================================

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('RASCUNHO', 'ABERTA', 'ENCERRADA', 'DECIDIDA', 'CANCELADA');
CREATE TYPE "QuotationSupplierStatus" AS ENUM ('PENDENTE', 'ENVIADA', 'RESPONDIDA', 'RECUSADA');

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'RASCUNHO',
    "prazoResposta" TIMESTAMP(3),
    "observacao" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "decididaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT,
    "packagingId" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationSupplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "QuotationSupplierStatus" NOT NULL DEFAULT 'PENDENTE',
    "enviadaEm" TIMESTAMP(3),
    "respondidaEm" TIMESTAMP(3),
    "prazoEntregaDias" INTEGER,
    "condicaoPagamento" TEXT,
    "frete" DECIMAL(12,2),
    "observacao" TEXT,
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationSupplierId" TEXT NOT NULL,
    "quotationItemId" TEXT NOT NULL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "precoUnitario" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "quantidadeOfertada" DECIMAL(12,3),
    "marca" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_tenantId_numero_key" ON "Quotation"("tenantId", "numero");
CREATE INDEX "Quotation_tenantId_idx" ON "Quotation"("tenantId");
CREATE INDEX "Quotation_tenantId_status_idx" ON "Quotation"("tenantId", "status");
CREATE INDEX "Quotation_siteId_idx" ON "Quotation"("siteId");

CREATE INDEX "QuotationItem_tenantId_idx" ON "QuotationItem"("tenantId");
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");
CREATE INDEX "QuotationItem_productId_idx" ON "QuotationItem"("productId");

CREATE UNIQUE INDEX "QuotationSupplier_quotationId_supplierId_key" ON "QuotationSupplier"("quotationId", "supplierId");
CREATE INDEX "QuotationSupplier_tenantId_idx" ON "QuotationSupplier"("tenantId");
CREATE INDEX "QuotationSupplier_supplierId_idx" ON "QuotationSupplier"("supplierId");

CREATE UNIQUE INDEX "QuotationResponse_quotationSupplierId_quotationItemId_key" ON "QuotationResponse"("quotationSupplierId", "quotationItemId");
CREATE INDEX "QuotationResponse_tenantId_idx" ON "QuotationResponse"("tenantId");
CREATE INDEX "QuotationResponse_quotationItemId_idx" ON "QuotationResponse"("quotationItemId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationSupplier" ADD CONSTRAINT "QuotationSupplier_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationSupplier" ADD CONSTRAINT "QuotationSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationResponse" ADD CONSTRAINT "QuotationResponse_quotationSupplierId_fkey" FOREIGN KEY ("quotationSupplierId") REFERENCES "QuotationSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationResponse" ADD CONSTRAINT "QuotationResponse_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "QuotationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Quotation', 'QuotationItem', 'QuotationSupplier', 'QuotationResponse'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;

-- Rede de proteção: tabela de negócio com tenantId e sem policy derruba o deploy.
DO $$
DECLARE
  faltantes TEXT;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO faltantes
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name = 'tenantId'
     AND c.table_name NOT IN ('Membership', 'MembershipAccess', 'Subscription', 'Invite')
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
