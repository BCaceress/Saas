-- CreateEnum
CREATE TYPE "TipoControleEstoque" AS ENUM ('MINIMO', 'MINIMO_IDEAL', 'ROTATIVIDADE');

-- AlterTable
ALTER TABLE "Tenant"
  ADD COLUMN "tipoControleEstoque" "TipoControleEstoque" NOT NULL DEFAULT 'MINIMO_IDEAL',
  ADD COLUMN "periodoMediaDias" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "diasCobertura" INTEGER NOT NULL DEFAULT 7;
