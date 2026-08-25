-- Recebimento sem pedido — a terceira porta do XML.
--
-- Havia duas saídas para uma nota que chega: vincular a um pedido existente ou
-- gerar um pedido a partir dela. Falta a que o mercadinho mais usa: o
-- representante para na porta, deixa a mercadoria e a nota, e ninguém quer um
-- "pedido" para documentar uma compra que nunca foi planejada.
--
-- Aqui a conferência passa a existir sem a camada de pedido: a NOTA vira a
-- referência e o operador confere contra ela. O documento de origem continua
-- existindo — é a própria NF-e (chave, XML, duplicatas), não um pedido
-- retroativo inventado para preencher a coluna.

-- AlterTable — a linha da conciliação vive sem pedido.
ALTER TABLE "PurchaseReconciliationItem" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;

-- AlterTable — e a timeline também: sem pedido, o evento pendura na nota.
ALTER TABLE "PurchaseEvent" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;

-- CreateIndex — timeline lida por nota (é a única chave que o fluxo sem
-- pedido tem para ler a história de volta).
CREATE INDEX "PurchaseEvent_inboundId_createdAt_idx" ON "PurchaseEvent"("inboundId", "createdAt");
