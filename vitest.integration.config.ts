import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes de INTEGRAÇÃO — batem num Postgres de teste real (não o de produção).
// Rodam só quando DATABASE_URL_TEST está setado; senão os specs se auto-pulam.
// Rodar: DATABASE_URL_TEST=postgres://... npm run test:integration
export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "tests/stubs/empty.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.int.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // compartilham o mesmo banco
  },
});
