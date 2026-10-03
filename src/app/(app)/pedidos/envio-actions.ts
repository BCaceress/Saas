"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSite, guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { enviarPedidoCompra } from "@/lib/estoque";
import { enviarEmail } from "@/lib/email";
import { emailPedido } from "@/lib/email/templates";
import { rotuloEmbalagem } from "@/lib/compras/cotacao-unidades";
import { linkDoPedido } from "@/lib/compras/pedido-link";

// ============================================================
// Envio do pedido ao fornecedor — de verdade.
//
// Antes, "Enviar pedido" só trocava o status: o sistema dizia ENVIADO sem
// que nenhuma mensagem tivesse saído. Agora ENVIADO quer dizer que a mensagem
// saiu:
//
//   · e-mail  → o servidor manda; falhou, o pedido continua em RASCUNHO;
//   · WhatsApp / outro canal → o sistema monta a mensagem, o operador manda e
//     CONFIRMA que mandou (sem gateway não há outra prova possível).
//
// A mensagem leva o link /pedido/<token>, onde o fornecedor confirma a
// entrega. Usado pela conclusão da cotação, pelo drawer e pelo Kanban.
// ============================================================

export type ContatoEnvioPedido = {
  /** null = telefone/e-mail geral da empresa. */
  id: string | null;
  nome: string;
  telefone: string | null;
  email: string | null;
};

export type PedidoParaEnvio = {
  id: string;
  numero: string;
  status: string;
  supplierNome: string;
  supplierLogoUrl: string | null;
  total: number;
  itens: number;
  observacao: string | null;
  contatos: ContatoEnvioPedido[];
  /** Quem respondeu a cotação, o principal, ou o primeiro alcançável. */
  contatoSugeridoId: string | null;
  /** Texto pronto (WhatsApp/copiar), já com o link. Usa o nome do contato sugerido. */
  mensagem: string;
  link: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtdTxt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const idsSchema = z.array(z.string().min(1)).min(1).max(20);

type Carregado = NonNullable<Awaited<ReturnType<typeof carregarPedido>>>;

async function carregarPedido(id: string) {
  const po = await db.purchaseOrder.findFirst({
    where: { id },
    select: {
      id: true,
      numero: true,
      status: true,
      siteId: true,
      valorTotal: true,
      observacao: true,
      previsaoEntrega: true,
      site: { select: { nome: true } },
      supplier: {
        select: {
          razaoSocial: true,
          nomeFantasia: true,
          logoUrl: true,
          telefone: true,
          email: true,
          contacts: {
            where: { ativo: true },
            orderBy: [{ principal: "desc" }, { createdAt: "asc" }],
            select: { id: true, nome: true, telefone: true, email: true },
          },
        },
      },
      items: {
        select: { productId: true, packagingId: true, qtdPedida: true, custoUnitario: true, tipo: true },
      },
    },
  });
  if (!po) return null;

  const [produtos, embalagens, convite] = await Promise.all([
    db.product.findMany({
      where: { id: { in: [...new Set(po.items.map((i) => i.productId))] } },
      select: { id: true, nome: true },
    }),
    db.productPackaging.findMany({
      where: { id: { in: po.items.flatMap((i) => (i.packagingId ? [i.packagingId] : [])) } },
      select: { id: true, nome: true, fatorConversao: true },
    }),
    // Quem respondeu a cotação é quem deve receber o pedido dela.
    db.quotationSupplier.findFirst({
      where: { purchaseOrderId: po.id },
      select: { contactId: true },
    }),
  ]);
  return { po, produtos, embalagens, contatoDaCotacao: convite?.contactId ?? null };
}

function contatosDe(c: Carregado): ContatoEnvioPedido[] {
  const lista: ContatoEnvioPedido[] = c.po.supplier.contacts.filter((x) => x.telefone || x.email);
  const s = c.po.supplier;
  if (s.telefone || s.email) {
    lista.push({ id: null, nome: s.nomeFantasia || s.razaoSocial, telefone: s.telefone, email: s.email });
  }
  return lista;
}

function sugerido(c: Carregado, contatos: ContatoEnvioPedido[]): string | null {
  if (c.contatoDaCotacao && contatos.some((x) => x.id === c.contatoDaCotacao)) return c.contatoDaCotacao;
  return contatos[0]?.id ?? null;
}

function linhasDoPedido(c: Carregado) {
  const nome = new Map(c.produtos.map((p) => [p.id, p.nome]));
  const emb = new Map(c.embalagens.map((e) => [e.id, e]));
  return c.po.items.map((i) => {
    const e = i.packagingId ? emb.get(i.packagingId) : undefined;
    const q = Number(i.qtdPedida);
    return {
      descricao: nome.get(i.productId) ?? "Produto",
      quantidade: `${qtdTxt(q)} × ${e ? rotuloEmbalagem(e.nome, Number(e.fatorConversao) || 1) : "un"}`,
      total: i.tipo === "COMPRA" ? brl(q * Number(i.custoUnitario)) : "bonificação",
    };
  });
}

/** Mensagem pronta do pedido. A primeira linha da observação ("Origem: Cotação X") vira a referência. */
function textoDoPedido(c: Carregado, empresa: string, contato: string, link: string): string {
  const obs = (c.po.observacao ?? "").split("\n").filter(Boolean);
  const origem = obs.find((l) => l.startsWith("Origem: Cotação "))?.replace("Origem: Cotação ", "");
  const condicoes = obs.filter((l) => !l.startsWith("Origem:"));
  const primeiro = contato.split(/\s+/)[0];
  return [
    `*Pedido de compra ${c.po.numero} — ${empresa}*`,
    "",
    `Olá, ${primeiro}! Segue nosso pedido${origem ? ` (conforme sua proposta na ${origem})` : ""}:`,
    "",
    ...linhasDoPedido(c).map((l) => `• ${l.quantidade} — ${l.descricao} — ${l.total}`),
    "",
    `*Total: ${brl(Number(c.po.valorTotal))}*`,
    `Entrega em: ${c.po.site.nome}`,
    ...condicoes,
    "",
    `Confirme o pedido e a data de entrega aqui: ${link}`,
  ].join("\n");
}

/** Dados do envio de cada pedido. Pedido que já saiu vem com o status real, sem mensagem nova. */
export async function prepararEnvioPedidosAction(ids: string[]): Promise<PedidoParaEnvio[]> {
  const lista = idsSchema.parse(ids);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const saida: PedidoParaEnvio[] = [];
    for (const id of lista) {
      const c = await carregarPedido(id);
      if (!c) continue;
      assertSite(ctx, "compras.pedir", c.po.siteId);
      const contatos = contatosDe(c);
      const sugeridoId = sugerido(c, contatos);
      const nomeContato =
        contatos.find((x) => x.id === sugeridoId)?.nome ??
        (c.po.supplier.nomeFantasia || c.po.supplier.razaoSocial);
      // Link só para pedido que vai sair: rascunho que ninguém envia não
      // precisa de endereço público.
      const link = c.po.status === "RASCUNHO" ? await linkDoPedido(ctx.tenant.id, c.po.id) : null;
      saida.push({
        id: c.po.id,
        numero: c.po.numero,
        status: c.po.status,
        supplierNome: c.po.supplier.nomeFantasia || c.po.supplier.razaoSocial,
        supplierLogoUrl: c.po.supplier.logoUrl,
        total: Number(c.po.valorTotal),
        itens: c.po.items.length,
        observacao: c.po.observacao,
        contatos,
        contatoSugeridoId: sugeridoId,
        mensagem: link ? textoDoPedido(c, ctx.tenant.nome, nomeContato, link.url) : "",
        link: link?.url ?? "",
      });
    }
    return saida;
  });
}

/** Mensagem com o nome de outro contato — o operador trocou quem recebe. */
export async function mensagemDoPedidoAction(pedidoId: string, contatoNome: string): Promise<string> {
  const nome = z.string().trim().min(1).max(120).parse(contatoNome);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async () => {
    const c = await carregarPedido(pedidoId);
    if (!c) throw new Error("Pedido não encontrado.");
    assertSite(ctx, "compras.pedir", c.po.siteId);
    const link = await linkDoPedido(ctx.tenant.id, c.po.id);
    return textoDoPedido(c, ctx.tenant.nome, nome, link.url);
  });
}

const enviarSchema = z.object({
  pedidoId: z.string().min(1),
  canal: z.enum(["EMAIL", "WHATSAPP", "OUTRO"]),
  /** null = contato geral da empresa. */
  contatoId: z.string().nullable(),
});

export type ResultadoEnvioPedido = { ok: true } | { ok: false; erro: string };

/**
 * Manda (e-mail) ou registra o envio (WhatsApp/outro, confirmado pelo
 * operador) e só então marca ENVIADO. Pedido que já saiu devolve erro claro —
 * o segundo clique não gera segundo envio.
 */
export async function enviarPedidoAction(
  input: z.input<typeof enviarSchema>,
): Promise<ResultadoEnvioPedido> {
  const d = enviarSchema.parse(input);
  const ctx = await guardAction("compras.pedir");
  return runWithTenant(ctx.tenant.id, async (): Promise<ResultadoEnvioPedido> => {
    const c = await carregarPedido(d.pedidoId);
    if (!c) return { ok: false, erro: "Pedido não encontrado." };
    assertSite(ctx, "compras.pedir", c.po.siteId);
    if (c.po.status !== "RASCUNHO") return { ok: false, erro: "Este pedido já foi enviado." };

    const contato = contatosDe(c).find((x) => x.id === d.contatoId);
    if (!contato) return { ok: false, erro: "Escolha para quem o pedido vai." };

    let detalhe: string;
    if (d.canal === "EMAIL") {
      if (!contato.email) return { ok: false, erro: `${contato.nome} não tem e-mail cadastrado.` };
      const link = await linkDoPedido(ctx.tenant.id, c.po.id);
      const r = await enviarEmail(
        emailPedido({
          para: contato.email,
          fornecedor: contato.nome,
          mercado: ctx.tenant.nome,
          numero: c.po.numero,
          url: link.url,
          entregaEm: c.po.site.nome,
          itens: linhasDoPedido(c),
          total: brl(Number(c.po.valorTotal)),
          observacao: (c.po.observacao ?? "")
            .split("\n")
            .filter((l) => l && !l.startsWith("Origem:"))
            .join("\n"),
        }),
      );
      if (!r.ok) {
        return {
          ok: false,
          erro: `O e-mail para ${contato.email} não saiu (${r.erro ?? "erro no envio"}). O pedido continua em rascunho — tente de novo ou mande por WhatsApp.`,
        };
      }
      detalhe = `por e-mail para ${contato.nome} (${contato.email})`;
    } else {
      detalhe =
        d.canal === "WHATSAPP"
          ? `por WhatsApp para ${contato.nome}${contato.telefone ? ` (${contato.telefone})` : ""}`
          : `para ${contato.nome}, por fora do sistema`;
    }

    try {
      await enviarPedidoCompra(ctx.tenant.id, c.po.id, detalhe);
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "Não foi possível marcar o envio." };
    }
    revalidatePath("/pedidos", "layout");
    revalidatePath("/cotacoes", "layout");
    revalidatePath("/m/cotacoes", "layout");
    return { ok: true };
  });
}
