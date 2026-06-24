"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizeBrand, normalizeSkuPrefix, onlyDigits } from "@/lib/normalize";
import { getOrCreateDefaultSite } from "@/lib/sites";
import { generateSku } from "@/lib/sku";

/** Linha mapeada do CSV (mapeamento de colunas feito no cliente). */
export type CsvRow = {
  nome?: string;
  ean?: string;
  marca?: string;
  subcategoria?: string; // prefixo (CER) ou nome (Cervejas)
  precoVenda?: string;
  custo?: string;
  estoqueMinimo?: string;
  estoqueIdeal?: string;
  estoqueInicial?: string;
};

export type ImportResult = {
  criados: number;
  erros: { linha: number; motivo: string }[];
};

function num(v?: string): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Importação CSV (PRD §8.3): valida e grava as linhas. Marca/subcategoria
 * inexistentes podem ser criadas no fluxo (marca implícita; subcategoria só se
 * casar por prefixo/nome — senão a linha vira erro). Tudo no contexto do tenant.
 */
export async function commitImport(rows: CsvRow[]): Promise<ImportResult> {
  const ctx = await requireActiveTenant();
  const tid = ctx.tenant.id;
  return runWithTenant(tid, async () => {
    const subs = await db.subcategory.findMany({
      include: { category: true },
    });
    const brandCache = new Map<string, string>();
    const result: ImportResult = { criados: 0, erros: [] };

    for (let i = 0; i < rows.length; i++) {
      const linha = i + 2; // +1 cabeçalho, +1 base-1
      const row = rows[i];
      const nome = row.nome?.trim();
      if (!nome) {
        result.erros.push({ linha, motivo: "Sem nome." });
        continue;
      }

      const key = (row.subcategoria ?? "").trim();
      const keyPrefix = normalizeSkuPrefix(key);
      const sub =
        subs.find((s) => s.skuPrefix === keyPrefix) ??
        subs.find((s) => s.nome.toLowerCase() === key.toLowerCase());
      if (!sub) {
        result.erros.push({ linha, motivo: `Subcategoria "${key}" não encontrada.` });
        continue;
      }

      let brandId: string | null = null;
      const marca = row.marca?.trim();
      if (marca) {
        const norm = normalizeBrand(marca);
        if (brandCache.has(norm)) {
          brandId = brandCache.get(norm)!;
        } else {
          const existing = await db.brand.findFirst({ where: { nomeNormalizado: norm } });
          const b = existing ?? (await db.brand.create({ data: { tenantId: tid, nome: marca, nomeNormalizado: norm } }));
          brandId = b.id;
          brandCache.set(norm, b.id);
        }
      }

      try {
        const sku = await generateSku(sub.category.skuPrefix, sub.skuPrefix);
        await db.product.create({
          data: {
            tenantId: tid,
            nome,
            sku,
            ean: row.ean ? onlyDigits(row.ean) : null,
            subcategoryId: sub.id,
            brandId,
            precoVenda: num(row.precoVenda),
            custo: num(row.custo),
            fiscalProfileId: sub.defaultFiscalProfileId,
            stocks: {
              create: [{
                tenantId: tid,
                siteId: (await getOrCreateDefaultSite(tid)).id,
                estoqueFechado: num(row.estoqueInicial) ?? 0,
                estoqueMinimo: num(row.estoqueMinimo) ?? 0,
                estoqueIdeal: num(row.estoqueIdeal) ?? 0,
              }],
            },
          },
        });
        result.criados++;
      } catch (e) {
        result.erros.push({ linha, motivo: e instanceof Error ? e.message : "Falha ao gravar." });
      }
    }

    revalidatePath("/produtos");
    return result;
  });
}
