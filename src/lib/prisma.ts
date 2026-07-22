import { PrismaClient, Prisma } from "@/generated/prisma";
import { getTenantId } from "./tenant-context";

/**
 * Um único PrismaClient (PRD §2/§3). Dois "modos" de acesso:
 *
 *  - `basePrisma`  — client cru, SEM injeção de tenant. Uso restrito: Auth.js,
 *    signup/provisionamento (criar User/Tenant/Membership), tabelas globais.
 *    NUNCA usar para ler/escrever tabelas de negócio sem cuidar do tenantId à mão.
 *
 *  - `db`          — client estendido ($extends) que injeta tenantId
 *    automaticamente a partir do AsyncLocalStorage (Camada 1, PRD §3.2).
 *    É o caminho padrão para TODO o código de negócio.
 *
 * Regra de ouro: no código de negócio use `db`. Nunca o client cru.
 */

const globalForPrisma = globalThis as unknown as {
  basePrisma?: PrismaClient;
};

export const basePrisma =
  globalForPrisma.basePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.basePrisma = basePrisma;

// Tabelas globais (Auth.js / sem tenantId): passam direto, sem injeção.
const GLOBAL_MODELS = new Set([
  "User",
  "Account",
  "Session",
  "VerificationToken",
]);

// Operações de leitura/escrita por filtro (recebem WHERE).
const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
  "update",
  "delete",
  "upsert",
]);

// Operações que escrevem DATA (recebem tenantId no payload).
const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

function withTenantWhere(where: unknown, model: string, tenantId: string) {
  const base = (where as Record<string, unknown>) ?? {};
  // Tenant é identificado pelo próprio id; demais tabelas por tenantId.
  if (model === "Tenant") return { ...base, id: tenantId };
  return { ...base, tenantId };
}

/**
 * Client estendido com injeção de tenant. Lê o tenantId do contexto async
 * no momento da query (lazy), então é seguro reaproveitar a instância.
 *
 * DUAS CAMADAS (PRD §8):
 *  1. Injeção de tenantId em WHERE/DATA (impede WHERE esquecido).
 *  2. RLS no Postgres: cada operação roda dentro de uma transação que primeiro
 *     faz `SET LOCAL app.current_tenant` (via set_config local) e então executa
 *     a query — o banco recusa cruzar tenants mesmo se a Camada 1 falhar.
 *     Padrão batch `$transaction([set_config, query])` = uma só conexão, então
 *     o `SET LOCAL` vale para a query (necessário sob o pooler do Neon).
 */
const extendedPrisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (GLOBAL_MODELS.has(model)) return query(args);

        const tenantId = getTenantId();
        if (!tenantId) {
          throw new Error(
            `Query em ${model}.${operation} sem contexto de tenant. ` +
              `Use runWithTenant() ou acesse via basePrisma conscientemente.`
          );
        }

        const a = (args ?? {}) as Record<string, unknown>;

        if (WHERE_OPS.has(operation)) {
          a.where = withTenantWhere(a.where, model, tenantId);
        }

        if (CREATE_OPS.has(operation) && model !== "Tenant") {
          if (operation === "createMany") {
            const data = a.data;
            if (Array.isArray(data)) {
              a.data = data.map((d) => ({ ...(d as object), tenantId }));
            } else if (data) {
              a.data = { ...(data as object), tenantId };
            }
          } else if (operation === "create") {
            a.data = { ...((a.data as object) ?? {}), tenantId };
          } else if (operation === "upsert") {
            a.create = { ...((a.create as object) ?? {}), tenantId };
          }
        }

        // Camada 2 (RLS): SET LOCAL app.current_tenant + query na MESMA transação.
        const [, result] = await basePrisma.$transaction([
          basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
          query(a),
        ]);
        return result;
      },
    },
  },
});

/**
 * Client de negócio com tenant injetado. IMPORTANTE: por usar injeção em WHERE,
 * NÃO use `findUnique` para tabelas de negócio (o WHERE de findUnique só aceita
 * campos únicos). Use `findFirst` — o extension adiciona o tenantId. Ver CLAUDE.md.
 */
export const db = extendedPrisma;
export type Db = typeof extendedPrisma;

// ============================================================
// Acesso com tenant explícito (para quem usa basePrisma)
//
// Serviços de domínio (lib/vendas, lib/estoque, lib/caixa, lib/pagamentos)
// recebem o tenantId por parâmetro e rodam FORA do AsyncLocalStorage — por
// isso usam basePrisma. Só que basePrisma não faz `SET LOCAL
// app.current_tenant`, então a query roda sem contexto: hoje passa porque o
// papel do banco tem BYPASSRLS, mas no dia em que o RLS valer de verdade a
// policy compara `tenantId = NULL` e devolve ZERO LINHA.
//
// Zero linha é pior que erro: um `count()` que devolve 0 vira "não há
// restrição". Use estes helpers em TODA leitura via basePrisma — o custo é o
// mesmo (uma ida ao banco, igual ao que o `db` estendido já faz).
// ============================================================

/**
 * Uma query só, com o tenant setado na mesma transação (e portanto na mesma
 * conexão — necessário sob o pooler do Neon).
 *
 *   const po = await comTenant(tenantId, basePrisma.purchaseOrder.findFirst({…}));
 */
export async function comTenant<T>(
  tenantId: string,
  query: Prisma.PrismaPromise<T>,
): Promise<T> {
  const [, resultado] = await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    query,
  ]);
  return resultado;
}

/**
 * Várias queries no mesmo contexto — quando uma depende do resultado da outra.
 * Transação interativa: segura a conexão, então prefira `comTenant` quando for
 * leitura única.
 */
export function txComTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return fn(tx);
  });
}
