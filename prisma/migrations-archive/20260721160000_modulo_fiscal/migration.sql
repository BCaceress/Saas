-- CreateEnum
CREATE TYPE "FiscalProviderKind" AS ENUM ('NUVEM_FISCAL', 'PLUGNOTAS', 'FOCUS', 'TECNOSPEED', 'SIMULADO');

-- CreateEnum
CREATE TYPE "FiscalAmbiente" AS ENUM ('PRODUCAO', 'HOMOLOGACAO');

-- CreateEnum
CREATE TYPE "FiscalModelo" AS ENUM ('NFCE', 'NFE');

-- CreateEnum
CREATE TYPE "FiscalDirecao" AS ENUM ('SAIDA', 'ENTRADA');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'AUTORIZADO', 'REJEITADO', 'DENEGADO', 'CANCELADO', 'CONTINGENCIA', 'INUTILIZADO');

-- CreateEnum
CREATE TYPE "FiscalEventoTipo" AS ENUM ('EMISSAO', 'CANCELAMENTO', 'CARTA_CORRECAO', 'INUTILIZACAO', 'REJEICAO', 'CONTINGENCIA', 'MANIFESTACAO');

-- CreateEnum
CREATE TYPE "FiscalInboundStatus" AS ENUM ('PENDENTE', 'CONCILIADO', 'RECEBIDO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "ManifestacaoTipo" AS ENUM ('CIENCIA', 'CONFIRMACAO', 'DESCONHECIMENTO', 'NAO_REALIZADA');

-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('SIMPLES_NACIONAL', 'SIMPLES_EXCESSO', 'REGIME_NORMAL');

-- CreateEnum
CREATE TYPE "IndicadorIE" AS ENUM ('CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "codigoMunicipio" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "ie" TEXT,
ADD COLUMN     "indicadorIE" "IndicadorIE",
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "municipio" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "razaoSocial" TEXT,
ADD COLUMN     "uf" TEXT;

-- AlterTable
ALTER TABLE "FiscalProfile" ADD COLUMN     "aliquotaCofins" DECIMAL(5,2),
ADD COLUMN     "aliquotaIpi" DECIMAL(5,2),
ADD COLUMN     "aliquotaPis" DECIMAL(5,2),
ADD COLUMN     "cfopEntrada" TEXT,
ADD COLUMN     "cfopSaida" TEXT,
ADD COLUMN     "codigoBeneficio" TEXT,
ADD COLUMN     "cstIpi" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "codigoAnp" TEXT,
ADD COLUMN     "fatorConversaoTrib" DECIMAL(12,4),
ADD COLUMN     "gtinTributavel" TEXT,
ADD COLUMN     "unidadeTributavel" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "codigoMunicipio" TEXT,
ADD COLUMN     "ie" TEXT,
ADD COLUMN     "indicadorIE" "IndicadorIE";

-- CreateTable
CREATE TABLE "FiscalConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "FiscalProviderKind" NOT NULL DEFAULT 'SIMULADO',
    "ambiente" "FiscalAmbiente" NOT NULL DEFAULT 'HOMOLOGACAO',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "apiToken" TEXT,
    "webhookSecret" TEXT,
    "emissaoAutomaticaNfce" BOOLEAN NOT NULL DEFAULT false,
    "prazoCancelamentoMin" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalEmitente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "ie" TEXT NOT NULL,
    "im" TEXT,
    "cnae" TEXT,
    "regime" "RegimeTributario" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
    "cep" TEXT NOT NULL,
    "logradouro" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "complemento" TEXT,
    "bairro" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,
    "codigoMunicipio" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "telefone" TEXT,
    "certificadoId" TEXT,
    "certificadoTitular" TEXT,
    "certificadoValidade" TIMESTAMP(3),
    "cscId" TEXT,
    "csc" TEXT,
    "naturezaOperacaoPadrao" TEXT NOT NULL DEFAULT 'Venda de mercadoria',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalEmitente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalSerie" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "modelo" "FiscalModelo" NOT NULL,
    "serie" INTEGER NOT NULL,
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalSerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "modelo" "FiscalModelo" NOT NULL,
    "direcao" "FiscalDirecao" NOT NULL DEFAULT 'SAIDA',
    "status" "FiscalStatus" NOT NULL DEFAULT 'PENDENTE',
    "ambiente" "FiscalAmbiente" NOT NULL,
    "serie" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "chave" TEXT,
    "protocolo" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "naturezaOperacao" TEXT NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAutorizacao" TIMESTAMP(3),
    "saleId" TEXT,
    "purchaseId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "destNome" TEXT,
    "destDocumento" TEXT,
    "valorProdutos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorDesconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "codigoRejeicao" TEXT,
    "motivoRejeicao" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "contingencia" BOOLEAN NOT NULL DEFAULT false,
    "xmlUrl" TEXT,
    "pdfUrl" TEXT,
    "qrCodeUrl" TEXT,
    "urlConsulta" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocumentItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "productId" TEXT,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "gtin" TEXT,
    "ncm" TEXT NOT NULL,
    "cest" TEXT,
    "cfop" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT '0',
    "cst" TEXT,
    "csosn" TEXT,
    "unidade" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "valorUnitario" DECIMAL(12,4) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "valorDesconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "baseIcms" DECIMAL(12,2),
    "aliquotaIcms" DECIMAL(5,2),
    "valorIcms" DECIMAL(12,2),
    "valorIcmsSt" DECIMAL(12,2),
    "valorPis" DECIMAL(12,2),
    "valorCofins" DECIMAL(12,2),

    CONSTRAINT "FiscalDocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT,
    "tipo" "FiscalEventoTipo" NOT NULL,
    "sequencia" INTEGER,
    "motivo" TEXT,
    "protocolo" TEXT,
    "codigo" TEXT,
    "mensagem" TEXT,
    "serie" INTEGER,
    "numeroInicial" INTEGER,
    "numeroFinal" INTEGER,
    "payload" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalInbound" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "FiscalInboundStatus" NOT NULL DEFAULT 'PENDENTE',
    "chave" TEXT NOT NULL,
    "modelo" TEXT NOT NULL DEFAULT '55',
    "numero" INTEGER NOT NULL,
    "serie" INTEGER NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "emitCnpj" TEXT NOT NULL,
    "emitRazaoSocial" TEXT NOT NULL,
    "emitUf" TEXT,
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "purchaseId" TEXT,
    "manifestacao" "ManifestacaoTipo",
    "manifestadoEm" TIMESTAMP(3),
    "xmlUrl" TEXT,
    "observacao" TEXT,
    "importadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalInbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalInboundItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "gtin" TEXT,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT,
    "cfop" TEXT,
    "unidade" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "valorUnitario" DECIMAL(12,4) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "valorDesconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorIcmsSt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorIpi" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorFrete" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "productId" TEXT,
    "packagingId" TEXT,
    "fatorConversao" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "bonificacao" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FiscalInboundItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItemMap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "gtin" TEXT,
    "productId" TEXT NOT NULL,
    "packagingId" TEXT,
    "fatorConversao" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierItemMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalConfig_tenantId_key" ON "FiscalConfig"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalConfig_tenantId_idx" ON "FiscalConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalEmitente_siteId_key" ON "FiscalEmitente"("siteId");

-- CreateIndex
CREATE INDEX "FiscalEmitente_tenantId_idx" ON "FiscalEmitente"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalEmitente_tenantId_cnpj_key" ON "FiscalEmitente"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "FiscalSerie_tenantId_idx" ON "FiscalSerie"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalSerie_siteId_modelo_serie_key" ON "FiscalSerie"("siteId", "modelo", "serie");

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_idx" ON "FiscalDocument"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_status_idx" ON "FiscalDocument"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FiscalDocument_siteId_dataEmissao_idx" ON "FiscalDocument"("siteId", "dataEmissao");

-- CreateIndex
CREATE INDEX "FiscalDocument_saleId_idx" ON "FiscalDocument"("saleId");

-- CreateIndex
CREATE INDEX "FiscalDocument_customerId_idx" ON "FiscalDocument"("customerId");

-- CreateIndex
CREATE INDEX "FiscalDocument_supplierId_idx" ON "FiscalDocument"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_idempotencyKey_key" ON "FiscalDocument"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_chave_key" ON "FiscalDocument"("tenantId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_siteId_modelo_serie_numero_key" ON "FiscalDocument"("siteId", "modelo", "serie", "numero");

-- CreateIndex
CREATE INDEX "FiscalDocumentItem_tenantId_idx" ON "FiscalDocumentItem"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalDocumentItem_documentId_idx" ON "FiscalDocumentItem"("documentId");

-- CreateIndex
CREATE INDEX "FiscalDocumentItem_productId_idx" ON "FiscalDocumentItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocumentItem_documentId_ordem_key" ON "FiscalDocumentItem"("documentId", "ordem");

-- CreateIndex
CREATE INDEX "FiscalEvent_tenantId_idx" ON "FiscalEvent"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalEvent_tenantId_createdAt_idx" ON "FiscalEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalEvent_documentId_idx" ON "FiscalEvent"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalInbound_purchaseId_key" ON "FiscalInbound"("purchaseId");

-- CreateIndex
CREATE INDEX "FiscalInbound_tenantId_idx" ON "FiscalInbound"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalInbound_tenantId_status_idx" ON "FiscalInbound"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FiscalInbound_siteId_idx" ON "FiscalInbound"("siteId");

-- CreateIndex
CREATE INDEX "FiscalInbound_supplierId_idx" ON "FiscalInbound"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalInbound_tenantId_chave_key" ON "FiscalInbound"("tenantId", "chave");

-- CreateIndex
CREATE INDEX "FiscalInboundItem_tenantId_idx" ON "FiscalInboundItem"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalInboundItem_inboundId_idx" ON "FiscalInboundItem"("inboundId");

-- CreateIndex
CREATE INDEX "FiscalInboundItem_productId_idx" ON "FiscalInboundItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalInboundItem_inboundId_ordem_key" ON "FiscalInboundItem"("inboundId", "ordem");

-- CreateIndex
CREATE INDEX "SupplierItemMap_tenantId_idx" ON "SupplierItemMap"("tenantId");

-- CreateIndex
CREATE INDEX "SupplierItemMap_productId_idx" ON "SupplierItemMap"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItemMap_supplierId_codigoFornecedor_key" ON "SupplierItemMap"("supplierId", "codigoFornecedor");

-- AddForeignKey
ALTER TABLE "FiscalConfig" ADD CONSTRAINT "FiscalConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalEmitente" ADD CONSTRAINT "FiscalEmitente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalEmitente" ADD CONSTRAINT "FiscalEmitente_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalSerie" ADD CONSTRAINT "FiscalSerie_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocumentItem" ADD CONSTRAINT "FiscalDocumentItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalEvent" ADD CONSTRAINT "FiscalEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalInbound" ADD CONSTRAINT "FiscalInbound_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalInbound" ADD CONSTRAINT "FiscalInbound_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalInbound" ADD CONSTRAINT "FiscalInbound_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalInbound" ADD CONSTRAINT "FiscalInbound_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalInboundItem" ADD CONSTRAINT "FiscalInboundItem_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItemMap" ADD CONSTRAINT "SupplierItemMap_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — mesma policy das demais tabelas de negócio (ver
-- 20260622200000_rls_tenant_isolation). Tabela fiscal nova sem policy seria um
-- buraco de isolamento: documento fiscal carrega CNPJ, endereço e valores.
DO $$
DECLARE
  t TEXT;
  fiscal_tables TEXT[] := ARRAY[
    'FiscalConfig',
    'FiscalEmitente',
    'FiscalSerie',
    'FiscalDocument',
    'FiscalDocumentItem',
    'FiscalEvent',
    'FiscalInbound',
    'FiscalInboundItem',
    'SupplierItemMap'
  ];
BEGIN
  FOREACH t IN ARRAY fiscal_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) '
      'WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;

-- Numeração atômica. O número da nota NUNCA sai de max(numero)+1: duas vendas
-- simultâneas pegariam o mesmo e a segunda seria rejeitada pela SEFAZ como
-- duplicidade. UPDATE ... RETURNING serializa no lock da linha do contador.
CREATE OR REPLACE FUNCTION fiscal_proximo_numero(
  p_tenant TEXT,
  p_site   TEXT,
  p_modelo "FiscalModelo",
  p_serie  INT
) RETURNS INT AS $$
DECLARE
  n INT;
BEGIN
  UPDATE "FiscalSerie"
     SET "proximoNumero" = "proximoNumero" + 1,
         "updatedAt" = NOW()
   WHERE "tenantId" = p_tenant
     AND "siteId" = p_site
     AND "modelo" = p_modelo
     AND "serie" = p_serie
     AND "ativa" = TRUE
  RETURNING "proximoNumero" - 1 INTO n;

  IF n IS NULL THEN
    RAISE EXCEPTION 'Serie fiscal inexistente ou inativa (site %, modelo %, serie %)',
      p_site, p_modelo, p_serie;
  END IF;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
