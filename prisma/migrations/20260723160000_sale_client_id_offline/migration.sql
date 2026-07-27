-- Venda criada OFFLINE no PDV e sincronizada depois. O clientId (uuid gerado no
-- navegador) é a chave de IDEMPOTÊNCIA da sincronização: reenviar a mesma venda
-- não a duplica. Null = venda nasceu online (o caso normal).
ALTER TABLE "Sale" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "Sale_clientId_key" ON "Sale"("clientId");
