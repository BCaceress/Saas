import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { basePrisma } from "./prisma";
import { rootUrl } from "./urls";

// ============================================================
// Recuperação de senha.
//
// Três decisões que valem o comentário:
//
// 1. O banco guarda o HASH do token, não o token. Quem lê um dump não
//    consegue redefinir a senha de ninguém.
// 2. `pedirReset` devolve sempre o mesmo resultado, exista o e-mail ou não.
//    Diferenciar as respostas transforma a tela num verificador de contas.
// 3. Token vale 60 minutos e morre no primeiro uso. Quem esqueceu a senha
//    resolve isso em minutos; link eterno no e-mail é passivo de segurança.
// ============================================================

export const VALIDADE_MIN = 60;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function resetUrl(token: string): string {
  return rootUrl(`/recuperar-senha/${token}`);
}

/**
 * Cria um token para o e-mail informado. Devolve `null` quando não há conta
 * com login por senha — quem chama envia o e-mail só nesse caso, mas mostra a
 * mesma mensagem sempre.
 */
export async function criarTokenReset(
  email: string,
): Promise<{ token: string; url: string; nome: string | null; email: string } | null> {
  const normalizado = email.toLowerCase().trim();
  const user = await basePrisma.user.findUnique({
    where: { email: normalizado },
    select: { id: true, name: true, email: true, passwordHash: true },
  });
  if (!user) return null;

  // Conta só de Google não tem senha para redefinir — criar token aqui daria
  // ao dono um link que não resolve o problema dele.
  if (!user.passwordHash) return null;

  // Pedido novo invalida os anteriores: dois links válidos ao mesmo tempo é
  // superfície de ataque sem ganho para o usuário.
  await basePrisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  });

  const token = randomBytes(32).toString("base64url");
  await basePrisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + VALIDADE_MIN * 60 * 1000),
    },
  });

  return { token, url: resetUrl(token), nome: user.name, email: user.email };
}

export type TokenValido = { userId: string; tokenId: string };

/** Valida sem consumir — usado para decidir se a tela mostra o formulário. */
export async function validarToken(token: string): Promise<TokenValido | null> {
  if (!token || token.length < 20) return null;

  const registro = await basePrisma.passwordResetToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!registro) return null;
  if (registro.usedAt) return null;
  if (registro.expiresAt.getTime() < Date.now()) return null;

  return { userId: registro.userId, tokenId: registro.id };
}

export type ResultadoTroca = { ok: true } | { ok: false; erro: string };

/**
 * Troca a senha e queima o token na mesma transação. Sessões antigas seguem
 * válidas por enquanto (JWT), o que é aceitável para o caso "esqueci a senha";
 * revogação total entra junto com sessão em banco.
 */
export async function trocarSenhaComToken(
  token: string,
  novaSenha: string,
): Promise<ResultadoTroca> {
  if (novaSenha.length < 8) {
    return { ok: false, erro: "A senha precisa ter ao menos 8 caracteres." };
  }

  const valido = await validarToken(token);
  if (!valido) {
    return {
      ok: false,
      erro: "Este link expirou ou já foi usado. Peça um novo para redefinir a senha.",
    };
  }

  const passwordHash = await bcrypt.hash(novaSenha, 10);

  await basePrisma.$transaction([
    basePrisma.user.update({
      where: { id: valido.userId },
      data: { passwordHash },
    }),
    basePrisma.passwordResetToken.update({
      where: { id: valido.tokenId },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}

/** Comparação em tempo constante — usada onde tokens são comparados à mão. */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Remove tokens vencidos. Roda no job diário. */
export async function limparTokensExpirados(): Promise<number> {
  const r = await basePrisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });
  return r.count;
}
