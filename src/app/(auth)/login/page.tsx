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
        <p className="mb-6 flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
          Senha alterada. Entre com a nova senha.
        </p>
      )}
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        Bem-vindo de volta
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        Entrar na sua conta
      </h1>
      <p className="mt-1.5 mb-7 text-sm text-[var(--auth-muted)]">
        Acesse o painel do seu mercado pra continuar de onde parou.
      </p>
      <AuthForm mode="login" action={loginAction} googleAction={googleLoginAction} />
    </div>
  );
}
