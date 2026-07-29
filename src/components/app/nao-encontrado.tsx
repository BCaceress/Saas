"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tela de 404 — usada pelo `not-found.tsx` da raiz e pelo do shell autenticado.
 *
 * Cliente por causa do "Voltar" (history.back): quem chegou por link quebrado
 * dentro do app quer voltar de onde veio, não ir para a home. O link direto ao
 * início fica ao lado como saída garantida. O código 404 vira etiqueta de
 * prateleira (mono, âmbar) — mesma linguagem do SKU.
 */
export function NaoEncontrado({
  titulo = "Esta página não existe",
  descricao = "O endereço pode ter mudado de lugar ou o link veio com um erro de digitação.",
  homeHref = "/inicio",
  homeLabel = "Ir para o início",
  className,
}: {
  titulo?: string;
  descricao?: string;
  homeHref?: string;
  homeLabel?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center px-5 py-20 text-center",
        className,
      )}
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
        <PackageSearch size={24} />
      </span>

      <span className="mt-5 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-accent/30 bg-accent-soft px-2.5 py-1 font-mono text-[11px] font-medium tracking-widest text-accent uppercase">
        Erro 404
      </span>

      <h1 className="mt-3 font-display text-[22px] font-semibold tracking-tight text-ink">
        {titulo}
      </h1>
      <p className="mt-2 text-sm text-muted">{descricao}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-line-button bg-surface px-5 text-sm font-medium text-ink transition-all duration-200 hover:bg-surface-2 hover:shadow-sm"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
        <Link
          href={homeHref}
          className="inline-flex h-10 items-center justify-center rounded-full border border-transparent bg-brand px-5 text-sm font-medium text-on-brand shadow-[var(--shadow-1)] transition-all duration-200 hover:bg-brand-strong hover:shadow-md"
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
