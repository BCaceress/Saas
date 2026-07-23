-- "CPF na nota" do balcão: vai ao destinatário da NFC-e sem exigir cadastro de
-- Customer. Só dígitos; cliente identificado (customerId) tem prioridade.
ALTER TABLE "Sale" ADD COLUMN "cpfNota" TEXT;
