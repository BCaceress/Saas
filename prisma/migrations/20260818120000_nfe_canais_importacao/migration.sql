-- Canais de importação de NF-e: caixa de e-mail monitorada (IMAP), mensagens
-- já processadas e a trilha de auditoria de tudo que entrou por qualquer porta.

-- CreateEnum
CREATE TYPE "FiscalImportOrigem" AS ENUM ('UPLOAD', 'EMAIL', 'SEFAZ');

-- CreateEnum
CREATE TYPE "FiscalImportStatus" AS ENUM ('IMPORTADA', 'DUPLICADA', 'IGNORADA', 'ERRO');

-- CreateTable
CREATE TABLE "FiscalEmailInbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "porta" INTEGER NOT NULL DEFAULT 993,
    "ssl" BOOLEAN NOT NULL DEFAULT true,
    "usuario" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "pasta" TEXT NOT NULL DEFAULT 'INBOX',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaSincronizacao" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "mensagensLidas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalEmailInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalEmailMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "assunto" TEXT,
    "remetente" TEXT,
    "recebidoEm" TIMESTAMP(3),
    "anexos" INTEGER NOT NULL DEFAULT 0,
    "importados" INTEGER NOT NULL DEFAULT 0,
    "processadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalEmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT,
    "origem" "FiscalImportOrigem" NOT NULL,
    "status" "FiscalImportStatus" NOT NULL,
    "arquivo" TEXT,
    "chave" TEXT,
    "mensagem" TEXT,
    "remetente" TEXT,
    "inboxId" TEXT,
    "inboundId" TEXT,
    "usuarioId" TEXT,
    "processadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalEmailInbox_tenantId_idx" ON "FiscalEmailInbox"("tenantId");
CREATE INDEX "FiscalEmailInbox_siteId_idx" ON "FiscalEmailInbox"("siteId");
CREATE UNIQUE INDEX "FiscalEmailInbox_tenantId_email_pasta_key" ON "FiscalEmailInbox"("tenantId", "email", "pasta");

CREATE INDEX "FiscalEmailMessage_tenantId_idx" ON "FiscalEmailMessage"("tenantId");
CREATE INDEX "FiscalEmailMessage_inboxId_uid_idx" ON "FiscalEmailMessage"("inboxId", "uid");
CREATE UNIQUE INDEX "FiscalEmailMessage_inboxId_messageId_key" ON "FiscalEmailMessage"("inboxId", "messageId");

CREATE INDEX "FiscalImportLog_tenantId_processadoEm_idx" ON "FiscalImportLog"("tenantId", "processadoEm");
CREATE INDEX "FiscalImportLog_tenantId_chave_idx" ON "FiscalImportLog"("tenantId", "chave");
CREATE INDEX "FiscalImportLog_inboxId_idx" ON "FiscalImportLog"("inboxId");

-- AddForeignKey
ALTER TABLE "FiscalEmailInbox" ADD CONSTRAINT "FiscalEmailInbox_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalEmailMessage" ADD CONSTRAINT "FiscalEmailMessage_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "FiscalEmailInbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalImportLog" ADD CONSTRAINT "FiscalImportLog_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "FiscalEmailInbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (Camada 2) — tabela nova de tenant não nasce sem isolamento.
ALTER TABLE "FiscalEmailInbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalEmailInbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalEmailInbox";
CREATE POLICY tenant_isolation ON "FiscalEmailInbox"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

ALTER TABLE "FiscalEmailMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalEmailMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalEmailMessage";
CREATE POLICY tenant_isolation ON "FiscalEmailMessage"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

ALTER TABLE "FiscalImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalImportLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalImportLog";
CREATE POLICY tenant_isolation ON "FiscalImportLog"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

-- Totais da nota e CEST do item: o XML já trazia, faltava guardar. Frete e
-- desconto do cabeçalho fecham a conferência de valor contra o pedido; o CEST
-- alimenta o cadastro fiscal do produto novo.
ALTER TABLE "FiscalInbound"
  ADD COLUMN "valorFrete" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "valorDesconto" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "FiscalInboundItem" ADD COLUMN "cest" TEXT;
