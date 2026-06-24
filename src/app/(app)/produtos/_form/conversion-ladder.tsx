import { ArrowRight, Box, Droplets, Wine } from "lucide-react";
import { cn, brl } from "@/lib/utils";

/**
 * Escada de conversão ao vivo: compra → unidade → dose.
 * Componente de apresentação (sem estado próprio) — espelha o que o operador
 * digita no bloco "Como compro e vendo". Reaproveita a linguagem de etiqueta
 * (mono, tokens de cor) do SkuTag. Direção "vitrine": produto frio × preço âmbar.
 */
export function ConversionLadder({
  compraNome,
  compraEan,
  fator,
  unidadeEan,
  precoVenda,
  custo,
  fracionavel,
  conteudo,
  unidadeBase,
}: {
  compraNome?: string;
  compraEan?: string;
  fator?: number | null;
  unidadeEan?: string;
  precoVenda?: number | null;
  custo?: number | null;
  fracionavel?: boolean;
  conteudo?: number | null;
  unidadeBase?: "UN" | "ML" | "G";
}) {
  const temCompra = Boolean((fator ?? 0) > 0 || compraNome?.trim());
  const medida = unidadeBase === "G" ? "g" : "ml";

  // Custo por unidade de medida (R$/ml ou R$/g) — só quando há ambos.
  const custoPorMedida =
    fracionavel && custo && conteudo && conteudo > 0 ? custo / conteudo : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-3 sm:flex-row sm:items-stretch sm:gap-0"
      aria-label="Resumo de compra, venda e fracionamento"
    >
      {/* Camada 1 — Compra */}
      {temCompra && (
        <>
          <LadderNode
            icon={<Box size={15} />}
            tone="brand"
            eyebrow="Compro"
            titulo={compraNome?.trim() || "Embalagem"}
            ean={compraEan}
          />
          <LadderArrow label={fator ? `${fator} un` : "un"} />
        </>
      )}

      {/* Camada 2 — Venda da unidade */}
      <LadderNode
        icon={<Wine size={15} />}
        tone="brand"
        eyebrow="Vendo"
        titulo="Unidade"
        ean={unidadeEan}
        valor={precoVenda ? brl(precoVenda) : undefined}
      />

      {/* Camada 3 — Fração (dose) */}
      {fracionavel && (
        <>
          <LadderArrow label={conteudo ? `${conteudo} ${medida}` : medida} />
          <LadderNode
            icon={<Droplets size={15} />}
            tone="accent"
            eyebrow="Fraciono"
            titulo="Dose · drink"
            valor={
              custoPorMedida
                ? `${custoPorMedida.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}/${medida}`
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}

function LadderNode({
  icon,
  tone,
  eyebrow,
  titulo,
  ean,
  valor,
}: {
  icon: React.ReactNode;
  tone: "brand" | "accent";
  eyebrow: string;
  titulo: string;
  ean?: string;
  valor?: string;
}) {
  return (
    <div className="flex flex-1 items-start gap-2.5 rounded-[var(--radius-sm)] bg-surface px-3 py-2.5 shadow-[var(--shadow-1)]">
      <span
        className={cn(
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
          tone === "brand"
            ? "bg-brand-soft text-brand-strong"
            : "bg-accent-soft text-accent"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
          {eyebrow}
        </span>
        <p className="truncate text-[13px] font-medium text-ink">{titulo}</p>
        {ean ? (
          <p className="truncate font-mono text-[11px] text-faint">{ean}</p>
        ) : null}
        {valor ? (
          <p
            className={cn(
              "truncate font-mono text-[12px] font-semibold tabular-nums",
              tone === "accent" ? "text-accent" : "text-ink-2"
            )}
          >
            {valor}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LadderArrow({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-1 px-1 py-1 text-faint sm:flex-col sm:px-3 sm:py-0">
      <ArrowRight size={15} className="rotate-90 sm:rotate-0" aria-hidden />
      <span className="font-mono text-[10px] font-medium tracking-tight text-muted">
        {label}
      </span>
    </div>
  );
}
