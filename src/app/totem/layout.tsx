import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toast";

/**
 * Manifest próprio (ver `manifest.webmanifest/route.ts`): instalado a partir
 * daqui, o quiosque vira um app à parte que abre em `display: fullscreen` — sem
 * barra de navegação E sem barra de status. É o único caminho para tela cheia
 * de verdade num tablet Android sem modo quiosque do sistema.
 */
export const metadata: Metadata = {
  manifest: "/totem/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Autoatendimento", statusBarStyle: "black-translucent" },
};

// Quiosque: sem AppShell (sidebar/navbar) — o dispositivo fica dedicado ao totem.
export default function TotemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      {children}
      <Toaster />
    </div>
  );
}
