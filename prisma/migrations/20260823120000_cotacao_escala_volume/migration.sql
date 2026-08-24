-- Cotação por escala: promoção por volume vira dado, não conversa de WhatsApp.
--
-- O distribuidor de bebida quase sempre tem tabela por volume ("5 caixas a
-- R$ 45, 10 a R$ 41"), e ela nunca chegava ao comparativo — vinha no meio da
-- conversa e morria ali. Aqui ela vira linha: o fornecedor informa as faixas
-- no mesmo link, e o comprador ganha uma segunda lente ("Melhor oportunidade")
-- ao lado da de sempre ("Minha necessidade").
--
-- Nada muda para quem não liga a chave: `Quotation.pedeEscala` nasce false, e
-- a tela pública continua com um preço por item.

-- AlterTable — a chave da cotação
ALTER TABLE "Quotation" ADD COLUMN "pedeEscala" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable — travas do comprador. Os defaults são conservadores de propósito:
-- sem teto de cobertura, "melhor promoção" vira "compre tudo".
ALTER TABLE "Tenant" ADD COLUMN "escalaCoberturaMaxDias" INTEGER NOT NULL DEFAULT 45;
ALTER TABLE "Tenant" ADD COLUMN "escalaEconomiaMinPct" DECIMAL(5,2) NOT NULL DEFAULT 3;
ALTER TABLE "Tenant" ADD COLUMN "escalaCapitalExtraMax" DECIMAL(12,2);

-- CreateTable — a faixa em si. A quantidade está SEMPRE na embalagem do item
-- cotado (a mesma que o fornecedor viu no link); o preço-base da resposta é a
-- faixa implícita da quantidade pedida, e estas linhas são só as acima dela.
CREATE TABLE "QuotationResponseTier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationResponseId" TEXT NOT NULL,
    "quantidadeMinima" DECIMAL(12,3) NOT NULL,
    "precoUnitario" DECIMAL(12,4) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationResponseTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationResponseTier_quotationResponseId_quantidadeMinima_key" ON "QuotationResponseTier"("quotationResponseId", "quantidadeMinima");
CREATE INDEX "QuotationResponseTier_tenantId_idx" ON "QuotationResponseTier"("tenantId");
CREATE INDEX "QuotationResponseTier_quotationResponseId_idx" ON "QuotationResponseTier"("quotationResponseId");

-- AddForeignKey — a faixa não sobrevive à resposta que a originou.
ALTER TABLE "QuotationResponseTier" ADD CONSTRAINT "QuotationResponseTier_quotationResponseId_fkey" FOREIGN KEY ("quotationResponseId") REFERENCES "QuotationResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- RLS (Camada 2) — mesma policy das demais tabelas de negócio.
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['QuotationResponseTier'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.current_tenant'', TRUE)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', TRUE))',
      t
    );
  END LOOP;
END $$;
