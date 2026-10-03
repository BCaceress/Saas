"use server";

import { z } from "zod";
import { consumir, mensagemBloqueio } from "@/lib/rate-limit";
import { confirmarPedidoPeloLink, contestarPedidoPeloLink } from "@/lib/compras/pedido-link";

// ============================================================
// Resposta pública ao pedido. Sem sessão: quem autoriza é o token. Nada aqui
// aceita id do cliente — o pedido sai do link.
// ============================================================

const LIMITE = 20;
const JANELA_SEG = 60 * 60;

export type ResultadoPedidoPublico = { ok: true } | { ok: false; erro: string };

const confirmarSchema = z.object({
  token: z.string().min(10).max(200),
  /** yyyy-mm-dd, opcional. */
  previsaoEntrega: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export async function confirmarPedidoAction(
  input: z.input<typeof confirmarSchema>,
): Promise<ResultadoPedidoPublico> {
  const parsed = confirmarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, erro: "Confira a data de entrega e tente de novo." };
  const d = parsed.data;

  const limite = await consumir(`pedido-link:${d.token}`, LIMITE, JANELA_SEG);
  if (!limite.ok) return { ok: false, erro: mensagemBloqueio(limite.esperaSeg) };

  let previsao: Date | null = null;
  if (d.previsaoEntrega) {
    // Meio-dia UTC: a data não "volta um dia" quando lida em outro fuso.
    previsao = new Date(`${d.previsaoEntrega}T12:00:00Z`);
    const ontem = Date.now() - 24 * 60 * 60 * 1000;
    if (Number.isNaN(previsao.getTime()) || previsao.getTime() < ontem) {
      return { ok: false, erro: "A previsão de entrega não pode ser uma data passada." };
    }
  }
  return confirmarPedidoPeloLink(d.token, previsao);
}

const contestarSchema = z.object({
  token: z.string().min(10).max(200),
  motivo: z.string().trim().min(3, "Conte em poucas palavras o que não dá para atender.").max(1000),
});

export async function contestarPedidoAction(
  input: z.input<typeof contestarSchema>,
): Promise<ResultadoPedidoPublico> {
  const parsed = contestarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, erro: parsed.error.issues[0]?.message ?? "Confira o texto e tente de novo." };
  }
  const limite = await consumir(`pedido-link:${parsed.data.token}`, LIMITE, JANELA_SEG);
  if (!limite.ok) return { ok: false, erro: mensagemBloqueio(limite.esperaSeg) };
  return contestarPedidoPeloLink(parsed.data.token, parsed.data.motivo);
}
