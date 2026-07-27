-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "validadeAlertaDias" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "TransferItem" ADD COLUMN     "lotesInfo" JSONB;
