-- ============================================================
-- Compras com Fornecedores — catálogo, oferta, importação e comparação
--
-- Tabelas novas nascem com RLS ligada (Camada 2). O DO $$ do final é a mesma
-- rede da migration 20260721180000: tabela de negócio com tenantId e sem
-- policy derruba o deploy em vez de virar achado de auditoria.
-- ============================================================

-- CreateEnum
CREATE TYPE "SupplierIntegrationKind" AS ENUM ('API', 'PLANILHA', 'CSV', 'PDF', 'IMAGEM', 'XML', 'JSON', 'MANUAL');
CREATE TYPE "SupplierIntegrationStatus" AS ENUM ('NAO_CONFIGURADA', 'ONLINE', 'OFFLINE', 'ERRO');
CREATE TYPE "SupplierImportStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU');
CREATE TYPE "SupplierMatchStatus" AS ENUM ('VINCULADO', 'PENDENTE', 'IGNORADO');
CREATE TYPE "SupplierMatchOrigem" AS ENUM ('EAN', 'CODIGO_FORNECEDOR', 'SKU', 'NOME', 'MANUAL');

-- AlterTable
ALTER TABLE "Supplier"
  ADD COLUMN "possuiIntegracao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tipoIntegracao" "SupplierIntegrationKind",
  ADD COLUMN "situacaoIntegracao" "SupplierIntegrationStatus" NOT NULL DEFAULT 'NAO_CONFIGURADA',
  ADD COLUMN "ultimaSincronizacao" TIMESTAMP(3),
  ADD COLUMN "aceitaImportacaoManual" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aceitaImportacaoAutomatica" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SupplierIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierIntegrationKind" NOT NULL DEFAULT 'MANUAL',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "endpoint" TEXT,
    "authTipo" TEXT,
    "credencial" TEXT,
    "headers" JSONB,
    "mapeamento" JSONB,
    "frequenciaHoras" INTEGER,
    "proximaSync" TIMESTAMP(3),
    "ultimaSync" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "status" "SupplierIntegrationStatus" NOT NULL DEFAULT 'NAO_CONFIGURADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT 'Tabela geral',
    "referencia" TEXT NOT NULL DEFAULT 'padrao',
    "origem" "SupplierIntegrationKind" NOT NULL DEFAULT 'MANUAL',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "totalItens" INTEGER NOT NULL DEFAULT 0,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierCatalogItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "codigoFornecedor" TEXT,
    "ean" TEXT,
    "descricao" TEXT NOT NULL,
    "marca" TEXT,
    "categoria" TEXT,
    "imagemUrl" TEXT,
    "unidade" TEXT,
    "fatorConversao" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "preco" DECIMAL(12,4) NOT NULL,
    "precoPromocional" DECIMAL(12,4),
    "emPromocao" BOOLEAN NOT NULL DEFAULT false,
    "quantidadeMinima" DECIMAL(12,3),
    "estoqueDisponivel" DECIMAL(12,3),
    "validadeOferta" TIMESTAMP(3),
    "productId" TEXT,
    "matchStatus" "SupplierMatchStatus" NOT NULL DEFAULT 'PENDENTE',
    "matchOrigem" "SupplierMatchOrigem",
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaAtualizacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "preco" DECIMAL(12,4) NOT NULL,
    "precoPromocional" DECIMAL(12,4),
    "quantidadeMinima" DECIMAL(12,3),
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierPriceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "productId" TEXT,
    "preco" DECIMAL(12,4) NOT NULL,
    "precoPromocional" DECIMAL(12,4),
    "emPromocao" BOOLEAN NOT NULL DEFAULT false,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importId" TEXT,

    CONSTRAINT "SupplierPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogId" TEXT,
    "tipo" "SupplierIntegrationKind" NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "arquivoNome" TEXT,
    "arquivoTamanho" INTEGER,
    "mimeType" TEXT,
    "status" "SupplierImportStatus" NOT NULL DEFAULT 'PENDENTE',
    "totalLinhas" INTEGER NOT NULL DEFAULT 0,
    "itensLidos" INTEGER NOT NULL DEFAULT 0,
    "itensNovos" INTEGER NOT NULL DEFAULT 0,
    "itensAtualizados" INTEGER NOT NULL DEFAULT 0,
    "itensSemVinculo" INTEGER NOT NULL DEFAULT 0,
    "mensagem" TEXT,
    "erros" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "SupplierImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierCartItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "productId" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "precoUnitario" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierIntegration_supplierId_key" ON "SupplierIntegration"("supplierId");
CREATE INDEX "SupplierIntegration_tenantId_idx" ON "SupplierIntegration"("tenantId");
CREATE INDEX "SupplierIntegration_tenantId_proximaSync_idx" ON "SupplierIntegration"("tenantId", "proximaSync");

CREATE UNIQUE INDEX "SupplierCatalog_supplierId_referencia_key" ON "SupplierCatalog"("supplierId", "referencia");
CREATE INDEX "SupplierCatalog_tenantId_idx" ON "SupplierCatalog"("tenantId");
CREATE INDEX "SupplierCatalog_supplierId_idx" ON "SupplierCatalog"("supplierId");

CREATE UNIQUE INDEX "SupplierCatalogItem_catalogId_chave_key" ON "SupplierCatalogItem"("catalogId", "chave");
CREATE INDEX "SupplierCatalogItem_tenantId_idx" ON "SupplierCatalogItem"("tenantId");
CREATE INDEX "SupplierCatalogItem_tenantId_productId_idx" ON "SupplierCatalogItem"("tenantId", "productId");
CREATE INDEX "SupplierCatalogItem_tenantId_ean_idx" ON "SupplierCatalogItem"("tenantId", "ean");
CREATE INDEX "SupplierCatalogItem_tenantId_matchStatus_idx" ON "SupplierCatalogItem"("tenantId", "matchStatus");
CREATE INDEX "SupplierCatalogItem_supplierId_idx" ON "SupplierCatalogItem"("supplierId");

CREATE INDEX "SupplierOffer_tenantId_idx" ON "SupplierOffer"("tenantId");
CREATE INDEX "SupplierOffer_catalogItemId_idx" ON "SupplierOffer"("catalogItemId");
CREATE INDEX "SupplierOffer_tenantId_ativa_fim_idx" ON "SupplierOffer"("tenantId", "ativa", "fim");

CREATE INDEX "SupplierPriceHistory_tenantId_idx" ON "SupplierPriceHistory"("tenantId");
CREATE INDEX "SupplierPriceHistory_catalogItemId_data_idx" ON "SupplierPriceHistory"("catalogItemId", "data");
CREATE INDEX "SupplierPriceHistory_tenantId_productId_data_idx" ON "SupplierPriceHistory"("tenantId", "productId", "data");

CREATE INDEX "SupplierImport_tenantId_idx" ON "SupplierImport"("tenantId");
CREATE INDEX "SupplierImport_tenantId_createdAt_idx" ON "SupplierImport"("tenantId", "createdAt");
CREATE INDEX "SupplierImport_supplierId_idx" ON "SupplierImport"("supplierId");

CREATE INDEX "SupplierCartItem_tenantId_userId_idx" ON "SupplierCartItem"("tenantId", "userId");
CREATE INDEX "SupplierCartItem_supplierId_idx" ON "SupplierCartItem"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierIntegration" ADD CONSTRAINT "SupplierIntegration_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalog" ADD CONSTRAINT "SupplierCatalog_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "SupplierCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierImport" ADD CONSTRAINT "SupplierImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierImport" ADD CONSTRAINT "SupplierImport_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "SupplierCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierCartItem" ADD CONSTRAINT "SupplierCartItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCartItem" ADD CONSTRAINT "SupplierCartItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCartItem" ADD CONSTRAINT "SupplierCartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'SupplierIntegration', 'SupplierCatalog', 'SupplierCatalogItem',
    'SupplierOffer', 'SupplierPriceHistory', 'SupplierImport', 'SupplierCartItem'
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
