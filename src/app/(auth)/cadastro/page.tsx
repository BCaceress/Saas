import { AuthForm } from "../_components/auth-form";
import { signupAction, googleLoginAction } from "../actions";

export const metadata = { title: "Criar conta — NoHub Market" };

export default function CadastroPage() {
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        Comece agora
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        Criar conta
      </h1>
      <p className="mt-1.5 mb-7 text-sm text-[var(--auth-muted)]">
        14 dias grátis, sem cartão. Só o essencial agora — o resto vem no setup.
      </p>
      <AuthForm mode="signup" action={signupAction} googleAction={googleLoginAction} />
    </div>
  );
}
