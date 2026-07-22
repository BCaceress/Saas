"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormState } from "../actions";

const REMEMBER_KEY = "nohub:remember-email";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl",
        "bg-[var(--auth-brand)] text-[15px] font-semibold text-[#1a0d02] transition-all duration-200",
        "hover:bg-[var(--auth-brand-hover)] hover:shadow-[0_8px_28px_-8px_var(--auth-glow)]",
        "active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {pending && <Loader2 size={17} className="animate-spin" aria-hidden />}
      {pending ? "Um instante…" : label}
    </button>
  );
}

/** Campo de texto no tema escuro do auth: altura 52px, foco com glow laranja. */
const AuthInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }
>(({ icon: Icon, className, ...props }, ref) => (
  <div className="relative">
    <Icon
      size={17}
      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--auth-muted)]"
    />
    <input
      ref={ref}
      className={cn(
        "h-[52px] w-full rounded-2xl border border-[var(--auth-line-strong)] bg-[var(--auth-field)] pl-11 pr-4 text-[15px] text-[var(--auth-ink)]",
        "placeholder:text-[var(--auth-muted)]/70 transition-colors duration-150",
        "hover:border-white/20",
        "focus-visible:border-[var(--auth-brand)] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--auth-glow)]",
        className,
      )}
      {...props}
    />
  </div>
));
AuthInput.displayName = "AuthInput";

function PasswordField({
  hasError,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <div>
      <div className="relative">
        <Lock
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--auth-muted)]"
        />
        <input
          type={visible ? "text" : "password"}
          onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
          onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
          onBlur={() => setCapsLock(false)}
          className={cn(
            "h-[52px] w-full rounded-2xl border bg-[var(--auth-field)] pl-11 pr-11 text-[15px] text-[var(--auth-ink)]",
            "placeholder:text-[var(--auth-muted)]/70 transition-colors duration-150",
            hasError ? "border-[var(--auth-danger)]" : "border-[var(--auth-line-strong)] hover:border-white/20",
            "focus-visible:border-[var(--auth-brand)] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--auth-glow)]",
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-ink)]"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {capsLock && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--auth-brand)]" role="status">
          <AlertTriangle size={13} aria-hidden />
          Caps Lock ativado
        </p>
      )}
    </div>
  );
}

export function AuthForm({
  mode,
  action,
  googleAction,
  emailFixo,
}: {
  mode: "login" | "signup";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  googleAction: () => Promise<void>;
  /** Cadastro via convite: o e-mail vem travado — se mudar, o convite não pega. */
  emailFixo?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined);
  const isSignup = mode === "signup";
  const emailRef = useRef<HTMLInputElement>(null);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (emailFixo) return;
    const saved = window.localStorage.getItem(REMEMBER_KEY);
    if (saved && emailRef.current) {
      emailRef.current.value = saved;
      setRemember(true);
    }
  }, [emailFixo]);

  function handleSubmit(fd: FormData) {
    const email = String(fd.get("email") ?? "");
    if (remember && email) window.localStorage.setItem(REMEMBER_KEY, email);
    else window.localStorage.removeItem(REMEMBER_KEY);
    formAction(fd);
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={googleAction}>
        <button
          type="submit"
          className={cn(
            "inline-flex h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl",
            "border border-[var(--auth-line-strong)] bg-white text-[15px] font-medium text-[#1c1c1c] transition-all duration-200",
            "hover:bg-white/90 hover:shadow-[0_8px_24px_-10px_rgba(255,255,255,0.35)] active:scale-[0.99]",
          )}
        >
          <GoogleIcon />
          Continuar com o Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-[var(--auth-muted)]">
        <span className="h-px flex-1 bg-[var(--auth-line)]" />
        ou com e-mail
        <span className="h-px flex-1 bg-[var(--auth-line)]" />
      </div>

      <form action={handleSubmit} className="flex flex-col gap-4">
        {isSignup && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-[13px] font-medium text-[var(--auth-ink)]/90">
              Nome
            </label>
            <AuthInput icon={User} id="name" name="name" autoComplete="name" placeholder="Seu nome" required />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[13px] font-medium text-[var(--auth-ink)]/90">
            E-mail
          </label>
          <AuthInput
            ref={emailRef}
            icon={Mail}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@mercado.com.br"
            required
            defaultValue={emailFixo}
            readOnly={!!emailFixo}
          />
          {emailFixo && (
            <p className="text-xs text-[var(--auth-muted)]">
              E-mail do convite — não pode ser alterado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] font-medium text-[var(--auth-ink)]/90">
              Senha
            </label>
            {!isSignup && (
              <Link
                href="/recuperar-senha"
                className="text-xs font-medium text-[var(--auth-muted)] hover:text-[var(--auth-brand)]"
              >
                Esqueceu a senha?
              </Link>
            )}
          </div>
          <PasswordField
            id="password"
            name="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            // Sem placeholder de bolinhas: no cadastro parecia campo já preenchido.
            hasError={!!state?.error}
            required
          />
          {isSignup && <p className="text-xs text-[var(--auth-muted)]">Mínimo de 8 caracteres.</p>}
        </div>

        {!isSignup && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--auth-muted)] select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--auth-line-strong)] bg-[var(--auth-field)] text-[var(--auth-brand)] accent-[var(--auth-brand)]"
            />
            Lembrar meu e-mail neste dispositivo
          </label>
        )}

        {state?.error && (
          <p className="flex items-center gap-2 rounded-xl bg-[var(--auth-danger-soft)] px-3 py-2.5 text-sm text-[var(--auth-danger)]">
            <AlertCircle size={16} className="shrink-0" />
            {state.error}
          </p>
        )}

        <Submit label={isSignup ? "Criar conta grátis" : "Entrar"} />
      </form>

      <p className="text-center text-sm text-[var(--auth-muted)]">
        {isSignup ? (
          <>
            Já tem conta?{" "}
            <Link href="/login" className="font-medium text-[var(--auth-brand)] hover:text-[var(--auth-brand-hover)]">
              Entrar
            </Link>
          </>
        ) : (
          <>
            Não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-[var(--auth-brand)] hover:text-[var(--auth-brand-hover)]">
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
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 34.5 26.7 35.5 24 35.5c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.4 43.5 30.7 43.5 24c0-1.2-.1-2.3.1-3.5z" />
    </svg>
  );
}
