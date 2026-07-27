"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enviarEmail } from "@/lib/email";
import { emailResetSenha } from "@/lib/email/templates";
import { logErro, logInfo } from "@/lib/log";
import { consumir, mensagemBloqueio } from "@/lib/rate-limit";
import { criarTokenReset, trocarSenhaComToken, VALIDADE_MIN } from "@/lib/senha";

// ============================================================
// Recuperação de senha — telas do domínio raiz.
//
// A resposta de "pedir link" é sempre a mesma, com ou sem conta: quem não é
// dono do e-mail não descobre daqui se ele existe no sistema.
// ============================================================

export type EstadoPedido = { erro?: string; enviado?: boolean } | undefined;
export type EstadoTroca = { erro?: string } | undefined;

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "desconhecido";
}

const pedidoSchema = z.object({ email: z.string().email("Informe um e-mail válido.") });

export async function pedirResetAction(
  _prev: EstadoPedido,
  formData: FormData,
): Promise<EstadoPedido> {
  const parsed = pedidoSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  }
  const email = parsed.data.email.toLowerCase().trim();

  // Dois limites: um protege a caixa de entrada de quem tem a conta, o outro
  // impede varredura de e-mails a partir de uma mesma origem.
  const porEmail = await consumir(`reset:email:${email}`, 3, 3600);
  const porIp = await consumir(`reset:ip:${await ip()}`, 10, 3600);
  if (!porEmail.ok || !porIp.ok) {
    return { erro: mensagemBloqueio(Math.max(porEmail.esperaSeg, porIp.esperaSeg)) };
  }

  const pedido = await criarTokenReset(email);
  if (pedido) {
    const envio = await enviarEmail(
      emailResetSenha({
        para: pedido.email,
        nome: pedido.nome,
        url: pedido.url,
        validadeMin: VALIDADE_MIN,
      }),
    );
    if (!envio.ok) {
      logErro("reset.email", envio.erro);
      return {
        erro: "Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.",
      };
    }
    logInfo("reset.solicitado", { email });
  }

  return { enviado: true };
}

const trocaSchema = z
  .object({
    token: z.string().min(20, "Link inválido."),
    senha: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, {
    message: "As senhas não são iguais.",
    path: ["confirmacao"],
  });

export async function redefinirSenhaAction(
  _prev: EstadoTroca,
  formData: FormData,
): Promise<EstadoTroca> {
  const parsed = trocaSchema.safeParse({
    token: formData.get("token"),
    senha: formData.get("senha"),
    confirmacao: formData.get("confirmacao"),
  });
  if (!parsed.success) {
    return { erro: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // Força bruta sobre o token: 32 bytes não se adivinha, mas tentativa em
  // massa consome banco. Limite por origem resolve.
  const tentativas = await consumir(`reset:troca:${await ip()}`, 10, 900);
  if (!tentativas.ok) return { erro: mensagemBloqueio(tentativas.esperaSeg) };

  const r = await trocarSenhaComToken(parsed.data.token, parsed.data.senha);
  if (!r.ok) return { erro: r.erro };

  logInfo("reset.concluido");
  // Sem login automático: quem acabou de trocar a senha entra com ela. Também
  // evita que um link de e-mail, sozinho, vire sessão aberta.
  redirect("/login?senha=alterada");
}
