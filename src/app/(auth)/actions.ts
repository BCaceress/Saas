"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { basePrisma } from "@/lib/prisma";
import { signupWithTenant, SignupError } from "@/lib/provisioning";
import { tenantUrl } from "@/lib/urls";

export type FormState = { error?: string } | undefined;

const signupSchema = z.object({
  name: z.string().min(2, "Informe seu nome."),
  email: z.string().email("E-mail inválido."),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha."),
});

/** Destino pós-login do usuário: subdomínio do tenant + onboarding ou produtos. */
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
  return tenantUrl(tenant.subdomain, tenant.onboardingDone ? "/inicio" : "/onboarding");
}

export async function signupAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  let dest: string;
  try {
    const { subdomain } = await signupWithTenant(parsed.data);
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    dest = tenantUrl(subdomain, "/onboarding");
  } catch (e) {
    if (e instanceof SignupError) return { error: e.message };
    if (e instanceof AuthError) return { error: "Conta criada, mas o login falhou. Tente entrar." };
    throw e;
  }
  redirect(dest);
}

export async function loginAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: "E-mail ou senha incorretos." };
    throw e;
  }

  redirect(await destinationForUser(parsed.data.email));
}

export async function googleLoginAction() {
  await signIn("google", { redirectTo: "/pos-login" });
}
