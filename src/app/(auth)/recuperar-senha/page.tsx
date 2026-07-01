import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

export const metadata = { title: "Recuperar senha — NoHub Market" };

export default function RecuperarSenhaPage() {
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        Recuperação de senha
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        Vamos redefinir sua senha
      </h1>
      <p className="mt-1.5 mb-7 text-sm leading-relaxed text-[var(--auth-muted)]">
        A redefinição automática por e-mail ainda não está disponível. Fale com
        o suporte informando o e-mail da sua conta que redefinimos pra você.
      </p>

      <a
        href="mailto:suporte@nohub.market?subject=Recupera%C3%A7%C3%A3o%20de%20senha"
        className="inline-flex h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--auth-brand)] text-[15px] font-semibold text-[#1a0d02] transition-all duration-200 hover:bg-[var(--auth-brand-hover)] hover:shadow-[0_8px_28px_-8px_var(--auth-glow)]"
      >
        <Mail size={17} aria-hidden />
        Falar com o suporte
      </a>

      <Link
        href="/login"
        className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--auth-muted)] hover:text-[var(--auth-brand)]"
      >
        <ArrowLeft size={15} aria-hidden />
        Voltar para o login
      </Link>
    </div>
  );
}
