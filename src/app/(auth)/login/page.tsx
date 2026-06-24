import { AuthForm } from "../_components/auth-form";
import { loginAction, googleLoginAction } from "../actions";

export const metadata = { title: "Entrar — NoHub Market" };

export default function LoginPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Entrar</h1>
      <p className="mt-1 mb-7 text-sm text-muted">
        Bom te ver de volta. Acesse o painel do seu mercado.
      </p>
      <AuthForm mode="login" action={loginAction} googleAction={googleLoginAction} />
    </div>
  );
}
