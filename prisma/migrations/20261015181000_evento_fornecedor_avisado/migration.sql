-- ============================================================
-- "Avisei o fornecedor" vira fato na história do recebimento.
--
-- O e-mail da divergência sai da tela do recebimento com a planilha da
-- conferência anexada. Sem o evento, a pergunta "alguém avisou o fornecedor?"
-- só tinha resposta na caixa de saída de quem mandou.
-- ============================================================

ALTER TYPE "PurchaseEventType" ADD VALUE IF NOT EXISTS 'FORNECEDOR_AVISADO';
