-- Certificado A1 local e cursor da Distribuição DF-e oficial.
ALTER TABLE "FiscalEmitente"
  ADD COLUMN "certificadoPfx" TEXT,
  ADD COLUMN "certificadoSenha" TEXT,
  ADD COLUMN "distribuicaoUltNsu" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "distribuicaoMaxNsu" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "distribuicaoConsultadoEm" TIMESTAMP(3),
  ADD COLUMN "distribuicaoUltimoErro" TEXT;

CREATE TABLE "FiscalDistribuicaoDocumento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emitenteId" TEXT NOT NULL,
    "nsu" BIGINT NOT NULL,
    "chave" TEXT NOT NULL,
    "emitCnpj" TEXT NOT NULL,
    "emitRazaoSocial" TEXT NOT NULL,
    "valorTotal" DECIMAL(12,2),
    "dataEmissao" TIMESTAMP(3),
    "schema" TEXT NOT NULL,
    "resumo" BOOLEAN NOT NULL DEFAULT true,
    "xml" TEXT,
    "manifestacao" "ManifestacaoTipo",
    "manifestadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDistribuicaoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDistribuicaoDocumento_emitenteId_nsu_key"
  ON "FiscalDistribuicaoDocumento"("emitenteId", "nsu");
CREATE UNIQUE INDEX "FiscalDistribuicaoDocumento_tenantId_chave_key"
  ON "FiscalDistribuicaoDocumento"("tenantId", "chave");
CREATE INDEX "FiscalDistribuicaoDocumento_tenantId_resumo_idx"
  ON "FiscalDistribuicaoDocumento"("tenantId", "resumo");
CREATE INDEX "FiscalDistribuicaoDocumento_tenantId_emitenteId_idx"
  ON "FiscalDistribuicaoDocumento"("tenantId", "emitenteId");

ALTER TABLE "FiscalDistribuicaoDocumento"
  ADD CONSTRAINT "FiscalDistribuicaoDocumento_emitenteId_fkey"
  FOREIGN KEY ("emitenteId") REFERENCES "FiscalEmitente"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiscalDistribuicaoDocumento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalDistribuicaoDocumento" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalDistribuicaoDocumento";
CREATE POLICY tenant_isolation ON "FiscalDistribuicaoDocumento"
  USING ("tenantId" = current_setting('app.current_tenant', TRUE))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', TRUE));
