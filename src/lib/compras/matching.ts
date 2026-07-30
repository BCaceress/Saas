import type { SupplierMatchOrigem } from "@/generated/prisma";
import { db } from "@/lib/prisma";
import { normalizeBrand, onlyDigits } from "@/lib/normalize";
import type { OfertaBruta } from "./types";

// ============================================================
// Vínculo item do fornecedor → produto do tenant. É o coração do módulo: sem
// ele, "comparar preço entre fornecedores" vira comparar strings diferentes do
// mesmo produto.
//
// Ordem de confiança (a primeira que casar vence):
//   1. EAN            — código global, é o único que não erra;
//   2. código do fornecedor — via SupplierItemMap, a mesma tabela que a
//      entrada por XML já alimenta, e via ProductSupplier;
//   3. SKU            — quando o fornecedor manda o código do lojista;
//   4. nome normalizado — último recurso, e só com igualdade exata.
//
// Sem correspondência, o item entra PENDENTE: aparece no catálogo, fica fora
// da comparação por produto e cai na fila de revisão manual.
// ============================================================

export type Vinculo = { productId: string; origem: SupplierMatchOrigem } | null;

export type IndiceProdutos = {
  porEan: Map<string, string>;
  porSku: Map<string, string>;
  porNome: Map<string, string>;
  porCodigoFornecedor: Map<string, string>;
};

/** Nome comparável: sem acento, sem pontuação, caixa alta, espaços colapsados. */
export function chaveNome(nome: string): string {
  return normalizeBrand(nome);
}

/**
 * Carrega tudo que serve de âncora em memória — o catálogo do fornecedor tem
 * milhares de linhas e uma consulta por linha derrubaria a importação.
 * Roda dentro de `runWithTenant`.
 */
export async function carregarIndice(supplierId: string): Promise<IndiceProdutos> {
  const [produtos, mapas, vinculos] = await Promise.all([
    db.product.findMany({
      where: { ativo: true },
      select: { id: true, ean: true, sku: true, nome: true },
    }),
    db.supplierItemMap.findMany({
      where: { supplierId },
      select: { codigoFornecedor: true, productId: true, gtin: true },
    }),
    db.productSupplier.findMany({
      where: { supplierId, codigoNoFornecedor: { not: null } },
      select: { codigoNoFornecedor: true, productId: true },
    }),
  ]);

  const porEan = new Map<string, string>();
  const porSku = new Map<string, string>();
  const porNome = new Map<string, string>();
  const porCodigoFornecedor = new Map<string, string>();

  for (const p of produtos) {
    if (p.ean) porEan.set(onlyDigits(p.ean), p.id);
    porSku.set(p.sku.toUpperCase(), p.id);
    // Nome repetido não desempata sozinho — o primeiro fica e o resto é
    // ignorado de propósito, para não casar produto errado no escuro.
    const chave = chaveNome(p.nome);
    if (chave && !porNome.has(chave)) porNome.set(chave, p.id);
  }

  for (const m of mapas) {
    porCodigoFornecedor.set(m.codigoFornecedor.toUpperCase(), m.productId);
    if (m.gtin) porEan.set(onlyDigits(m.gtin), m.productId);
  }
  for (const v of vinculos) {
    if (v.codigoNoFornecedor) {
      porCodigoFornecedor.set(v.codigoNoFornecedor.toUpperCase(), v.productId);
    }
  }

  return { porEan, porSku, porNome, porCodigoFornecedor };
}

export function vincular(oferta: OfertaBruta, indice: IndiceProdutos): Vinculo {
  if (oferta.ean) {
    const id = buscarEan(indice.porEan, oferta.ean);
    if (id) return { productId: id, origem: "EAN" };
  }

  if (oferta.codigoFornecedor) {
    const id = indice.porCodigoFornecedor.get(oferta.codigoFornecedor.toUpperCase());
    if (id) return { productId: id, origem: "CODIGO_FORNECEDOR" };

    const porSku = indice.porSku.get(oferta.codigoFornecedor.toUpperCase());
    if (porSku) return { productId: porSku, origem: "SKU" };
  }

  const nome = chaveNome(oferta.descricao ?? "");
  if (nome) {
    const id = indice.porNome.get(nome);
    if (id) return { productId: id, origem: "NOME" };
  }

  return null;
}

/**
 * GTIN-8/12/13/14 são o mesmo produto com zeros à esquerda diferentes — comparar
 * a string crua perde metade dos casos.
 */
function buscarEan(porEan: Map<string, string>, ean: string): string | null {
  const digitos = onlyDigits(ean);
  if (!digitos) return null;

  const direto = porEan.get(digitos);
  if (direto) return direto;

  const semZeros = digitos.replace(/^0+/, "");
  for (const [chave, id] of porEan) {
    if (chave.replace(/^0+/, "") === semZeros) return id;
  }
  return null;
}
