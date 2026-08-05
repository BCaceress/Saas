-- ============================================================
-- Relatórios configuráveis — modelos salvos de configuração.
--
-- `relatorioId` é o slug do catálogo em código, não FK: o catálogo é código
-- versionado e um relatório aposentado não pode derrubar o modelo de ninguém.
-- `config` guarda a CONFIGURAÇÃO (filtros, colunas, ordem, agrupamento), nunca
-- o resultado — abrir o modelo tem de trazer o dado de hoje.
-- Tabela nova nasce com RLS ligada (Camada 2).
-- ============================================================

-- CreateTable
CREATE TABLE "ReportPreset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "relatorioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "compartilhado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportPreset_tenantId_relatorioId_ownerUserId_nome_key"
  ON "ReportPreset"("tenantId", "relatorioId", "ownerUserId", "nome");
CREATE INDEX "ReportPreset_tenantId_relatorioId_idx"
  ON "ReportPreset"("tenantId", "relatorioId");
CREATE INDEX "ReportPreset_tenantId_ownerUserId_idx"
  ON "ReportPreset"("tenantId", "ownerUserId");

ALTER TABLE "ReportPreset" ADD CONSTRAINT "ReportPreset_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Camada 2)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ReportPreset'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;

-- Rede de proteção: tabela de negócio com tenantId e sem policy derruba o deploy.
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
