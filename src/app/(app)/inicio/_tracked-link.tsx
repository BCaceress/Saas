"use client";

import Link from "next/link";
import { registrarFeedbackInsight } from "./actions";

/** Link que dispara o feedback "CLICADO" (fire-and-forget) antes de navegar — nunca bloqueia o clique. */
export function TrackedLink({
  insightId,
  href,
  className,
  style,
  children,
}: {
  insightId: string;
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      style={style}
      onClick={() => void registrarFeedbackInsight(insightId, "CLICADO")}
    >
      {children}
    </Link>
  );
}
