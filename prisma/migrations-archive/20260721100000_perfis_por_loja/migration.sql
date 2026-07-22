-- Papel escalar (Role) vira lista de acessos (perfil x loja).
-- OWNER/ADMIN colapsam em ADMINISTRADOR; OWNER vira flag proprietario.

CREATE TYPE "Perfil" AS ENUM ('ADMINISTRADOR', 'ESTOQUISTA', 'CAIXA', 'FINANCEIRO', 'CONTADOR');

-- ── Membership ──────────────────────────────────────────────
ALTER TABLE "Membership"
  ADD COLUMN "proprietario" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ativo"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ultimoAcesso" TIMESTAMP(3);

UPDATE "Membership" SET "proprietario" = true WHERE "role" = 'OWNER';

-- ── MembershipAccess ────────────────────────────────────────
CREATE TABLE "MembershipAccess" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "perfil"       "Perfil" NOT NULL,
  "siteId"       TEXT,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipAccess_membershipId_perfil_siteId_key"
  ON "MembershipAccess" ("membershipId", "perfil", "siteId");

-- NULL não colide em Postgres: sem este índice parcial daria para duplicar o
-- acesso global (siteId IS NULL) do mesmo perfil.
CREATE UNIQUE INDEX "MembershipAccess_global_key"
  ON "MembershipAccess" ("membershipId", "perfil")
  WHERE "siteId" IS NULL;

CREATE INDEX "MembershipAccess_tenantId_siteId_idx"
  ON "MembershipAccess" ("tenantId", "siteId");

ALTER TABLE "MembershipAccess"
  ADD CONSTRAINT "MembershipAccess_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipAccess"
  ADD CONSTRAINT "MembershipAccess_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Migração dos dados ──────────────────────────────────────
-- OWNER + ADMIN -> ADMINISTRADOR (todas as lojas)
INSERT INTO "MembershipAccess" ("id", "tenantId", "membershipId", "perfil", "siteId")
SELECT gen_random_uuid()::text, m."tenantId", m."id", 'ADMINISTRADOR', NULL
FROM "Membership" m
WHERE m."role" IN ('OWNER', 'ADMIN');

-- MEMBER -> operação do dia a dia (caixa + estoque) em todas as lojas
INSERT INTO "MembershipAccess" ("id", "tenantId", "membershipId", "perfil", "siteId")
SELECT gen_random_uuid()::text, m."tenantId", m."id", p."perfil", NULL
FROM "Membership" m
CROSS JOIN (VALUES ('CAIXA'::"Perfil"), ('ESTOQUISTA'::"Perfil")) AS p("perfil")
WHERE m."role" = 'MEMBER';

-- ── Invite: role -> acessos (Json) ──────────────────────────
ALTER TABLE "Invite" ADD COLUMN "acessos" JSONB NOT NULL DEFAULT '[]';

UPDATE "Invite" SET "acessos" =
  CASE "role"
    WHEN 'MEMBER' THEN '[{"perfil":"CAIXA","siteId":null},{"perfil":"ESTOQUISTA","siteId":null}]'::jsonb
    ELSE '[{"perfil":"ADMINISTRADOR","siteId":null}]'::jsonb
  END;

-- ── Fim do Role ─────────────────────────────────────────────
ALTER TABLE "Membership" DROP COLUMN "role";
ALTER TABLE "Invite" DROP COLUMN "role";
DROP TYPE "Role";
