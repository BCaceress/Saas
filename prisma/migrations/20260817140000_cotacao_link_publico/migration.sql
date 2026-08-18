-- Link público de resposta de cotação + de onde a resposta veio.

-- CreateEnum
CREATE TYPE "QuotationResponseOrigem" AS ENUM ('OPERADOR', 'LINK');

-- AlterTable
ALTER TABLE "QuotationSupplier" ADD COLUMN "respondidaVia" "QuotationResponseOrigem";

-- CreateTable
CREATE TABLE "QuotationLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationSupplierId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "abertoEm" TIMESTAMP(3),
    "respondidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationLink_quotationSupplierId_key" ON "QuotationLink"("quotationSupplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationLink_token_key" ON "QuotationLink"("token");

-- CreateIndex
CREATE INDEX "QuotationLink_tenantId_idx" ON "QuotationLink"("tenantId");

-- AddForeignKey
ALTER TABLE "QuotationLink" ADD CONSTRAINT "QuotationLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLink" ADD CONSTRAINT "QuotationLink_quotationSupplierId_fkey" FOREIGN KEY ("quotationSupplierId") REFERENCES "QuotationSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEM RLS, de propósito: QuotationLink é tabela de CONTROLE, igual a Invite. É
-- lida pelo token ANTES de existir contexto de tenant (o token é justamente
-- quem revela o tenant), então `app.current_tenant` ainda não está definido e a
-- política de isolamento bloquearia a própria leitura que faz o link funcionar.
-- O isolamento aqui vem do segredo: 24 bytes aleatórios, uma linha por convite.
-- Todo dado de negócio lido depois disso passa por `runWithTenant` normal.
