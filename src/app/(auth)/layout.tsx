import Link from "next/link";
import { BadgeCheck, BarChart3, PackageSearch, Wine } from "lucide-react";
import { BrandMark } from "./_components/brand-mark";

const destaques = [
  { icon: Wine, label: "Saldo fechado + aberto por garrafa, em tempo real" },
  { icon: PackageSearch, label: "Cadastro por EAN — Cosmos preenche o resto" },
  { icon: BarChart3, label: "Relatórios prontos pra levar ao contador" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-theme grid min-h-dvh bg-[var(--auth-bg)] md:grid-cols-[1fr_300px] lg:grid-cols-[45fr_55fr]">
      {/* Coluna de autenticação */}
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16 xl:px-20">
        <Link href="/" aria-label="NoHub Market — início" className="w-fit">
          <BrandMark className="text-[var(--auth-ink)]" />
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="auth-fade-up w-full max-w-md rounded-[24px] border border-[var(--auth-line)] bg-[var(--auth-card)] p-8 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.55)] sm:p-10">
            {children}
          </div>
        </div>

        <p className="text-center text-xs text-[var(--auth-muted)] lg:text-left">
          © {new Date().getFullYear()} NoHub Market
        </p>
      </div>

      {/* Painel-vitrine: reforça a assinatura do produto */}
      <aside className="relative hidden overflow-hidden bg-[var(--auth-surface)] md:block">
        {/* Grid sutil + glow de fundo — profundidade sem exagero */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(var(--auth-line) 1px, transparent 1px), linear-gradient(90deg, var(--auth-line) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
          aria-hidden
        />
        <div
          className="absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-[var(--auth-brand)]/[0.16] blur-[110px]"
          aria-hidden
        />
        <div
          className="absolute bottom-0 left-0 h-64 w-full bg-gradient-to-t from-[var(--auth-bg)] to-transparent"
          aria-hidden
        />

        <div className="relative flex h-full flex-col justify-center gap-8 px-10 py-16 lg:gap-10 lg:px-14 xl:px-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--auth-brand)]">
            NoHub Market
          </p>
          <h2 className="max-w-sm font-display text-[2rem] font-semibold leading-[1.15] text-[var(--auth-ink)] lg:text-4xl">
            Cada garrafa importa. Controle seu estoque em tempo real.
          </h2>
          <p className="hidden max-w-xs text-sm leading-relaxed text-[var(--auth-muted)] lg:block">
            Um único painel pra saldo, compras e relatório — pensado pro
            operador de mercado autônomo, conveniência ou distribuidora.
          </p>

          {/* Composição visual — demonstração do produto, não é dado real */}
          <div className="w-full max-w-xs rounded-[20px] border border-[var(--auth-line-strong)] bg-white/[0.04] p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-[var(--auth-ink)]">Vodka Absolut 1L</div>
              <span className="rounded-full bg-[var(--auth-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--auth-brand)]">
                Repor
              </span>
            </div>

            <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--auth-line-strong)] bg-white/[0.05] px-1.5 py-0.5">
              <span aria-hidden className="barcode-strip h-3.5 w-4 rounded-[2px] opacity-90 invert" />
              <span className="font-mono text-[12px] font-medium tracking-tight text-[var(--auth-ink)] tnum">
                BEB-DES-3344
              </span>
            </div>

            <div className="mt-3.5 flex items-baseline gap-2 font-mono text-sm text-[var(--auth-ink)] tnum">
              <span className="font-semibold">4</span>
              <span className="text-xs text-[var(--auth-muted)]">fechadas</span>
              <span className="text-xs text-[var(--auth-brand)]">+ 1 aberta · 20%</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--auth-ok)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--auth-ok)]" aria-hidden />
                ao vivo
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 rounded-full bg-[var(--auth-brand)]" />
            </div>
          </div>

          <ul className="hidden flex-col gap-3.5 lg:flex">
            {destaques.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-3 text-sm text-[var(--auth-muted)]">
                <Icon size={17} className="mt-0.5 shrink-0 text-[var(--auth-brand)]" aria-hidden />
                {label}
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-2 text-xs text-[var(--auth-muted)] lg:flex">
            <BadgeCheck size={15} className="text-[var(--auth-brand)]" aria-hidden />
            14 dias grátis, sem cartão de crédito
          </div>
        </div>
      </aside>
    </div>
  );
}
