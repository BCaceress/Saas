-- CreateEnum
CREATE TYPE "TipoItemPedido" AS ENUM ('COMPRA', 'BONIFICACAO', 'BRINDE', 'TROCA', 'AMOSTRA', 'SERVICO');

-- CreateEnum
CREATE TYPE "MotivoBonificacao" AS ENUM ('COMERCIAL', 'CAMPANHA', 'REPOSICAO', 'TROCA', 'CORTESIA', 'OUTRO');

-- AlterEnum
ALTER TYPE "PurchaseMotivo" ADD VALUE 'BRINDE';
ALTER TYPE "PurchaseMotivo" ADD VALUE 'TROCA';
ALTER TYPE "PurchaseMotivo" ADD VALUE 'AMOSTRA';
ALTER TYPE "PurchaseMotivo" ADD VALUE 'SERVICO';

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "tipo" "TipoItemPedido" NOT NULL DEFAULT 'COMPRA';
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "motivoBonificacao" "MotivoBonificacao";
