import Link from "next/link";
import { Logo } from "@/components/logo";
import { SkuTag } from "@/components/sku-tag";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-2">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" aria-label="NoHub Market — início">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>

      {/* Painel-vitrine: reforça a assinatura do produto */}
      <aside className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="absolute inset-0 opacity-[0.07]" aria-hidden>
          <div className="barcode-strip h-full w-full invert" />
        </div>
        <div className="relative flex h-full flex-col justify-center gap-6 px-12">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">
            NoHub Market
          </p>
          <h2 className="max-w-sm font-display text-3xl font-semibold leading-tight text-white">
            Cada garrafa contada. Fechada ou aberta.
          </h2>
          <div className="max-w-xs rounded-[var(--radius-lg)] border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-medium text-white">Vodka Absolut 1L</div>
            <SkuTag sku="BEB-DES-3344" className="mt-2 bg-white/10 text-white" />
            <div className="mt-3 flex items-baseline gap-2 font-mono text-sm text-white tnum">
              <span className="font-semibold">4</span>
              <span className="text-xs text-white/60">fechadas</span>
              <span className="text-xs text-brand">+ 1 aberta · 20%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-2/3 rounded-full bg-brand" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
