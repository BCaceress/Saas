/**
 * `server-only` não existe em node_modules: o Next resolve esse specifier
 * internamente, só no bundle. Rodando um script por `tsx`, fora do Next, o
 * import quebra — e módulos de serviço (`src/lib/estoque.ts`) começam com ele.
 *
 * Este stub existe só para o `tsx` resolver o nome. Ele não enfraquece a
 * guarda: no app, quem importa continua sendo o Next, com o módulo de verdade;
 * o mapeamento mora em `scripts/tsconfig.json`, que o build nunca lê.
 */
export {};
