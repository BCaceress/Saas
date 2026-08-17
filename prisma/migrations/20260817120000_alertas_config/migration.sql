-- Preferência de alerta por TIPO (antes só por categoria) + limiares que
-- pertencem ao próprio alerta. `alertasDesativados` continua na tabela como
-- fallback de leitura para quem ainda não salvou no formato novo.
ALTER TABLE "Tenant" ADD COLUMN "alertasConfig" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "inventarioAtrasoDias" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Tenant" ADD COLUMN "novoSemMovDias" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Tenant" ADD COLUMN "pushHoraInicio" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "Tenant" ADD COLUMN "pushHoraFim" INTEGER NOT NULL DEFAULT 21;

-- Régua de severidade da cobertura (era a constante fixa de 30%).
ALTER TABLE "Tenant" ADD COLUMN "coberturaCriticaPct" INTEGER NOT NULL DEFAULT 30;
