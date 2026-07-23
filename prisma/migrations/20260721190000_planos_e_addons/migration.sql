-- Planos comerciais: STARTER/PRO/MULTI -> PRATA/OURO/DIAMANTE.
-- RENAME VALUE preserva as linhas existentes (recriar o enum obrigaria a
-- reescrever a coluna e perderia o default).
ALTER TYPE "Plan" RENAME VALUE 'STARTER' TO 'PRATA';
ALTER TYPE "Plan" RENAME VALUE 'PRO' TO 'OURO';
ALTER TYPE "Plan" RENAME VALUE 'MULTI' TO 'DIAMANTE';

ALTER TABLE "Tenant" ALTER COLUMN "plano" SET DEFAULT 'PRATA';

-- Add-ons contratados (slugs de src/lib/planos.ts) e lojas além das do plano.
ALTER TABLE "Tenant" ADD COLUMN "addons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tenant" ADD COLUMN "lojasExtras" INTEGER NOT NULL DEFAULT 0;

-- Backfill: a partir daqui o módulo só abre se o plano/add-on cobrir. Quem já
-- usava um módulo continua usando — cobrança some do app, não some do cliente.
UPDATE "Tenant"
SET "addons" = ARRAY(
  SELECT unnest FROM unnest(
    ARRAY[
      CASE WHEN "moduloFiscal" THEN 'fiscal' END,
      CASE WHEN "moduloAutoatendimento" THEN 'autoatendimento' END
    ]
  ) WHERE unnest IS NOT NULL
)
WHERE "moduloFiscal" OR "moduloAutoatendimento";

-- PDV e fidelização começam no Ouro; comodato e rota, no Diamante.
UPDATE "Tenant" SET "plano" = 'OURO'
WHERE "plano" = 'PRATA'
  AND ("moduloPdv" OR "moduloFiscal" OR "moduloAutoatendimento");

UPDATE "Tenant" SET "plano" = 'DIAMANTE'
WHERE "plano" <> 'DIAMANTE' AND ("moduloComodato" OR "moduloRota");
