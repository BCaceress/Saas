import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// ============================================================
// Moldura dos documentos legais. Texto jurídico é lido com raiva ou com pressa
// — então: coluna estreita, entrelinha larga, títulos numerados e a data de
// vigência em cima, que é a primeira coisa que um contador procura.
// ============================================================

export function PaginaLegal({
  titulo,
  atualizadoEm,
  resumo,
  children,
}: {
  titulo: string;
  atualizadoEm: string;
  resumo: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft size={15} aria-hidden />
        Voltar ao início
      </Link>

      <h1 className="mt-6 font-display text-3xl font-bold text-ink sm:text-4xl">{titulo}</h1>
      <p className="mt-2 font-mono text-xs tracking-wide text-faint uppercase">
        Vigente desde {atualizadoEm}
      </p>
      <p className="mt-5 border-l-2 border-brand pl-4 text-[15px] leading-relaxed text-muted">
        {resumo}
      </p>

      <div className="mt-10 flex flex-col gap-8">{children}</div>
    </article>
  );
}

export function Secao({
  numero,
  titulo,
  children,
}: {
  numero: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-ink">
        <span className="mr-2 font-mono text-sm text-brand">{numero}</span>
        {titulo}
      </h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export function Lista({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-1">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
