import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes de unidade rodam em Node, sem servidor nem banco. Dois apelidos tornam
// os módulos do app importáveis fora do runtime Next:
//  - "server-only" vira um stub vazio (o guard só existe para o bundler do Next);
//  - "@" aponta para src (mesmo alias do tsconfig).
export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "tests/stubs/empty.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // fake-indexeddb registra o global indexedDB para os testes da fila offline.
    setupFiles: ["tests/setup/indexeddb.ts"],
  },
});
