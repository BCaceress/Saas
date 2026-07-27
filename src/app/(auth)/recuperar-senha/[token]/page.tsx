import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { validarToken } from "@/lib/senha";
import { FormNovaSenha } from "./_form";

export const metadata = { title: "Nova senha — NoHub Market" };

export default async function NovaSenhaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valido = await validarToken(token);

  // Link morto tem que dizer o que fazer agora, não só que deu errado.
  if (!valido) {
    return (
      <div>
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-400">
          <AlertTriangle size={22} aria-hidden />
        </div>
        <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
          Este link não vale mais
        </h1>
        <p className="mt-2 mb-7 text-sm leading-relaxed text-[var(--auth-muted)]">
          Links de redefinição expiram em 1 hora e só funcionam uma vez. Peça um novo para
          continuar.
        </p>
        <Link
          href="/recuperar-senha"
          className="inline-flex h-[52px] w-full items-center justify-center rounded-2xl bg-[var(--auth-brand)] text-[15px] font-semibold text-[#1a0d02] transition-all duration-200 hover:bg-[var(--auth-brand-hover)]"
        >
          Pedir novo link
        </Link>
        <Link
          href="/login"
          className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--auth-muted)] transition-colors hover:text-[var(--auth-brand)]"
        >
          <ArrowLeft size={15} aria-hidden />
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        Recuperação de senha
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        Criar nova senha
      </h1>
      <p className="mt-1.5 mb-7 text-sm leading-relaxed text-[var(--auth-muted)]">
        Escolha uma senha de pelo menos 8 caracteres. Depois de salvar, entre com ela.
      </p>
      <FormNovaSenha token={token} />
    </div>
  );
}
