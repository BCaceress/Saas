-- Melhorias do recebimento por NF-e: OAuth na caixa de e-mail, trava e backoff
-- da varredura, manifestação automática, duplicatas da nota e conferência cega.

-- CreateEnum
CREATE TYPE "FiscalEmailAuth" AS ENUM ('SENHA', 'OAUTH2_GOOGLE', 'OAUTH2_MICROSOFT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "conferenciaCega" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FiscalConfig" ADD COLUMN "manifestacaoAutomatica" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FiscalEmailInbox"
  ALTER COLUMN "senha" SET DEFAULT '',
  ADD COLUMN "autenticacao" "FiscalEmailAuth" NOT NULL DEFAULT 'SENHA',
  ADD COLUMN "oauthClientId" TEXT,
  ADD COLUMN "oauthClientSecret" TEXT,
  ADD COLUMN "oauthRefreshToken" TEXT,
  ADD COLUMN "oauthTenantId" TEXT,
  ADD COLUMN "sincronizandoEm" TIMESTAMP(3),
  ADD COLUMN "falhasSeguidas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "proximaTentativa" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FiscalInboundDuplicata" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "FiscalInboundDuplicata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalInboundDuplicata_tenantId_idx" ON "FiscalInboundDuplicata"("tenantId");
CREATE INDEX "FiscalInboundDuplicata_tenantId_vencimento_idx" ON "FiscalInboundDuplicata"("tenantId", "vencimento");
CREATE UNIQUE INDEX "FiscalInboundDuplicata_inboundId_numero_key" ON "FiscalInboundDuplicata"("inboundId", "numero");

-- AddForeignKey
ALTER TABLE "FiscalInboundDuplicata" ADD CONSTRAINT "FiscalInboundDuplicata_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Camada 2)
ALTER TABLE "FiscalInboundDuplicata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalInboundDuplicata" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalInboundDuplicata";
CREATE POLICY tenant_isolation ON "FiscalInboundDuplicata"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));
