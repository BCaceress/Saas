import type { Prisma } from "@/generated/prisma";
import { normalizeBrand } from "./normalize";
import {
  SEED_BRANDS,
  SEED_CATEGORIES,
  SEED_FISCAL_PROFILES,
  SEED_STORAGE_LOCATIONS,
} from "./seed-data";

/**
 * Seed de um tenant (PRD §3.5). Roda DENTRO da transação de provisionamento,
 * com o client cru (tx) e tenantId explícito — o tenant ainda não existe no
 * contexto async, então não dá pra usar o `db` estendido aqui.
 *
 * Ordem: perfis fiscais -> categorias/subcategorias (ligam o perfil) -> marcas
 * -> locais de armazenagem.
 */
export async function seedTenant(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<void> {
  // RLS (PRD §8): o seed insere linhas de negócio via client cru (tx), então
  // precisa fixar app.current_tenant nesta transação — senão o WITH CHECK das
  // policies recusa os inserts. Vale só para esta transação (local=TRUE).
  await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;

  // 1. Perfis fiscais template (precisaRevisao=true — nunca verdade de fábrica).
  const fiscalIdByKey = new Map<string, string>();
  for (const fp of SEED_FISCAL_PROFILES) {
    const created = await tx.fiscalProfile.create({
      data: {
        tenantId,
        nome: fp.nome,
        ncm: fp.ncm,
        cest: fp.cest ?? null,
        temSt: fp.temSt ?? false,
        precisaRevisao: true,
      },
    });
    fiscalIdByKey.set(fp.key, created.id);
  }

  // 2. Categorias + subcategorias.
  for (const cat of SEED_CATEGORIES) {
    const category = await tx.category.create({
      data: { tenantId, nome: cat.nome, skuPrefix: cat.skuPrefix },
    });
    for (const sub of cat.subcategories) {
      await tx.subcategory.create({
        data: {
          tenantId,
          categoryId: category.id,
          nome: sub.nome,
          skuPrefix: sub.skuPrefix,
          defaultStorageType: sub.storage ?? null,
          defaultFiscalProfileId: sub.fiscalKey
            ? fiscalIdByKey.get(sub.fiscalKey) ?? null
            : null,
        },
      });
    }
  }

  // 3. Marcas nacionais.
  await tx.brand.createMany({
    data: SEED_BRANDS.map((nome) => ({
      tenantId,
      nome,
      nomeNormalizado: normalizeBrand(nome),
    })),
    skipDuplicates: true,
  });

  // 4. Site padrão (LOJA "Principal") — base para estoque e locais.
  const site = await tx.site.create({
    data: { tenantId, nome: "Principal", tipo: "LOJA" },
  });

  // 5. Locais de armazenagem vinculados ao site padrão.
  await tx.storageLocation.createMany({
    data: SEED_STORAGE_LOCATIONS.map((l) => ({
      tenantId,
      siteId: site.id,
      nome: l.nome,
      tipo: l.tipo,
    })),
    skipDuplicates: true,
  });
}
