"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { basePrisma } from "@/lib/prisma";
import { signupWithTenant, SignupError } from "@/lib/provisioning";
import { consumir, liberar, mensagemBloqueio } from "@/lib/rate-limit";
import { tenantUrl } from "@/lib/urls";
import { homeDoLogin } from "@/lib/superficie-server";

/** `email`/`name` voltam junto do erro: o formulário se repõe sozinho em vez de
 *  obrigar a digitar tudo de novo (o React reseta os campos após a action). */
export type FormState = { error?: string; email?: string; name?: string } | undefined;

/** Origem da requisição — chave de rate limit que não depende do e-mail digitado. */
async function origem(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "desconhecido";
}

/**
 * "Lembrar este dispositivo" desmarcado: reescreve o cookie de sessão sem
 * validade, para ele morrer quando o navegador fechar (o padrão do Auth.js são
 * 30 dias). Preserva domínio/flags do auth.config — sem isso a sessão deixaria
 * de ser compartilhada entre os subdomínios de tenant.
 */
async function encerrarSessaoAoFechar() {
  const jar = await cookies();
  const rootDomain = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000").split(":")[0];
  const domain = rootDomain.includes(".") ? `.${rootDomain}` : undefined;

  // O JWT pode vir fatiado (…-token.0, …-token.1) quando cresce.
  for (const c of jar.getAll().filter((c) => c.name.includes("authjs.session-token"))) {
    jar.set(c.name, c.value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      domain,
      secure: process.env.NODE_ENV === "production",
      // Sem maxAge/expires => cookie de sessão.
    });
  }
}

const signupSchema = z.object({
  name: z.string().min(2, "Informe seu nome."),
  email: z.string().email("E-mail inválido."),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha."),
});

/**
 * Destino pós-login do usuário: subdomínio do tenant + onboarding ou a home da
 * superfície do aparelho (`/m` no celular, `/inicio` no computador). O
 * onboarding vem antes das duas — ele só existe na superfície completa.
 */
async function destinationForUser(email: string): Promise<string> {
  const user = await basePrisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: {
      memberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { tenant: { select: { subdomain: true, onboardingDone: true } } },
      },
    },
  });
  const tenant = user?.memberships[0]?.tenant;
  if (!tenant) return tenantUrl("app", "/"); // fallback improvável
  if (!tenant.onboardingDone) return tenantUrl(tenant.subdomain, "/onboarding");
  return tenantUrl(tenant.subdomain, await homeDoLogin());
}

export async function signupAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const digitado = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ...digitado, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // Cadastro cria tenant, seed e banco — abrir isso sem limite é convite para
  // encher a base com contas de robô.
  const limite = await consumir(`signup:ip:${await origem()}`, 5, 3600);
  if (!limite.ok) return { ...digitado, error: mensagemBloqueio(limite.esperaSeg) };

  let dest: string;
  try {
    await signupWithTenant(parsed.data);
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    // Convidado entra num tenant já configurado — mandar para /onboarding só
    // ricocheteava. destinationForUser olha o onboardingDone e decide.
    dest = await destinationForUser(parsed.data.email);
  } catch (e) {
    if (e instanceof SignupError) return { ...digitado, error: e.message };
    if (e instanceof AuthError)
      return { ...digitado, error: "Conta criada, mas o login falhou. Tente entrar." };
    throw e;
  }
  redirect(dest);
}

export async function loginAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const digitado = { email: String(formData.get("email") ?? "") };
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ...digitado, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // Dois limites: por conta (protege o dono do e-mail de ficar trancado por
  // ataque vindo de fora) e por origem (barra o robô que varre muitas contas).
  const email = parsed.data.email.toLowerCase().trim();
  const ip = await origem();
  const porConta = await consumir(`login:email:${email}`, 8, 900);
  const porIp = await consumir(`login:ip:${ip}`, 30, 900);
  if (!porConta.ok || !porIp.ok) {
    return {
      ...digitado,
      error: mensagemBloqueio(Math.max(porConta.esperaSeg, porIp.esperaSeg)),
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) return { ...digitado, error: "E-mail ou senha incorretos." };
    throw e;
  }

  if (formData.get("lembrar") !== "1") await encerrarSessaoAoFechar();

  // Acertou: zera o contador da conta para não punir quem só errou a senha.
  await liberar(`login:email:${email}`);
  redirect(await destinationForUser(parsed.data.email));
}

export async function googleLoginAction() {
  await signIn("google", { redirectTo: "/pos-login" });
}
