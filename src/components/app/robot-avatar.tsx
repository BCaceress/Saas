"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Avatar do Assistente — mascote do Centro de Operações. Além do idle (respira,
 * flutua, pisca, pulsa a antena), reage ao estado real da operação: `humor`
 * muda boca e olhos, e "pensando" é o estado enquanto a IA reescreve o resumo.
 *
 * Detalhes de implementação:
 * - Keyframes vivem em globals.css (SVG repetido não duplica CSS) e o bloco
 *   `prefers-reduced-motion` de lá desliga tudo, inclusive o olhar.
 * - O glow é um div com blur em CSS, não `feGaussianBlur`: filtro SVG com
 *   opacidade animada re-rasteriza a cada frame; aqui só a opacidade anima.
 * - Fora da viewport as animações pausam (IntersectionObserver).
 */

export type RobotHumor = "calmo" | "atento" | "alerta" | "pensando";

/** Mesmo traço da boca, curvatura por humor. */
const BOCA: Record<RobotHumor, string> = {
  calmo: "M49 63 C54 68 66 68 71 63",
  atento: "M49 64 C54 67 66 67 71 64",
  alerta: "M49 66 C54 62 66 62 71 66",
  pensando: "M53 64 C57 63 63 63 67 64",
};

/**
 * Feições em cor FIXA, não token: o rosto do robô é branco nos dois temas, e
 * `--accent`/`--danger` clareiam no dark (#fb923c, #f87171) — viraria laranja
 * claro sobre branco, sem contraste. Estes são os valores do tema claro.
 */
const OLHO_COR: Record<RobotHumor, string> = {
  calmo: "#C2410C",
  atento: "#C2410C",
  pensando: "#C2410C",
  alerta: "#DC2626",
};

/** Raio (px) em que o mascote passa a acompanhar o cursor. */
const ALCANCE_OLHAR = 260;

export function RobotAvatar({
  size = 72,
  humor = "calmo",
  className,
}: {
  size?: number;
  humor?: RobotHumor;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const gradient = `robot-grad-${uid}`;
  const wrapRef = useRef<HTMLSpanElement>(null);
  const olharRef = useRef<SVGGElement>(null);
  const [pausado, setPausado] = useState(false);

  // Olhos seguem o cursor — aplicado direto no DOM (rAF) pra não re-renderizar
  // o componente a cada movimento do mouse.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;

    function mover(e: PointerEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const alvo = olharRef.current;
        const caixa = wrapRef.current?.getBoundingClientRect();
        if (!alvo || !caixa) return;
        const dx = e.clientX - (caixa.left + caixa.width / 2);
        const dy = e.clientY - (caixa.top + caixa.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < 1 || dist > ALCANCE_OLHAR) {
          alvo.style.transform = "";
          return;
        }
        const forca = Math.min(1, dist / 120);
        alvo.style.transform = `translate(${(dx / dist) * forca * 2.2}px, ${(dy / dist) * forca * 1.6}px)`;
      });
    }

    window.addEventListener("pointermove", mover);
    return () => {
      window.removeEventListener("pointermove", mover);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Pausa o idle quando o card sai da viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entrada]) => setPausado(!entrada.isIntersecting));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const olhoCor = OLHO_COR[humor];

  return (
    <span
      ref={wrapRef}
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("robot-avatar", `robot-avatar--${humor}`, pausado && "robot-avatar--pausado", className)}
    >
      <span className="robot-glow" />

      <svg viewBox="0 0 120 120" width={size} height={size} fill="none" className="relative">
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-brand)" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>

        <circle className="robot-breathe" cx="60" cy="60" r="44" fill={`url(#${gradient})`} opacity="0.12" />

        <g className="robot-head">
          <line x1="60" y1="24" x2="60" y2="34" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
          <circle className="robot-antenna" cx="60" cy="20" r="4" fill="var(--color-brand)" />

          <rect x="35" y="34" width="50" height="42" rx="16" fill="white" />

          <circle cx="31" cy="55" r="4" fill="var(--color-brand)" />
          <circle cx="89" cy="55" r="4" fill="var(--color-brand)" />

          <g ref={olharRef}>
            {humor === "pensando" ? (
              <>
                <line x1="45.5" y1="53" x2="52.5" y2="53" stroke={olhoCor} strokeWidth="3" strokeLinecap="round" />
                <line x1="67.5" y1="53" x2="74.5" y2="53" stroke={olhoCor} strokeWidth="3" strokeLinecap="round" />
              </>
            ) : (
              <>
                <circle className="robot-eye" cx="49" cy="53" r="3.5" fill={olhoCor} />
                <circle className="robot-eye" cx="71" cy="53" r="3.5" fill={olhoCor} />
              </>
            )}
          </g>

          <path
            className="robot-boca"
            d={BOCA[humor]}
            stroke={olhoCor}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />

          <rect x="45" y="82" width="30" height="12" rx="6" fill="white" />
        </g>
      </svg>
    </span>
  );
}
