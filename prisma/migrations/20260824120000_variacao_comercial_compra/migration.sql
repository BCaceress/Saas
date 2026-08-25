-- Variação comercial de compra: o sabor existe na nota, não na prateleira.
--
-- O operador compra Bubbaloo Morango, Uva e Tutti-Frutti — 50 UN de cada — e
-- vende "Bubbaloo Sortido". Se cada sabor virasse produto, ele teria três
-- saldos impossíveis de contar (a caixa vem misturada) e três SKUs para o
-- caixa distinguir com o olho. Aqui o sabor é atributo da ORIGEM da compra:
-- entra no pedido, na nota e no lançamento manual, fica gravado no item para o
-- histórico — e o estoque soma tudo em um saldo só, o do produto principal.

-- AlterTable — o eixo da variação vive no produto ("Sabor", "Cor", "Aroma").
-- `variacaoControlada` nasce e permanece false: o motor de estoque consolida.
ALTER TABLE "Product" ADD COLUMN "variacaoLabel" TEXT;
ALTER TABLE "Product" ADD COLUMN "variacaoControlada" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable — a variação em si. Sem SKU, sem preço, sem Stock: de propósito.
CREATE TABLE "ProductPurchaseVariant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ean" TEXT,
    "codigoFornecedor" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPurchaseVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPurchaseVariant_productId_nome_key" ON "ProductPurchaseVariant"("productId", "nome");
CREATE INDEX "ProductPurchaseVariant_tenantId_idx" ON "ProductPurchaseVariant"("tenantId");
CREATE INDEX "ProductPurchaseVariant_productId_idx" ON "ProductPurchaseVariant"("productId");
-- O EAN do sabor é o que faz o XML cair no produto certo já com a variação.
CREATE INDEX "ProductPurchaseVariant_tenantId_ean_idx" ON "ProductPurchaseVariant"("tenantId", "ean");

-- AddForeignKey — variação não sobrevive ao produto que a define.
ALTER TABLE "ProductPurchaseVariant" ADD CONSTRAINT "ProductPurchaseVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — o sabor viaja pelo documento de compra. `variacaoNome` é cópia
-- congelada: a linha de compra é história e não pode ser reescrita por um
-- rename da variação seis meses depois.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "variacaoNome" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "variacaoNome" TEXT;

-- AlterTable — a linha do XML já resolve o sabor pelo GTIN/cProd, e o de-para
-- do fornecedor guarda a decisão para a nota seguinte não perguntar de novo.
ALTER TABLE "FiscalInboundItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "SupplierItemMap" ADD COLUMN "variantId" TEXT;

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProductPurchaseVariant'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
