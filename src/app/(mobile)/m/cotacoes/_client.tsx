"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Handshake, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { MCard, MCardLink } from "@/components/mobile/ui";
import type { CotacaoRow } from "@/app/(app)/cotacoes/_compra-types";
import { andamento, statusVisivel } from "@/app/(app)/cotacoes/_status";
import { criarCotacaoAction } from "@/app/(app)/cotacoes/_compra-actions";

// ── Lista de cotações (celular) ─────────────────────────────
// Cartão em vez de linha: o que interessa em movimento é o estado (quantos
// responderam) e o relógio (quanto falta), e isso não cabe numa linha de 390px
// sem virar sopa de letra.

const FILTROS = [
  { id: "ativas", label: "Ativas" },
  { id: "RASCUNHO", label: "Rascunhos" },
  { id: "ABERTA", label: "Aguardando" },
  { id: "todas", label: "Todas" },
] as const;

type Filtro = (typeof FILTROS)[number]["id"];

export function CotacoesMobile({
  linhas,
  podePedir,
}: {
  linhas: CotacaoRow[];
  podePedir: boolean;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = React.useState<Filtro>("ativas");
  const [criando, setCriando] = React.useState(false);

  const visiveis = linhas.filter((l) => {
    if (filtro === "todas") return true;
    if (filtro === "ativas") return l.status === "RASCUNHO" || l.status === "ABERTA";
    return l.status === filtro;
  });

  async function nova() {
    if (criando) return;
    setCriando(true);
    try {
      const criada = await criarCotacaoAction({});
      router.push(`/m/cotacoes/${criada.id}`);
    } catch (e) {
      toast.error(
        "Não foi possível abrir a cotação",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
      setCriando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium",
              filtro === f.id
                ? "border-transparent bg-brand text-on-brand"
                : "border-line-button bg-surface text-ink-2",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <MCard className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
            <Handshake className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">
            {filtro === "todas" ? "Você ainda não tem cotações" : "Nada por aqui"}
          </p>
          <p className="text-[13px] text-muted">
            Monte a lista do que falta e deixe os fornecedores disputarem o preço.
          </p>
        </MCard>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((l) => {
            const rotulo = statusVisivel(
              l.status,
              l.totalConvidados,
              l.totalRespondidos,
              l.totalRecusados,
            );
            return (
              <li key={l.id}>
                <MCardLink href={`/m/cotacoes/${l.id}`} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-muted">
                        {l.numero}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          rotulo.classe,
                        )}
                      >
                        {rotulo.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-display text-[15px] font-semibold text-ink">
                      {l.titulo}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {l.totalItens} {l.totalItens === 1 ? "item" : "itens"}
                      {l.status === "ABERTA"
                        ? ` · ${andamento(l.totalConvidados, l.totalRespondidos)}`
                        : ` · ${l.siteNome}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                </MCardLink>
              </li>
            );
          })}
        </ul>
      )}

      {podePedir && (
        <div className="sticky bottom-24 z-10">
          <Button onClick={nova} disabled={criando} size="lg" className="w-full">
            {criando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {criando ? "Abrindo…" : "Nova cotação"}
          </Button>
        </div>
      )}
    </div>
  );
}
