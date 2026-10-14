import { PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { thumbSrc } from "@/lib/imagem";

// ============================================================
// Miniatura do produto do catálogo.
//
// Existe porque no recebimento a foto é o que o operador confere primeiro: o
// nome do fornecedor na nota ("REFRIG COLA 2L PET") não se parece com o nome
// do catálogo, mas a garrafa se parece com a garrafa. Um lugar só para que as
// três telas que mostram o de-para mostrem a mesma coisa do mesmo tamanho.
// ============================================================

const TAMANHOS = {
  xs: "h-7 w-7",
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-11 w-11",
  xl: "h-14 w-14",
} as const;

const ICONE = { xs: 13, sm: 13, md: 15, lg: 16, xl: 20 } as const;

/** Largura pedida ao otimizador — o dobro do tamanho na tela, para retina. */
const LARGURA_PX = { xs: 64, sm: 96, md: 96, lg: 96, xl: 128 } as const;

export function ProdutoThumb({
  url,
  nome,
  size = "md",
  className,
}: {
  url: string | null | undefined;
  /** Só para leitor de tela — visualmente o nome já está ao lado. */
  nome?: string | null;
  size?: keyof typeof TAMANHOS;
  className?: string;
}) {
  const base = cn(
    TAMANHOS[size],
    "shrink-0 rounded-[var(--radius-sm)] border border-line",
    className,
  );

  if (!url) {
    return (
      <span className={cn(base, "grid place-items-center bg-surface-2 text-faint")} aria-hidden>
        <PackageOpen size={ICONE[size]} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Foto do catálogo pode ter centenas de KB: a miniatura pede só a
      // largura que vai desenhar, e só quando aparece na tela.
      src={thumbSrc(url, LARGURA_PX[size])}
      alt={nome ?? ""}
      loading="lazy"
      decoding="async"
      className={cn(base, "bg-surface object-contain")}
    />
  );
}
