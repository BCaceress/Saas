import { Lock } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";

export const metadata = { title: "Sem acesso — NoHub Market" };

export default async function SemAcessoPage() {
  const ctx = await requireActiveTenant();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-warn-soft text-warn">
        <Lock size={24} />
      </span>
      <h1 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-ink">
        Nenhum acesso liberado
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sua conta faz parte de {ctx.tenant.nome}, mas ainda não tem perfil em nenhuma
        área. Peça a quem administra a conta para liberar seu acesso em
        Configurações → Usuários.
      </p>
    </div>
  );
}
