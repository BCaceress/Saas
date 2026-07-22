-- Personalização do Centro de Operações (/inicio): widgets ocultos/reordenados
-- por usuário. Tabela de negócio de baixo volume, tenantId escalar (Camada 1
-- via extension) — mesmo padrão de InsightFeedback, não entra na lista de RLS forçado.

CREATE TABLE "DashboardWidgetPref" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "hidden"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ordem"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardWidgetPref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardWidgetPref_tenantId_userId_key" ON "DashboardWidgetPref"("tenantId", "userId");
