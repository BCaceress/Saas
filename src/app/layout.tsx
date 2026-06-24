import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
  title: "NoHub Market — ERP para mercados de bebidas",
  description:
    "Controle de produtos, estoque e perdas para mercados autônomos, conveniências e mercadinhos. Teste grátis por 14 dias.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Tema vem do cookie (escrito pelo ThemeToggle) e é aplicado no servidor —
  // sem flash, sem script inline no cliente.
  const cookieTheme = (await cookies()).get("theme")?.value;
  const dataTheme = cookieTheme === "dark" || cookieTheme === "light" ? cookieTheme : undefined;

  return (
    <html lang="pt-BR" data-theme={dataTheme} className="h-full" suppressHydrationWarning>
      <head />
      <body
        className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable} min-h-full flex flex-col antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
