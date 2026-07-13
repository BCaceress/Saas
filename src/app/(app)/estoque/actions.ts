"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { loadComprasFormOptions } from "./_data";
import {
  registrarEntrada,
  registrarAjuste,
  registrarPerda,
  registrarDevolucao,
  registrarTransferencia,
  registrarProducao,
  criarRequisicao,
  expedirRequisicao,
  receberTransferencia,
  cancelarRequisicao,
  criarInventario,
  fecharInventario,
  cancelarInventario,
  criarPedidoCompra,
  atualizarPedidoCompra,
  enviarPedidoCompra,
  marcarAguardandoPedido,
  cancelarPedidoCompra,
  excluirPedidoCompra,
  receberPedidoCompra,
} from "@/lib/estoque";

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => revalidatePath("/estoque", "layout");

// ── Sites ────────────────────────────────────────────────────

const siteSchema = z.object({
  nome: z.string().min(2, "Informe o nome do site."),
  tipo: z.enum(["LOJA", "CD"]),
  cep: z.string().optional().nullable(),
  rua: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  estoquePropio: z.boolean().default(true),
  cdAbastecedorId: z.string().optional().nullable(),
  controleIdade: z.boolean().default(false),
});

export async function createSite(input: z.input<typeof siteSchema>) {
  return tx(async (tid) => {
    const d = siteSchema.parse(input);
    const nome = d.nome.trim();
    const dup = await db.site.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (dup) throw new Error(`Já existe um site com o nome "${nome}".`);
    const site = await db.site.create({
      data: {
        tenantId: tid,
        nome,
        tipo: d.tipo,
        cep: d.cep,
        rua: d.rua,
        numero: d.numero,
        cidade: d.cidade,
        estado: d.estado,
        estoquePropio: d.estoquePropio,
        cdAbastecedorId: d.cdAbastecedorId,
        controleIdade: d.tipo === "LOJA" && d.controleIdade,
      },
    });
    ok();
    return site.id;
  });
}

export async function updateSite(id: string, input: z.input<typeof siteSchema>) {
  return tx(async () => {
    const d = siteSchema.parse(input);
    const nome = d.nome.trim();
    const dup = await db.site.findFirst({ where: { nome: { equals: nome, mode: "insensitive" }, id: { not: id } } });
    if (dup) throw new Error(`Já existe um site com o nome "${nome}".`);
    await db.site.update({
      where: { id },
      data: {
        nome,
        tipo: d.tipo,
        cep: d.cep,
        rua: d.rua,
        numero: d.numero,
        cidade: d.cidade,
        estado: d.estado,
        estoquePropio: d.estoquePropio,
        cdAbastecedorId: d.cdAbastecedorId,
        controleIdade: d.tipo === "LOJA" && d.controleIdade,
      },
    });
    ok();
  });
}

export async function toggleSiteAtivo(id: string, ativo: boolean) {
  return tx(async () => {
    await db.site.update({ where: { id }, data: { ativo } });
    ok();
  });
}

// ── Entrada ──────────────────────────────────────────────────

const entradaItemSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().positive(),
  custoTotal: z.number().nonnegative(),
  packagingId: z.string().optional().nullable(),
});

const entradaSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  tipo: z.enum(["MANUAL", "FORNECEDOR"]),
  supplierId: z.string().optional().nullable(),
  numeroNota: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  items: z.array(entradaItemSchema).min(1, "Adicione ao menos um item."),
});

export async function registrarEntradaAction(input: z.input<typeof entradaSchema>) {
  return tx(async (tid, userId) => {
    const d = entradaSchema.parse(input);
    const id = await registrarEntrada(tid, d.siteId, d.items, {
      tipo: d.tipo,
      supplierId: d.supplierId,
      numeroNota: d.numeroNota,
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Pedido de compra ─────────────────────────────────────────

const pedidoItemSchema = z.object({
  productId: z.string().min(1),
  packagingId: z.string().optional().nullable(),
  qtdPedida: z.number().positive(),
  custoUnitario: z.number().nonnegative().default(0),
});

const pedidoSchema = z.object({
  siteId: z.string().min(1, "Selecione o destino."),
  supplierId: z.string().min(1, "Selecione o fornecedor."),
  previsaoEntrega: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  items: z.array(pedidoItemSchema).min(1, "Adicione ao menos um item."),
});

const parsePrevisao = (v?: string | null) => (v ? new Date(`${v}T00:00:00`) : null);

export async function loadComprasFormOptionsAction() {
  return tx(() => loadComprasFormOptions());
}

export async function criarPedidoCompraAction(
  input: z.input<typeof pedidoSchema>,
  enviar = false,
) {
  return tx(async (tid, userId) => {
    const d = pedidoSchema.parse(input);
    const id = await criarPedidoCompra(
      tid,
      {
        siteId: d.siteId,
        supplierId: d.supplierId,
        previsaoEntrega: parsePrevisao(d.previsaoEntrega),
        observacao: d.observacao,
        items: d.items,
      },
      { enviar, createdBy: userId },
    );
    ok();
    return id;
  });
}

export async function atualizarPedidoCompraAction(
  pedidoId: string,
  input: z.input<typeof pedidoSchema>,
) {
  return tx(async (tid) => {
    const d = pedidoSchema.parse(input);
    await atualizarPedidoCompra(tid, pedidoId, {
      siteId: d.siteId,
      supplierId: d.supplierId,
      previsaoEntrega: parsePrevisao(d.previsaoEntrega),
      observacao: d.observacao,
      items: d.items,
    });
    ok();
  });
}

export async function enviarPedidoCompraAction(pedidoId: string) {
  return tx(async (tid) => {
    await enviarPedidoCompra(tid, pedidoId);
    ok();
  });
}

export async function marcarAguardandoPedidoAction(pedidoId: string) {
  return tx(async (tid) => {
    await marcarAguardandoPedido(tid, pedidoId);
    ok();
  });
}

export async function cancelarPedidoCompraAction(pedidoId: string) {
  return tx(async (tid) => {
    await cancelarPedidoCompra(tid, pedidoId);
    ok();
  });
}

export async function excluirPedidoCompraAction(pedidoId: string) {
  return tx(async (tid) => {
    await excluirPedidoCompra(tid, pedidoId);
    ok();
  });
}

const recebimentoCompraSchema = z.object({
  pedidoId: z.string().min(1),
  numeroNota: z.string().optional().nullable(),
  gerarFinanceiro: z.boolean().default(false),
  items: z.array(z.object({ productId: z.string().min(1), qtdRecebida: z.number().nonnegative() })).min(1),
});

export async function receberPedidoCompraAction(input: z.input<typeof recebimentoCompraSchema>) {
  return tx(async (tid, userId) => {
    const d = recebimentoCompraSchema.parse(input);
    await receberPedidoCompra(tid, d.pedidoId, d.items, {
      numeroNota: d.numeroNota,
      gerarFinanceiro: d.gerarFinanceiro,
      createdBy: userId,
    });
    ok();
  });
}

// ── Ajuste ───────────────────────────────────────────────────

const ajusteSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  deltaFechado: z.number().default(0),
  deltaAberto: z.number().default(0),
  observacao: z.string().min(3, "Informe o motivo do ajuste."),
});

export async function registrarAjusteAction(input: z.input<typeof ajusteSchema>) {
  return tx(async (tid, userId) => {
    const d = ajusteSchema.parse(input);
    await registrarAjuste(tid, d.siteId, d.productId, {
      fechado: d.deltaFechado,
      aberto: d.deltaAberto,
    }, d.observacao, userId);
    ok();
  });
}

// ── Devolução ────────────────────────────────────────────────

const devolucaoSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  tipo: z.enum(["CLIENTE", "FORNECEDOR"]),
  deltaFechado: z.number().nonnegative().default(0),
  deltaAberto: z.number().nonnegative().default(0),
  observacao: z.string().min(3, "Informe o motivo da devolução."),
  custoUnitario: z.number().nonnegative().optional(),
});

export async function registrarDevolucaoAction(input: z.input<typeof devolucaoSchema>) {
  return tx(async (tid, userId) => {
    const d = devolucaoSchema.parse(input);
    await registrarDevolucao(
      tid,
      d.siteId,
      d.productId,
      d.tipo,
      { fechado: d.deltaFechado, aberto: d.deltaAberto },
      d.observacao,
      { custoUnitario: d.custoUnitario, createdBy: userId },
    );
    ok();
  });
}

// ── Perda ────────────────────────────────────────────────────

const perdaSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  deltaFechado: z.number().nonnegative().default(0),
  deltaAberto: z.number().nonnegative().default(0),
  observacao: z.string().min(3, "Informe o motivo da perda."),
});

export async function registrarPerdaAction(input: z.input<typeof perdaSchema>) {
  return tx(async (tid, userId) => {
    const d = perdaSchema.parse(input);
    await registrarPerda(tid, d.siteId, d.productId, {
      fechado: d.deltaFechado,
      aberto: d.deltaAberto,
    }, d.observacao, userId);
    ok();
  });
}

// ── Transferência ─────────────────────────────────────────────

const transferenciaItemSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().positive(),
});

const transferenciaSchema = z.object({
  origemSiteId: z.string().min(1),
  destinoSiteId: z.string().min(1),
  observacao: z.string().optional().nullable(),
  items: z.array(transferenciaItemSchema).min(1, "Adicione ao menos um item."),
});

export async function registrarTransferenciaAction(input: z.input<typeof transferenciaSchema>) {
  return tx(async (tid, userId) => {
    const d = transferenciaSchema.parse(input);
    if (d.origemSiteId === d.destinoSiteId) throw new Error("Origem e destino devem ser diferentes.");
    const id = await registrarTransferencia(tid, d.origemSiteId, d.destinoSiteId, d.items, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Requisição / expedição / recebimento (distribuição CD→loja) ──

const requisicaoSchema = z.object({
  origemSiteId: z.string().min(1, "Selecione o CD de origem."),
  destinoSiteId: z.string().min(1, "Selecione a loja de destino."),
  observacao: z.string().optional().nullable(),
  items: z
    .array(z.object({ productId: z.string().min(1), qtdSolicitada: z.number().positive() }))
    .min(1, "Adicione ao menos um item."),
});

export async function criarRequisicaoAction(input: z.input<typeof requisicaoSchema>) {
  return tx(async (tid, userId) => {
    const d = requisicaoSchema.parse(input);
    if (d.origemSiteId === d.destinoSiteId) throw new Error("Origem e destino devem ser diferentes.");
    const id = await criarRequisicao(tid, d.origemSiteId, d.destinoSiteId, d.items, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

const expedicaoSchema = z.object({
  requisicaoId: z.string().min(1),
  observacao: z.string().optional().nullable(),
  items: z
    .array(z.object({ productId: z.string().min(1), qtdExpedida: z.number().nonnegative() }))
    .min(1, "Informe as quantidades a expedir."),
});

export async function expedirRequisicaoAction(input: z.input<typeof expedicaoSchema>) {
  return tx(async (tid, userId) => {
    const d = expedicaoSchema.parse(input);
    const id = await expedirRequisicao(tid, d.requisicaoId, d.items, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

const recebimentoSchema = z.object({
  transferId: z.string().min(1),
  items: z
    .array(z.object({ productId: z.string().min(1), qtdRecebida: z.number().nonnegative() }))
    .min(1),
});

export async function receberTransferenciaAction(input: z.input<typeof recebimentoSchema>) {
  return tx(async (tid, userId) => {
    const d = recebimentoSchema.parse(input);
    await receberTransferencia(tid, d.transferId, d.items, { createdBy: userId });
    ok();
  });
}

export async function cancelarRequisicaoAction(requisicaoId: string) {
  return tx(async (tid) => {
    await cancelarRequisicao(tid, requisicaoId);
    ok();
  });
}

export async function updateRecebimentoConfigAction(exige: boolean) {
  return tx(async (tid) => {
    await db.tenant.update({ where: { id: tid }, data: { recebimentoExigeContagem: exige } });
    revalidatePath("/estoque", "layout");
    revalidatePath("/configuracoes", "layout");
  });
}

const topologiaSchema = z.enum(["LOCAL", "CD_ABASTECE", "MISTO"]);

export async function updateTopologiaAction(topologia: z.infer<typeof topologiaSchema>) {
  return tx(async (tid) => {
    const t = topologiaSchema.parse(topologia);
    await db.tenant.update({ where: { id: tid }, data: { topologia: t } });
    revalidatePath("/estoque", "layout");
    revalidatePath("/configuracoes", "layout");
  });
}

// ── Inventário / contagem ─────────────────────────────────────

const inventarioSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  observacao: z.string().optional().nullable(),
});

export async function criarInventarioAction(input: z.input<typeof inventarioSchema>) {
  return tx(async (tid, userId) => {
    const d = inventarioSchema.parse(input);
    const id = await criarInventario(tid, d.siteId, { observacao: d.observacao, createdBy: userId });
    ok();
    return id;
  });
}

const fecharInventarioSchema = z.object({
  inventoryId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), qtdContada: z.number().nonnegative() })).min(1),
});

export async function fecharInventarioAction(input: z.input<typeof fecharInventarioSchema>) {
  return tx(async (tid, userId) => {
    const d = fecharInventarioSchema.parse(input);
    await fecharInventario(tid, d.inventoryId, d.items, { createdBy: userId });
    ok();
  });
}

export async function cancelarInventarioAction(inventoryId: string) {
  return tx(async (tid) => {
    await cancelarInventario(tid, inventoryId);
    ok();
  });
}

// ── Produção ─────────────────────────────────────────────────

const producaoSchema = z.object({
  siteId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantidade: z.number().int().positive().default(1),
  observacao: z.string().optional().nullable(),
});

export async function registrarProducaoAction(input: z.input<typeof producaoSchema>) {
  return tx(async (tid, userId) => {
    const d = producaoSchema.parse(input);
    const id = await registrarProducao(tid, d.siteId, d.productId, d.variantId ?? null, d.quantidade, {
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

// ── Histórico de movimentações por produto ────────────────────

export async function fetchHistoricoProductAction(productId: string, siteId: string | null) {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const movements = await db.stockMovement.findMany({
      where: {
        productId,
        ...(siteId ? { siteId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const saleIds       = [...new Set(movements.flatMap((m) => (m.saleId       ? [m.saleId]       : [])))];
    const purchaseIds   = [...new Set(movements.flatMap((m) => (m.purchaseId   ? [m.purchaseId]   : [])))];
    const productionIds = [...new Set(movements.flatMap((m) => (m.productionId ? [m.productionId] : [])))];

    const [sales, purchases, productions] = await Promise.all([
      saleIds.length > 0
        ? db.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, origem: true } })
        : Promise.resolve([]),
      purchaseIds.length > 0
        ? db.purchase.findMany({
            where: { id: { in: purchaseIds } },
            include: { supplier: { select: { razaoSocial: true, nomeFantasia: true } } },
          })
        : Promise.resolve([]),
      productionIds.length > 0
        ? db.production.findMany({
            where: { id: { in: productionIds } },
            select: { id: true, productId: true },
          })
        : Promise.resolve([]),
    ]);

    const saleMap = new Map(sales.map((s) => [s.id, s.origem as string]));
    const purchaseMap = new Map(purchases.map((p) => [p.id, {
      tipo: p.tipo as string,
      supplierNome: p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : null,
    }]));

    // Resolve product names for productions
    const prodProductIds = [...new Set(productions.map((p) => p.productId))];
    const prodProducts = prodProductIds.length > 0
      ? await db.product.findMany({ where: { id: { in: prodProductIds } }, select: { id: true, nome: true } })
      : [];
    const prodProductMap = new Map(prodProducts.map((p) => [p.id, p.nome]));
    const productionMap = new Map(productions.map((p) => [p.id, prodProductMap.get(p.productId) ?? null]));

    return movements.map((m) => ({
      id: m.id,
      tipo: m.tipo as string,
      deltaFechado: Number(m.deltaFechado),
      deltaAberto: Number(m.deltaAberto),
      custoUnitario: m.custoUnitario ? Number(m.custoUnitario) : null,
      observacao: m.observacao,
      createdAt: m.createdAt.toISOString(),
      saleOrigem:         m.saleId       ? (saleMap.get(m.saleId)             ?? null) : null,
      purchaseTipo:       m.purchaseId   ? (purchaseMap.get(m.purchaseId)?.tipo        ?? null) : null,
      purchaseSupplier:   m.purchaseId   ? (purchaseMap.get(m.purchaseId)?.supplierNome ?? null) : null,
      producaoDrinkNome:  m.productionId ? (productionMap.get(m.productionId)           ?? null) : null,
    }));
  });
}

// ── Cookie de site ────────────────────────────────────────────

import { cookies } from "next/headers";

export async function setSiteAction(siteId: string) {
  const store = await cookies();
  store.set("nohub-site", siteId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}

// ── Fetch data for header panels (lazy-load) ──────────────────

import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadEntradaFormOptions, loadInventarios, loadPersonalizados } from "./_data";

export async function fetchAjustesFormDataAction() {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const [siteId, sites, products] = await Promise.all([
      getActiveSiteId(),
      listSites(),
      db.product.findMany({
        where: { ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, sku: true, unidadeBase: true, fracionavel: true },
      }),
    ]);
    return { siteId, sites, products };
  });
}

export async function fetchInventarioDataAction() {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const activeSiteId = await getActiveSiteId();
    const [inventarios, sites] = await Promise.all([
      loadInventarios(activeSiteId),
      listSites(),
    ]);
    return {
      inventarios: inventarios.map((inv) => ({
        ...inv,
        createdAt: inv.createdAt.toISOString(),
        fechadoEm: inv.fechadoEm?.toISOString() ?? null,
      })),
      sites,
      activeSiteId,
    };
  });
}

export async function fetchProducaoDataAction() {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const [siteId, sites, personalizados] = await Promise.all([
      getActiveSiteId(),
      listSites(),
      loadPersonalizados(),
    ]);
    // Decimals do Prisma não cruzam a fronteira RSC → client; converter para número.
    return {
      siteId,
      sites,
      personalizados: personalizados.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        variants: p.variants.map((v) => ({
          id: v.id,
          nome: v.nome,
          fatorEscala: Number(v.fatorEscala),
          volumeMl: v.volumeMl == null ? null : Number(v.volumeMl),
        })),
        components: p.components.map((c) => ({
          component: { nome: c.component.nome, unidadeBase: c.component.unidadeBase },
          quantidade: Number(c.quantidade),
        })),
      })),
    };
  });
}

export async function fetchEntradaFormDataAction() {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const opts = await loadEntradaFormOptions();
    return {
      products: opts.products.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        imagemUrl: p.imagemUrl ?? null,
        packagings: p.packagings.map((pk) => ({
          id: pk.id,
          nome: pk.nome,
          fatorConversao: Number(pk.fatorConversao),
          isCompraDefault: pk.isCompraDefault,
        })),
        suppliers: p.suppliers.map((sup) => ({ supplierId: sup.supplierId })),
        brand: p.brand ? { nome: p.brand.nome } : null,
      })),
      suppliers: opts.suppliers.map((s) => ({
        id: s.id,
        razaoSocial: s.razaoSocial,
        nomeFantasia: s.nomeFantasia,
      })),
      sites: opts.sites.map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo })),
    };
  });
}
