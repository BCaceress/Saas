import { db } from "./prisma";

/**
 * Gera SKU no formato PREFIXOCAT-PREFIXOSUBCAT-#### (ex.: BEB-CER-6489).
 * 4 dígitos aleatórios (não sequencial: não vaza contagem nem cria buracos),
 * checa unicidade em [tenantId, sku] e faz retry em colisão (PRD §8.5).
 * Roda dentro do contexto de tenant (db injeta tenantId).
 */
export async function generateSku(
  categoryPrefix: string,
  subcategoryPrefix: string,
  maxRetries = 12
): Promise<string> {
  const base = `${categoryPrefix}-${subcategoryPrefix}`;
  for (let i = 0; i < maxRetries; i++) {
    const n = Math.floor(1000 + Math.random() * 9000); // 1000–9999
    const sku = `${base}-${n}`;
    const existing = await db.product.findFirst({
      where: { sku },
      select: { id: true },
    });
    if (!existing) return sku;
  }
  throw new Error(
    `Não foi possível gerar SKU único para ${base} após ${maxRetries} tentativas.`
  );
}
