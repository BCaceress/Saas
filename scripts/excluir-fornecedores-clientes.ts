/**
 * Exclui TODOS os fornecedores e clientes de um tenant (ou de todos).
 *
 * Padrão é inventário (não apaga nada). Só apaga com --apagar.
 *
 * Uso:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/excluir-fornecedores-clientes.ts [subdomain]
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/excluir-fornecedores-clientes.ts [subdomain] --apagar
 */
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";

/** Dependentes que BLOQUEIAM a exclusão (FK Restrict / required sem onDelete). */
const BLOQUEIAM_FORNECEDOR = ["productSupplier", "purchaseOrder", "supplierReturn"] as const;
const BLOQUEIAM_CLIENTE = ["comodatoLoan", "containerMovement"] as const;
/** Dependentes que soltam sozinhos (Cascade) ou viram null (SetNull). */
const SOLTAM_FORNECEDOR = ["purchase", "goodsReceipt", "accountPayable", "fiscalInbound", "quotationSupplier", "supplierCartItem", "supplierCatalog", "supplierOffer", "supplierImport"] as const;
const SOLTAM_CLIENTE = ["sale", "accountReceivable", "couponSend"] as const;

async function inventario() {
  const fornecedores = await db.supplier.count();
  const clientes = await db.customer.count();
  const linhas: string[] = [];
  linhas.push(`  Supplier: ${fornecedores}`);
  linhas.push(`  Customer: ${clientes}`);
  linhas.push("  --- bloqueiam (Restrict) ---");
  for (const m of [...BLOQUEIAM_FORNECEDOR, ...BLOQUEIAM_CLIENTE]) {
    // @ts-expect-error acesso dinâmico ao delegate
    const n = await db[m].count();
    if (n > 0) linhas.push(`  ${m}: ${n}`);
  }
  linhas.push("  --- soltam sozinhos (Cascade/SetNull) ---");
  for (const m of [...SOLTAM_FORNECEDOR, ...SOLTAM_CLIENTE]) {
    // @ts-expect-error acesso dinâmico ao delegate
    const n = await db[m].count();
    if (n > 0) linhas.push(`  ${m}: ${n}`);
  }
  return linhas;
}

async function apagar() {
  const clientes = await db.customer.deleteMany({});
  const fornecedores = await db.supplier.deleteMany({});
  return [`  Customer apagados: ${clientes.count}`, `  Supplier apagados: ${fornecedores.count}`];
}

async function main() {
  const args = process.argv.slice(2);
  const apagarDeVerdade = args.includes("--apagar");
  const subdomain = args.find((a) => !a.startsWith("--"));
  const tenants = await basePrisma.tenant.findMany({
    where: subdomain ? { subdomain } : {},
    select: { id: true, nome: true, subdomain: true },
  });
  if (tenants.length === 0) {
    console.error("Nenhum tenant encontrado.");
    process.exit(1);
  }
  for (const t of tenants) {
    console.log(`\n${t.nome} (${t.subdomain})`);
    const linhas = await runWithTenant(t.id, () => inventario());
    for (const l of linhas) console.log(l);
    if (apagarDeVerdade) {
      console.log("  APAGANDO...");
      const feito = await runWithTenant(t.id, () => apagar());
      for (const l of feito) console.log(l);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => basePrisma.$disconnect());
