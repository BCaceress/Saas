/**
 * Teste de fumaça do RLS.
 *
 *   node --env-file=.env prisma/rls-smoke.mjs            (usa DATABASE_URL)
 *   node --env-file=.env prisma/rls-smoke.mjs --app      (usa DATABASE_URL_APP)
 *
 * Prova três coisas, tabela por tabela:
 *   1. SEM contexto de tenant → 0 linhas. É o ponto: sob RLS, esquecer o
 *      set_config tem de devolver NADA, não o banco inteiro.
 *   2. COM o tenant A → só as linhas de A.
 *   3. Com o tenant A setado, filtrar por B → 0 linhas (não cruza tenant).
 *
 * Sai com código 1 se qualquer tabela falhar — serve em CI.
 *
 * Papel com BYPASSRLS (neondb_owner) passa por cima de tudo: rodando sem
 * --app o teste avisa que o resultado não significa nada.
 */
import { PrismaClient } from "../src/generated/prisma/index.js";

const usarApp = process.argv.includes("--app");
const url = usarApp ? process.env.DATABASE_URL_APP : process.env.DATABASE_URL;
if (!url) {
  console.error(`Falta ${usarApp ? "DATABASE_URL_APP" : "DATABASE_URL"} no ambiente.`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: url });

const papel = await prisma.$queryRawUnsafe(
  `SELECT current_user AS usuario, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
);
const { usuario, rolbypassrls } = papel[0];
console.log(`conexão: ${usuario} (bypassrls=${rolbypassrls})\n`);

if (rolbypassrls) {
  console.error(
    "AVISO: este papel tem BYPASSRLS — as policies são ignoradas e o teste não\n" +
      "prova isolamento. Rode com --app (DATABASE_URL_APP).\n",
  );
}

// Tabelas protegidas = as que têm a policy. Lê do banco em vez de manter uma
// lista à mão, senão o teste envelhece e passa a mentir.
const protegidas = await prisma.$queryRawUnsafe(
  `SELECT tablename FROM pg_policies
    WHERE schemaname='public' AND policyname='tenant_isolation'
    ORDER BY tablename`,
);

// Precisa de 2 tenants para provar que não cruza. Lido com o owner? Não: sob
// RLS Tenant não tem policy, então qualquer papel enxerga.
const tenants = await prisma.$queryRawUnsafe(
  `SELECT id FROM "Tenant" ORDER BY "createdAt" LIMIT 2`,
);
if (tenants.length === 0) {
  console.error("Sem tenants no banco — nada a testar.");
  process.exit(1);
}
const tenantA = tenants[0].id;
const tenantB = tenants[1]?.id ?? null;

const q = (sql) => prisma.$queryRawUnsafe(sql);
const contar = async (tabela, tenantCtx, filtro) => {
  const [, r] = await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant', ${tenantCtx === null ? "NULL" : `'${tenantCtx}'`}, TRUE)`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${tabela}"` +
        (filtro ? ` WHERE "tenantId" = '${filtro}'` : ""),
    ),
  ]);
  return r[0].n;
};

let falhas = 0;
let comDados = 0;

for (const { tablename } of protegidas) {
  const semCtx = await contar(tablename, null, null);
  const comA = await contar(tablename, tenantA, null);
  const cruzado = tenantB ? await contar(tablename, tenantA, tenantB) : 0;

  const okSemCtx = semCtx === 0;
  const okCruzado = cruzado === 0;
  if (comA > 0) comDados++;

  if (!okSemCtx || !okCruzado) {
    falhas++;
    console.log(
      `FALHA  ${tablename}: sem contexto=${semCtx} (esperado 0), ` +
        `cruzando tenant=${cruzado} (esperado 0), com tenant A=${comA}`,
    );
  }
}

await prisma.$disconnect();

console.log(
  `\n${protegidas.length} tabela(s) com policy · ${comDados} com dados do tenant de teste`,
);

if (!tenantB) {
  console.log("Só há 1 tenant: o teste de cruzamento não foi exercitado de verdade.");
}

if (falhas > 0) {
  console.error(`\n${falhas} tabela(s) NÃO isolaram. RLS não está protegendo.`);
  process.exit(1);
}
if (rolbypassrls) {
  console.error("\nPassou, mas com BYPASSRLS — sem valor probatório. Rode com --app.");
  process.exit(1);
}
console.log("\nOK: nenhuma tabela vaza sem contexto nem cruza tenant.");
