-- ============================================================
-- BASELINE — NoHub Market
--
-- Este arquivo substitui as 15 migrations anteriores (arquivadas em
-- prisma/migrations-archive/). Elas não replicavam do zero: da Fase 3 em
-- diante o schema foi ao banco por `db push`, então tabelas como Site, Sale,
-- Purchase e Customer nunca entraram no histórico e o shadow database
-- quebrava em `migrate dev`.
--
-- Gerado de `prisma migrate diff --from-empty --to-schema-datamodel` com o
-- banco de produção verificado idêntico ao schema, mais o bloco de RLS e a
-- função de numeração fiscal no fim (que o Prisma não conhece).
--
-- No banco existente foi marcado como aplicado (`migrate resolve --applied`);
-- ele só roda de verdade em banco novo ou no shadow database.
-- ============================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STARTER', 'PRO', 'MULTI');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('ADMINISTRADOR', 'ESTOQUISTA', 'CAIXA', 'FINANCEIRO', 'CONTADOR');

-- CreateEnum
CREATE TYPE "TipoOperacao" AS ENUM ('AUTONOMO', 'MERCADINHO', 'CONVENIENCIA_BEBIDAS');

-- CreateEnum
CREATE TYPE "Atendimento" AS ENUM ('SELF_SERVICE', 'OPERADOR_PDV');

-- CreateEnum
CREATE TYPE "Topologia" AS ENUM ('LOCAL', 'CD_ABASTECE', 'MISTO');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLES', 'COMBO', 'PERSONALIZADO', 'INSUMO');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('UN', 'ML', 'G');

-- CreateEnum
CREATE TYPE "RecipeType" AS ENUM ('DRINK', 'PRATO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('AMBIENTE', 'REFRIGERADO', 'CONGELADO');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('IFOOD', 'MERCADO_LIVRE', 'PROPRIO');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('LOJA', 'CD');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'TRANSFERENCIA', 'ABERTURA', 'PRODUCAO', 'PERDA', 'DEVOLUCAO_CLIENTE', 'DEVOLUCAO_FORNECEDOR');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('MANUAL', 'FORNECEDOR');

-- CreateEnum
CREATE TYPE "PurchaseMotivo" AS ENUM ('COMPRA_SEM_PEDIDO', 'BONIFICACAO', 'ESTOQUE_INICIAL', 'TRANSFERENCIA', 'BRINDE', 'TROCA', 'AMOSTRA', 'SERVICO');

-- CreateEnum
CREATE TYPE "TipoItemPedido" AS ENUM ('COMPRA', 'BONIFICACAO', 'BRINDE', 'TROCA', 'AMOSTRA', 'SERVICO');

-- CreateEnum
CREATE TYPE "MotivoBonificacao" AS ENUM ('COMERCIAL', 'CAMPANHA', 'REPOSICAO', 'TROCA', 'CORTESIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('RASCUNHO', 'ENVIADO', 'AGUARDANDO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "RequisicaoStatus" AS ENUM ('ABERTA', 'ATENDIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('SEPARANDO', 'EXPEDIDO', 'RECEBIDO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('PROGRAMADO', 'ABERTO', 'FECHADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "SelectionType" AS ENUM ('UNICA', 'MULTIPLA');

-- CreateEnum
CREATE TYPE "SaleOrigin" AS ENUM ('PDV', 'TOTEM', 'APP');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('ABERTA', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'OUTRO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONFIRMADO', 'RECUSADO', 'EXPIRADO', 'CANCELADO', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('MERCADO_PAGO', 'STONE', 'PAGSEGURO', 'SIMULADO');

-- CreateEnum
CREATE TYPE "PaymentAmbiente" AS ENUM ('PRODUCAO', 'SANDBOX');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('ABERTA', 'FECHADA');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('ABERTURA', 'SANGRIA', 'SUPRIMENTO', 'FECHAMENTO');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MASCULINO', 'FEMININO', 'OUTRO');

-- CreateEnum
CREATE TYPE "CouponReason" AS ENUM ('RISCO', 'ANIVERSARIO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ComodatoAssetStatus" AS ENUM ('DISPONIVEL', 'EMPRESTADO', 'MANUTENCAO', 'BAIXADO');

-- CreateEnum
CREATE TYPE "ContainerMovementType" AS ENUM ('ENTREGA', 'DEVOLUCAO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "InventoryEscopo" AS ENUM ('COMPLETO', 'CATEGORIA', 'PRODUTOS');

-- CreateEnum
CREATE TYPE "InsightFeedbackAcao" AS ENUM ('IGNORADO', 'CLICADO');

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

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "plano" "Plan" NOT NULL DEFAULT 'STARTER',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "logoUrl" TEXT,
    "telefone" TEXT,
    "emailContato" TEXT,
    "cep" TEXT,
    "rua" TEXT,
    "numero" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "tipoOperacao" "TipoOperacao",
    "atendimento" "Atendimento",
    "topologia" "Topologia",
    "numPontos" INTEGER,
    "moduloPdv" BOOLEAN NOT NULL DEFAULT false,
    "moduloFiscal" BOOLEAN NOT NULL DEFAULT false,
    "moduloComodato" BOOLEAN NOT NULL DEFAULT false,
    "moduloRota" BOOLEAN NOT NULL DEFAULT false,
    "moduloAutoatendimento" BOOLEAN NOT NULL DEFAULT false,
    "totemPinHash" TEXT,
    "recebimentoExigeContagem" BOOLEAN NOT NULL DEFAULT false,
    "cupomAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "cupomDiasRisco" INTEGER NOT NULL DEFAULT 25,
    "tierBronzeMin" INTEGER NOT NULL DEFAULT 200,
    "tierPrataMin" INTEGER NOT NULL DEFAULT 500,
    "tierOuroMin" INTEGER NOT NULL DEFAULT 2000,
    "tierDiamanteMin" INTEGER NOT NULL DEFAULT 5000,
    "estoqueMinimoPadrao" INTEGER NOT NULL DEFAULT 0,
    "produtoParadoDias" INTEGER NOT NULL DEFAULT 45,
    "caixaFundoTroco" DECIMAL(10,2),
    "caixaLimiteGaveta" DECIMAL(10,2),
    "alertasDesativados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proprietario" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcesso" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipAccess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "siteId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "acessos" JSONB NOT NULL DEFAULT '[]',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plano" "Plan" NOT NULL,
    "status" TEXT NOT NULL,
    "gateway" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "skuPrefix" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "skuPrefix" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "defaultFiscalProfileId" TEXT,
    "defaultStorageType" "StorageType",

    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cest" TEXT,
    "origem" TEXT NOT NULL DEFAULT '0',
    "csosn" TEXT,
    "cst" TEXT,
    "cstPis" TEXT,
    "cstCofins" TEXT,
    "cstIpi" TEXT,
    "aliquotaIcms" DECIMAL(5,2),
    "aliquotaPis" DECIMAL(5,2),
    "aliquotaCofins" DECIMAL(5,2),
    "aliquotaIpi" DECIMAL(5,2),
    "cfopSaida" TEXT,
    "cfopEntrada" TEXT,
    "codigoBeneficio" TEXT,
    "temSt" BOOLEAN NOT NULL DEFAULT false,
    "precisaRevisao" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "StorageType" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cnpj" TEXT,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "nomeContatoPrincipal" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "municipio" TEXT,
    "codigoMunicipio" TEXT,
    "uf" TEXT,
    "ie" TEXT,
    "indicadorIE" "IndicadorIE",
    "pedidoMinimo" DECIMAL(12,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "codigoNoFornecedor" TEXT,
    "custoFornecedor" DECIMAL(10,2),
    "isPrincipal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "ProductType" NOT NULL DEFAULT 'SIMPLES',
    "ean" TEXT,
    "nome" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "brandId" TEXT,
    "subcategoryId" TEXT,
    "imagemUrl" TEXT,
    "unidadeBase" "BaseUnit" NOT NULL DEFAULT 'UN',
    "fracionavel" BOOLEAN NOT NULL DEFAULT false,
    "conteudoPorUnidade" DECIMAL(10,2),
    "precoVenda" DECIMAL(10,2),
    "custo" DECIMAL(10,2),
    "custoMedio" DECIMAL(10,2),
    "fiscalProfileId" TEXT,
    "gtinTributavel" TEXT,
    "unidadeTributavel" TEXT,
    "fatorConversaoTrib" DECIMAL(12,4),
    "codigoAnp" TEXT,
    "restricaoIdade" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "controlaEstoque" BOOLEAN NOT NULL DEFAULT true,
    "tipoReceita" "RecipeType",
    "copoMl" DECIMAL(10,2),
    "modoPreparo" TEXT,
    "vendeOnline" BOOLEAN NOT NULL DEFAULT false,
    "pesoGramas" INTEGER,
    "alturaCm" DECIMAL(6,2),
    "larguraCm" DECIMAL(6,2),
    "comprimentoCm" DECIMAL(6,2),
    "descricaoOnline" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "siteId" TEXT,
    "locationId" TEXT,
    "estoqueFechado" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estoqueAberto" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estoqueMinimo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estoqueIdeal" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPackaging" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ean" TEXT,
    "fatorConversao" DECIMAL(10,3) NOT NULL,
    "isCompraDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductPackaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComponent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "unidade" "BaseUnit" NOT NULL,
    "groupId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "acrescenta" BOOLEAN NOT NULL DEFAULT true,
    "acrescimoPreco" DECIMAL(10,2),

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComponentGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "tipoSelecao" "SelectionType" NOT NULL DEFAULT 'UNICA',
    "maxSelecoes" INTEGER,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductComponentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "volumeMl" DECIMAL(10,2),
    "fatorEscala" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "precoVenda" DECIMAL(10,2),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTag" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "ProductSalesChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "canal" "SalesChannel" NOT NULL,
    "precoCanal" DECIMAL(10,2),
    "descricaoCanal" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductSalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "SiteType" NOT NULL DEFAULT 'LOJA',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "cep" TEXT,
    "rua" TEXT,
    "numero" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "estoquePropio" BOOLEAN NOT NULL DEFAULT true,
    "cdAbastecedorId" TEXT,
    "controleIdade" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tipo" "MovementType" NOT NULL,
    "deltaFechado" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "deltaAberto" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "custoUnitario" DECIMAL(10,2),
    "purchaseId" TEXT,
    "transferId" TEXT,
    "productionId" TEXT,
    "saleId" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tipo" "PurchaseType" NOT NULL DEFAULT 'MANUAL',
    "motivo" "PurchaseMotivo",
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "numeroNota" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'RASCUNHO',
    "previsaoEntrega" TIMESTAMP(3),
    "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "financeiroGerado" BOOLEAN NOT NULL DEFAULT false,
    "enviadoEm" TIMESTAMP(3),
    "confirmadoEm" TIMESTAMP(3),
    "emTransitoEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingId" TEXT,
    "tipo" "TipoItemPedido" NOT NULL DEFAULT 'COMPRA',
    "motivoBonificacao" "MotivoBonificacao",
    "qtdPedida" DECIMAL(12,3) NOT NULL,
    "custoUnitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qtdRecebida" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "observacao" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingId" TEXT,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "custoTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origemSiteId" TEXT NOT NULL,
    "destinoSiteId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'RECEBIDO',
    "requisicaoId" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expedidoEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3),
    "temDivergencia" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "qtdExpedida" DECIMAL(12,3),
    "qtdRecebida" DECIMAL(12,3),

    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requisicao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origemSiteId" TEXT NOT NULL,
    "destinoSiteId" TEXT NOT NULL,
    "status" "RequisicaoStatus" NOT NULL DEFAULT 'ABERTA',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "atendidaEm" TIMESTAMP(3),

    CONSTRAINT "Requisicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisicaoItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requisicaoId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtdSolicitada" DECIMAL(12,3) NOT NULL,
    "qtdAtendida" DECIMAL(12,3),

    CONSTRAINT "RequisicaoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'PROGRAMADO',
    "escopoTipo" "InventoryEscopo" NOT NULL DEFAULT 'COMPLETO',
    "categoryId" TEXT,
    "escopoProdutoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modoCego" BOOLEAN NOT NULL DEFAULT false,
    "dataProgramada" TIMESTAMP(3) NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "diasSemana" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "responsavelId" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "iniciadoEm" TIMESTAMP(3),
    "fechadoEm" TIMESTAMP(3),
    "fechadoPor" TEXT,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtdSistema" DECIMAL(12,3) NOT NULL,
    "qtdContada" DECIMAL(12,3),

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "saleId" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "origem" "SaleOrigin" NOT NULL DEFAULT 'PDV',
    "status" "SaleStatus" NOT NULL DEFAULT 'ABERTA',
    "cashSessionId" TEXT,
    "operatorUserId" TEXT,
    "customerId" TEXT,
    "totemDeviceId" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maiorIdadeConfirmada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotemDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotemDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "selectedComponentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMADO',
    "valor" DECIMAL(12,2) NOT NULL,
    "troco" DECIMAL(10,2),
    "gateway" TEXT,
    "externalId" TEXT,
    "pixCopiaECola" TEXT,
    "pixQrCode" TEXT,
    "expiraEm" TIMESTAMP(3),
    "terminalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT,
    "partnerRef" TEXT,
    "ambiente" "PaymentAmbiente" NOT NULL DEFAULT 'PRODUCAO',
    "pixAutomatico" BOOLEAN NOT NULL DEFAULT true,
    "cartaoIntegrado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTerminal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'ABERTA',
    "valorAbertura" DECIMAL(12,2) NOT NULL,
    "valorFechamento" DECIMAL(12,2),
    "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadaEm" TIMESTAMP(3),

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "tipo" "CashMovementType" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePaymentMethod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SitePaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "dataNascimento" DATE,
    "sexo" "Sexo",
    "whatsapp" TEXT,
    "email" TEXT,
    "pontos" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "ie" TEXT,
    "indicadorIE" "IndicadorIE",
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "municipio" TEXT,
    "codigoMunicipio" TEXT,
    "uf" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponSend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "motivo" "CouponReason" NOT NULL,
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "mensagem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComodatoAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "identificacao" TEXT NOT NULL,
    "status" "ComodatoAssetStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "valorEstimado" DECIMAL(10,2),
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComodatoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComodatoLoan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "emprestadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previsaoDevolucao" DATE,
    "devolvidoEm" TIMESTAMP(3),
    "condicaoSaida" TEXT,
    "condicaoRetorno" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComodatoLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valorUnitario" DECIMAL(10,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "containerTypeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tipo" "ContainerMovementType" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContainerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "InsightFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "acao" "InsightFeedbackAcao" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardWidgetPref" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hidden" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ordem" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidgetPref_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "Tenant_subdomain_key" ON "Tenant"("subdomain");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "MembershipAccess_tenantId_siteId_idx" ON "MembershipAccess"("tenantId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipAccess_membershipId_perfil_siteId_key" ON "MembershipAccess"("membershipId", "perfil", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tenantId_email_key" ON "Invite"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Brand_tenantId_idx" ON "Brand"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenantId_nomeNormalizado_key" ON "Brand"("tenantId", "nomeNormalizado");

-- CreateIndex
CREATE INDEX "Category_tenantId_idx" ON "Category"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_skuPrefix_key" ON "Category"("tenantId", "skuPrefix");

-- CreateIndex
CREATE INDEX "Subcategory_tenantId_idx" ON "Subcategory"("tenantId");

-- CreateIndex
CREATE INDEX "Subcategory_categoryId_idx" ON "Subcategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Subcategory_tenantId_categoryId_skuPrefix_key" ON "Subcategory"("tenantId", "categoryId", "skuPrefix");

-- CreateIndex
CREATE INDEX "FiscalProfile_tenantId_idx" ON "FiscalProfile"("tenantId");

-- CreateIndex
CREATE INDEX "StorageLocation_tenantId_idx" ON "StorageLocation"("tenantId");

-- CreateIndex
CREATE INDEX "StorageLocation_siteId_idx" ON "StorageLocation"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_tenantId_siteId_nome_key" ON "StorageLocation"("tenantId", "siteId", "nome");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_cnpj_key" ON "Supplier"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "ProductSupplier_tenantId_idx" ON "ProductSupplier"("tenantId");

-- CreateIndex
CREATE INDEX "ProductSupplier_supplierId_idx" ON "ProductSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_productId_supplierId_key" ON "ProductSupplier"("productId", "supplierId");

-- CreateIndex
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_ean_idx" ON "Product"("tenantId", "ean");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_subcategoryId_idx" ON "Product"("subcategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "Stock_tenantId_idx" ON "Stock"("tenantId");

-- CreateIndex
CREATE INDEX "Stock_siteId_idx" ON "Stock"("siteId");

-- CreateIndex
CREATE INDEX "Stock_locationId_idx" ON "Stock"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_productId_siteId_key" ON "Stock"("productId", "siteId");

-- CreateIndex
CREATE INDEX "ProductPackaging_tenantId_idx" ON "ProductPackaging"("tenantId");

-- CreateIndex
CREATE INDEX "ProductPackaging_productId_idx" ON "ProductPackaging"("productId");

-- CreateIndex
CREATE INDEX "ProductComponent_tenantId_idx" ON "ProductComponent"("tenantId");

-- CreateIndex
CREATE INDEX "ProductComponent_parentProductId_idx" ON "ProductComponent"("parentProductId");

-- CreateIndex
CREATE INDEX "ProductComponent_componentProductId_idx" ON "ProductComponent"("componentProductId");

-- CreateIndex
CREATE INDEX "ProductComponent_groupId_idx" ON "ProductComponent"("groupId");

-- CreateIndex
CREATE INDEX "ProductComponentGroup_tenantId_idx" ON "ProductComponentGroup"("tenantId");

-- CreateIndex
CREATE INDEX "ProductComponentGroup_parentProductId_idx" ON "ProductComponentGroup"("parentProductId");

-- CreateIndex
CREATE INDEX "ProductVariant_tenantId_idx" ON "ProductVariant"("tenantId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_nome_key" ON "ProductVariant"("productId", "nome");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_nome_key" ON "Tag"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "ProductTag_tenantId_idx" ON "ProductTag"("tenantId");

-- CreateIndex
CREATE INDEX "ProductTag_tagId_idx" ON "ProductTag"("tagId");

-- CreateIndex
CREATE INDEX "ProductSalesChannel_tenantId_idx" ON "ProductSalesChannel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSalesChannel_productId_canal_key" ON "ProductSalesChannel"("productId", "canal");

-- CreateIndex
CREATE INDEX "Site_tenantId_idx" ON "Site"("tenantId");

-- CreateIndex
CREATE INDEX "Site_cdAbastecedorId_idx" ON "Site"("cdAbastecedorId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_tenantId_nome_key" ON "Site"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_idx" ON "StockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_siteId_idx" ON "StockMovement"("siteId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_tipo_idx" ON "StockMovement"("tipo");

-- CreateIndex
CREATE INDEX "StockMovement_transferId_idx" ON "StockMovement"("transferId");

-- CreateIndex
CREATE INDEX "StockMovement_productionId_idx" ON "StockMovement"("productionId");

-- CreateIndex
CREATE INDEX "StockMovement_saleId_idx" ON "StockMovement"("saleId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_idx" ON "Purchase"("tenantId");

-- CreateIndex
CREATE INDEX "Purchase_siteId_idx" ON "Purchase"("siteId");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");

-- CreateIndex
CREATE INDEX "Purchase_purchaseOrderId_idx" ON "Purchase"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_siteId_idx" ON "PurchaseOrder"("siteId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_numero_key" ON "PurchaseOrder"("tenantId", "numero");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_tenantId_idx" ON "PurchaseOrderItem"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenantId_idx" ON "PurchaseItem"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_requisicaoId_key" ON "Transfer"("requisicaoId");

-- CreateIndex
CREATE INDEX "Transfer_tenantId_idx" ON "Transfer"("tenantId");

-- CreateIndex
CREATE INDEX "Transfer_origemSiteId_idx" ON "Transfer"("origemSiteId");

-- CreateIndex
CREATE INDEX "Transfer_destinoSiteId_idx" ON "Transfer"("destinoSiteId");

-- CreateIndex
CREATE INDEX "Transfer_status_idx" ON "Transfer"("status");

-- CreateIndex
CREATE INDEX "TransferItem_tenantId_idx" ON "TransferItem"("tenantId");

-- CreateIndex
CREATE INDEX "TransferItem_transferId_idx" ON "TransferItem"("transferId");

-- CreateIndex
CREATE INDEX "TransferItem_productId_idx" ON "TransferItem"("productId");

-- CreateIndex
CREATE INDEX "Requisicao_tenantId_idx" ON "Requisicao"("tenantId");

-- CreateIndex
CREATE INDEX "Requisicao_origemSiteId_idx" ON "Requisicao"("origemSiteId");

-- CreateIndex
CREATE INDEX "Requisicao_destinoSiteId_idx" ON "Requisicao"("destinoSiteId");

-- CreateIndex
CREATE INDEX "Requisicao_status_idx" ON "Requisicao"("status");

-- CreateIndex
CREATE INDEX "RequisicaoItem_tenantId_idx" ON "RequisicaoItem"("tenantId");

-- CreateIndex
CREATE INDEX "RequisicaoItem_requisicaoId_idx" ON "RequisicaoItem"("requisicaoId");

-- CreateIndex
CREATE INDEX "RequisicaoItem_productId_idx" ON "RequisicaoItem"("productId");

-- CreateIndex
CREATE INDEX "Inventory_tenantId_idx" ON "Inventory"("tenantId");

-- CreateIndex
CREATE INDEX "Inventory_siteId_idx" ON "Inventory"("siteId");

-- CreateIndex
CREATE INDEX "Inventory_status_idx" ON "Inventory"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_tenantId_idx" ON "InventoryItem"("tenantId");

-- CreateIndex
CREATE INDEX "InventoryItem_inventoryId_idx" ON "InventoryItem"("inventoryId");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_idx" ON "InventoryItem"("productId");

-- CreateIndex
CREATE INDEX "Production_tenantId_idx" ON "Production"("tenantId");

-- CreateIndex
CREATE INDEX "Production_siteId_idx" ON "Production"("siteId");

-- CreateIndex
CREATE INDEX "Production_productId_idx" ON "Production"("productId");

-- CreateIndex
CREATE INDEX "Production_saleId_idx" ON "Production"("saleId");

-- CreateIndex
CREATE INDEX "Sale_tenantId_idx" ON "Sale"("tenantId");

-- CreateIndex
CREATE INDEX "Sale_siteId_idx" ON "Sale"("siteId");

-- CreateIndex
CREATE INDEX "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_totemDeviceId_idx" ON "Sale"("totemDeviceId");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- CreateIndex
CREATE INDEX "TotemDevice_tenantId_idx" ON "TotemDevice"("tenantId");

-- CreateIndex
CREATE INDEX "TotemDevice_siteId_idx" ON "TotemDevice"("siteId");

-- CreateIndex
CREATE INDEX "SaleItem_tenantId_idx" ON "SaleItem"("tenantId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderConfig_tenantId_key" ON "PaymentProviderConfig"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentProviderConfig_tenantId_idx" ON "PaymentProviderConfig"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentTerminal_tenantId_idx" ON "PaymentTerminal"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentTerminal_siteId_idx" ON "PaymentTerminal"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTerminal_tenantId_externalId_key" ON "PaymentTerminal"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "CashSession_tenantId_idx" ON "CashSession"("tenantId");

-- CreateIndex
CREATE INDEX "CashSession_siteId_idx" ON "CashSession"("siteId");

-- CreateIndex
CREATE INDEX "CashSession_status_idx" ON "CashSession"("status");

-- CreateIndex
CREATE INDEX "CashMovement_tenantId_idx" ON "CashMovement"("tenantId");

-- CreateIndex
CREATE INDEX "CashMovement_cashSessionId_idx" ON "CashMovement"("cashSessionId");

-- CreateIndex
CREATE INDEX "SitePaymentMethod_tenantId_idx" ON "SitePaymentMethod"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SitePaymentMethod_siteId_metodo_key" ON "SitePaymentMethod"("siteId", "metodo");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_nome_idx" ON "Customer"("tenantId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_cpf_key" ON "Customer"("tenantId", "cpf");

-- CreateIndex
CREATE INDEX "CouponSend_tenantId_idx" ON "CouponSend"("tenantId");

-- CreateIndex
CREATE INDEX "CouponSend_customerId_idx" ON "CouponSend"("customerId");

-- CreateIndex
CREATE INDEX "CouponSend_createdAt_idx" ON "CouponSend"("createdAt");

-- CreateIndex
CREATE INDEX "ComodatoAsset_tenantId_idx" ON "ComodatoAsset"("tenantId");

-- CreateIndex
CREATE INDEX "ComodatoAsset_tenantId_status_idx" ON "ComodatoAsset"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComodatoAsset_tenantId_identificacao_key" ON "ComodatoAsset"("tenantId", "identificacao");

-- CreateIndex
CREATE INDEX "ComodatoLoan_tenantId_idx" ON "ComodatoLoan"("tenantId");

-- CreateIndex
CREATE INDEX "ComodatoLoan_tenantId_devolvidoEm_idx" ON "ComodatoLoan"("tenantId", "devolvidoEm");

-- CreateIndex
CREATE INDEX "ComodatoLoan_assetId_idx" ON "ComodatoLoan"("assetId");

-- CreateIndex
CREATE INDEX "ComodatoLoan_customerId_idx" ON "ComodatoLoan"("customerId");

-- CreateIndex
CREATE INDEX "ContainerType_tenantId_idx" ON "ContainerType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContainerType_tenantId_nome_key" ON "ContainerType"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "ContainerMovement_tenantId_idx" ON "ContainerMovement"("tenantId");

-- CreateIndex
CREATE INDEX "ContainerMovement_tenantId_customerId_idx" ON "ContainerMovement"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "ContainerMovement_containerTypeId_idx" ON "ContainerMovement"("containerTypeId");

-- CreateIndex
CREATE INDEX "ContainerMovement_customerId_idx" ON "ContainerMovement"("customerId");

-- CreateIndex
CREATE INDEX "StockSnapshot_tenantId_idx" ON "StockSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "StockSnapshot_siteId_data_idx" ON "StockSnapshot"("siteId", "data");

-- CreateIndex
CREATE INDEX "StockSnapshot_data_idx" ON "StockSnapshot"("data");

-- CreateIndex
CREATE UNIQUE INDEX "StockSnapshot_siteId_productId_data_key" ON "StockSnapshot"("siteId", "productId", "data");

-- CreateIndex
CREATE INDEX "InsightFeedback_tenantId_insightId_idx" ON "InsightFeedback"("tenantId", "insightId");

-- CreateIndex
CREATE INDEX "InsightFeedback_tenantId_createdAt_idx" ON "InsightFeedback"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWidgetPref_tenantId_userId_key" ON "DashboardWidgetPref"("tenantId", "userId");

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
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipAccess" ADD CONSTRAINT "MembershipAccess_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipAccess" ADD CONSTRAINT "MembershipAccess_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_defaultFiscalProfileId_fkey" FOREIGN KEY ("defaultFiscalProfileId") REFERENCES "FiscalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_fiscalProfileId_fkey" FOREIGN KEY ("fiscalProfileId") REFERENCES "FiscalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPackaging" ADD CONSTRAINT "ProductPackaging_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductComponentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponentGroup" ADD CONSTRAINT "ProductComponentGroup_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSalesChannel" ADD CONSTRAINT "ProductSalesChannel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_cdAbastecedorId_fkey" FOREIGN KEY ("cdAbastecedorId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_origemSiteId_fkey" FOREIGN KEY ("origemSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_destinoSiteId_fkey" FOREIGN KEY ("destinoSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_requisicaoId_fkey" FOREIGN KEY ("requisicaoId") REFERENCES "Requisicao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisicao" ADD CONSTRAINT "Requisicao_origemSiteId_fkey" FOREIGN KEY ("origemSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisicao" ADD CONSTRAINT "Requisicao_destinoSiteId_fkey" FOREIGN KEY ("destinoSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisicaoItem" ADD CONSTRAINT "RequisicaoItem_requisicaoId_fkey" FOREIGN KEY ("requisicaoId") REFERENCES "Requisicao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_totemDeviceId_fkey" FOREIGN KEY ("totemDeviceId") REFERENCES "TotemDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotemDevice" ADD CONSTRAINT "TotemDevice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PaymentTerminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderConfig" ADD CONSTRAINT "PaymentProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTerminal" ADD CONSTRAINT "PaymentTerminal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePaymentMethod" ADD CONSTRAINT "SitePaymentMethod_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponSend" ADD CONSTRAINT "CouponSend_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComodatoAsset" ADD CONSTRAINT "ComodatoAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComodatoLoan" ADD CONSTRAINT "ComodatoLoan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ComodatoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComodatoLoan" ADD CONSTRAINT "ComodatoLoan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerType" ADD CONSTRAINT "ContainerType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerMovement" ADD CONSTRAINT "ContainerMovement_containerTypeId_fkey" FOREIGN KEY ("containerTypeId") REFERENCES "ContainerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerMovement" ADD CONSTRAINT "ContainerMovement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- ============================================================
-- O QUE NÃO VEM DO SCHEMA PRISMA
-- O restante deste arquivo foi gerado por `prisma migrate diff` a partir do
-- schema. Daqui para baixo é o que o Prisma não conhece e que, sem estar
-- aqui, sumiria em qualquer banco novo (shadow database, ambiente novo).
-- ============================================================

-- RLS — segunda camada de isolamento por tenant (PRD §8). FORCE sujeita o
-- próprio dono da tabela à policy (no Neon a app conecta como dono).
-- current_setting(..., TRUE) devolve NULL sem o setting, e "tenantId = NULL"
-- é NULL => nega tudo (fail-safe). lib/prisma.ts faz o SET LOCAL por query.
--
-- Tabelas de controle/auth (Tenant, User, Account, Session, VerificationToken,
-- Membership, MembershipAccess, Subscription, Invite) ficam de FORA: são lidas
-- pelo basePrisma ANTES de existir contexto de tenant (login, provisionamento).
-- Ligar RLS nelas quebraria a autenticação.
DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'Brand',
    'CashMovement',
    'CashSession',
    'Category',
    'FiscalConfig',
    'FiscalDocument',
    'FiscalDocumentItem',
    'FiscalEmitente',
    'FiscalEvent',
    'FiscalInbound',
    'FiscalInboundItem',
    'FiscalProfile',
    'FiscalSerie',
    'Payment',
    'Product',
    'ProductComponent',
    'ProductPackaging',
    'ProductSalesChannel',
    'ProductSupplier',
    'ProductTag',
    'ProductVariant',
    'Sale',
    'SaleItem',
    'SitePaymentMethod',
    'Stock',
    'StorageLocation',
    'Subcategory',
    'Supplier',
    'SupplierItemMap',
    'Tag'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
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

-- Numeração fiscal atômica. O número da nota NUNCA sai de max(numero)+1: duas
-- vendas simultâneas pegariam o mesmo e a segunda seria rejeitada pela SEFAZ
-- como duplicidade. UPDATE ... RETURNING serializa no lock da linha.
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
