"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { redefinirSenhaAction, type EstadoTroca } from "../actions";

function Salvar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--auth-brand)] text-[15px] font-semibold text-[#1a0d02] transition-all duration-200 hover:bg-[var(--auth-brand-hover)] hover:shadow-[0_8px_28px_-8px_var(--auth-glow)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && <Loader2 size={17} className="animate-spin" aria-hidden />}
      {pending ? "Salvando…" : "Salvar nova senha"}
    </button>
  );
}

function CampoSenha({
  name,
  label,
  autoFocus,
}: {
  name: string;
  label: string;
  autoFocus?: boolean;
}) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <Lock
        size={17}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--auth-muted)]"
        aria-hidden
      />
      <input
        name={name}
        type={visivel ? "text" : "password"}
        required
        minLength={8}
        autoFocus={autoFocus}
        autoComplete="new-password"
        placeholder={label}
        aria-label={label}
        className="h-[52px] w-full rounded-2xl border border-[var(--auth-line-strong)] bg-[var(--auth-field)] pl-11 pr-12 text-[15px] text-[var(--auth-ink)] transition-colors duration-150 placeholder:text-[var(--auth-muted)]/70 hover:border-white/20 focus-visible:border-[var(--auth-brand)] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--auth-glow)]"
      />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-2 text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--auth-brand)]"
      >
        {visivel ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  );
}

export function FormNovaSenha({ token }: { token: string }) {
  const [estado, action] = useActionState<EstadoTroca, FormData>(redefinirSenhaAction, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {estado?.erro && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {estado.erro}
        </p>
      )}

      <CampoSenha name="senha" label="Nova senha (mínimo 8 caracteres)" autoFocus />
      <CampoSenha name="confirmacao" label="Repita a nova senha" />

      <Salvar />
    </form>
  );
}
