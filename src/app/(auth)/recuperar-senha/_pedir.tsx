"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { pedirResetAction, type EstadoPedido } from "./actions";

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--auth-brand)] text-[15px] font-semibold text-[var(--auth-on-brand)] transition-all duration-200 hover:bg-[var(--auth-brand-hover)] hover:shadow-[0_8px_28px_-8px_var(--auth-glow)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && <Loader2 size={17} className="animate-spin" aria-hidden />}
      {pending ? "Enviando…" : "Enviar link de redefinição"}
    </button>
  );
}

export function PedirReset() {
  const [estado, action] = useActionState<EstadoPedido, FormData>(pedirResetAction, undefined);

  // Confirmação ocupa a tela inteira: depois de enviado, a única coisa a fazer
  // é abrir o e-mail — manter o formulário só convida a reenviar.
  if (estado?.enviado) {
    return (
      <div>
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--auth-brand)]/15 text-[var(--auth-brand-text)]">
          <CheckCircle2 size={22} aria-hidden />
        </div>
        <h1 className="text-center font-display text-[27px] font-semibold leading-tight tracking-tight text-[var(--auth-ink)]">
          Verifique seu e-mail
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--auth-muted)]">
          Se existir uma conta com esse e-mail, o link de redefinição já está a caminho. Ele vale
          por 1 hora e só funciona uma vez.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-[var(--auth-muted)]">
          Não chegou? Confira a caixa de spam antes de pedir outro.
        </p>
        <Link
          href="/login"
          className="mt-7 flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-brand-text-hover)]"
        >
          <ArrowLeft size={15} aria-hidden />
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand-text)]">
        Recuperação de senha
      </p>
      <h1 className="text-center font-display text-[27px] font-semibold leading-tight tracking-tight text-[var(--auth-ink)]">
        Vamos redefinir sua senha
      </h1>
      <p className="mt-1.5 mb-7 text-sm leading-relaxed text-[var(--auth-muted)]">
        Informe o e-mail da sua conta. Enviamos um link para você criar uma nova senha.
      </p>

      <form action={action} className="flex flex-col gap-4">
        {estado?.erro && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-2xl bg-[var(--auth-danger-soft)] px-4 py-3 text-sm text-[var(--auth-danger)]"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {estado.erro}
          </p>
        )}

        <div className="relative">
          <Mail
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--auth-muted)]"
            aria-hidden
          />
          <input
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="voce@mercado.com.br"
            aria-label="E-mail da conta"
            className="h-[52px] w-full rounded-2xl border border-[var(--auth-line-strong)] bg-[var(--auth-field)] pl-11 pr-4 text-[15px] text-[var(--auth-ink)] transition-colors duration-150 placeholder:text-[var(--auth-muted)]/70 focus-visible:border-[var(--auth-brand)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--auth-glow)]"
          />
        </div>

        <Enviar />
      </form>

      <Link
        href="/login"
        className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-brand-text-hover)]"
      >
        <ArrowLeft size={15} aria-hidden />
        Voltar para o login
      </Link>
    </div>
  );
}
