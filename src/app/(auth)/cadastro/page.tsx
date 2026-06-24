import { AuthForm } from "../_components/auth-form";
import { signupAction, googleLoginAction } from "../actions";

export const metadata = { title: "Criar conta — NoHub Market" };

export default function CadastroPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Criar conta</h1>
      <p className="mt-1 mb-7 text-sm text-muted">
        14 dias grátis, sem cartão. Só o essencial agora — o resto vem no setup.
      </p>
      <AuthForm mode="signup" action={signupAction} googleAction={googleLoginAction} />
    </div>
  );
}
