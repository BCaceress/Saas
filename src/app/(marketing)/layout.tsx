import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Mail } from "lucide-react";
import { Logo } from "@/components/logo";
import { TRIAL_DIAS } from "@/lib/planos";
import { SiteHeader } from "./_components/site-header";

const DESCRICAO =
  "ERP completo para mercados autônomos, conveniências, adegas e mercadinhos: " +
  "produtos, estoque, compras, PDV, fiscal, clientes e relatórios num sistema só. " +
  `Teste ${TRIAL_DIAS} dias sem cartão.`;

// metadataBase resolve as URLs relativas do OG. Sem ele, o Next avisa no build
// e a imagem de compartilhamento sai com caminho relativo (que o WhatsApp
// ignora). APP_DOMAIN já existe no ambiente — reaproveitado aqui.
const site = process.env.APP_DOMAIN
  ? `https://${process.env.APP_DOMAIN.replace(/^https?:\/\//, "")}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: "NoHub Market — o ERP do mercado de bairro",
    template: "%s — NoHub Market",
  },
  description: DESCRICAO,
  keywords: [
    "ERP para mercado",
    "sistema para adega",
    "PDV para conveniência",
    "controle de estoque bebidas",
    "mercado autônomo",
    "NFC-e",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: "NoHub Market",
    title: "NoHub Market — o ERP do mercado de bairro",
    description: DESCRICAO,
  },
  twitter: {
    card: "summary_large_image",
    title: "NoHub Market — o ERP do mercado de bairro",
    description: DESCRICAO,
  },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas">
      {/* Halo de marca + poeira de pontos no topo da página. Fica no layout, e
          não na seção do herói, para começar ATRÁS do cabeçalho (que é
          transparente até a página rolar) — dentro da seção, a faixa começava
          no fim do header e criava uma emenda visível.
          z-index positivo e conteúdo em z-10: com z negativo as camadas
          ficariam atrás do `bg-canvas` deste mesmo div — o fundo de um
          ancestral em fluxo pinta depois de descendente com z negativo. */}
      <div aria-hidden className="mkt-aura pointer-events-none absolute inset-x-0 top-0 z-0 h-[46rem]" />
      <div aria-hidden className="mkt-dots pointer-events-none absolute inset-x-0 top-0 z-0 h-[46rem]" />

      <SiteHeader />
      <main className="relative z-10 flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Logo />
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
                Controle de mercado que cabe no balcão. Feito para quem opera, não para
                quem só relata.
              </p>
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
                <ShieldCheck size={13} className="text-ok" />
                Dados isolados por mercado · exportação a qualquer momento
              </p>
            </div>

            <nav aria-label="Produto" className="flex flex-col gap-2">
              <p className="font-display text-sm font-semibold text-ink">Produto</p>
              <Link
                href="/#recursos"
                className="text-sm text-muted transition-colors hover:text-brand"
              >
                Recursos
              </Link>
              <Link href="/#telas" className="text-sm text-muted transition-colors hover:text-brand">
                Por dentro
              </Link>
              <Link
                href="/#planos"
                className="text-sm text-muted transition-colors hover:text-brand"
              >
                Planos e preços
              </Link>
              <Link href="/#faq" className="text-sm text-muted transition-colors hover:text-brand">
                Dúvidas
              </Link>
            </nav>

            <nav aria-label="Conta e legal" className="flex flex-col gap-2">
              <p className="font-display text-sm font-semibold text-ink">Conta</p>
              <Link href="/login" className="text-sm text-muted transition-colors hover:text-brand">
                Entrar
              </Link>
              <Link
                href="/cadastro"
                className="text-sm text-muted transition-colors hover:text-brand"
              >
                Criar conta grátis
              </Link>
              <Link href="/termos" className="text-sm text-muted transition-colors hover:text-brand">
                Termos de uso
              </Link>
              <Link
                href="/privacidade"
                className="text-sm text-muted transition-colors hover:text-brand"
              >
                Privacidade
              </Link>
            </nav>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
            <p className="text-xs text-faint">
              © {new Date().getFullYear()} NoHub Market · pt-BR · Teste de {TRIAL_DIAS} dias
            </p>
            <a
              href="mailto:contato@nohub.market"
              className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-brand"
            >
              <Mail size={13} />
              contato@nohub.market
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
