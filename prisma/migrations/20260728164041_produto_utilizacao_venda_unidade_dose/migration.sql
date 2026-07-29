-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "dosePadrao" DECIMAL(10,2),
ADD COLUMN     "vendaUnidade" BOOLEAN NOT NULL DEFAULT true;
