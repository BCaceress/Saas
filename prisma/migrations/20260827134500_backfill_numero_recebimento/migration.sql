-- Numeração retroativa dos recebimentos (REC-00001…), por tenant.
--
-- A tela de Recebimentos agrupa as linhas de Purchase por `numero` — é assim
-- que compra e bonificação da mesma conferência aparecem como UM recebimento.
-- Linha sem número viraria um grupo só com todas as outras, então nenhuma pode
-- ficar nula.
--
-- Entrada antiga ganha um número por linha: as que foram gravadas antes desta
-- migration não têm como saber quem era irmã de quem (nada as ligava além do
-- instante da escrita), e adivinhar por proximidade de horário juntaria coisas
-- que nunca foram o mesmo recebimento. Daqui para frente o número é emitido
-- uma vez por conferência e compartilhado pelas linhas.

WITH numerado AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId"
      ORDER BY "data" ASC, "createdAt" ASC, id ASC
    ) AS seq
  FROM "Purchase"
  WHERE "numero" IS NULL
)
UPDATE "Purchase" p
SET "numero" = 'REC-' || LPAD(n.seq::text, 5, '0')
FROM numerado n
WHERE p.id = n.id;

-- Alinha o contador com o histórico: sem isto o próximo recebimento sairia
-- como REC-00001 e colidiria visualmente com uma entrada antiga.
INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
SELECT "tenantId", 'REC', COUNT(*)::int
FROM "Purchase"
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "tipo")
DO UPDATE SET "valor" = GREATEST("DocumentCounter"."valor", EXCLUDED."valor");
