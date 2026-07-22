-- Convite passa a ter link próprio: token secreto + validade.
-- Sem isso o convite só "pegava" se a pessoa se cadastrasse com o e-mail exato.

ALTER TABLE "Invite"
  ADD COLUMN "token"       TEXT,
  ADD COLUMN "expiresAt"   TIMESTAMP(3),
  ADD COLUMN "criadoPorId" TEXT;

-- Convites já existentes ganham token e 7 dias a partir de agora.
UPDATE "Invite"
SET "token"     = replace(gen_random_uuid()::text, '-', ''),
    "expiresAt" = NOW() + INTERVAL '7 days'
WHERE "token" IS NULL;

ALTER TABLE "Invite"
  ALTER COLUMN "token"     SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");
