-- ============================================================
-- RLS em StockLot
--
-- A tabela nasceu por `db push` (lotes/validade) depois da migration que ligou
-- RLS nas demais, então ficou sem policy: com o papel `app_user` (sem
-- BYPASSRLS) ela era a única tabela de negócio onde uma falha da Camada 1
-- vazaria linha entre tenants.
--
-- Mesma policy das outras: leitura e escrita amarradas a
-- `app.current_tenant`, setado por transação em lib/prisma.ts.
-- ============================================================

ALTER TABLE "StockLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockLot";
CREATE POLICY tenant_isolation ON "StockLot"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));

-- Mesma rede de proteção da migration 20260721180000: tabela de negócio com
-- tenantId e sem policy derruba o deploy, em vez de virar achado de auditoria.
DO $$
DECLARE
  faltantes TEXT;
BEGIN
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO faltantes
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name = 'tenantId'
     AND c.table_name NOT IN ('Membership', 'MembershipAccess', 'Subscription', 'Invite')
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
