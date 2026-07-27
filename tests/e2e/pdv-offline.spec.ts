import { test, expect } from "@playwright/test";

// E2E do fluxo OFFLINE do PDV (Fase 3). Prova o caminho de dinheiro sem rede:
// banner "sem conexão" → venda em dinheiro entra na fila → volta a rede →
// sincroniza. Usa os simulados, sem PSP/hardware.
//
// TODO(auth): estes specs precisam de sessão autenticada + tenant semeado e um
// caixa aberto. Implementar um fixture de login (storageState) e trocar os
// `test.fixme` por `test`. Sem isso, o PDV redireciona para /login.

test.describe("PDV offline (dinheiro)", () => {
  test.fixme("mostra banner e enfileira a venda sem rede", async ({ page, context }) => {
    await page.goto("/vendas");

    // corta a rede como o navegador vê
    await context.setOffline(true);
    await expect(page.getByText(/sem conex/i)).toBeVisible();

    // TODO: adicionar item ao carrinho, abrir pagamento, escolher Dinheiro,
    // valor exato, receber. Esperado: toast "Venda salva (offline)" e o
    // contador "1 na fila" no banner.
    await expect(page.getByText(/na fila/i)).toBeVisible();

    // volta a rede → o worker drena a fila
    await context.setOffline(false);
    await expect(page.getByText(/sincroniz/i)).toBeVisible();
  });

  test.fixme("cartão/PIX ficam indisponíveis offline", async ({ page, context }) => {
    await page.goto("/vendas");
    await context.setOffline(true);
    // TODO: abrir o modal de pagamento e verificar que só "Dinheiro" aparece.
  });
});
