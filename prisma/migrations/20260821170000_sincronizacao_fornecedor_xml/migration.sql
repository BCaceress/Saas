-- Sincronização inteligente do fornecedor pelo XML da NF-e.
--
-- O bloco `emit` da nota é cadastro atualizado de graça — vem da SEFAZ, não da
-- digitação. Esta migration cria: (a) o cache de relacionamento no Supplier,
-- (b) a trilha do que a sincronização mudou (e do que ainda espera decisão),
-- (c) o histórico de itens que cada fornecedor já entregou.
--
-- O backfill reconstrói tudo a partir das notas JÁ importadas: quem usa o
-- módulo há meses ganha o histórico pronto, sem reimportar XML nenhum.

-- CreateEnum
CREATE TYPE "SupplierSyncTipo" AS ENUM ('AUTOMATICO', 'SUGESTAO', 'HISTORICO');
CREATE TYPE "SupplierSyncStatus" AS ENUM ('APLICADA', 'PENDENTE', 'IGNORADA');

-- AlterTable
ALTER TABLE "Supplier"
  ADD COLUMN "crt" INTEGER,
  ADD COLUMN "ultimaCompraEm" TIMESTAMP(3),
  ADD COLUMN "ultimaCompraNota" TEXT,
  ADD COLUMN "ultimaCompraValor" DECIMAL(12,2),
  ADD COLUMN "comprasNotas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "prazoMedioDias" INTEGER;

-- CreateTable
CREATE TABLE "SupplierSyncChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "inboundId" TEXT,
    "chave" TEXT,
    "notaNumero" TEXT,
    "tipo" "SupplierSyncTipo" NOT NULL,
    "status" "SupplierSyncStatus" NOT NULL DEFAULT 'APLICADA',
    "campo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "decisao" TEXT,
    "decididoEm" TIMESTAMP(3),
    "decididoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSyncChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierSyncChange_tenantId_idx" ON "SupplierSyncChange"("tenantId");
CREATE INDEX "SupplierSyncChange_supplierId_createdAt_idx" ON "SupplierSyncChange"("supplierId", "createdAt");
CREATE INDEX "SupplierSyncChange_tenantId_status_idx" ON "SupplierSyncChange"("tenantId", "status");

-- CreateTable
CREATE TABLE "SupplierProductHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "codigoFornecedor" TEXT NOT NULL,
    "gtin" TEXT,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT,
    "cest" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "productId" TEXT,
    "vezes" INTEGER NOT NULL DEFAULT 1,
    "quantidadeTotal" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "ultimoPreco" DECIMAL(12,4),
    "ultimaNota" TEXT,
    "primeiraCompraEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaCompraEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductHistory_supplierId_codigoFornecedor_key" ON "SupplierProductHistory"("supplierId", "codigoFornecedor");
CREATE INDEX "SupplierProductHistory_tenantId_idx" ON "SupplierProductHistory"("tenantId");
CREATE INDEX "SupplierProductHistory_supplierId_ultimaCompraEm_idx" ON "SupplierProductHistory"("supplierId", "ultimaCompraEm");
CREATE INDEX "SupplierProductHistory_productId_idx" ON "SupplierProductHistory"("productId");
CREATE INDEX "SupplierProductHistory_tenantId_gtin_idx" ON "SupplierProductHistory"("tenantId", "gtin");

-- AddForeignKey
ALTER TABLE "SupplierSyncChange" ADD CONSTRAINT "SupplierSyncChange_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierProductHistory" ADD CONSTRAINT "SupplierProductHistory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Backfill a partir das notas já importadas.
-- ============================================================

-- Itens que cada fornecedor já entregou. A agregação conta as aparições; o
-- LATERAL pega a foto da nota MAIS RECENTE (descrição, GTIN e último preço) —
-- é o que a cotação lê para dizer "quanto paguei da última vez".
INSERT INTO "SupplierProductHistory" (
  "id", "tenantId", "supplierId", "codigoFornecedor", "gtin", "descricao", "ncm", "cest",
  "unidade", "productId", "vezes", "quantidadeTotal", "ultimoPreco", "ultimaNota",
  "primeiraCompraEm", "ultimaCompraEm", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  a."tenantId",
  a."supplierId",
  a."codigoFornecedor",
  u."gtin",
  u."descricao",
  u."ncm",
  u."cest",
  u."unidade",
  u."productId",
  a."vezes",
  a."quantidadeTotal",
  -- Bonificação não é preço praticado: gravar zero faria o comparador mentir.
  CASE WHEN u."bonificacao" THEN NULL ELSE u."valorUnitario" END,
  u."ultimaNota",
  a."primeira",
  a."ultima",
  NOW(),
  NOW()
FROM (
  SELECT
    fi."tenantId",
    fi."supplierId",
    it."codigoFornecedor",
    COUNT(*)::int AS "vezes",
    SUM(it."quantidade")::decimal(14,3) AS "quantidadeTotal",
    MIN(fi."dataEmissao") AS "primeira",
    MAX(fi."dataEmissao") AS "ultima"
  FROM "FiscalInboundItem" it
  JOIN "FiscalInbound" fi ON fi."id" = it."inboundId"
  WHERE fi."supplierId" IS NOT NULL
  GROUP BY fi."tenantId", fi."supplierId", it."codigoFornecedor"
) a
JOIN LATERAL (
  SELECT
    it."gtin", it."descricao", it."ncm", it."cest", it."unidade", it."productId",
    it."valorUnitario", it."bonificacao",
    fi."numero" || '/' || fi."serie" AS "ultimaNota"
  FROM "FiscalInboundItem" it
  JOIN "FiscalInbound" fi ON fi."id" = it."inboundId"
  WHERE fi."supplierId" = a."supplierId"
    AND it."codigoFornecedor" = a."codigoFornecedor"
  ORDER BY fi."dataEmissao" DESC
  LIMIT 1
) u ON TRUE;

-- Última compra e quantidade de notas por fornecedor.
UPDATE "Supplier" s
SET "comprasNotas" = x."notas",
    "ultimaCompraEm" = x."ultima",
    "ultimaCompraNota" = x."nota",
    "ultimaCompraValor" = x."valor"
FROM (
  SELECT DISTINCT ON (fi."supplierId")
    fi."supplierId",
    fi."dataEmissao" AS "ultima",
    fi."numero" || '/' || fi."serie" AS "nota",
    fi."valorTotal" AS "valor",
    COUNT(*) OVER (PARTITION BY fi."supplierId")::int AS "notas"
  FROM "FiscalInbound" fi
  WHERE fi."supplierId" IS NOT NULL
  ORDER BY fi."supplierId", fi."dataEmissao" DESC
) x
WHERE s."id" = x."supplierId";

-- Prazo praticado das duplicatas. Nota à vista não tem duplicata e fica de
-- fora: zero dia puxaria a média para baixo. O backfill usa todo o histórico;
-- daqui em diante o app recalcula sobre as últimas notas.
UPDATE "Supplier" s
SET "prazoMedioDias" = p."media"
FROM (
  SELECT
    fi."supplierId",
    ROUND(AVG(EXTRACT(EPOCH FROM (d."vencimento" - fi."dataEmissao")) / 86400))::int AS "media"
  FROM "FiscalInboundDuplicata" d
  JOIN "FiscalInbound" fi ON fi."id" = d."inboundId"
  WHERE fi."supplierId" IS NOT NULL
    AND d."vencimento" >= fi."dataEmissao"
    AND d."vencimento" <= fi."dataEmissao" + INTERVAL '365 days'
  GROUP BY fi."supplierId"
) p
WHERE s."id" = p."supplierId";

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio. Depois do
-- backfill de propósito: com FORCE nem o dono escapa da policy, e os comandos
-- acima rodam sem `app.current_tenant` definido.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['SupplierSyncChange', 'SupplierProductHistory'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
