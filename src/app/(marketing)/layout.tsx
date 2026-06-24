import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="NoHub Market — início">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">Entrar</Button>
            </Link>
            <Link href="/cadastro">
              <Button size="sm">Testar grátis</Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-10 text-center">
          <Logo />
          <p className="text-sm text-muted">
            Controle de bebidas que cabe no balcão. Feito para quem opera, não para quem só relata.
          </p>
          <p className="text-xs text-faint">Plano teste: 14 dias</p>
          <p className="text-xs text-faint">
            © {new Date().getFullYear()} NoHub Market · pt-BR
          </p>
        </div>
      </footer>
    </div>
  );
}
