/**
 * Importa histórico de vendas de um CSV do sistema antigo, direto pelo terminal
 * (alternativa à tela Configurações → Importar histórico de vendas, útil para
 * arquivos grandes ou automação). Mesma lógica de casamento de produto e
 * mesmas regras — ver src/lib/vendas/importar-historico.ts.
 *
 * Uso:
 *   npx tsx scripts/importar-historico-vendas.ts <subdomain-do-tenant> <arquivo.csv> [--dry-run] [--sem-dedupe]
 */
import { readFileSync } from "node:fs";
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";
import {
  montarImportacaoVendas,
  gravarVendasImportadas,
  decodificarCsv,
} from "../src/lib/vendas/importar-historico";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const semDedupe = args.includes("--sem-dedupe");
  const [subdomain, arquivo] = args.filter((a) => !a.startsWith("--"));

  if (!subdomain || !arquivo) {
    console.error(
      "Uso: npx tsx scripts/importar-historico-vendas.ts <subdomain-do-tenant> <arquivo.csv> [--dry-run] [--sem-dedupe]",
    );
    process.exit(1);
  }

  const tenant = await basePrisma.tenant.findFirst({ where: { subdomain } });
  if (!tenant) {
    console.error(`Tenant não encontrado para subdomain "${subdomain}".`);
    process.exit(1);
  }

  const texto = decodificarCsv(readFileSync(arquivo));

  await runWithTenant(tenant.id, async () => {
    const site = await db.site.findFirst({
      where: { ativo: true },
      orderBy: { createdAt: "asc" },
    });
    if (!site) {
      console.error(`Tenant "${subdomain}" não tem nenhum site ativo cadastrado.`);
      process.exit(1);
    }
    const totalSites = await db.site.count();
    if (totalSites > 1) {
      console.warn(
        `Tenant tem ${totalSites} lojas — todas as vendas importadas vão para "${site.nome}". ` +
          `Use a tela Configurações → Importar histórico de vendas se precisar escolher a loja.`,
      );
    }

    const relatorio = await montarImportacaoVendas(texto, { semDedupe });

    console.log(`\n${dryRun ? "[DRY-RUN] " : ""}Importação de "${arquivo}" para ${subdomain}:`);
    console.log(
      `  vendas prontas: ${relatorio.vendas.length} (total líquido R$ ${relatorio.totalLiquido.toFixed(2)})`,
    );
    console.log(`  vendas puladas (sem item válido): ${relatorio.vendasPuladas}`);
    console.log(`  itens pulados (qtd<=0 ou produto não casado): ${relatorio.itensPulados}`);
    if (relatorio.linhasColapsadas > 0) {
      console.log(`  linhas duplicadas colapsadas: ${relatorio.linhasColapsadas}`);
    }
    if (relatorio.naoCasados.length > 0) {
      console.log(`  produtos não casados (cadastre ou corrija o nome e rode de novo):`);
      for (const { nome, vezes } of relatorio.naoCasados) {
        console.log(`    ${vezes}x  "${nome}"`);
      }
    }

    if (!dryRun && relatorio.vendas.length > 0) {
      const gravadas = await gravarVendasImportadas(site.id, relatorio.vendas);
      console.log(`\n  ${gravadas} vendas gravadas.`);
    } else if (dryRun) {
      console.log(`\n  Nenhuma venda foi gravada (--dry-run). Rode sem a flag para importar de verdade.`);
    }
  });

  await basePrisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
