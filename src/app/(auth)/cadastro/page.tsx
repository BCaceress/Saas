import { resolverConvite } from "@/lib/convites";
import { AuthForm } from "../_components/auth-form";
import { signupAction, googleLoginAction } from "../actions";

export const metadata = { title: "Criar conta — NoHub Market" };

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const { convite: token } = await searchParams;

  // Cadastro vindo de convite: e-mail travado, senão o convite não é consumido
  // (o casamento no signup é por e-mail) e a pessoa cai num tenant vazio.
  const convite = token ? await resolverConvite(token) : null;
  const doConvite = convite?.estado === "valido" ? convite : null;

  return (
    <div>
      {doConvite && (
        <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand-text)]">
          Convite de equipe
        </p>
      )}
      <h1 className="text-center font-display text-[27px] font-semibold leading-tight tracking-tight text-[var(--auth-ink)]">
        Criar sua conta
      </h1>
      <p className="mb-7 mt-2 text-center text-sm text-[var(--auth-muted)]">
        {doConvite
          ? `Ao concluir, você entra na equipe de ${doConvite.tenantNome}.`
          : "14 dias grátis, sem cartão. Só o essencial agora — o resto vem no setup."}
      </p>
      <AuthForm
        mode="signup"
        action={signupAction}
        googleAction={googleLoginAction}
        emailFixo={doConvite?.email}
      />
    </div>
  );
}
