-- Reconciliação de drift: alterações aplicadas via `db:push` durante a Fase 1/2
-- que faltavam no histórico de migrations. O banco atual já contém tudo isto
-- (esta migration foi registrada via `migrate resolve --applied`, não executada).
-- O DDL existe para o replay em bancos limpos (shadow DB / novos ambientes).

-- Subcategory: flag de ativo (Fase 1)
ALTER TABLE "Subcategory" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;

-- Supplier: endereço (Fase 1)
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "cep" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "logradouro" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "numero" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "complemento" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bairro" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "municipio" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "uf" TEXT;

-- ProductVariant: variações de tamanho (Fase 2 §5)
CREATE TABLE IF NOT EXISTS "ProductVariant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "volumeMl" DECIMAL(10,2),
    "fatorEscala" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "precoVenda" DECIMAL(10,2),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductVariant_tenantId_idx" ON "ProductVariant"("tenantId");
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_nome_key" ON "ProductVariant"("productId", "nome");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_productId_fkey'
  ) THEN
    ALTER TABLE "ProductVariant"
      ADD CONSTRAINT "ProductVariant_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
