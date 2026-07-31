-- Centro de Gestão do Fornecedor: condições comerciais e anotações internas
-- deixam de morar na cabeça do comprador e passam a viver no cadastro.
ALTER TABLE "Supplier" ADD COLUMN "prazoPagamentoDias" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN "observacoes" TEXT;

-- Basic auth precisa mostrar o usuário de volta na tela; só a senha é segredo.
ALTER TABLE "SupplierIntegration" ADD COLUMN "usuario" TEXT;
