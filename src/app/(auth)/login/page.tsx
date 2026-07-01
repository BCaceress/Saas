import { AuthForm } from "../_components/auth-form";
import { loginAction, googleLoginAction } from "../actions";

export const metadata = { title: "Entrar — NoHub Market" };

export default function LoginPage() {
  return (
    <div>
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
