import "server-only";
import { randomBytes } from "node:crypto";
import { basePrisma, db } from "@/lib/prisma";
import { maskCnpj } from "@/lib/masks";
import { runWithTenant } from "@/lib/tenant-context";
import { rootUrl } from "@/lib/urls";
import { rotuloEmbalagem } from "@/lib/compras/cotacao-unidades";
import { enderecoEmLinha } from "@/lib/compras/cotacao-link";
import { registrarEvento } from "@/lib/compras/eventos";
import { enviarPushImediato } from "@/lib/alertas/push";

// ============================================================
// Link público do pedido (/pedido/<token>).
//
// Enviar o pedido é prometer a compra. Até aqui o sistema só sabia que o
// comprador DISSE que mandou; o link é o outro lado da conversa: o fornecedor
// abre, vê exatamente o que foi pedido e confirma — com a previsão de entrega
// — ou aponta o problema ("não tenho a Brahma lata"). Sem conta, como a
// cotação.
//
// Tabela de controle (PurchaseOrderLink), lida por `basePrisma` até o token
// revelar o tenant. O token NÃO muda num reenvio: é o mesmo documento, e o
// link que já está na conversa continua valendo.
// ============================================================

const VALIDADE_DIAS = 45;
const DIA_MS = 24 * 60 * 60 * 1000;

export function pedidoLinkUrl(token: string): string {
  return rootUrl(`/pedido/${token}`);
}

/** Link do pedido — o vigente, ou um novo se não houver ou tiver vencido. */
export async function linkDoPedido(
  tenantId: string,
  purchaseOrderId: string,
): Promise<{ token: string; url: string }> {
  const atual = await basePrisma.purchaseOrderLink.findUnique({
    where: { purchaseOrderId },
    select: { token: true, expiraEm: true, tenantId: true },
  });
  const expiraEm = new Date(Date.now() + VALIDADE_DIAS * DIA_MS);
  if (atual && atual.tenantId === tenantId) {
    if (atual.expiraEm.getTime() > Date.now()) {
      return { token: atual.token, url: pedidoLinkUrl(atual.token) };
    }
    const token = randomBytes(24).toString("base64url");
    await basePrisma.purchaseOrderLink.update({
      where: { purchaseOrderId },
      data: { token, expiraEm },
    });
    return { token, url: pedidoLinkUrl(token) };
  }
  const token = randomBytes(24).toString("base64url");
  await basePrisma.purchaseOrderLink.create({
    data: { tenantId, purchaseOrderId, token, expiraEm },
  });
  return { token, url: pedidoLinkUrl(token) };
}

/** O que o comprador vê sobre o link no pedido. */
export type SinalLinkPedido = {
  abertoEm: string | null;
  confirmadoEm: string | null;
  contestadoEm: string | null;
  contestacao: string | null;
};

export async function sinalDoLinkPedido(purchaseOrderId: string): Promise<SinalLinkPedido | null> {
  const l = await basePrisma.purchaseOrderLink.findUnique({
    where: { purchaseOrderId },
    select: { abertoEm: true, confirmadoEm: true, contestadoEm: true, contestacao: true },
  });
  if (!l) return null;
  return {
    abertoEm: l.abertoEm?.toISOString() ?? null,
    confirmadoEm: l.confirmadoEm?.toISOString() ?? null,
    contestadoEm: l.contestadoEm?.toISOString() ?? null,
    contestacao: l.contestacao,
  };
}

// ── Leitura pública ─────────────────────────────────────────

export type PedidoPublico = {
  token: string;
  empresa: string;
  empresaLogoUrl: string | null;
  empresaCnpj: string | null;
  empresaEndereco: string | null;
  /** Loja que recebe a mercadoria — é para onde o caminhão vai. */
  entregaEm: string;
  numero: string;
  fornecedor: string;
  status: string;
  previsaoEntrega: string | null;
  observacao: string | null;
  itens: {
    id: string;
    nome: string;
    ean: string | null;
    quantidade: number;
    embalagem: string;
    preco: number;
    bonificacao: boolean;
  }[];
  total: number;
  confirmadoEm: string | null;
  contestadoEm: string | null;
  contestacao: string | null;
};

export type LinkPedidoResolvido =
  | { estado: "invalido" }
  | { estado: "fechado"; empresa: string; numero: string; motivo: string }
  | { estado: "valido"; pedido: PedidoPublico };

const MOTIVO_FECHADO: Record<string, string> = {
  RASCUNHO: "Este pedido ainda não foi enviado.",
  CANCELADO: "Este pedido foi cancelado pelo comprador.",
  RECEBIDO: "Este pedido já foi recebido.",
};

export async function resolverLinkPedido(token: string): Promise<LinkPedidoResolvido> {
  const link = await basePrisma.purchaseOrderLink.findUnique({
    where: { token },
    select: {
      tenantId: true,
      purchaseOrderId: true,
      expiraEm: true,
      confirmadoEm: true,
      contestadoEm: true,
      contestacao: true,
      tenant: {
        select: {
          nome: true,
          logoUrl: true,
          cnpj: true,
          rua: true,
          numero: true,
          cidade: true,
          estado: true,
        },
      },
    },
  });
  if (!link || link.expiraEm.getTime() < Date.now()) return { estado: "invalido" };

  return runWithTenant(link.tenantId, async (): Promise<LinkPedidoResolvido> => {
    const po = await db.purchaseOrder.findFirst({
      where: { id: link.purchaseOrderId },
      select: {
        numero: true,
        status: true,
        previsaoEntrega: true,
        observacao: true,
        valorTotal: true,
        site: { select: { nome: true } },
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        items: {
          select: {
            id: true,
            productId: true,
            packagingId: true,
            qtdPedida: true,
            custoUnitario: true,
            tipo: true,
          },
        },
      },
    });
    const empresa = link.tenant.nome;
    if (!po) return { estado: "invalido" };
    const motivo = MOTIVO_FECHADO[po.status];
    if (motivo) return { estado: "fechado", empresa, numero: po.numero, motivo };

    const productIds = [...new Set(po.items.map((i) => i.productId))];
    const packagingIds = [...new Set(po.items.flatMap((i) => (i.packagingId ? [i.packagingId] : [])))];
    const [produtos, embalagens] = await Promise.all([
      db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, nome: true, ean: true },
      }),
      packagingIds.length
        ? db.productPackaging.findMany({
            where: { id: { in: packagingIds } },
            select: { id: true, nome: true, fatorConversao: true, ean: true },
          })
        : Promise.resolve([]),
    ]);
    const produto = new Map(produtos.map((p) => [p.id, p]));
    const emb = new Map(embalagens.map((e) => [e.id, e]));

    return {
      estado: "valido",
      pedido: {
        token,
        empresa,
        empresaLogoUrl: link.tenant.logoUrl,
        empresaCnpj: link.tenant.cnpj ? maskCnpj(link.tenant.cnpj) : null,
        empresaEndereco: enderecoEmLinha(link.tenant),
        entregaEm: po.site.nome,
        numero: po.numero,
        fornecedor: po.supplier.nomeFantasia || po.supplier.razaoSocial,
        status: po.status,
        previsaoEntrega: po.previsaoEntrega?.toISOString() ?? null,
        observacao: po.observacao,
        itens: po.items.map((i) => {
          const p = produto.get(i.productId);
          const e = i.packagingId ? emb.get(i.packagingId) : undefined;
          return {
            id: i.id,
            nome: p?.nome ?? "Produto",
            ean: e?.ean ?? p?.ean ?? null,
            quantidade: Number(i.qtdPedida),
            embalagem: e ? rotuloEmbalagem(e.nome, Number(e.fatorConversao) || 1) : "Unidade",
            preco: Number(i.custoUnitario),
            bonificacao: i.tipo !== "COMPRA",
          };
        }),
        total: Number(po.valorTotal),
        confirmadoEm: link.confirmadoEm?.toISOString() ?? null,
        contestadoEm: link.contestadoEm?.toISOString() ?? null,
        contestacao: link.contestacao,
      },
    };
  });
}

export async function marcarLinkPedidoAberto(token: string): Promise<void> {
  try {
    await basePrisma.purchaseOrderLink.updateMany({
      where: { token, abertoEm: null },
      data: { abertoEm: new Date() },
    });
  } catch {
    // sinal de leitura é conveniência
  }
}

// ── Resposta do fornecedor ──────────────────────────────────

type Resultado = { ok: true } | { ok: false; erro: string };

async function linkValido(token: string) {
  const link = await basePrisma.purchaseOrderLink.findUnique({
    where: { token },
    select: { id: true, tenantId: true, purchaseOrderId: true, expiraEm: true },
  });
  if (!link || link.expiraEm.getTime() < Date.now()) return null;
  return link;
}

async function avisarComprador(
  tenantId: string,
  po: { id: string; numero: string; siteId: string; fornecedor: string },
  titulo: string,
  corpo: string,
) {
  await enviarPushImediato({
    tenantId,
    permissao: "compras.ver",
    siteId: po.siteId,
    mensagem: { titulo, corpo, url: `/pedidos?pedido=${po.id}`, tag: `pedido:${po.id}` },
  });
}

/**
 * O fornecedor confirma. ENVIADO vira AGUARDANDO (a entrega), e a previsão que
 * ele informou substitui a estimada. Confirmar de novo não é erro — só
 * atualiza a previsão.
 */
export async function confirmarPedidoPeloLink(
  token: string,
  previsaoEntrega: Date | null,
): Promise<Resultado> {
  const link = await linkValido(token);
  if (!link) return { ok: false, erro: "Este link não vale mais. Fale com o comprador." };

  return runWithTenant(link.tenantId, async (): Promise<Resultado> => {
    const po = await db.purchaseOrder.findFirst({
      where: { id: link.purchaseOrderId },
      select: {
        id: true,
        numero: true,
        status: true,
        siteId: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    });
    if (!po) return { ok: false, erro: "Pedido não encontrado." };
    if (po.status !== "ENVIADO" && po.status !== "AGUARDANDO") {
      return { ok: false, erro: "Este pedido não está mais esperando confirmação." };
    }

    const agora = new Date();
    const jaConfirmado = po.status === "AGUARDANDO";
    // Condicional no status: dois toques seguidos não viram duas confirmações.
    await db.purchaseOrder.updateMany({
      where: { id: po.id, status: { in: ["ENVIADO", "AGUARDANDO"] } },
      data: {
        status: "AGUARDANDO",
        ...(jaConfirmado ? {} : { confirmadoEm: agora }),
        ...(previsaoEntrega ? { previsaoEntrega } : {}),
      },
    });
    await basePrisma.purchaseOrderLink.update({
      where: { id: link.id },
      data: { confirmadoEm: agora, contestadoEm: null, contestacao: null },
    });

    const fornecedor = po.supplier.nomeFantasia || po.supplier.razaoSocial;
    const quando = previsaoEntrega
      ? ` Entrega prevista para ${previsaoEntrega.toLocaleDateString("pt-BR", { timeZone: "UTC" })}.`
      : "";
    await registrarEvento({
      tenantId: link.tenantId,
      purchaseOrderId: po.id,
      tipo: "PEDIDO_CONFIRMADO",
      descricao: jaConfirmado
        ? `${fornecedor} atualizou a confirmação pelo link.${quando}`
        : `${fornecedor} confirmou o pedido ${po.numero} pelo link.${quando}`,
    });
    await avisarComprador(
      link.tenantId,
      { id: po.id, numero: po.numero, siteId: po.siteId, fornecedor },
      `${po.numero} confirmado`,
      `${fornecedor} confirmou o pedido.${quando}`,
    );
    return { ok: true };
  });
}

/** O fornecedor aponta um problema. O pedido não muda de estado: quem decide é o comprador. */
export async function contestarPedidoPeloLink(token: string, motivo: string): Promise<Resultado> {
  const link = await linkValido(token);
  if (!link) return { ok: false, erro: "Este link não vale mais. Fale com o comprador." };

  return runWithTenant(link.tenantId, async (): Promise<Resultado> => {
    const po = await db.purchaseOrder.findFirst({
      where: { id: link.purchaseOrderId },
      select: {
        id: true,
        numero: true,
        status: true,
        siteId: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      },
    });
    if (!po) return { ok: false, erro: "Pedido não encontrado." };
    if (po.status !== "ENVIADO" && po.status !== "AGUARDANDO") {
      return { ok: false, erro: "Este pedido não está mais aberto para ajustes por aqui." };
    }

    await basePrisma.purchaseOrderLink.update({
      where: { id: link.id },
      data: { contestadoEm: new Date(), contestacao: motivo },
    });
    const fornecedor = po.supplier.nomeFantasia || po.supplier.razaoSocial;
    await registrarEvento({
      tenantId: link.tenantId,
      purchaseOrderId: po.id,
      tipo: "PEDIDO_CONTESTADO",
      descricao: `${fornecedor} apontou um problema no pedido: "${motivo}"`,
    });
    await avisarComprador(
      link.tenantId,
      { id: po.id, numero: po.numero, siteId: po.siteId, fornecedor },
      `${po.numero}: ${fornecedor} apontou um problema`,
      motivo.length > 120 ? `${motivo.slice(0, 117)}…` : motivo,
    );
    return { ok: true };
  });
}
