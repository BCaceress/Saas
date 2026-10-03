-- ============================================================
-- Categoria pode ser inativada
--
-- `Subcategory` já tinha `ativo`; `Category` não — então a única saída para uma
-- categoria que o operador parou de usar era deixá-la na lista para sempre.
--
-- Inativar e não excluir porque categoria classifica o HISTÓRICO, não só o
-- catálogo de hoje: inventário fechado com escopo "Bebidas" (FK
-- `Inventory.categoryId`), relatório do ano passado, SKU já impresso na
-- prateleira. Excluir reescreveria o passado — então excluir vale só para o que
-- nunca foi usado, e todo o resto inativa.
--
-- `DEFAULT true`: tudo que existe hoje continua ativo.
-- ============================================================

ALTER TABLE "Category" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
