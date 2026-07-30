"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/crypto";
import { criarPedidoCompra } from "@/lib/estoque";
import { ingerir } from "@/lib/compras/ingest";
import {
  buscarOfertas,
  compararCesta,
  historicoPreco,
  type ItemCesta,
} from "@/lib/compras/comparador";
import { loadCarrinho } from "./data";

// ============================================================
// Escrita do módulo. Leitura é RSC; aqui só entra o que muda estado.
//
// Permissões: ver = `compras.ver`; importar/sincronizar/configurar =
// `fornecedor.editar` (mexer na tabela do fornecedor é cadastro); carrinho e
// geração de pedido = `compras.pedir`.
// ============================================================

async function tx<T>(
  permissao: Permissao,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

function ok() {
  revalidatePath("/compras", "layout");
}

// ── Integração do fornecedor ────────────────────────────────

const integracaoSchema = z.object({
  supplierId: z.string().min(1),
  possuiIntegracao: z.boolean().default(false),
  tipoIntegracao: z
    .enum(["API", "PLANILHA", "CSV", "PDF", "IMAGEM", "XML", "JSON", "MANUAL"])
    .nullable()
    .optional(),
  aceitaImportacaoManual: z.boolean().default(true),
  aceitaImportacaoAutomatica: z.boolean().default(false),
  endpoint: z.string().trim().url("Informe uma URL válida.").nullable().optional().or(z.literal("")),
  authTipo: z.enum(["none", "bearer", "basic", "apikey"]).nullable().optional(),
  /** Vazio = manter a credencial atual (a tela nunca recebe o valor em claro). */
  credencial: z.string().trim().optional(),
  frequenciaHoras: z.number().int().min(1).max(168).nullable().optional(),
});

export async function salvarIntegracaoAction(input: z.input<typeof integracaoSchema>) {
  const d = integracaoSchema.parse(input);

  await tx("fornecedor.editar", async (tid) => {
    const kind = d.tipoIntegracao ?? "MANUAL";
    const endpoint = d.endpoint && d.endpoint !== "" ? d.endpoint : null;

    await db.supplier.update({
      where: { id: d.supplierId },
      data: {
        possuiIntegracao: d.possuiIntegracao,
        tipoIntegracao: d.tipoIntegracao ?? null,
        aceitaImportacaoManual: d.aceitaImportacaoManual,
        aceitaImportacaoAutomatica: d.aceitaImportacaoAutomatica,
        situacaoIntegracao: d.possuiIntegracao
          ? kind === "API"
            ? endpoint
              ? "OFFLINE"
              : "NAO_CONFIGURADA"
            : "ONLINE"
          : "NAO_CONFIGURADA",
      },
    });

    const existente = await db.supplierIntegration.findFirst({
      where: { supplierId: d.supplierId },
      select: { id: true },
    });

    const dados = {
      kind,
      ativo: d.possuiIntegracao,
      endpoint,
      authTipo: d.authTipo ?? null,
      frequenciaHoras: d.frequenciaHoras ?? null,
      proximaSync:
        d.aceitaImportacaoAutomatica && d.frequenciaHoras
          ? new Date(Date.now() + d.frequenciaHoras * 3600_000)
          : null,
      // Segredo só é reescrito quando a pessoa digita um novo.
      ...(d.credencial ? { credencial: cifrar(d.credencial) } : {}),
    };

    if (existente) {
      await db.supplierIntegration.update({ where: { id: existente.id }, data: dados });
    } else {
      await db.supplierIntegration.create({
        data: { ...dados, tenantId: tid, supplierId: d.supplierId },
      });
    }
  });

  ok();
  return { ok: true as const };
}

/** Puxa a tabela agora pela API configurada. */
export async function sincronizarFornecedorAction(supplierId: string) {
  const resultado = await tx("fornecedor.editar", async (_tid, userId) => {
    const integracao = await db.supplierIntegration.findFirst({
      where: { supplierId },
      select: { kind: true, endpoint: true, authTipo: true, credencial: true, headers: true },
    });

    if (!integracao || integracao.kind !== "API" || !integracao.endpoint) {
      throw new Error("Este fornecedor não tem integração por API configurada.");
    }

    return ingerir({
      supplierId,
      kind: "API",
      origem: "api",
      userId,
      fonte: {
        tipo: "api",
        endpoint: integracao.endpoint,
        authTipo: integracao.authTipo,
        credencial: decifrar(integracao.credencial),
        headers: (integracao.headers as Record<string, string> | null) ?? null,
      },
    });
  });

  ok();
  return resultado;
}

// ── Ofertas digitadas à mão ─────────────────────────────────

const ofertaManualSchema = z.object({
  codigoFornecedor: z.string().trim().max(60).nullable().optional(),
  ean: z.string().trim().max(20).nullable().optional(),
  descricao: z.string().trim().min(2, "Descreva o produto."),
  unidade: z.string().trim().max(20).nullable().optional(),
  preco: z.number().positive("Informe o preço."),
  precoPromocional: z.number().positive().nullable().optional(),
  quantidadeMinima: z.number().positive().nullable().optional(),
  validadeOferta: z.string().nullable().optional(),
});

const manualSchema = z.object({
  supplierId: z.string().min(1, "Escolha o fornecedor."),
  itens: z.array(ofertaManualSchema).min(1, "Adicione ao menos um item."),
});

export async function importarManualAction(input: z.input<typeof manualSchema>) {
  const d = manualSchema.parse(input);

  const resultado = await tx("fornecedor.editar", (_tid, userId) =>
    ingerir({
      supplierId: d.supplierId,
      kind: "MANUAL",
      origem: "manual",
      userId,
      // Digitação é sempre parcial: o que não foi digitado continua valendo.
      substituirCatalogo: false,
      fonte: {
        tipo: "manual",
        ofertas: d.itens.map((i) => ({
          codigoFornecedor: i.codigoFornecedor ?? null,
          ean: i.ean ?? null,
          descricao: i.descricao,
          unidade: i.unidade ?? null,
          preco: i.preco,
          precoPromocional: i.precoPromocional ?? null,
          quantidadeMinima: i.quantidadeMinima ?? null,
          validadeOferta: i.validadeOferta ? new Date(i.validadeOferta) : null,
        })),
      },
    }),
  );

  ok();
  return resultado;
}

// ── Fila de revisão ─────────────────────────────────────────

export async function vincularItemAction(itemId: string, productId: string) {
  await tx("fornecedor.editar", async (tid) => {
    const produto = await db.product.findFirst({ where: { id: productId }, select: { id: true } });
    if (!produto) throw new Error("Produto não encontrado.");

    await db.supplierCatalogItem.update({
      where: { id: itemId },
      data: { productId, matchStatus: "VINCULADO", matchOrigem: "MANUAL" },
    });

    // O vínculo feito aqui também ensina a entrada por XML: mesma tabela,
    // mesmo código de fornecedor.
    const item = await db.supplierCatalogItem.findFirst({
      where: { id: itemId },
      select: { supplierId: true, codigoFornecedor: true, ean: true },
    });
    if (item?.codigoFornecedor) {
      const mapa = await db.supplierItemMap.findFirst({
        where: { supplierId: item.supplierId, codigoFornecedor: item.codigoFornecedor },
        select: { id: true },
      });
      if (mapa) {
        await db.supplierItemMap.update({
          where: { id: mapa.id },
          data: { productId, gtin: item.ean ?? undefined },
        });
      } else {
        await db.supplierItemMap.create({
          data: {
            tenantId: tid,
            supplierId: item.supplierId,
            codigoFornecedor: item.codigoFornecedor,
            gtin: item.ean,
            productId,
          },
        });
      }
    }
  });

  ok();
  return { ok: true as const };
}

export async function ignorarItemAction(itemId: string) {
  await tx("fornecedor.editar", () =>
    db.supplierCatalogItem.update({
      where: { id: itemId },
      data: { matchStatus: "IGNORADO", productId: null, matchOrigem: "MANUAL" },
    }),
  );
  ok();
  return { ok: true as const };
}

/** Produtos para o seletor da revisão manual. */
export async function buscarProdutosAction(termo: string) {
  return tx("compras.ver", async () => {
    const t = termo.trim();
    if (t.length < 2) return [];
    const produtos = await db.product.findMany({
      where: {
        ativo: true,
        OR: [
          { nome: { contains: t, mode: "insensitive" } },
          { sku: { contains: t, mode: "insensitive" } },
          { ean: { contains: t.replace(/\D/g, "") || " " } },
        ],
      },
      orderBy: { nome: "asc" },
      take: 20,
      select: { id: true, nome: true, sku: true, ean: true },
    });
    return produtos;
  });
}

// ── Comparador ──────────────────────────────────────────────

export async function buscarOfertasAction(termo: string) {
  return tx("compras.ver", () => buscarOfertas(termo));
}

export async function compararCestaAction(itens: ItemCesta[]) {
  return tx("compras.ver", () => compararCesta(itens));
}

export async function historicoPrecoAction(catalogItemId: string, dias: number) {
  return tx("compras.ver", () => historicoPreco(catalogItemId, dias));
}

// ── Carrinho ────────────────────────────────────────────────

const carrinhoSchema = z.object({
  catalogItemId: z.string().min(1),
  quantidade: z.number().positive().default(1),
});

export async function adicionarAoCarrinhoAction(input: z.input<typeof carrinhoSchema>) {
  const d = carrinhoSchema.parse(input);

  await tx("compras.pedir", async (tid, userId) => {
    const item = await db.supplierCatalogItem.findFirst({
      where: { id: d.catalogItemId, ativo: true },
      select: {
        id: true,
        supplierId: true,
        productId: true,
        descricao: true,
        preco: true,
        precoPromocional: true,
        validadeOferta: true,
      },
    });
    if (!item) throw new Error("Oferta não encontrada.");

    const promo = item.precoPromocional == null ? null : Number(item.precoPromocional);
    const vencida = item.validadeOferta != null && item.validadeOferta.getTime() < Date.now();
    const preco = promo != null && !vencida && promo < Number(item.preco) ? promo : Number(item.preco);

    const existente = await db.supplierCartItem.findFirst({
      where: { userId, catalogItemId: item.id },
      select: { id: true, quantidade: true },
    });

    if (existente) {
      await db.supplierCartItem.update({
        where: { id: existente.id },
        data: { quantidade: Number(existente.quantidade) + d.quantidade, precoUnitario: preco },
      });
    } else {
      await db.supplierCartItem.create({
        data: {
          tenantId: tid,
          userId,
          supplierId: item.supplierId,
          catalogItemId: item.id,
          productId: item.productId,
          descricao: item.descricao,
          quantidade: d.quantidade,
          precoUnitario: preco,
        },
      });
    }
  });

  ok();
  return { ok: true as const };
}

/** Joga a estratégia escolhida no comparador inteira no carrinho. */
export async function adicionarLoteAoCarrinhoAction(
  itens: Array<{ catalogItemId: string; quantidade: number }>,
) {
  const lista = z
    .array(z.object({ catalogItemId: z.string().min(1), quantidade: z.number().positive() }))
    .min(1)
    .parse(itens);

  for (const item of lista) await adicionarAoCarrinhoAction(item);
  return { ok: true as const, adicionados: lista.length };
}

export async function atualizarItemCarrinhoAction(id: string, quantidade: number) {
  if (quantidade <= 0) return removerItemCarrinhoAction(id);

  await tx("compras.pedir", async (_tid, userId) => {
    const item = await db.supplierCartItem.findFirst({ where: { id, userId }, select: { id: true } });
    if (!item) throw new Error("Item não encontrado no carrinho.");
    await db.supplierCartItem.update({ where: { id }, data: { quantidade } });
  });

  ok();
  return { ok: true as const };
}

export async function removerItemCarrinhoAction(id: string) {
  await tx("compras.pedir", async (_tid, userId) => {
    await db.supplierCartItem.deleteMany({ where: { id, userId } });
  });
  ok();
  return { ok: true as const };
}

export async function limparCarrinhoAction() {
  await tx("compras.pedir", async (_tid, userId) => {
    await db.supplierCartItem.deleteMany({ where: { userId } });
  });
  ok();
  return { ok: true as const };
}

/** Troca o item pelo mesmo produto no fornecedor mais barato. */
export async function trocarPorMelhorPrecoAction(id: string) {
  await tx("compras.pedir", async (_tid, userId) => {
    const item = await db.supplierCartItem.findFirst({
      where: { id, userId },
      select: { id: true, productId: true, quantidade: true },
    });
    if (!item?.productId) throw new Error("Este item não está vinculado a um produto.");

    const ofertas = await db.supplierCatalogItem.findMany({
      where: { ativo: true, matchStatus: "VINCULADO", productId: item.productId },
      select: {
        id: true,
        supplierId: true,
        descricao: true,
        preco: true,
        precoPromocional: true,
        validadeOferta: true,
      },
    });
    if (ofertas.length === 0) throw new Error("Nenhuma oferta disponível para este produto.");

    const melhor = ofertas
      .map((o) => {
        const promo = o.precoPromocional == null ? null : Number(o.precoPromocional);
        const vencida = o.validadeOferta != null && o.validadeOferta.getTime() < Date.now();
        return {
          ...o,
          efetivo: promo != null && !vencida && promo < Number(o.preco) ? promo : Number(o.preco),
        };
      })
      .sort((a, b) => a.efetivo - b.efetivo)[0];

    await db.supplierCartItem.update({
      where: { id },
      data: {
        supplierId: melhor.supplierId,
        catalogItemId: melhor.id,
        descricao: melhor.descricao,
        precoUnitario: melhor.efetivo,
      },
    });
  });

  ok();
  return { ok: true as const };
}

// ── Fechamento: carrinho → um pedido por fornecedor ─────────

const fecharSchema = z.object({
  siteId: z.string().min(1, "Escolha a loja de destino."),
  enviar: z.boolean().default(false),
  previsaoEntrega: z.string().nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  /** Vazio = todos os fornecedores do carrinho. */
  supplierIds: z.array(z.string()).optional(),
});

export async function gerarPedidosAction(input: z.input<typeof fecharSchema>) {
  const d = fecharSchema.parse(input);
  const ctx = await guardAction("compras.pedir", d.siteId);

  const resultado = await runWithTenant(ctx.tenant.id, async () => {
    const grupos = await loadCarrinho(ctx.user.id ?? "");
    const alvo = d.supplierIds?.length
      ? grupos.filter((g) => d.supplierIds!.includes(g.supplierId))
      : grupos;

    if (alvo.length === 0) throw new Error("O carrinho está vazio.");

    const criados: Array<{ supplierId: string; supplierNome: string; pedidoId: string; itens: number }> = [];
    let semVinculo = 0;

    for (const grupo of alvo) {
      // Item sem produto vinculado não vira linha de pedido — pedido de compra
      // move estoque, e estoque exige produto. Fica no carrinho para revisão.
      const itens = grupo.itens.filter((i) => i.productId);
      semVinculo += grupo.itens.length - itens.length;
      if (itens.length === 0) continue;

      const pedidoId = await criarPedidoCompra(
        ctx.tenant.id,
        {
          siteId: d.siteId,
          supplierId: grupo.supplierId,
          previsaoEntrega: d.previsaoEntrega ? new Date(d.previsaoEntrega) : null,
          observacao: d.observacao ?? "Gerado pelo comparador de fornecedores.",
          items: itens.map((i) => ({
            productId: i.productId as string,
            qtdPedida: i.quantidade,
            custoUnitario: i.precoUnitario,
          })),
        },
        { enviar: d.enviar, createdBy: ctx.user.id ?? undefined },
      );

      criados.push({
        supplierId: grupo.supplierId,
        supplierNome: grupo.supplierNome,
        pedidoId,
        itens: itens.length,
      });

      await db.supplierCartItem.deleteMany({
        where: {
          userId: ctx.user.id ?? "",
          supplierId: grupo.supplierId,
          productId: { not: null },
        },
      });
    }

    return { criados, semVinculo };
  });

  ok();
  revalidatePath("/compras", "layout");
  return resultado;
}
