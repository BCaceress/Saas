-- Comprovante do cartão (via cliente) devolvido pelo TEF/pinpad, para
-- reimpressão. Separado do cupom fiscal (DANFCE), que vem do provedor.
-- O gateway "TEF" reusa as colunas de detalhe de cartão já existentes
-- (bandeira, parcelas, nsu, autorizacao, adquirenteCnpj, externalId=tefId).
ALTER TABLE "Payment" ADD COLUMN "comprovante" TEXT;
