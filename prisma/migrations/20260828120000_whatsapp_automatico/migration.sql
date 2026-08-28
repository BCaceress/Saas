-- CreateEnum
CREATE TYPE "WhatsAppProviderKind" AS ENUM ('META_CLOUD', 'SIMULADO');

-- CreateEnum
CREATE TYPE "QuotationSendStatus" AS ENUM ('ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU');

-- AlterTable
ALTER TABLE "QuotationSend" ADD COLUMN     "automatico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "status" "QuotationSendStatus",
ADD COLUMN     "statusEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "WhatsAppProviderKind" NOT NULL DEFAULT 'META_CLOUD',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "numeroExibicao" TEXT,
    "accessToken" TEXT NOT NULL,
    "appSecret" TEXT,
    "templateNome" TEXT NOT NULL DEFAULT 'cotacao_fornecedor',
    "templateIdioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConfig_tenantId_key" ON "WhatsAppConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConfig_phoneNumberId_key" ON "WhatsAppConfig"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppConfig_tenantId_idx" ON "WhatsAppConfig"("tenantId");

-- CreateIndex
CREATE INDEX "QuotationSend_externalId_idx" ON "QuotationSend"("externalId");

-- AddForeignKey
ALTER TABLE "WhatsAppConfig" ADD CONSTRAINT "WhatsAppConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- RLS: a configuração do WhatsApp guarda credencial de um tenant só.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppConfig'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
