-- ============================================================
-- RECEBIMENTO como entidade própria (GoodsReceipt).
--
-- Antes, "recebimento" não existia no banco: era um agrupamento de linhas de
-- Purchase pelo campo `numero`, e a conferência em andamento só tinha onde
-- morar quando havia XML (FiscalInbound). Consequência: recebimento sem nota
-- não existia até virar estoque, e um pedido com duas entregas não tinha como
-- dizer "esta é a primeira, aquela é a segunda".
--
-- Agora o recebimento é a entidade da doca. O pedido continua existindo e
-- pode gerar 0..N recebimentos; o recebimento pode existir sem pedido e sem
-- nota. O estoque continua se movendo só no fechamento (Purchase), que passa
-- a apontar para o recebimento que a gerou.
-- ============================================================

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('PENDENTE', 'EM_CONFERENCIA', 'DIVERGENCIA', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "GoodsReceiptOrigem" AS ENUM ('PEDIDO', 'XML', 'AVULSO');

-- ============================================================
-- PurchaseOrderStatus perde CONFERENCIA.
--
-- "Em conferência" é situação do RECEBIMENTO, não do pedido: o pedido segue
-- confirmado enquanto alguém conta caixa na porta. Manter os dois ciclos no
-- mesmo enum obrigava o pedido a mentir sobre um estado que não é dele — e a
-- esquecer o estado real (confirmado) quando a conferência começava.
-- ============================================================
UPDATE "PurchaseOrder" SET "status" = 'AGUARDANDO' WHERE "status" = 'CONFERENCIA';

ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('RASCUNHO', 'ENVIADO', 'AGUARDANDO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO');
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" TYPE "PurchaseOrderStatus" USING ("status"::text::"PurchaseOrderStatus");
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'RASCUNHO';
DROP TYPE "PurchaseOrderStatus_old";

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'EM_CONFERENCIA',
    "origem" "GoodsReceiptOrigem" NOT NULL,
    "purchaseOrderId" TEXT,
    "inboundId" TEXT,
    "supplierId" TEXT,
    "fornecedorLivre" TEXT,
    "observacao" TEXT,
    "divergenciaMotivo" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "canceladoMotivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_inboundId_key" ON "GoodsReceipt"("inboundId");
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_numero_key" ON "GoodsReceipt"("tenantId", "numero");
CREATE INDEX "GoodsReceipt_tenantId_idx" ON "GoodsReceipt"("tenantId");
CREATE INDEX "GoodsReceipt_tenantId_status_idx" ON "GoodsReceipt"("tenantId", "status");
CREATE INDEX "GoodsReceipt_siteId_idx" ON "GoodsReceipt"("siteId");
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");
CREATE INDEX "GoodsReceipt_tenantId_iniciadoEm_idx" ON "GoodsReceipt"("tenantId", "iniciadoEm");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable — a entrada de estoque passa a saber de qual recebimento nasceu.
ALTER TABLE "Purchase" ADD COLUMN "receiptId" TEXT;
CREATE INDEX "Purchase_receiptId_idx" ON "Purchase"("receiptId");
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable — o evento nascido na doca pertence ao recebimento.
ALTER TABLE "PurchaseEvent" ADD COLUMN "receiptId" TEXT;
CREATE INDEX "PurchaseEvent_receiptId_createdAt_idx" ON "PurchaseEvent"("receiptId", "createdAt");
ALTER TABLE "PurchaseEvent" ADD CONSTRAINT "PurchaseEvent_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- A linha de conferência passa a pertencer ao RECEBIMENTO, não à nota.
--
-- `inboundId` vira nulo: a conferência de um pedido sem XML, e a do avulso,
-- usam exatamente a mesma tabela. Era a ausência disto que obrigava a contagem
-- sem nota a viver no localStorage do aparelho de quem conferia.
-- ============================================================
ALTER TABLE "PurchaseReconciliationItem" ADD COLUMN "receiptId" TEXT;
ALTER TABLE "PurchaseReconciliationItem" ALTER COLUMN "inboundId" DROP NOT NULL;
CREATE INDEX "PurchaseReconciliationItem_receiptId_idx" ON "PurchaseReconciliationItem"("receiptId");
ALTER TABLE "PurchaseReconciliationItem" DROP CONSTRAINT IF EXISTS "PurchaseReconciliationItem_inboundId_fkey";
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "FiscalInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReconciliationItem" ADD CONSTRAINT "PurchaseReconciliationItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- BACKFILL 1 — recebimentos já finalizados.
--
-- Cada grupo (tenant, Purchase.numero) com fornecedor É um recebimento que
-- aconteceu: compra e bonificação da mesma conferência dividem o número. O
-- recebimento nasce direto em FINALIZADO, com a data da entrada.
-- ============================================================
INSERT INTO "GoodsReceipt" (
  "id", "tenantId", "siteId", "numero", "status", "origem",
  "purchaseOrderId", "inboundId", "supplierId", "observacao",
  "iniciadoEm", "finalizadoEm", "createdAt", "updatedAt", "createdBy"
)
SELECT
  gen_random_uuid()::text,
  g."tenantId",
  g."siteId",
  g."numero",
  'FINALIZADO'::"GoodsReceiptStatus",
  CASE
    WHEN g."inboundId" IS NOT NULL THEN 'XML'::"GoodsReceiptOrigem"
    WHEN g."origemPedido" IN ('XML', 'DFE', 'ENTRADA_MANUAL') OR g."purchaseOrderId" IS NULL
      THEN 'AVULSO'::"GoodsReceiptOrigem"
    ELSE 'PEDIDO'::"GoodsReceiptOrigem"
  END,
  g."purchaseOrderId",
  g."inboundId",
  g."supplierId",
  g."observacao",
  g."data",
  g."data",
  g."data",
  g."data",
  g."createdBy"
FROM (
  SELECT DISTINCT ON (p."tenantId", p."numero")
    p."tenantId",
    p."numero",
    p."siteId",
    p."supplierId",
    p."purchaseOrderId",
    p."observacao",
    p."data",
    p."createdBy",
    po."origem" AS "origemPedido",
    (
      SELECT fi."id" FROM "FiscalInbound" fi
      WHERE fi."purchaseId" IN (
        SELECT p2."id" FROM "Purchase" p2
        WHERE p2."tenantId" = p."tenantId" AND p2."numero" = p."numero"
      )
      LIMIT 1
    ) AS "inboundId"
  FROM "Purchase" p
  LEFT JOIN "PurchaseOrder" po ON po."id" = p."purchaseOrderId"
  WHERE p."numero" IS NOT NULL
    AND p."supplierId" IS NOT NULL
  -- A linha "principal" do grupo é a de compra (motivo nulo): é ela que
  -- carrega fornecedor, pedido e nota de verdade.
  ORDER BY p."tenantId", p."numero", (p."motivo" IS NULL) DESC, p."data" ASC
) g
ON CONFLICT ("tenantId", "numero") DO NOTHING;

-- Liga cada linha da razão ao recebimento que a gerou.
UPDATE "Purchase" p
SET "receiptId" = r."id"
FROM "GoodsReceipt" r
WHERE r."tenantId" = p."tenantId"
  AND r."numero" = p."numero"
  AND p."receiptId" IS NULL;

-- ============================================================
-- BACKFILL 2 — recebimentos ainda em andamento (nota aberta na doca).
--
-- Nota PENDENTE/CONCILIADO é trabalho em curso: vira recebimento aberto, com
-- número novo tirado do contador do tenant.
-- ============================================================
WITH base AS (
  SELECT
    fi."id",
    fi."tenantId",
    fi."siteId",
    fi."supplierId",
    fi."purchaseOrderId",
    fi."status",
    fi."dataEmissao",
    fi."importadoPor",
    COALESCE(dc."valor", 0) + ROW_NUMBER() OVER (
      PARTITION BY fi."tenantId" ORDER BY fi."dataEmissao" ASC, fi."id" ASC
    ) AS seq
  FROM "FiscalInbound" fi
  LEFT JOIN "DocumentCounter" dc
    ON dc."tenantId" = fi."tenantId" AND dc."tipo" = 'REC'
  WHERE fi."status" IN ('PENDENTE', 'CONCILIADO')
    AND NOT EXISTS (SELECT 1 FROM "GoodsReceipt" r WHERE r."inboundId" = fi."id")
)
INSERT INTO "GoodsReceipt" (
  "id", "tenantId", "siteId", "numero", "status", "origem",
  "purchaseOrderId", "inboundId", "supplierId",
  "iniciadoEm", "createdAt", "updatedAt", "createdBy"
)
SELECT
  gen_random_uuid()::text,
  b."tenantId",
  b."siteId",
  'REC-' || LPAD(b.seq::text, 5, '0'),
  CASE WHEN b."status" = 'PENDENTE'
    THEN 'PENDENTE'::"GoodsReceiptStatus"
    ELSE 'EM_CONFERENCIA'::"GoodsReceiptStatus"
  END,
  'XML'::"GoodsReceiptOrigem",
  b."purchaseOrderId",
  b."id",
  b."supplierId",
  b."dataEmissao",
  b."dataEmissao",
  b."dataEmissao",
  b."importadoPor"
FROM base b
ON CONFLICT ("tenantId", "numero") DO NOTHING;

-- Linhas de conferência migram para o recebimento da sua nota.
UPDATE "PurchaseReconciliationItem" i
SET "receiptId" = r."id"
FROM "GoodsReceipt" r
WHERE r."inboundId" = i."inboundId"
  AND i."receiptId" IS NULL;

-- Contador de REC não pode retroceder depois dos números emitidos acima.
INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
SELECT
  "tenantId",
  'REC',
  MAX(NULLIF(regexp_replace("numero", '\D', '', 'g'), '')::int)
FROM "GoodsReceipt"
WHERE "numero" ~ '^REC-\d+$'
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "tipo")
DO UPDATE SET "valor" = GREATEST("DocumentCounter"."valor", EXCLUDED."valor");

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['GoodsReceipt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- Novos marcos da timeline: o recebimento tem começo e fim próprios.
-- ============================================================
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'RECEBIMENTO_INICIADO';
ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'RECEBIMENTO_CANCELADO';

-- O canhoto que o entregador deixou, quando o XML ainda não veio.
ALTER TABLE "GoodsReceipt" ADD COLUMN "numeroNota" TEXT;
