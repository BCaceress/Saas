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
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        {doConvite ? "Convite de equipe" : "Comece agora"}
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        {doConvite ? "Criar sua conta" : "Criar conta"}
      </h1>
      <p className="mt-1.5 mb-7 text-sm text-[var(--auth-muted)]">
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
