import { describe, it, expect } from "vitest";

// Integração do caminho de DINHEIRO offline — o mais valioso de blindar, porque
// bug aqui = prejuízo. Bate num Postgres de teste (DATABASE_URL_TEST).
//
// ⚠️ TEMPLATE. Precisa de:
//   1. Um banco de teste com o schema aplicado (`prisma migrate deploy`).
//   2. DATABASE_URL apontando para ELE antes de importar lib/prisma (o client lê
//      a env no import). Rodar como:
//        DATABASE_URL=$DATABASE_URL_TEST DATABASE_URL_TEST=$DATABASE_URL_TEST \
//          npm run test:integration
//   3. Um seed mínimo: tenant + site + produto (com estoque) + caixa aberto.
//      Extrair um helper `seedTenantMinimo()` reaproveitando prisma/seed.ts.
//
// Enquanto o seed helper não existir, os casos ficam em `it.skip`. A estrutura
// abaixo é o alvo — descreve exatamente o que blindar.

const TEM_DB = !!process.env.DATABASE_URL_TEST;

describe.skipIf(!TEM_DB)("sincronização de venda offline (dinheiro)", () => {
  it.skip("idempotência: reenviar o mesmo clientId não duplica a venda", async () => {
    // const tenant = await seedTenantMinimo();
    // const payload = { clientId: "off-1", ... };
    // const a = await sincronizarVendaOffline(tenant.id, payload);
    // const b = await sincronizarVendaOffline(tenant.id, payload);
    // expect(b.already).toBe(true);
    // expect(b.saleId).toBe(a.saleId);
    // expect(await contarVendasDoTenant(tenant.id)).toBe(1);
    expect(true).toBe(true);
  });

  it.skip("reconciliação: venda offline sem saldo grava e deixa estoque negativo", async () => {
    // Zera o saldo do produto, sincroniza uma venda offline dele.
    // Esperado: venda PAGA (não falha), StockMovement de SAIDA com observacao
    // "reconciliar", estoque final negativo.
    expect(true).toBe(true);
  });

  it.skip("a NFC-e é enfileirada na sincronização", async () => {
    // Com módulo fiscal + emissão automática ligados: após o sync existe um
    // FiscalDocument PENDENTE/CONTINGENCIA para a venda.
    expect(true).toBe(true);
  });
});
