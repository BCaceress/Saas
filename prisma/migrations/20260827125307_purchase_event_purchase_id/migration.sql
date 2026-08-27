-- AlterTable
ALTER TABLE "PurchaseEvent" ADD COLUMN     "purchaseId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseEvent_purchaseId_idx" ON "PurchaseEvent"("purchaseId");

-- AddForeignKey
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
