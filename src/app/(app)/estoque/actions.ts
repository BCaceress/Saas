"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { assertCabeSite } from "@/lib/limites";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { loadComprasFormOptions, loadInventarioFormOptions } from "./_data";
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
  iniciarInventario,
  salvarContagemInventario,
  fecharInventario,
  cancelarInventario,
  criarPedidoCompra,
  atualizarPedidoCompra,
  enviarPedidoCompra,
  marcarAguardandoPedido,
  marcarEmTransitoPedido,
  cancelarPedidoCompra,
  excluirPedidoCompra,
  receberPedidoCompra,
  adicionarBonificacaoPedido,
} from "@/lib/estoque";

/** Baseline: só abre o módulo quem enxerga estoque. Use `txp` para escrita. */
async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("estoque.ver");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/**
 * Escrita: exige `permissao` — e, quando a operação pertence a uma loja, exige
 * naquela loja. É o que faz o acesso por loja valer contra requisição forjada.
 */
async function txp<T>(
  permissao: Permissao,
  siteId: string | null,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/** Idem, mas o siteId só é conhecido depois de ler o registro no banco. */
async function txpDepois<T>(
  permissao: Permissao,
  fn: (
    tid: string,
    userId: string,
    exigirLoja: (siteId: string) => void,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, () =>
    fn(ctx.tenant.id, ctx.user.id ?? "", (siteId) => assertSite(ctx, permissao, siteId)),
  );
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
  // Criar/editar loja é configuração do tenant, não operação de estoque.
  return txp("config.gerenciar", null, async (tid) => {
    const d = siteSchema.parse(input);
    const nome = d.nome.trim();
    const dup = await db.site.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (dup) throw new Error(`Já existe um site com o nome "${nome}".`);
    await assertCabeSite(tid);
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
  return txp("config.gerenciar", null, async () => {
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
  return txp("config.gerenciar", null, async () => {
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
  motivo: z.enum(["COMPRA_SEM_PEDIDO", "BONIFICACAO", "ESTOQUE_INICIAL", "TRANSFERENCIA"]),
  numeroNota: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  items: z.array(entradaItemSchema).min(1, "Adicione ao menos um item."),
});

export async function registrarEntradaAction(input: z.input<typeof entradaSchema>) {
  const d = entradaSchema.parse(input);
  return txp("estoque.ajustar", d.siteId, async (tid, userId) => {
    const id = await registrarEntrada(tid, d.siteId, d.items, {
      tipo: "MANUAL",
      motivo: d.motivo,
      supplierId: null,
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
  tipo: z.enum(["COMPRA", "BONIFICACAO", "BRINDE", "TROCA", "AMOSTRA", "SERVICO"]).default("COMPRA"),
  motivoBonificacao: z.enum(["COMERCIAL", "CAMPANHA", "REPOSICAO", "TROCA", "CORTESIA", "OUTRO"]).optional().nullable(),
  qtdPedida: z.number().positive(),
  custoUnitario: z.number().nonnegative().default(0),
  observacao: z.string().trim().max(500).optional().nullable(),
});

const pedidoSchema = z.object({
  siteId: z.string().min(1, "Selecione o destino."),
  supplierId: z.string().min(1, "Selecione o fornecedor."),
  previsaoEntrega: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  items: z.array(pedidoItemSchema).min(1, "Adicione ao menos um item."),
});

const parsePrevisao = (v?: string | null) => (v ? new Date(`${v}T00:00:00`) : null);

/** Loja de destino do pedido — o escopo só aparece depois de ler o registro. */
async function siteDoPedido(pedidoId: string): Promise<string> {
  const p = await db.purchaseOrder.findFirst({
    where: { id: pedidoId },
    select: { siteId: true },
  });
  if (!p) throw new Error("Pedido não encontrado.");
  return p.siteId;
}

async function sitesDaRequisicao(requisicaoId: string): Promise<[string, string]> {
  const r = await db.requisicao.findFirst({
    where: { id: requisicaoId },
    select: { origemSiteId: true, destinoSiteId: true },
  });
  if (!r) throw new Error("Requisição não encontrada.");
  return [r.origemSiteId, r.destinoSiteId];
}

async function siteDestinoTransferencia(transferId: string): Promise<string> {
  const t = await db.transfer.findFirst({
    where: { id: transferId },
    select: { destinoSiteId: true },
  });
  if (!t) throw new Error("Transferência não encontrada.");
  return t.destinoSiteId;
}

async function siteDoInventario(inventoryId: string): Promise<string> {
  const i = await db.inventory.findFirst({
    where: { id: inventoryId },
    select: { siteId: true },
  });
  if (!i) throw new Error("Inventário não encontrado.");
  return i.siteId;
}

export async function loadComprasFormOptionsAction() {
  return tx(() => loadComprasFormOptions());
}

export async function criarPedidoCompraAction(
  input: z.input<typeof pedidoSchema>,
  enviar = false,
) {
  const d = pedidoSchema.parse(input);
  return txp("compras.pedir", d.siteId, async (tid, userId) => {
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
  const d = pedidoSchema.parse(input);
  // Editar pode MOVER o pedido de loja — exige as duas pontas.
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    exigirLoja(d.siteId);
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
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await enviarPedidoCompra(tid, pedidoId);
    ok();
  });
}

export async function marcarAguardandoPedidoAction(pedidoId: string) {
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await marcarAguardandoPedido(tid, pedidoId);
    ok();
  });
}

export async function marcarEmTransitoPedidoAction(pedidoId: string) {
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await marcarEmTransitoPedido(tid, pedidoId);
    ok();
  });
}

const bonificacaoItemSchema = z.object({
  productId: z.string().min(1),
  packagingId: z.string().optional().nullable(),
  motivoBonificacao: z.enum(["COMERCIAL", "CAMPANHA", "REPOSICAO", "TROCA", "CORTESIA", "OUTRO"]).optional().nullable(),
  qtdPedida: z.number().positive(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

const bonificacaoSchema = z.object({
  items: z.array(bonificacaoItemSchema).min(1, "Adicione ao menos um item."),
});

export async function adicionarBonificacaoPedidoAction(
  pedidoId: string,
  input: z.input<typeof bonificacaoSchema>,
) {
  const d = bonificacaoSchema.parse(input);
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await adicionarBonificacaoPedido(
      tid,
      pedidoId,
      d.items.map((i) => ({ ...i, tipo: "BONIFICACAO" as const, custoUnitario: 0 })),
    );
    ok();
  });
}

export async function cancelarPedidoCompraAction(pedidoId: string) {
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await cancelarPedidoCompra(tid, pedidoId);
    ok();
  });
}

export async function excluirPedidoCompraAction(pedidoId: string) {
  return txpDepois("compras.pedir", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(pedidoId));
    await excluirPedidoCompra(tid, pedidoId);
    ok();
  });
}

const recebimentoCompraSchema = z.object({
  pedidoId: z.string().min(1),
  numeroNota: z.string().optional().nullable(),
  gerarFinanceiro: z.boolean().default(false),
  items: z.array(z.object({ itemId: z.string().min(1), qtdRecebida: z.number().nonnegative() })).min(1),
});

export async function receberPedidoCompraAction(input: z.input<typeof recebimentoCompraSchema>) {
  const d = recebimentoCompraSchema.parse(input);
  // Receber é do estoquista; pedir é de quem compra. Permissões diferentes.
  return txpDepois("compras.receber", async (tid, userId, exigirLoja) => {
    exigirLoja(await siteDoPedido(d.pedidoId));
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
  const d = ajusteSchema.parse(input);
  return txp("estoque.ajustar", d.siteId, async (tid, userId) => {
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
  const d = devolucaoSchema.parse(input);
  return txp("estoque.ajustar", d.siteId, async (tid, userId) => {
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
  const d = perdaSchema.parse(input);
  return txp("estoque.ajustar", d.siteId, async (tid, userId) => {
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
  const d = transferenciaSchema.parse(input);
  // Move estoque entre duas lojas — precisa ter acesso às DUAS pontas.
  return txpDepois("estoque.transferir", async (tid, userId, exigirLoja) => {
    exigirLoja(d.origemSiteId);
    exigirLoja(d.destinoSiteId);
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
  const d = requisicaoSchema.parse(input);
  // Quem pede é a loja de destino; basta acesso a ela.
  return txp("estoque.transferir", d.destinoSiteId, async (tid, userId) => {
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
  const d = expedicaoSchema.parse(input);
  // Quem expede é o CD de origem.
  return txpDepois("estoque.transferir", async (tid, userId, exigirLoja) => {
    exigirLoja((await sitesDaRequisicao(d.requisicaoId))[0]);
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
  const d = recebimentoSchema.parse(input);
  // Quem recebe é a loja de destino.
  return txpDepois("estoque.transferir", async (tid, userId, exigirLoja) => {
    exigirLoja(await siteDestinoTransferencia(d.transferId));
    await receberTransferencia(tid, d.transferId, d.items, { createdBy: userId });
    ok();
  });
}

export async function cancelarRequisicaoAction(requisicaoId: string) {
  return txpDepois("estoque.transferir", async (tid, _userId, exigirLoja) => {
    exigirLoja((await sitesDaRequisicao(requisicaoId))[1]);
    await cancelarRequisicao(tid, requisicaoId);
    ok();
  });
}

export async function updateRecebimentoConfigAction(exige: boolean) {
  // Regra do tenant inteiro — configuração, não operação.
  return txp("config.gerenciar", null, async (tid) => {
    await db.tenant.update({ where: { id: tid }, data: { recebimentoExigeContagem: exige } });
    revalidatePath("/estoque", "layout");
    revalidatePath("/configuracoes", "layout");
  });
}

const topologiaSchema = z.enum(["LOCAL", "CD_ABASTECE", "MISTO"]);

export async function updateTopologiaAction(topologia: z.infer<typeof topologiaSchema>) {
  return txp("config.gerenciar", null, async (tid) => {
    const t = topologiaSchema.parse(topologia);
    await db.tenant.update({ where: { id: tid }, data: { topologia: t } });
    revalidatePath("/estoque", "layout");
    revalidatePath("/configuracoes", "layout");
  });
}

// ── Inventário / contagem ─────────────────────────────────────

const inventarioSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  escopoTipo: z.enum(["COMPLETO", "CATEGORIA", "PRODUTOS"]).default("COMPLETO"),
  categoryId: z.string().optional().nullable(),
  productIds: z.array(z.string()).optional().nullable(),
  modoCego: z.boolean().default(false),
  dataProgramada: z.string().min(1, "Informe a data do inventário."),
  recorrente: z.boolean().default(false),
  diasSemana: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  observacao: z.string().optional().nullable(),
});

export async function criarInventarioAction(input: z.input<typeof inventarioSchema>) {
  const d = inventarioSchema.parse(input);
  return txp("estoque.inventario", d.siteId, async (tid, userId) => {
    const id = await criarInventario(tid, d.siteId, {
      escopoTipo: d.escopoTipo,
      categoryId: d.categoryId,
      productIds: d.productIds,
      modoCego: d.modoCego,
      dataProgramada: new Date(d.dataProgramada),
      recorrente: d.recorrente,
      diasSemana: d.diasSemana,
      observacao: d.observacao,
      createdBy: userId,
    });
    ok();
    return id;
  });
}

export async function iniciarInventarioAction(inventoryId: string) {
  return txpDepois("estoque.inventario", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoInventario(inventoryId));
    await iniciarInventario(tid, inventoryId);
    ok();
  });
}

const contagemItemsSchema = z
  .array(z.object({ productId: z.string().min(1), qtdContada: z.number().nonnegative() }))
  .min(1);

const salvarContagemSchema = z.object({
  inventoryId: z.string().min(1),
  items: contagemItemsSchema,
});

/**
 * Rascunho da contagem — persiste qtdContada sem aplicar ajuste, para a contagem
 * sobreviver a F5/troca de aparelho. Sem revalidatePath de propósito: o estado
 * local do contador é a verdade durante a digitação.
 */
export async function salvarContagemInventarioAction(input: z.input<typeof salvarContagemSchema>) {
  const d = salvarContagemSchema.parse(input);
  return txpDepois("estoque.inventario", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoInventario(d.inventoryId));
    await salvarContagemInventario(tid, d.inventoryId, d.items);
  });
}

const fecharInventarioSchema = z.object({
  inventoryId: z.string().min(1),
  items: contagemItemsSchema,
});

export async function fecharInventarioAction(input: z.input<typeof fecharInventarioSchema>) {
  const d = fecharInventarioSchema.parse(input);
  return txpDepois("estoque.inventario", async (tid, userId, exigirLoja) => {
    exigirLoja(await siteDoInventario(d.inventoryId));
    await fecharInventario(tid, d.inventoryId, d.items, { createdBy: userId });
    ok();
  });
}

export async function cancelarInventarioAction(inventoryId: string) {
  return txpDepois("estoque.inventario", async (tid, _userId, exigirLoja) => {
    exigirLoja(await siteDoInventario(inventoryId));
    await cancelarInventario(tid, inventoryId);
    ok();
  });
}

/** Catálogo de produtos p/ escopo "Produtos específicos" — carregado sob demanda ao abrir o formulário. */
export async function fetchInventarioProdutosAction() {
  return tx(async () => (await loadInventarioFormOptions()).products);
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
  const d = producaoSchema.parse(input);
  return txp("estoque.ajustar", d.siteId, async (tid, userId) => {
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
  return tx(async () => {
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
      motivo: p.motivo as string | null,
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
      purchaseMotivo:     m.purchaseId   ? (purchaseMap.get(m.purchaseId)?.motivo      ?? null) : null,
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

import { loadEntradaFormOptions, loadTransferenciaFormOptions } from "./_data";

export async function fetchTransferenciaFormDataAction() {
  return tx(() => loadTransferenciaFormOptions());
}

export async function fetchEntradaFormDataAction() {
  return tx(async () => {
    const opts = await loadEntradaFormOptions();
    return {
      products: opts.products.map((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        ean: p.ean ?? null,
        imagemUrl: p.imagemUrl ?? null,
        packagings: p.packagings.map((pk) => ({
          id: pk.id,
          nome: pk.nome,
          fatorConversao: Number(pk.fatorConversao),
          isCompraDefault: pk.isCompraDefault,
        })),
        brand: p.brand ? { nome: p.brand.nome } : null,
      })),
      sites: opts.sites.map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo })),
    };
  });
}
