import { CheckCircle2 } from "lucide-react";
import { AuthForm } from "../_components/auth-form";
import { loginAction, googleLoginAction } from "../actions";

export const metadata = { title: "Entrar — NoHub Market" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ senha?: string }>;
}) {
  const { senha } = await searchParams;

  return (
    <div>
      {/* Quem acabou de redefinir a senha chega aqui: confirma o que aconteceu
          antes de pedir que digite de novo. */}
      {senha === "alterada" && (
        <p className="mb-6 flex items-start gap-2 rounded-2xl bg-[var(--auth-ok-soft)] px-4 py-3 text-sm text-[var(--auth-ok)]">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
          Senha alterada. Entre com a nova senha.
        </p>
      )}

      <h1 className="text-center font-display text-[29px] font-semibold leading-tight tracking-tight text-[var(--auth-ink)]">
        Bem-vindo de volta
      </h1>
      <p className="mb-8 mt-2.5 text-center text-sm text-[var(--auth-muted)]">
        Entre na sua conta para continuar sua operação.
      </p>

      <AuthForm mode="login" action={loginAction} googleAction={googleLoginAction} />
    </div>
  );
}
