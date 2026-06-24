-- RLS — segunda camada de isolamento por tenant (PRD Fase 2 §8).
-- Cada tabela de negócio: ENABLE + FORCE row level security (FORCE faz o próprio
-- dono da tabela ficar sujeito à policy — no Neon a app conecta como o dono).
-- Policy: só enxerga/escreve linhas cujo tenantId == app.current_tenant.
-- current_setting(..., TRUE) = missing_ok: sem o setting retorna NULL e
-- "tenantId = NULL" é NULL => nega tudo (fail-safe). O runtime (lib/prisma.ts)
-- faz SET LOCAL app.current_tenant dentro da transação de cada query.
--
-- Tabelas de controle/auth (Tenant, Membership, Subscription, User, Account,
-- Session, VerificationToken) NÃO entram: são acessadas pelo basePrisma fora do
-- contexto de tenant (auth/provisionamento).

DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'Brand',
    'Category',
    'Subcategory',
    'FiscalProfile',
    'StorageLocation',
    'Supplier',
    'ProductSupplier',
    'Product',
    'Stock',
    'ProductPackaging',
    'ProductComponent',
    'ProductVariant',
    'Tag',
    'ProductTag',
    'ProductSalesChannel'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) '
      'WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
