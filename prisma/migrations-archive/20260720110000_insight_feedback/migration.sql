-- Feedback dos insights do dashboard (/inicio) — aprendizado de priorização.
-- Tabela de negócio de baixo volume, tenantId escalar (Camada 1 via extension),
-- segue o mesmo padrão de StockSnapshot — não entra na lista de RLS forçado.

CREATE TYPE "InsightFeedbackAcao" AS ENUM ('IGNORADO', 'CLICADO');

CREATE TABLE "InsightFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "acao" "InsightFeedbackAcao" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InsightFeedback_tenantId_insightId_idx" ON "InsightFeedback"("tenantId", "insightId");
CREATE INDEX "InsightFeedback_tenantId_createdAt_idx" ON "InsightFeedback"("tenantId", "createdAt");
