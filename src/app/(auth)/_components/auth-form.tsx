"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import type { FormState } from "../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? "Um instante…" : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
  googleAction,
}: {
  mode: "login" | "signup";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  googleAction: () => Promise<void>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined);
  const isSignup = mode === "signup";

  return (
    <div className="flex flex-col gap-5">
      <form action={googleAction}>
        <Button type="submit" variant="secondary" size="lg" className="w-full gap-2.5">
          <GoogleIcon />
          Continuar com o Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        ou com e-mail
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {isSignup && (
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" placeholder="Seu nome" required />
          </Field>
        )}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="voce@mercado.com.br" required />
        </Field>
        <Field
          label="Senha"
          htmlFor="password"
          hint={isSignup ? "Mínimo de 8 caracteres." : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="••••••••"
            required
          />
        </Field>

        {state?.error && (
          <p className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertCircle size={16} className="shrink-0" />
            {state.error}
          </p>
        )}

        <Submit label={isSignup ? "Criar conta grátis" : "Entrar"} />
      </form>

      <p className="text-center text-sm text-muted">
        {isSignup ? (
          <>
            Já tem conta?{" "}
            <Link href="/login" className="font-medium text-brand hover:text-brand-strong">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-brand hover:text-brand-strong">
              Criar grátis
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 34.5 26.7 35.5 24 35.5c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.4 43.5 30.7 43.5 24c0-1.2-.1-2.3.1-3.5z" />
    </svg>
  );
}
