"use client";

import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggle() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      className="hidden h-10 w-10 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink sm:grid cursor-pointer"
      aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
      title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
    >
      {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
}
