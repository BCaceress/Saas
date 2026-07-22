"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { aceitarConviteAction, trocarDeContaAction, type ConviteState } from "../actions";

/**
 * Aceite com sessão ativa. Se o e-mail logado não é o do convite, não adianta
 * tentar — o caminho é trocar de conta.
 */
export function AceitarConvite({
  token,
  emailConvite,
  emailSessao,
  bate,
}: {
  token: string;
  emailConvite: string;
  emailSessao: string;
  bate: boolean;
}) {
  const [state, formAction] = useActionState<ConviteState, FormData>(
    aceitarConviteAction,
    undefined,
  );

  if (!bate) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-start gap-2 rounded-xl bg-[var(--auth-danger-soft)] px-3 py-2.5 text-sm text-[var(--auth-danger)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            Você está em <strong>{emailSessao}</strong>, mas o convite é para{" "}
            <strong>{emailConvite}</strong>.
          </span>
        </p>
        <form action={trocarDeContaAction}>
          <input type="hidden" name="token" value={token} />
          <Botao rotulo="Sair e entrar com a conta certa" variante="secundario" />
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state?.error && (
        <p className="flex items-center gap-2 rounded-xl bg-[var(--auth-danger-soft)] px-3 py-2.5 text-sm text-[var(--auth-danger)]">
          <AlertCircle size={16} className="shrink-0" />
          {state.error}
        </p>
      )}
      <Botao rotulo="Aceitar convite" variante="primario" />
    </form>
  );
}

function Botao({
  rotulo,
  variante,
}: {
  rotulo: string;
  variante: "primario" | "secundario";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        "inline-flex h-[52px] w-full cursor-pointer items-center justify-center rounded-2xl text-[15px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60 " +
        (variante === "primario"
          ? "bg-[var(--auth-brand)] text-[var(--auth-on-brand,#04121a)] hover:opacity-90"
          : "border border-[var(--auth-line-strong)] font-medium text-[var(--auth-ink)] hover:bg-white/5")
      }
    >
      {pending ? "Aguarde…" : rotulo}
    </button>
  );
}
