-- RLS para as tabelas da Fase 4 (Vendas & Checkout).
-- Mesma política das demais tabelas de negócio: ENABLE + FORCE row level security
-- e isolamento por tenantId == app.current_tenant (set pelo runtime em cada query).
-- Idempotente: pode rodar de novo sem efeito colateral.

DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'Sale',
    'SaleItem',
    'Payment',
    'CashSession',
    'CashMovement',
    'SitePaymentMethod'
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
