-- Segunda rodada da espinha de compras: o que faltava para o ciclo fechar.
--
--   1. Numeração atômica (DocumentCounter) — `count() + 1` não é sequencial:
--      dois operadores no mesmo segundo estouravam o unique de `numero`.
--   2. Trilha de baixa (AccountPayablePayment) — dinheiro saía sem autor.
--   3. Estorno de entrada — desfazer não existia; só ajuste manual.
--   4. NF-e de devolução — `numeroNota` era campo digitado à mão.
--   5. Frete de CT-e — o conhecimento era recusado e o custo sumia.
--   6. Contas a receber + fluxo de caixa — só existia o lado que sai.
--   7. Limiares dos três alertas novos do Documento de Compra.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "BaixaOrigem" AS ENUM ('PAGAMENTO', 'CREDITO_DEVOLUCAO', 'AJUSTE');
CREATE TYPE "AccountReceivableStatus" AS ENUM ('ABERTO', 'RECEBIDO', 'CANCELADO');
CREATE TYPE "AccountReceivableOrigem" AS ENUM ('MANUAL', 'VENDA_PRAZO', 'COMODATO', 'OUTRO');

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ESTORNO';

-- ============================================================
-- 2. Limiares dos alertas novos
-- ============================================================
ALTER TABLE "Tenant"
  ADD COLUMN "entradaSemDocumentoDias" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "saldoPendenteDias" INTEGER NOT NULL DEFAULT 5;

-- ============================================================
-- 3. DocumentCounter — numeração que não colide
-- ============================================================
CREATE TABLE "DocumentCounter" (
  "tenantId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "valor" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("tenantId", "tipo")
);

CREATE INDEX "DocumentCounter_tenantId_idx" ON "DocumentCounter"("tenantId");

-- Alinha o contador com o histórico. Sem isto quem já tem 340 pedidos receberia
-- PC-00001 de volta e bateria no unique na primeira criação.
INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
SELECT "tenantId", 'PC', MAX(COALESCE(NULLIF(regexp_replace("numero", '\D', '', 'g'), ''), '0')::INTEGER)
  FROM "PurchaseOrder"
 GROUP BY "tenantId"
ON CONFLICT ("tenantId", "tipo") DO UPDATE
  SET "valor" = GREATEST("DocumentCounter"."valor", EXCLUDED."valor");

INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
SELECT "tenantId", 'COT', MAX(COALESCE(NULLIF(regexp_replace("numero", '\D', '', 'g'), ''), '0')::INTEGER)
  FROM "Quotation"
 GROUP BY "tenantId"
ON CONFLICT ("tenantId", "tipo") DO UPDATE
  SET "valor" = GREATEST("DocumentCounter"."valor", EXCLUDED."valor");

-- ============================================================
-- 4. AccountPayablePayment — quem deu baixa, quando, quanto
-- ============================================================
CREATE TABLE "AccountPayablePayment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "origem" "BaixaOrigem" NOT NULL DEFAULT 'PAGAMENTO',
  "valor" DECIMAL(12,2) NOT NULL,
  "pagoEm" TIMESTAMP(3) NOT NULL,
  "returnId" TEXT,
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "AccountPayablePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountPayablePayment_tenantId_idx" ON "AccountPayablePayment"("tenantId");
CREATE INDEX "AccountPayablePayment_tenantId_pagoEm_idx" ON "AccountPayablePayment"("tenantId", "pagoEm");
CREATE INDEX "AccountPayablePayment_payableId_idx" ON "AccountPayablePayment"("payableId");

ALTER TABLE "AccountPayablePayment" ADD CONSTRAINT "AccountPayablePayment_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "AccountPayable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 5. Estorno de entrada
-- ============================================================
ALTER TABLE "Purchase"
  ADD COLUMN "estornadaEm" TIMESTAMP(3),
  ADD COLUMN "estornoMotivo" TEXT,
  ADD COLUMN "estornadaPor" TEXT;

-- ============================================================
-- 6. NF-e de devolução
-- ============================================================
ALTER TABLE "FiscalDocument" ADD COLUMN "chaveReferenciada" TEXT;

ALTER TABLE "SupplierReturn" ADD COLUMN "fiscalDocumentId" TEXT;

CREATE UNIQUE INDEX "SupplierReturn_fiscalDocumentId_key" ON "SupplierReturn"("fiscalDocumentId");

ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_fiscalDocumentId_fkey"
  FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 7. Frete de CT-e rateado na nota
-- ============================================================
ALTER TABLE "FiscalInbound"
  ADD COLUMN "freteCteValor" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "freteCteChave" TEXT,
  ADD COLUMN "freteCteRateadoEm" TIMESTAMP(3);

-- ============================================================
-- 8. Contas a receber — a outra metade do caixa
-- ============================================================
CREATE TABLE "AccountReceivable" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "saleId" TEXT,
  "origem" "AccountReceivableOrigem" NOT NULL DEFAULT 'MANUAL',
  "numeroDocumento" TEXT,
  "parcela" TEXT,
  "descricao" TEXT NOT NULL,
  "vencimento" TIMESTAMP(3) NOT NULL,
  "valor" DECIMAL(12,2) NOT NULL,
  "valorRecebido" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "AccountReceivableStatus" NOT NULL DEFAULT 'ABERTO',
  "recebidoEm" TIMESTAMP(3),
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  CONSTRAINT "AccountReceivable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountReceivable_tenantId_idx" ON "AccountReceivable"("tenantId");
CREATE INDEX "AccountReceivable_tenantId_status_vencimento_idx" ON "AccountReceivable"("tenantId", "status", "vencimento");
CREATE INDEX "AccountReceivable_customerId_idx" ON "AccountReceivable"("customerId");
CREATE INDEX "AccountReceivable_saleId_idx" ON "AccountReceivable"("saleId");

ALTER TABLE "AccountReceivable" ADD CONSTRAINT "AccountReceivable_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountReceivable" ADD CONSTRAINT "AccountReceivable_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AccountReceivablePayment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "origem" "BaixaOrigem" NOT NULL DEFAULT 'PAGAMENTO',
  "valor" DECIMAL(12,2) NOT NULL,
  "recebidoEm" TIMESTAMP(3) NOT NULL,
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "AccountReceivablePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountReceivablePayment_tenantId_idx" ON "AccountReceivablePayment"("tenantId");
CREATE INDEX "AccountReceivablePayment_tenantId_recebidoEm_idx" ON "AccountReceivablePayment"("tenantId", "recebidoEm");
CREATE INDEX "AccountReceivablePayment_receivableId_idx" ON "AccountReceivablePayment"("receivableId");

ALTER TABLE "AccountReceivablePayment" ADD CONSTRAINT "AccountReceivablePayment_receivableId_fkey"
  FOREIGN KEY ("receivableId") REFERENCES "AccountReceivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 9. RLS — Camada 2 nas tabelas novas
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'DocumentCounter',
    'AccountPayablePayment',
    'AccountReceivable',
    'AccountReceivablePayment'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
