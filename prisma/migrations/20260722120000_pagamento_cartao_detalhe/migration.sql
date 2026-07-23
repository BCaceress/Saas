-- Detalhe do cartão devolvido pelo PSP na aprovação. Nada aqui é digitado pelo
-- operador: bandeira e autorização são dados do adquirente, e o que o caixa
-- chuta não vale perante a SEFAZ. Alimentam o grupo `card` (YA04a) da NFC-e.
ALTER TABLE "Payment" ADD COLUMN "bandeira" TEXT;
ALTER TABLE "Payment" ADD COLUMN "parcelas" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "nsu" TEXT;
ALTER TABLE "Payment" ADD COLUMN "autorizacao" TEXT;
ALTER TABLE "Payment" ADD COLUMN "adquirenteCnpj" TEXT;

-- Id da TRANSAÇÃO no PSP — diferente de "externalId", que guarda a intenção /
-- pedido enviado à maquininha. O estorno precisa deste id, não daquele.
ALTER TABLE "Payment" ADD COLUMN "pspPaymentId" TEXT;
