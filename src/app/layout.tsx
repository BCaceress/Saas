import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/app/sw-register";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoHub Market — o ERP do mercado de bairro",
  description:
    "Produtos, estoque, compras, PDV, fiscal e clientes para mercados autônomos, conveniências, adegas e mercadinhos.",
  applicationName: "NoHub Market",
  manifest: "/manifest.webmanifest",
  // Instalado no iPhone, abre sem barra de navegação. A barra de status fica
  // "default" (texto escuro) porque o tema padrão do app é claro; o
  // <meta name="theme-color"> abaixo é quem acompanha a escolha real.
  appleWebApp: { capable: true, title: "NoHub", statusBarStyle: "default" },
  // Safari transforma sequências de dígitos (SKU, EAN, código de pedido) em
  // link de telefone. Num ERP isso é só ruído azul sublinhado.
  formatDetection: { telephone: false },
};

/**
 * Estático de propósito. `themeColor` NÃO entra aqui: ele depende do cookie de
 * tema, e um `generateViewport` que lê cookies bloqueia a rota inteira (o
 * viewport não pode ser transmitido em stream — ver docs do Next em
 * generate-viewport.md). O tema sai como <meta> no <head> logo abaixo, onde o
 * cookie já foi resolvido de graça pelo próprio layout.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom continua liberado: travar em `userScalable: false` quebra acessibilidade
  // e é justamente quem precisa ler validade em letra miúda que dá o pinch.
  maximumScale: 5,
  // Habilita env(safe-area-inset-*) — a barra inferior do mobile e o modo
  // quiosque do totem dependem disso para não ficar embaixo do notch.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Tema vem do cookie (escrito pelo ThemeToggle) e é aplicado no servidor —
  // sem flash, sem script inline no cliente. Sem cookie, o padrão é CLARO: não
  // seguimos o prefers-color-scheme do sistema, senão quem tem o SO no escuro
  // entrava no escuro sem ter escolhido.
  const cookieTheme = (await cookies()).get("theme")?.value;
  const dataTheme = cookieTheme === "dark" ? "dark" : "light";

  // Barra de status do app instalado e chrome nativo (scrollbar, campos) seguem
  // o tema ESCOLHIDO, não o do sistema — senão quem forçou claro num celular no
  // escuro veria uma faixa preta em cima de uma tela branca. Valores espelham
  // --surface de globals.css.
  const themeColor = dataTheme === "dark" ? "#16191e" : "#ffffff";

  return (
    <html lang="pt-BR" data-theme={dataTheme} className="h-full" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={themeColor} />
        <meta name="color-scheme" content={dataTheme} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable} min-h-full flex flex-col antialiased`}
        suppressHydrationWarning
      >
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
