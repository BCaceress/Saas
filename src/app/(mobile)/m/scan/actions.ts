"use server";

import { z } from "zod";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId } from "@/lib/sites";
import { onlyDigits } from "@/lib/normalize";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { getCosmosByEan, CosmosError } from "@/lib/cosmos";
import {
  montarFicha,
  SELECT_FICHA,
  type FichaProduto,
  type ProdutoResumo,
  type ProdutoCru,
} from "../_produto-data";

/**
 * Consulta de produto pelo código de barras.
 *
 * É LEITURA: usa `mesmoSuspenso` para não passar por `assertPodeEscrever`. Uma
 * assinatura em atraso trava a operação nova, não o direito de conferir o
 * próprio estoque na gôndola.
 *
 * Não dá para reaproveitar `searchProducts` de `produtos/actions.ts`: aquele
 * roda sob `guardAction("produto.editar")`, ou seja, exigiria permissão de
 * EDIÇÃO para uma consulta — o repositor não tem, e é justamente ele que
 * escaneia.
 */
function contexto() {
  return guardAction("produto.ver", null, { mesmoSuspenso: true });
}

export type ResultadoBusca =
  | { tipo: "achou"; ficha: FichaProduto }
  | { tipo: "nada"; codigo: string };

const codigoSchema = z
  .string()
  .trim()
  .min(1, "Informe um código")
  .max(64, "Código longo demais");

/**
 * Acha o produto por EAN da unidade, SKU ou EAN de embalagem (fardo/caixa).
 *
 * O EAN do fardo resolve para o mesmo produto e devolve o fator de conversão:
 * quem bipa a caixa no recebimento precisa saber que ali dentro vêm 12.
 */
export async function buscarPorCodigoAction(codigoRaw: string): Promise<ResultadoBusca> {
  const parsed = codigoSchema.safeParse(codigoRaw);
  if (!parsed.success) return { tipo: "nada", codigo: "" };
  const codigo = parsed.data;

  // Código de barras vem só com dígitos; SKU tem letras. Tentamos os dois em
  // vez de escolher — leitor de laser às vezes entrega o EAN com sujeira.
  const digitos = onlyDigits(codigo);
  const ctx = await contexto();
  const policy = policyDoTenant(ctx.tenant);

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();

    // `findFirst`, nunca `findUnique`: o WHERE de findUnique só aceita campos
    // únicos e a injeção de tenantId do extension quebra (ver CLAUDE.md).
    const porUnidade = (await db.product.findFirst({
      where: {
        ativo: true,
        OR: [
          ...(digitos ? [{ ean: digitos }] : []),
          { ean: codigo },
          { sku: { equals: codigo, mode: "insensitive" as const } },
        ],
      },
      select: SELECT_FICHA,
    })) as ProdutoCru | null;

    if (porUnidade) {
      const casouPor =
        porUnidade.ean && (porUnidade.ean === digitos || porUnidade.ean === codigo)
          ? "ean"
          : "sku";
      return {
        tipo: "achou" as const,
        ficha: await montarFicha(porUnidade, {
          acessos: ctx.acessos,
          siteId,
          policy,
          validadeAlertaDias: ctx.tenant.validadeAlertaDias || 30,
          casouPor,
        }),
      };
    }

    // Não é a unidade: pode ser o código do fardo.
    const porEmbalagem = await db.productPackaging.findFirst({
      where: { ean: digitos || codigo },
      select: {
        id: true,
        nome: true,
        ean: true,
        fatorConversao: true,
        product: { select: SELECT_FICHA },
      },
    });

    if (porEmbalagem?.product) {
      const embalagem = {
        id: porEmbalagem.id,
        nome: porEmbalagem.nome,
        ean: porEmbalagem.ean,
        fator: Number(porEmbalagem.fatorConversao),
      };
      return {
        tipo: "achou" as const,
        ficha: await montarFicha(porEmbalagem.product as ProdutoCru, {
          acessos: ctx.acessos,
          siteId,
          policy,
          validadeAlertaDias: ctx.tenant.validadeAlertaDias || 30,
          casouPor: "embalagem",
          embalagemCasada: embalagem,
        }),
      };
    }

    return { tipo: "nada" as const, codigo };
  });
}

/** Busca por nome/SKU quando o código não achou nada. */
export async function buscarPorNomeAction(termoRaw: string): Promise<ProdutoResumo[]> {
  const termo = termoRaw.trim();
  if (termo.length < 2) return [];

  const ctx = await contexto();
  return runWithTenant(ctx.tenant.id, () =>
    db.product.findMany({
      where: {
        ativo: true,
        OR: [
          { nome: { contains: termo, mode: "insensitive" } },
          { sku: { contains: termo, mode: "insensitive" } },
        ],
      },
      select: { id: true, nome: true, sku: true, ean: true, imagemUrl: true },
      orderBy: { nome: "asc" },
      take: 20,
    }),
  );
}

export type ConsultaCosmos =
  | { ok: true; nome: string | null; marca: string | null; imagem: string | null; ncm: string | null }
  | { ok: false; erro: string };

/**
 * Consulta o EAN na base pública (Cosmos). Só sob toque explícito: a chamada
 * tem custo por consulta e o token é de servidor — nunca vai ao browser.
 */
export async function consultarEanExternoAction(eanRaw: string): Promise<ConsultaCosmos> {
  await guardAction("produto.ver", null, { mesmoSuspenso: true });

  const ean = onlyDigits(eanRaw);
  if (ean.length < 8) return { ok: false, erro: "Código de barras inválido." };

  try {
    const r = await getCosmosByEan(ean);
    return {
      ok: true,
      nome: r.descricao,
      marca: r.marca,
      imagem: r.thumbnail,
      ncm: r.ncm,
    };
  } catch (e) {
    if (e instanceof CosmosError) return { ok: false, erro: e.message };
    return { ok: false, erro: "Não foi possível consultar agora." };
  }
}
