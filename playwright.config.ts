import { defineConfig, devices } from "@playwright/test";

// E2E do PDV. Sobe o Next dev e roda os specs de tests/e2e. Requer um tenant
// semeado e login (ver o TODO de auth em tests/e2e/pdv-offline.spec.ts) — por
// isso os specs nascem com `test.fixme` até o setup de sessão existir.
//
// Rodar: npx playwright test   (instale os browsers com `npx playwright install`)
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://lvh.me:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://lvh.me:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
