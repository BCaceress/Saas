-- ============================================================
-- RLS nas 26 tabelas de negócio que ficaram de fora
--
-- Elas nasceram da Fase 3 em diante por `db push`, depois da migration que
-- ligou RLS — então nunca receberam policy. Entre elas: Customer (CPF),
-- PaymentProviderConfig (token do PSP), Purchase, Sale-adjacentes e todo o
-- razão de estoque.
--
-- Ligar isto NÃO muda nada enquanto a app conectar como `neondb_owner`:
-- BYPASSRLS ignora policy. Só passa a valer quando DATABASE_URL apontar para
-- um papel sem bypass (ver prisma/rls-app-role.sql).
--
-- Continuam FORA, por desenho: Tenant, User, Account, Session,
-- VerificationToken, Membership, MembershipAccess, Subscription e Invite —
-- lidas pelo basePrisma ANTES de existir contexto de tenant (login,
-- provisionamento, aceite de convite). Ligar RLS nelas quebraria a autenticação.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  business_tables TEXT[] := ARRAY[
    'ComodatoAsset',
    'ComodatoLoan',
    'ContainerMovement',
    'ContainerType',
    'CouponSend',
    'Customer',
    'DashboardWidgetPref',
    'InsightFeedback',
    'Inventory',
    'InventoryItem',
    'PaymentProviderConfig',
    'PaymentTerminal',
    'ProductComponentGroup',
    'Production',
    'Purchase',
    'PurchaseItem',
    'PurchaseOrder',
    'PurchaseOrderItem',
    'Requisicao',
    'RequisicaoItem',
    'Site',
    'StockMovement',
    'StockSnapshot',
    'TotemDevice',
    'Transfer',
    'TransferItem'
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

-- Rede de proteção: daqui para frente, tabela de negócio nova (com tenantId)
-- sem policy é erro de migration, não descoberta em auditoria seis meses
-- depois. Roda no fim de cada deploy de schema.
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
