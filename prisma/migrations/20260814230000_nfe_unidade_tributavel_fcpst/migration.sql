-- Unidade tributável (uTrib/qTrib) e FCP-ST por item da nota de entrada.
--
-- uTrib/qTrib: o distribuidor vende em caixa e tributa em unidade. Guardar os
-- dois é o que permite saber que "5 CX" são 120 garrafas sem depender do
-- de-para. Nulos nas notas já importadas — o XML delas não foi relido.
--
-- valorFcpSt: FCP retido por ST é pago ao fornecedor e compõe o custo. Zero no
-- histórico: recalcular custo médio de entrada já feita mexeria em saldo
-- fechado. Vale da próxima nota em diante.
ALTER TABLE "FiscalInboundItem"
  ADD COLUMN "unidadeTributavel" TEXT,
  ADD COLUMN "quantidadeTributavel" DECIMAL(12,4),
  ADD COLUMN "valorFcpSt" DECIMAL(12,2) NOT NULL DEFAULT 0;
