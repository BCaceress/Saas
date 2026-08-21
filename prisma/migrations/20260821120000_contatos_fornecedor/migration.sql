-- Contatos de cotação por fornecedor.
--
-- O fornecedor continua sendo a EMPRESA; quem recebe a cotação passa a ser uma
-- PESSOA (vendedor, representante, comercial). O telefone/e-mail da empresa
-- continua no cadastro e vira o contato principal no backfill — nenhuma
-- cotação existente perde destinatário.

-- CreateEnum
CREATE TYPE "QuotationCanal" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "observacao" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContact_tenantId_idx" ON "SupplierContact"("tenantId");
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");
CREATE INDEX "SupplierContact_supplierId_principal_idx" ON "SupplierContact"("supplierId", "principal");

-- CreateTable
CREATE TABLE "QuotationSend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationSupplierId" TEXT NOT NULL,
    "contactId" TEXT,
    "canal" "QuotationCanal" NOT NULL,
    "contatoNome" TEXT,
    "destino" TEXT,
    "reenvio" BOOLEAN NOT NULL DEFAULT false,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoPor" TEXT,

    CONSTRAINT "QuotationSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationSend_tenantId_idx" ON "QuotationSend"("tenantId");
CREATE INDEX "QuotationSend_quotationSupplierId_enviadoEm_idx" ON "QuotationSend"("quotationSupplierId", "enviadoEm");

-- AlterTable
ALTER TABLE "QuotationSupplier" ADD COLUMN "contactId" TEXT;

-- CreateIndex
CREATE INDEX "QuotationSupplier_contactId_idx" ON "QuotationSupplier"("contactId");

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationSupplier" ADD CONSTRAINT "QuotationSupplier_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SupplierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuotationSend" ADD CONSTRAINT "QuotationSend_quotationSupplierId_fkey" FOREIGN KEY ("quotationSupplierId") REFERENCES "QuotationSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotationSend" ADD CONSTRAINT "QuotationSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SupplierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: quem já tinha telefone ou e-mail no cadastro ganha o contato
-- principal com esses dados. Sem isso, toda cotação existente ficaria sem
-- destinatário no dia seguinte ao deploy.
INSERT INTO "SupplierContact" ("id", "tenantId", "supplierId", "nome", "telefone", "email", "principal", "ativo", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  s."tenantId",
  s."id",
  COALESCE(NULLIF(TRIM(s."nomeContatoPrincipal"), ''), NULLIF(TRIM(s."nomeFantasia"), ''), s."razaoSocial"),
  s."telefone",
  s."email",
  true,
  true,
  NOW(),
  NOW()
FROM "Supplier" s
WHERE NULLIF(TRIM(COALESCE(s."telefone", '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(s."email", '')), '') IS NOT NULL;

-- Convites já existentes apontam para o contato recém-criado, para o histórico
-- continuar fazendo sentido depois da mudança.
UPDATE "QuotationSupplier" qs
SET "contactId" = c."id"
FROM "SupplierContact" c
WHERE c."supplierId" = qs."supplierId"
  AND c."principal" = true
  AND qs."contactId" IS NULL;

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio. Vem DEPOIS do
-- backfill de propósito: com FORCE, nem o dono da tabela escapa da policy, e o
-- INSERT acima roda sem app.current_tenant definido.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['SupplierContact', 'QuotationSend'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
