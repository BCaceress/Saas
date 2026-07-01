-- Backfill locais orfaos (sem site) para o site mais antigo do tenant.
UPDATE "StorageLocation" sl
SET "siteId" = (
  SELECT s.id FROM "Site" s
  WHERE s."tenantId" = sl."tenantId"
  ORDER BY s."createdAt" ASC
  LIMIT 1
)
WHERE sl."siteId" IS NULL;

-- Armazenagem passa a ser obrigatoriamente vinculada a um site.
ALTER TABLE "StorageLocation" ALTER COLUMN "siteId" SET NOT NULL;

-- Nome pode repetir entre sites diferentes (ex.: "Câmara Fria" em cada loja).
DROP INDEX "StorageLocation_tenantId_nome_key";
CREATE UNIQUE INDEX "StorageLocation_tenantId_siteId_nome_key" ON "StorageLocation"("tenantId", "siteId", "nome");
