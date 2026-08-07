import Link from "next/link";
import { cookies } from "next/headers";
import { Cloud, Headphones } from "lucide-react";
import { AuthTopbar } from "./_components/auth-topbar";
import { BrandSymbol } from "./_components/brand-symbol";
import { Showcase } from "./_components/showcase";
import { version } from "../../../package.json";

const garantias = [
  { icon: Cloud, titulo: "Backup automático", texto: "Seus dados salvos todos os dias." },
  { icon: Headphones, titulo: "Suporte especializado", texto: "Gente que entende de operação." },
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Mesma fonte do RootLayout: o botão de tema já nasce com o ícone certo.
  const temaInicial = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";

  return (
    <div className="auth-theme relative min-h-dvh bg-[var(--auth-bg)] text-[var(--auth-ink)]">
      {/* Fundo: gradiente quase branco, poeira de pontos, um traço curvo e dois
          halos de marca. Atmosfera — nunca concorrência com o conteúdo. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="auth-canvas absolute inset-0" />
        <div className="auth-dots absolute inset-0" />
        <svg
          className="absolute -left-24 top-0 h-full w-[75%] text-[var(--auth-brand)] opacity-[0.14]"
          viewBox="0 0 800 900"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <path
            d="M-40 640C160 620 250 470 300 320 350 170 470 60 760 40"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M-40 760C200 730 330 560 380 400 430 240 560 130 820 110"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.55"
          />
        </svg>
        <div
          className="absolute -left-40 -top-44 h-[40rem] w-[40rem] rounded-full blur-[130px]"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.13), transparent 70%)" }}
        />
        <div
          className="absolute -bottom-60 right-[-12rem] h-[38rem] w-[38rem] rounded-full blur-[140px]"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.07), transparent 70%)" }}
        />
      </div>

      <AuthTopbar temaInicial={temaInicial} />

      <div className="relative grid min-h-dvh md:grid-cols-[42fr_58fr] lg:grid-cols-[54fr_46fr]">
        <Showcase />

        {/* pt maior que pb: reserva o corredor do botão de tema para o card
            nunca encostar nele em telas baixas. */}
        <div className="flex items-center justify-center px-5 pb-14 pt-24 sm:px-8 md:pb-10 md:pt-20 lg:px-12">
          <div className="w-full max-w-[29.5rem]">
            {/* Sem coluna institucional no mobile, a marca precisa aparecer aqui. */}
            <Link
              href="/"
              aria-label="NoHub Market — início"
              className="mx-auto mb-8 flex w-fit items-center gap-2.5 md:hidden"
            >
              <BrandSymbol className="h-8" />
              <span className="font-display text-[15px] tracking-tight text-[var(--auth-ink-2)]">
                NoHub <span className="text-[var(--auth-muted)]">Market</span>
              </span>
            </Link>

            <div className="auth-fade-up rounded-[28px] bg-[var(--auth-card)] p-7 shadow-[var(--auth-card-shadow)] sm:px-11 sm:py-11">
              {children}

              <div className="mt-8 grid grid-cols-2 gap-4 border-t border-[var(--auth-line)] pt-5">
                {garantias.map(({ icon: Icon, titulo, texto }) => (
                  <div key={titulo} className="flex items-start gap-2.5">
                    <Icon
                      size={15}
                      className="mt-0.5 shrink-0 text-[var(--auth-brand-text)]"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold leading-tight text-[var(--auth-ink-2)]">
                        {titulo}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-tight text-[var(--auth-muted)]">
                        {texto}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Versão do build: ajuda o suporte a saber o que o operador está vendo. */}
            <p className="mt-5 text-center font-mono text-[11px] tracking-tight text-[var(--auth-muted)]">
              {version}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
