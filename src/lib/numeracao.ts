import "server-only";
import { basePrisma, comTenant } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

// ============================================================
// Numeração de documento — PC-00125, COT-00042, DEV-00012.
//
// Antes cada módulo fazia `count() + 1`. Isso não é um sequencial: é uma
// leitura seguida de uma escrita, com uma janela no meio. Dois operadores
// criando pedido no mesmo segundo leem a mesma contagem, e o segundo bate no
// `@@unique([tenantId, numero])` com um erro que não explica nada ao usuário.
//
// O incremento agora é um único `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
// O Postgres trava a linha do contador daquele tenant, serializa, devolve o
// valor novo. Sem transação explícita, sem retry, sem buraco.
//
// Efeito colateral bom: número não se perde nem retrocede quando um documento
// é excluído. `count()` fazia o próximo rascunho reaproveitar o número de um
// pedido apagado — dois documentos diferentes com o mesmo PC no histórico do
// fornecedor.
// ============================================================

export type TipoDocumento = "PC" | "COT" | "DEV";

/** Quantos dígitos cada prefixo usa. Mudar aqui muda só a aparência. */
const DIGITOS: Record<TipoDocumento, number> = { PC: 5, COT: 5, DEV: 5 };

/**
 * Próximo número do tipo, para este tenant. Atômico: pode ser chamado em
 * paralelo sem colidir.
 *
 * `tx` permite participar de uma transação já aberta (o número é reservado
 * junto com o documento — rollback devolve os dois). Sem `tx`, roda sozinho.
 */
export async function proximoNumeroDocumento(
  tenantId: string,
  tipo: TipoDocumento,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const sql = async (client: Prisma.TransactionClient) => {
    const linhas = await client.$queryRaw<{ valor: number }[]>`
      INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
      VALUES (${tenantId}, ${tipo}, 1)
      ON CONFLICT ("tenantId", "tipo")
      DO UPDATE SET "valor" = "DocumentCounter"."valor" + 1
      RETURNING "valor"
    `;
    return linhas[0]?.valor ?? 1;
  };

  const valor = tx
    ? await sql(tx)
    : await basePrisma.$transaction(async (t) => {
        // RLS: o contador é tabela de negócio como qualquer outra.
        await t.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
        return sql(t);
      });

  return `${tipo}-${String(valor).padStart(DIGITOS[tipo], "0")}`;
}

/**
 * Alinha o contador com o que já existe na tabela do documento. Roda uma vez,
 * na primeira numeração depois da migration: quem já tinha 340 pedidos não
 * pode receber PC-00001 de volta.
 *
 * Idempotente — só sobe o contador, nunca desce.
 */
export async function sincronizarContador(
  tenantId: string,
  tipo: TipoDocumento,
  maiorExistente: number,
): Promise<void> {
  if (maiorExistente <= 0) return;
  await comTenant(
    tenantId,
    basePrisma.$executeRaw`
      INSERT INTO "DocumentCounter" ("tenantId", "tipo", "valor")
      VALUES (${tenantId}, ${tipo}, ${maiorExistente})
      ON CONFLICT ("tenantId", "tipo")
      DO UPDATE SET "valor" = GREATEST("DocumentCounter"."valor", ${maiorExistente})
    `,
  );
}

/** "PC-00125" → 125. Usado para alinhar o contador com o histórico. */
export function numeroDoDocumento(numero: string | null | undefined): number {
  return Number(String(numero ?? "").replace(/\D/g, "")) || 0;
}
