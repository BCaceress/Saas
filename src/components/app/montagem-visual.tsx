"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { volumeDasCamadas, type CamadaMontagem } from "@/lib/montagem";

export type { CamadaMontagem };

/**
 * Representação visual da montagem no PDV (PRD Fase 4 §4).
 *
 * O operador precisa VER o que cada escolha coloca no pedido, não só ler uma
 * lista: no drink, cada opção escolhida é uma camada no copo, com altura
 * proporcional à dose; no kit, cada unidade é um vão da caixa. Passar da
 * capacidade do copo acende aviso — o caixa descobre o transbordo antes de
 * cobrar, não na hora de servir.
 *
 * A cor é da camada (identidade dentro da montagem), nunca da marca: sai dos
 * tokens `--camada-N` de `globals.css`.
 */

const NUM_CAMADAS = 6;

/** Cor estável por componente: mesmo produto, mesma faixa, sempre. */
function corDaCamada(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return `var(--camada-${(h % NUM_CAMADAS) + 1})`;
}

/** Ordem física no copo: xarope/denso embaixo, gelo por cima. */
function pesoNoCopo(c: CamadaMontagem): number {
  if (c.unidade === "G") return 0;
  return c.fixo ? 1 : 2;
}

const fmtMl = (n: number) => `${Math.round(n)} ml`;

export function MontagemVisual({
  modo,
  camadas,
  capacidadeMl,
  tamanhoNome,
  className,
}: {
  modo: "copo" | "bandeja";
  camadas: CamadaMontagem[];
  /** Capacidade do copo em ml (variação ou cadastro). null = sem baliza. */
  capacidadeMl: number | null;
  tamanhoNome: string | null;
  className?: string;
}) {
  if (modo === "bandeja") {
    return (
      <Bandeja camadas={camadas} tamanhoNome={tamanhoNome} className={className} />
    );
  }
  return (
    <Copo
      camadas={camadas}
      capacidadeMl={capacidadeMl}
      tamanhoNome={tamanhoNome}
      className={className}
    />
  );
}

// ── Copo (drink) ────────────────────────────────────────────

function Copo({
  camadas,
  capacidadeMl,
  tamanhoNome,
  className,
}: {
  camadas: CamadaMontagem[];
  capacidadeMl: number | null;
  tamanhoNome: string | null;
  className?: string;
}) {
  const { liquidos, enfeites, volume, base, transbordou } = useMemo(() => {
    const liq = camadas
      .filter((c) => c.unidade !== "UN" && c.quantidade > 0)
      .sort((a, b) => pesoNoCopo(a) - pesoNoCopo(b));
    // UN dentro de um drink é guarnição: entra na borda, não ocupa volume.
    const enf = camadas.filter((c) => c.unidade === "UN");
    const vol = volumeDasCamadas(camadas);
    const cap = capacidadeMl && capacidadeMl > 0 ? capacidadeMl : null;
    const estourou = cap != null && vol > cap;
    return {
      liquidos: liq,
      enfeites: enf,
      volume: vol,
      base: estourou || cap == null ? vol : cap,
      transbordou: estourou,
    };
  }, [camadas, capacidadeMl]);

  const temConteudo = liquidos.length > 0 || enfeites.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-stretch justify-center gap-2.5">
        {/* Régua de ml */}
        <div className="flex w-12 flex-col items-end justify-between py-0.5">
          {[4, 3, 2, 1, 0].map((k) => (
            <span
              key={k}
              className="flex items-center gap-1 font-mono text-[10px] text-faint tnum"
            >
              {base > 0 ? Math.round((base * k) / 4) : 0}
              {k === 4 ? " ml" : ""}
              <span className="block h-px w-1.5 bg-line-strong" />
            </span>
          ))}
        </div>

        {/* Copo */}
        <div className="relative h-[168px] w-[124px]">
          {/* boca */}
          <div className="absolute -top-[3px] left-[3px] right-[3px] h-2.5 rounded-[50%] border border-line-strong bg-surface-2" />
          {/* parede */}
          <div
            className="absolute inset-x-0 bottom-0 top-[3px] bg-line-strong"
            style={{ clipPath: "polygon(3% 0, 97% 0, 85% 100%, 15% 100%)" }}
          />
          {/* interior + camadas */}
          <div
            className="absolute bottom-[2px] left-[2px] right-[2px] top-[5px] flex flex-col-reverse overflow-hidden bg-surface"
            style={{ clipPath: "polygon(3% 0, 97% 0, 85% 100%, 15% 100%)" }}
          >
            {liquidos.map((c) => (
              <div
                key={c.componentProductId}
                className="shrink-0 border-t border-white/50"
                style={{
                  height: `${base > 0 ? (c.quantidade / base) * 100 : 0}%`,
                  background: corDaCamada(c.componentProductId),
                }}
                title={`${c.nome} — ${fmtMl(c.quantidade)}`}
              />
            ))}
          </div>
          {/* brilho */}
          <div className="pointer-events-none absolute bottom-3.5 left-[17%] top-3 w-[9%] rounded-full bg-gradient-to-b from-white/70 to-white/5" />
          {/* guarnição na borda */}
          {enfeites.length > 0 && (
            <span
              className="absolute -top-2.5 right-2 h-6 w-6 rounded-full border-[3px] border-surface"
              style={{ background: corDaCamada(enfeites[0].componentProductId) }}
              title={enfeites.map((e) => e.nome).join(" + ")}
            />
          )}
        </div>
      </div>

      {/* Medidor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-lg font-bold text-ink tnum">{fmtMl(volume)}</span>
          {capacidadeMl ? (
            <span className="text-[11px] text-muted">
              de {fmtMl(capacidadeMl)}
              {tamanhoNome ? ` · copo ${tamanhoNome}` : ""}
            </span>
          ) : (
            <span className="text-[11px] text-muted">no copo</span>
          )}
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
          {liquidos.map((c) => (
            <span
              key={c.componentProductId}
              className="block h-full"
              style={{
                width: `${base > 0 ? (c.quantidade / base) * 100 : 0}%`,
                background: corDaCamada(c.componentProductId),
              }}
            />
          ))}
        </div>
        {transbordou && capacidadeMl != null && (
          <p className="flex items-start gap-1.5 text-[11px] text-warn">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            Passa do copo em {fmtMl(volume - capacidadeMl)} — suba o tamanho ou tire um
            adicional.
          </p>
        )}
      </div>

      {temConteudo && <ListaCamadas camadas={[...liquidos, ...enfeites]} modo="copo" />}
    </div>
  );
}

// ── Bandeja (kit/combo) ─────────────────────────────────────

function Bandeja({
  camadas,
  tamanhoNome,
  className,
}: {
  camadas: CamadaMontagem[];
  tamanhoNome: string | null;
  className?: string;
}) {
  // Cada unidade ocupa um vão. Fracionado (ML/G) não existe em kit, mas se
  // aparecer entra como um vão só, com a quantidade no rótulo.
  const vaos = useMemo(
    () =>
      camadas.flatMap((c) => {
        const n = c.unidade === "UN" ? Math.max(1, Math.round(c.quantidade)) : 1;
        return Array.from({ length: Math.min(n, 24) }, (_, k) => ({
          key: `${c.componentProductId}-${k}`,
          camada: c,
        }));
      }),
    [camadas],
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="rounded-[var(--radius-lg)] border border-line-strong bg-surface p-2.5">
        {vaos.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted">
            A caixa está vazia — escolha os itens do kit.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {vaos.map(({ key, camada }) => (
              <div
                key={key}
                className="grid h-[76px] place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 px-1 py-1.5"
                title={camada.nome}
              >
                <span className="flex flex-col items-center gap-1">
                  {/* garrafa: gargalo + corpo; demais formas, só o corpo */}
                  <span className="relative block h-11 w-7">
                    <span
                      className="absolute left-1/2 top-0 h-3.5 w-2 -translate-x-1/2 rounded-t-[2px]"
                      style={{ background: corDaCamada(camada.componentProductId) }}
                    />
                    <span
                      className="absolute bottom-0 left-1/2 h-8 w-5 -translate-x-1/2 rounded-[4px]"
                      style={{ background: corDaCamada(camada.componentProductId) }}
                    />
                    <span className="absolute bottom-2.5 left-1/2 h-2 w-5 -translate-x-1/2 bg-surface/70" />
                  </span>
                  <span className="line-clamp-2 text-center font-mono text-[8px] leading-tight text-muted">
                    {camada.nome}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-bold text-ink tnum">{vaos.length}</span>
        <span className="text-[11px] text-muted">
          {vaos.length === 1 ? "item na caixa" : "itens na caixa"}
          {tamanhoNome ? ` · ${tamanhoNome}` : ""}
        </span>
      </div>

      {camadas.length > 0 && <ListaCamadas camadas={camadas} modo="bandeja" />}
    </div>
  );
}

// ── Lista das camadas ───────────────────────────────────────

function ListaCamadas({
  camadas,
  modo,
}: {
  camadas: CamadaMontagem[];
  modo: "copo" | "bandeja";
}) {
  return (
    <div className="flex flex-col">
      {camadas.map((c) => (
        <div
          key={`${c.componentProductId}-${c.fixo ? "f" : "e"}`}
          className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0"
        >
          <span
            className="h-3 w-3 shrink-0 rounded-[4px] border border-line"
            style={{ background: corDaCamada(c.componentProductId) }}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{c.nome}</span>
          {c.fixo && (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-faint">
              fixo
            </span>
          )}
          <span className="shrink-0 font-mono text-[11px] text-muted tnum">
            {modo === "copo" && c.unidade !== "UN"
              ? fmtMl(c.quantidade)
              : `${c.quantidade}×`}
          </span>
        </div>
      ))}
    </div>
  );
}
