import { Toaster } from "@/components/ui/toast";

// Quiosque: sem AppShell (sidebar/navbar) — o dispositivo fica dedicado ao totem.
export default function TotemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      {children}
      <Toaster />
    </div>
  );
}
