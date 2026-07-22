-- ============================================================
-- RLS — provisionar o role da APLICAÇÃO (sem BYPASSRLS)
-- ============================================================
-- Por quê: o role padrão do Neon (`neondb_owner`) tem BYPASSRLS e ignora as
-- policies de tenant. A app precisa conectar como um role SUJEITO à RLS.
-- As migrations/seed continuam com `neondb_owner` (BYPASSRLS) via DIRECT_URL.
--
-- Passo a passo:
--   1. Crie o role abaixo (troque a senha). Pode ser via Neon Console
--      (Roles → New Role) OU rodando este bloco com a conexão de owner.
--   2. Rode os GRANTs (como `neondb_owner`).
--   3. Aponte DATABASE_URL (pooled) para `app_user`. Mantenha DIRECT_URL no
--      `neondb_owner`. Reinicie a app.
--
-- Rodar como owner:  psql "$DIRECT_URL" -f prisma/rls-app-role.sql
-- (ou cole no SQL Editor do Neon)
-- ============================================================

-- 1. Role da aplicação (NOBYPASSRLS é o default; explícito por clareza).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'TROQUE_ESTA_SENHA' NOBYPASSRLS;
  END IF;
END $$;

-- 2. Privilégios. App só faz DML (sem DDL); RLS faz o isolamento por linha.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Funções: a numeração fiscal (fiscal_proximo_numero) é chamada pela app.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- 3. Privilégios padrão p/ tabelas/sequences/funções futuras (criadas pelo owner).
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;

-- Verificação rápida (deve mostrar rolbypassrls = false):
-- SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
