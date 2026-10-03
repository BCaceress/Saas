-- Cotação recorrente + custo efetivo.
--
-- 1. QuotationSchedule: a cotação da semana gerada sozinha a partir de um
--    molde (lista + fornecedores), sempre em RASCUNHO.
-- 2. Campos do custo efetivo: prazo de pagamento em dias médios e impostos
--    (ST/IPI) informados na proposta, e o custo do dinheiro da empresa.
-- Tudo aditivo: nenhuma coluna existente muda.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "custoCapitalMesPct" DECIMAL(5,2) NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "QuotationSupplier" ADD COLUMN "prazoPagamentoDias" INTEGER,
ADD COLUMN "impostosInclusos" BOOLEAN,
ADD COLUMN "impostosPct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN "recorrenciaId" TEXT;

-- CreateTable
CREATE TABLE "QuotationSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "diasSemana" INTEGER[],
    "modoQuantidade" TEXT NOT NULL DEFAULT 'FIXA',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaGeracaoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "QuotationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationSchedule_quotationId_key" ON "QuotationSchedule"("quotationId");
CREATE INDEX "QuotationSchedule_tenantId_idx" ON "QuotationSchedule"("tenantId");
CREATE INDEX "QuotationSchedule_tenantId_ativo_idx" ON "QuotationSchedule"("tenantId", "ativo");
CREATE INDEX "Quotation_recorrenciaId_idx" ON "Quotation"("recorrenciaId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_recorrenciaId_fkey" FOREIGN KEY ("recorrenciaId") REFERENCES "QuotationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuotationSchedule" ADD CONSTRAINT "QuotationSchedule_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: o prazo em dias das propostas que já existem, quando o texto é só
-- número ("28", "28 dias"). Formatos compostos ficam nulos — a próxima
-- resposta grava o valor certo pelo parser da aplicação.
UPDATE "QuotationSupplier"
SET "prazoPagamentoDias" = CAST(substring("condicaoPagamento" FROM '^\s*(\d{1,3})\s*(dias?|d)?\s*$') AS INTEGER)
WHERE "condicaoPagamento" ~ '^\s*\d{1,3}\s*(dias?|d)?\s*$';

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['QuotationSchedule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
