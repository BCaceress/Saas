-- CreateEnum
CREATE TYPE "ControleEstoquePdv" AS ENUM ('BLOQUEAR', 'CONFIRMAR', 'IGNORAR');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "controleEstoquePdv" "ControleEstoquePdv" NOT NULL DEFAULT 'BLOQUEAR';
