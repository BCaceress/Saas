-- ============================================================
-- Central de Relatórios — favoritos, histórico de execução e agendamentos.
--
-- `relatorioId` é o slug do catálogo em código, não FK: o catálogo é código
-- versionado e um relatório aposentado não pode derrubar o favorito de ninguém.
-- Tabelas novas nascem com RLS ligada (Camada 2).
-- ============================================================

-- CreateEnum
CREATE TYPE "ReportFrequencia" AS ENUM ('DIARIO', 'SEMANAL', 'MENSAL');

-- CreateTable
CREATE TABLE "ReportFavorite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relatorioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportFavorite_tenantId_userId_relatorioId_key"
  ON "ReportFavorite"("tenantId", "userId", "relatorioId");
CREATE INDEX "ReportFavorite_tenantId_idx" ON "ReportFavorite"("tenantId");
CREATE INDEX "ReportFavorite_tenantId_userId_idx" ON "ReportFavorite"("tenantId", "userId");

ALTER TABLE "ReportFavorite" ADD CONSTRAINT "ReportFavorite_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "relatorioId" TEXT NOT NULL,
    "parametros" JSONB,
    "formato" TEXT NOT NULL DEFAULT 'tela',
    "duracaoMs" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportRun_tenantId_criadoEm_idx" ON "ReportRun"("tenantId", "criadoEm");
CREATE INDEX "ReportRun_tenantId_relatorioId_idx" ON "ReportRun"("tenantId", "relatorioId");
CREATE INDEX "ReportRun_tenantId_userId_criadoEm_idx" ON "ReportRun"("tenantId", "userId", "criadoEm");

ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "relatorioId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "frequencia" "ReportFrequencia" NOT NULL,
    "hora" INTEGER NOT NULL DEFAULT 7,
    "diaSemana" INTEGER,
    "diaMes" INTEGER,
    "parametros" JSONB,
    "formato" TEXT NOT NULL DEFAULT 'pdf',
    "destinatarios" JSONB NOT NULL DEFAULT '[]',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "proximaExecucao" TIMESTAMP(3),
    "ultimaExecucao" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_tenantId_idx" ON "ReportSchedule"("tenantId");
CREATE INDEX "ReportSchedule_ativo_proximaExecucao_idx" ON "ReportSchedule"("ativo", "proximaExecucao");

ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Camada 2)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ReportFavorite', 'ReportRun', 'ReportSchedule'] LOOP
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
