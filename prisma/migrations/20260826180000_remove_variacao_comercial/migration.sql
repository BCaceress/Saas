-- Remoção da variação comercial de compra.
--
-- O conceito saiu inteiro: o sabor deixa de existir no pedido, na nota, no
-- lançamento manual e no cadastro do produto. A decisão veio da tela — cada
-- caixa de sabor exigia DUAS linhas para funcionar (uma embalagem, para o
-- fator de conversão, e uma variação, para o nome), porque a variação nunca
-- soube dizer quantas unidades vinham nela. Dado duplicado sempre diverge, e
-- divergiu.
--
-- DESTRUTIVA: apaga o sabor gravado em pedidos, entradas e notas já
-- processadas. O saldo do estoque não muda — ele sempre foi do produto
-- principal, nunca da variação.

-- DropForeignKey
ALTER TABLE "ProductPurchaseVariant" DROP CONSTRAINT IF EXISTS "ProductPurchaseVariant_productId_fkey";

-- DropTable
DROP TABLE IF EXISTS "ProductPurchaseVariant";

-- AlterTable — o eixo ("Sabor") e a flag reservada saem do produto.
ALTER TABLE "Product" DROP COLUMN IF EXISTS "variacaoLabel";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "variacaoControlada";

-- AlterTable — documento de compra: id da variação e o nome congelado.
ALTER TABLE "PurchaseOrderItem" DROP COLUMN IF EXISTS "variantId";
ALTER TABLE "PurchaseOrderItem" DROP COLUMN IF EXISTS "variacaoNome";
ALTER TABLE "PurchaseItem" DROP COLUMN IF EXISTS "variantId";
ALTER TABLE "PurchaseItem" DROP COLUMN IF EXISTS "variacaoNome";

-- AlterTable — resolução do XML e o de-para por fornecedor.
ALTER TABLE "FiscalInboundItem" DROP COLUMN IF EXISTS "variantId";
ALTER TABLE "SupplierItemMap" DROP COLUMN IF EXISTS "variantId";

-- NÃO TOCAR: "SaleItem"."variantId" e "Production"."variantId" apontam para
-- ProductVariant (o TAMANHO do drink: P/M/G), que continua vivo. Só o nome da
-- coluna era parecido.
