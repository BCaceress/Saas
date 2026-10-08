/**
 * Sincroniza as categorias/subcategorias de um tenant JÁ EXISTENTE com a árvore
 * canônica de `src/lib/seed-data.ts` (a mesma que o seed usa num tenant novo).
 *
 * A chave de identidade é o `skuPrefix`, não o nome: ele é imutável e único no
 * escopo (tenant, para categoria; categoria, para subcategoria). Então:
 *
 *   prefixo na árvore e no banco  → renomeia/reativa/completa os defaults
 *   prefixo só na árvore          → cria
 *   prefixo só no banco           → é EXTRA: exclui se nunca foi usado,
 *                                    inativa se já classifica histórico
 *
 * Excluir é privilégio do que nunca foi usado (mesma regra de
 * `produtos/actions.ts`): produto, subcategoria ou inventário vinculado →
 * inativa, porque apagar reescreveria relatório, SKU impresso e inventário
 * fechado. O relatório no fim diz o que foi inativado e por quê.
 *
 * Uso:
 *   npx tsx scripts/ajustar-categorias.ts --dry-run            # todos os tenants
 *   npx tsx scripts/ajustar-categorias.ts <subdomain>
 *   npx tsx scripts/ajustar-categorias.ts <subdomain> --dry-run
 */
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";
import { SEED_CATEGORIES, SEED_FISCAL_PROFILES } from "../src/lib/seed-data";

type Acao = { tipo: "criada" | "renomeada" | "reativada" | "ajustada" | "excluida" | "inativada"; texto: string };

const TREE_CAT = new Map(SEED_CATEGORIES.map((c) => [c.skuPrefix, c]));

/**
 * Categorias que a sincronização NÃO exclui nem inativa, mesmo fora da árvore.
 *
 * A árvore canônica é o catálogo de PRATELEIRA: o que o operador vende. Estas
 * duas não são prateleira — são insumo de produção (`/estoque/producao`,
 * relatório de rentabilidade de drinks) e montagem de combo. Apagá-las junto
 * tiraria do ar o cadastro de um módulo que funciona, por não constar de uma
 * lista que nunca falou dele.
 *
 * A proteção vale só para a CATEGORIA. As subcategorias dentro delas seguem a
 * regra geral: fora da árvore = extra. Insumo e combo não se classificam por
 * gôndola (um copo não é "bebida › copões"), então a categoria basta — a
 * subcategoria é nível sem conteúdo aqui, e nível vazio só atrapalha quem
 * cadastra.
 */
const CATEGORIAS_MANTIDAS = new Set(["INS", "KIT"]);

async function perfilFiscalPorKey(): Promise<Map<string, string>> {
  const porNome = new Map(SEED_FISCAL_PROFILES.map((fp) => [fp.nome, fp.key]));
  const perfis = await db.fiscalProfile.findMany({
    where: { nome: { in: [...porNome.keys()] } },
    select: { id: true, nome: true },
  });
  const m = new Map<string, string>();
  for (const p of perfis) {
    const key = porNome.get(p.nome);
    if (key) m.set(key, p.id);
  }
  return m;
}

async function ajustarTenant(tenantId: string, dryRun: boolean): Promise<Acao[]> {
  const acoes: Acao[] = [];
  const fiscalIdByKey = await perfilFiscalPorKey();

  const existentes = await db.category.findMany({
    include: { subcategories: true },
    orderBy: { nome: "asc" },
  });
  const catPorPrefixo = new Map(existentes.map((c) => [c.skuPrefix, c]));

  // ── 1. Categorias e subcategorias da árvore ──────────────
  for (const alvo of SEED_CATEGORIES) {
    let catId = catPorPrefixo.get(alvo.skuPrefix)?.id ?? null;
    const atual = catPorPrefixo.get(alvo.skuPrefix);

    if (!atual) {
      if (!dryRun) {
        const criada = await db.category.create({
          data: { tenantId, nome: alvo.nome, skuPrefix: alvo.skuPrefix },
        });
        catId = criada.id;
      }
      acoes.push({ tipo: "criada", texto: `categoria [${alvo.skuPrefix}] ${alvo.nome}` });
    } else {
      if (atual.nome !== alvo.nome) {
        if (!dryRun)
          await db.category.update({ where: { id: atual.id }, data: { nome: alvo.nome } });
        acoes.push({
          tipo: "renomeada",
          texto: `categoria [${alvo.skuPrefix}] «${atual.nome}» → «${alvo.nome}»`,
        });
      }
      if (!atual.ativo) {
        if (!dryRun)
          await db.category.update({ where: { id: atual.id }, data: { ativo: true } });
        acoes.push({ tipo: "reativada", texto: `categoria [${alvo.skuPrefix}] ${alvo.nome}` });
      }
    }

    const subsAtuais = atual?.subcategories ?? [];
    const subPorPrefixo = new Map(subsAtuais.map((s) => [s.skuPrefix, s]));

    for (const subAlvo of alvo.subcategories) {
      const sub = subPorPrefixo.get(subAlvo.skuPrefix);
      const fiscalId = subAlvo.fiscalKey ? fiscalIdByKey.get(subAlvo.fiscalKey) ?? null : null;

      if (!sub) {
        if (!dryRun && catId) {
          await db.subcategory.create({
            data: {
              tenantId,
              categoryId: catId,
              nome: subAlvo.nome,
              skuPrefix: subAlvo.skuPrefix,
              defaultStorageType: subAlvo.storage ?? null,
              defaultFiscalProfileId: fiscalId,
            },
          });
        }
        acoes.push({
          tipo: "criada",
          texto: `subcategoria ${alvo.nome} › [${subAlvo.skuPrefix}] ${subAlvo.nome}`,
        });
        continue;
      }

      if (sub.nome !== subAlvo.nome) {
        if (!dryRun)
          await db.subcategory.update({ where: { id: sub.id }, data: { nome: subAlvo.nome } });
        acoes.push({
          tipo: "renomeada",
          texto: `subcategoria ${alvo.nome} › [${sub.skuPrefix}] «${sub.nome}» → «${subAlvo.nome}»`,
        });
      }
      if (!sub.ativo) {
        if (!dryRun) await db.subcategory.update({ where: { id: sub.id }, data: { ativo: true } });
        acoes.push({
          tipo: "reativada",
          texto: `subcategoria ${alvo.nome} › [${sub.skuPrefix}] ${subAlvo.nome}`,
        });
      }
      // Só COMPLETA o que está vazio: default escolhido pelo operador é decisão
      // dele, e esta é uma correção de catálogo, não um reset.
      const completar: Record<string, unknown> = {};
      if (sub.defaultStorageType === null && subAlvo.storage)
        completar.defaultStorageType = subAlvo.storage;
      if (sub.defaultFiscalProfileId === null && fiscalId) completar.defaultFiscalProfileId = fiscalId;
      if (Object.keys(completar).length > 0) {
        if (!dryRun) await db.subcategory.update({ where: { id: sub.id }, data: completar });
        acoes.push({
          tipo: "ajustada",
          texto: `subcategoria ${alvo.nome} › [${sub.skuPrefix}] ${subAlvo.nome} — ${Object.keys(completar).join(", ")}`,
        });
      }
    }
  }

  // ── 2. Extras: subcategorias fora da árvore ──────────────
  // Antes das categorias, porque a FK da subcategoria segura o delete da mãe.
  for (const cat of existentes) {
    const alvo = TREE_CAT.get(cat.skuPrefix);
    const prefixosAlvo = new Set(alvo?.subcategories.map((s) => s.skuPrefix) ?? []);
    for (const sub of cat.subcategories) {
      if (prefixosAlvo.has(sub.skuPrefix)) continue;
      const produtos = await db.product.count({ where: { subcategoryId: sub.id } });
      if (produtos === 0) {
        if (!dryRun) await db.subcategory.deleteMany({ where: { id: sub.id } });
        acoes.push({
          tipo: "excluida",
          texto: `subcategoria ${cat.nome} › [${sub.skuPrefix}] ${sub.nome}`,
        });
      } else {
        if (!dryRun && sub.ativo)
          await db.subcategory.update({ where: { id: sub.id }, data: { ativo: false } });
        acoes.push({
          tipo: "inativada",
          texto: `subcategoria ${cat.nome} › [${sub.skuPrefix}] ${sub.nome} — ${produtos} produto(s) ainda nela`,
        });
      }
    }
  }

  // ── 3. Extras: categorias fora da árvore ─────────────────
  for (const cat of existentes) {
    if (TREE_CAT.has(cat.skuPrefix) || CATEGORIAS_MANTIDAS.has(cat.skuPrefix)) continue;
    const [subs, produtos, inventarios] = await Promise.all([
      db.subcategory.count({ where: { categoryId: cat.id } }),
      db.product.count({ where: { subcategory: { categoryId: cat.id } } }),
      db.inventory.count({ where: { categoryId: cat.id } }),
    ]);
    if (subs === 0 && produtos === 0 && inventarios === 0) {
      if (!dryRun) await db.category.deleteMany({ where: { id: cat.id } });
      acoes.push({ tipo: "excluida", texto: `categoria [${cat.skuPrefix}] ${cat.nome}` });
    } else {
      if (!dryRun && cat.ativo)
        await db.category.update({ where: { id: cat.id }, data: { ativo: false } });
      const motivos = [
        subs > 0 ? `${subs} subcategoria(s)` : null,
        produtos > 0 ? `${produtos} produto(s)` : null,
        inventarios > 0 ? `${inventarios} inventário(s)` : null,
      ].filter(Boolean);
      acoes.push({
        tipo: "inativada",
        texto: `categoria [${cat.skuPrefix}] ${cat.nome} — ${motivos.join(", ")}`,
      });
    }
  }

  return acoes;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const subdomain = args.find((a) => !a.startsWith("--"));

  const tenants = await basePrisma.tenant.findMany({
    where: subdomain ? { subdomain } : {},
    select: { id: true, nome: true, subdomain: true },
  });
  if (tenants.length === 0) {
    console.error(
      subdomain ? `Tenant não encontrado para subdomain "${subdomain}".` : "Nenhum tenant no banco.",
    );
    process.exit(1);
  }

  for (const t of tenants) {
    console.log(`\n${dryRun ? "[DRY-RUN] " : ""}${t.nome} (${t.subdomain})`);
    const acoes = await runWithTenant(t.id, () => ajustarTenant(t.id, dryRun));
    if (acoes.length === 0) {
      console.log("  já está igual à árvore canônica.");
      continue;
    }
    for (const tipo of ["criada", "renomeada", "reativada", "ajustada", "excluida", "inativada"] as const) {
      const doTipo = acoes.filter((a) => a.tipo === tipo);
      if (doTipo.length === 0) continue;
      console.log(`  ${tipo.toUpperCase()} (${doTipo.length}):`);
      for (const a of doTipo) console.log(`    - ${a.texto}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => basePrisma.$disconnect());
