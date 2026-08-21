"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { consumir, mensagemBloqueio } from "@/lib/rate-limit";
import { linkParaGravar, marcarLinkRespondido } from "@/lib/compras/cotacao-link";
import { registrarPrecosDaCotacao } from "@/lib/compras/cotacao-precos";

// ============================================================
// Resposta pública da cotação. NÃO tem sessão, NÃO tem guard de permissão:
// quem chama é o fornecedor, que não é usuário do sistema. Quem autoriza é o
// token do link — por isso nada aqui aceita id vindo do cliente que não tenha
// sido conferido contra o convite do próprio token.
// ============================================================

/** Tentativas por link. Generoso para quem corrige o preço, apertado para robô. */
const LIMITE_ENVIOS = 20;
const JANELA_SEG = 60 * 60;

const itemSchema = z.object({
  quotationItemId: z.string().min(1),
  disponivel: z.boolean().default(true),
  precoUnitario: z.number().min(0).max(9_999_999).default(0),
  quantidadeOfertada: z.number().min(0).max(9_999_999).optional().nullable(),
  marca: z.string().trim().max(120).optional().nullable(),
  observacao: z.string().trim().max(500).optional().nullable(),
});

const respostaSchema = z.object({
  token: z.string().min(10).max(200),
  prazoEntregaDias: z.number().int().min(0).max(365).optional().nullable(),
  condicaoPagamento: z.string().trim().max(120).optional().nullable(),
  frete: z.number().min(0).max(9_999_999).optional().nullable(),
  observacao: z.string().trim().max(1000).optional().nullable(),
  itens: z.array(itemSchema).min(1).max(500),
});

export type ResultadoResposta = { ok: true } | { ok: false; erro: string };

export async function responderPeloLinkAction(
  input: z.input<typeof respostaSchema>,
): Promise<ResultadoResposta> {
  const parsed = respostaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, erro: "Confira os valores digitados e tente de novo." };
  }
  const d = parsed.data;

  // Contador e link não dependem um do outro: uma ida ao banco em vez de duas
  // seguidas. O gate do limite continua valendo — só o custo em rede some.
  const [limite, link] = await Promise.all([
    consumir(`cotacao-link:${d.token}`, LIMITE_ENVIOS, JANELA_SEG),
    linkParaGravar(d.token),
  ]);
  if (!limite.ok) return { ok: false, erro: mensagemBloqueio(limite.esperaSeg) };
  if (!link) return { ok: false, erro: "Este link não vale mais. Peça um novo ao comprador." };

  return runWithTenant(link.tenantId, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: link.quotationSupplierId },
      select: {
        id: true,
        status: true,
        quotation: { select: { status: true, items: { select: { id: true } } } },
      },
    });
    if (!convite) return { ok: false, erro: "Cotação não encontrada." };
    if (convite.quotation.status !== "ABERTA") {
      return { ok: false, erro: "Esta cotação não está mais aberta para respostas." };
    }

    // O cliente manda ids; só valem os itens DESTA cotação. Sem isto, um id
    // adivinhado gravaria resposta numa cotação de outra loja.
    const validos = new Set(convite.quotation.items.map((i) => i.id));
    const itens = d.itens.filter((i) => validos.has(i.quotationItemId));
    if (itens.length === 0) return { ok: false, erro: "Nenhum item válido para registrar." };

    // Regravar por cima, igual ao registro feito pelo operador: enquanto a
    // cotação está aberta o fornecedor pode voltar e corrigir um preço, e a
    // resposta válida é sempre a última que ele mandou.
    await db.quotationResponse.deleteMany({ where: { quotationSupplierId: convite.id } });

    // Os três que sobram não dependem entre si — vão juntos. Em lista de 30
    // itens cada ida ao Neon é uma transação (SET LOCAL + query): serializar
    // por hábito é o que fazia o botão parecer travado.
    await Promise.all([
      db.quotationResponse.createMany({
        data: itens.map((i) => ({
          tenantId: link.tenantId,
          quotationSupplierId: convite.id,
          quotationItemId: i.quotationItemId,
          disponivel: i.disponivel,
          precoUnitario: i.disponivel ? i.precoUnitario : 0,
          quantidadeOfertada: i.quantidadeOfertada ?? null,
          marca: i.marca || null,
          observacao: i.observacao || null,
        })),
      }),
      db.quotationSupplier.updateMany({
        where: { id: convite.id },
        data: {
          status: "RESPONDIDA",
          respondidaEm: new Date(),
          respondidaVia: "LINK",
          prazoEntregaDias: d.prazoEntregaDias ?? null,
          condicaoPagamento: d.condicaoPagamento || null,
          frete: d.frete ?? null,
          observacao: d.observacao || null,
        },
      }),
      marcarLinkRespondido(link.linkId),
    ]);

    // Preço respondido vira preço vigente no catálogo do fornecedor (e ponto no
    // histórico). É a parte CARA — `ingerir` faz matching, upsert de catálogo e
    // histórico, dezenas de idas ao banco. O fornecedor não tem nada a ver com
    // isso: a proposta dele já está salva acima, então roda depois da resposta
    // (`after`) em vez de segurar o botão. Não lança — ver cotacao-precos.
    after(() => runWithTenant(link.tenantId, () => registrarPrecosDaCotacao(convite.id)));
    return { ok: true };
  });
}

const recusaSchema = z.object({
  token: z.string().min(10).max(200),
  motivo: z.string().trim().max(500).optional().nullable(),
});

/** "Não vou cotar" também é resposta — e evita o comprador ficar esperando. */
export async function recusarPeloLinkAction(
  input: z.input<typeof recusaSchema>,
): Promise<ResultadoResposta> {
  const parsed = recusaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, erro: "Não foi possível registrar." };
  const d = parsed.data;

  const [limite, link] = await Promise.all([
    consumir(`cotacao-link:${d.token}`, LIMITE_ENVIOS, JANELA_SEG),
    linkParaGravar(d.token),
  ]);
  if (!limite.ok) return { ok: false, erro: mensagemBloqueio(limite.esperaSeg) };
  if (!link) return { ok: false, erro: "Este link não vale mais. Peça um novo ao comprador." };

  return runWithTenant(link.tenantId, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: link.quotationSupplierId },
      select: { id: true, quotation: { select: { status: true } } },
    });
    if (!convite) return { ok: false, erro: "Cotação não encontrada." };
    if (convite.quotation.status !== "ABERTA") {
      return { ok: false, erro: "Esta cotação não está mais aberta." };
    }

    await Promise.all([
      db.quotationSupplier.updateMany({
        where: { id: convite.id },
        data: {
          status: "RECUSADA",
          respondidaEm: new Date(),
          respondidaVia: "LINK",
          observacao: d.motivo || null,
        },
      }),
      marcarLinkRespondido(link.linkId),
    ]);
    return { ok: true };
  });
}
