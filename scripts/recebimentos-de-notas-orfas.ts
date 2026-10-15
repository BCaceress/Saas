/**
 * Abre o recebimento das notas que entraram no sistema sem um.
 *
 * Até 15/10/2026 só o upload pela tela de Recebimentos criava o recebimento da
 * nota; quem importava pela tela fiscal (ou e-mail/SEFAZ) deixava a nota fora
 * da lista "o que chegou?". A importação agora cria o recebimento em todo
 * canal — este script cuida das notas que ficaram para trás.
 *
 * Só nota de mercadoria ainda não recebida: PENDENTE/CONCILIADO, sem entrada
 * gerada e sem recebimento. Idempotente — rodar duas vezes não duplica nada.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/recebimentos-de-notas-orfas.ts            (simula)
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/recebimentos-de-notas-orfas.ts --aplicar  (grava)
 */
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";
import { garantirRecebimentoDaNota } from "../src/lib/compras/recebimento";

const aplicar = process.argv.includes("--aplicar");

async function main() {
  const tenants = await basePrisma.tenant.findMany({ select: { id: true, nome: true } });
  let total = 0;

  for (const t of tenants) {
    await runWithTenant(t.id, async () => {
      const orfas = await db.fiscalInbound.findMany({
        where: {
          status: { in: ["PENDENTE", "CONCILIADO"] },
          purchaseId: null,
          receipt: null,
        },
        select: { id: true, numero: true, serie: true, emitRazaoSocial: true },
        orderBy: { createdAt: "asc" },
      });

      for (const n of orfas) {
        total++;
        const rotulo = `${t.nome} · NF-e ${n.numero}/${n.serie} · ${n.emitRazaoSocial}`;
        if (!aplicar) {
          console.log(`[simulação] abriria recebimento: ${rotulo}`);
          continue;
        }
        const r = await garantirRecebimentoDaNota({ tenantId: t.id, inboundId: n.id });
        console.log(`${r.numero} aberto: ${rotulo}`);
      }
    });
  }

  console.log(
    total === 0
      ? "Nenhuma nota sem recebimento."
      : aplicar
        ? `${total} recebimento(s) aberto(s).`
        : `${total} nota(s) sem recebimento. Rode com --aplicar para gravar.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
