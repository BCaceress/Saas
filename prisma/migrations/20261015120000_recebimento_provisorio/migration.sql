-- ============================================================
-- Recebimento avulso provisório
--
-- "Não tenho o XML" abria o recebimento no banco na hora do clique — e ele já
-- aparecia na lista, mesmo que o operador desistisse antes de lançar qualquer
-- coisa. Agora o avulso nasce `provisorio = true` e só entra na lista quando é
-- salvo (rascunho) ou recebido no estoque.
--
-- `DEFAULT false`: tudo que existe hoje continua visível.
-- ============================================================

ALTER TABLE "GoodsReceipt" ADD COLUMN "provisorio" BOOLEAN NOT NULL DEFAULT false;
