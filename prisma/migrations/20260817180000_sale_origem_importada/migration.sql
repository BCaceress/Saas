-- AlterEnum: venda que nasceu de importação de histórico (script), não do PDV/totem/app.
ALTER TYPE "SaleOrigin" ADD VALUE IF NOT EXISTS 'IMPORTADA';
