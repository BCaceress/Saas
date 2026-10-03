-- ============================================================
-- Vários códigos de barras por produto (fator 1)
--
-- "Açúcar 1 kg" é um produto na prateleira e um preço no caixa, mas chega com
-- o código da União numa semana e da Caravelas na outra. Até aqui o operador
-- tinha de abrir três cadastros do mesmo açúcar — três saldos, três preços.
--
-- `Product.ean` CONTINUA existindo como ESPELHO do código principal: ~700
-- leituras dependem dele (etiqueta, relatório, busca) e migrar tudo de uma vez
-- não traria ganho nenhum. A verdade é a tabela; `ean` é derivado e escrito só
-- por `sincronizarCodigos` (src/app/(app)/produtos/actions.ts).
-- ============================================================

CREATE TABLE "ProductBarcode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- Um código, um dono. Esta regra já existia em `assertCodigosLivres`, mas só
-- em código: qualquer caminho novo que esquecesse de chamar a função deixava
-- dois produtos com o mesmo bipe, e o PDV escolhia um ao acaso.
CREATE UNIQUE INDEX "ProductBarcode_tenantId_codigo_key" ON "ProductBarcode"("tenantId", "codigo");
CREATE INDEX "ProductBarcode_tenantId_idx" ON "ProductBarcode"("tenantId");
CREATE INDEX "ProductBarcode_productId_idx" ON "ProductBarcode"("productId");

ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ───────────────────────────────────────────────
-- Antes de ligar RLS: `FORCE ROW LEVEL SECURITY` vale até para o dono da
-- tabela, e este INSERT não roda dentro de `set_config('app.current_tenant')`.
--
-- `ON CONFLICT DO NOTHING` cobre o legado em que dois produtos do mesmo tenant
-- compartilham um EAN (a trava era só de aplicação). O segundo produto fica
-- sem linha aqui e segue achável pelo espelho `Product.ean`, que as consultas
-- continuam varrendo em OR.
INSERT INTO "ProductBarcode" ("id", "tenantId", "productId", "codigo", "principal")
SELECT gen_random_uuid()::text, "tenantId", "id", "ean", true
  FROM "Product"
 WHERE "ean" IS NOT NULL AND btrim("ean") <> ''
ON CONFLICT DO NOTHING;

-- ── Código bipado na venda ─────────────────────────────────
-- O cEAN da NFC-e tem de ser o GTIN do item entregue. Com um produto
-- respondendo por várias marcas, emitir sempre o principal põe na nota o
-- código de um pacote que não saiu da loja.
ALTER TABLE "SaleItem" ADD COLUMN "codigoBarras" TEXT;

-- ── RLS (Camada 2) ─────────────────────────────────────────
ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductBarcode";
CREATE POLICY tenant_isolation ON "ProductBarcode"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

-- ── Buraco de RLS que esta migration encontrou ─────────────
-- `SupplierCatalogItemProduct` nasceu por `db push` depois da migration que
-- ligou RLS nas demais, e ficou sem policy: com o papel `app_user` (sem
-- BYPASSRLS) era tabela de negócio onde uma falha da Camada 1 vazaria linha
-- entre tenants. A rede abaixo só a encontrou agora porque é ela que derruba o
-- deploy — mesma história do `StockLot` na 20260727180000.
ALTER TABLE "SupplierCatalogItemProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierCatalogItemProduct" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierCatalogItemProduct";
CREATE POLICY tenant_isolation ON "SupplierCatalogItemProduct"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

-- Mesma rede da migration 20260721180000: tabela de negócio com tenantId e sem
-- policy derruba o deploy, em vez de virar achado de auditoria.
--
-- `QuotationLink` e `PurchaseOrderLink` entram na lista de fora, ao lado de
-- `Invite`, e não por esquecimento: são as tabelas do LINK PÚBLICO
-- (`/cotacao/[token]`, `/pedido/[token]`). Quem abre esse link é o fornecedor,
-- sem login e portanto sem tenant — todo acesso é por `basePrisma` fora de
-- `runWithTenant` (ver lib/compras/cotacao-link.ts e pedido-link.ts). Com
-- `FORCE ROW LEVEL SECURITY` e `app.current_tenant` vazio, `current_setting`
-- devolve NULL e o link responderia "não encontrado" para todo fornecedor. O
-- segredo ali é o token, não o tenant.
DO $$
DECLARE
  faltantes TEXT;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO faltantes
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name = 'tenantId'
     AND c.table_name NOT IN (
       'Membership', 'MembershipAccess', 'Subscription', 'Invite',
       'QuotationLink', 'PurchaseOrderLink'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.table_name
          AND p.policyname = 'tenant_isolation'
     );

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas com tenantId e sem policy tenant_isolation: %', faltantes;
  END IF;
END $$;
