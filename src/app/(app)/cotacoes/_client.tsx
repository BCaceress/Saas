"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  FileQuestion,
  Send,
  Wallet,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney } from "./_catalogo/ui";
import { criarCotacaoAction } from "./_compra-actions";
import type { CotacaoRow, CotacaoStatus, ResumoCompras } from "./_compra-types";
import { andamento, statusVisivel } from "./_status";

// ── Lista de cotações ───────────────────────────────────────
// A cotação é uma pergunta que envelhece: o que importa na lista é quantos
// fornecedores já responderam e quanto tempo resta. O rótulo de status vem de
// `_status.ts` — derivado da contagem de convites, não do enum cru.
//
// "Nova cotação" não abre formulário: cria o rascunho e leva direto para os
// produtos. Nome e loja saem de padrão e ficam editáveis na revisão — pedir
// título antes da lista é cobrar uma decisão que o operador ainda não tem.

const FILTROS: { id: "ativas" | "todas" | CotacaoStatus; label: string }[] = [
  { id: "ativas", label: "Ativas" },
  { id: "RASCUNHO", label: "Rascunhos" },
  { id: "ABERTA", label: "Aguardando resposta" },
  { id: "DECIDIDA", label: "Viraram pedido" },
  { id: "todas", label: "Todas" },
];

function prazoTexto(iso: string | null): { texto: string; urgente: boolean } | null {
  if (!iso) return null;
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (dias < 0) return { texto: "Prazo vencido", urgente: true };
  if (dias === 0) return { texto: "Vence hoje", urgente: true };
  if (dias === 1) return { texto: "Vence amanhã", urgente: true };
  return { texto: `Vence em ${dias} dias`, urgente: dias <= 2 };
}

export function ListaCotacoes({
  linhas,
  resumo,
  produtosSugeridos,
  podePedir,
}: {
  linhas: CotacaoRow[];
  resumo: ResumoCompras;
  /** Contagem ao vivo de `loadSugestoesReposicao` — mesma fonte da Reposição Inteligente. */
  produtosSugeridos: number;
  podePedir: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("ativas");

  function novaCotacao() {
    setErro(null);
    startTransition(async () => {
      try {
        const criada = await criarCotacaoAction({});
        router.push(`/cotacoes/${criada.id}`);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível abrir a cotação.");
      }
    });
  }

  const visiveis = linhas.filter((l) => {
    if (filtro === "todas") return true;
    if (filtro === "ativas") return l.status === "RASCUNHO" || l.status === "ABERTA";
    return l.status === filtro;
  });

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Rascunhos"
          valor={String(resumo.planejamento)}
          icon={<FileQuestion size={13} />}
          tom="brand"
        />
        <Metrica
          label="Aguardando resposta"
          valor={String(resumo.cotando)}
          sub="cotações já enviadas aos fornecedores"
          icon={<Send size={13} />}
        />
        <Metrica
          label="Valor previsto"
          valor={fmtMoney(resumo.valorPrevisto)}
          sub="pelo melhor preço já conhecido"
          tom="ok"
          icon={<Wallet size={13} />}
        />
        <Metrica
          label="Produtos sugeridos"
          valor={String(produtosSugeridos)}
          sub="pela reposição inteligente"
          tom={produtosSugeridos > 0 ? "accent" : "ink"}
          icon={<Sparkles size={13} />}
        />
      </MetricaGrid>

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                filtro === f.id
                  ? "bg-brand text-on-brand"
                  : "border border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {podePedir && (
          <div className="flex items-center gap-2">
            <Link
              href="/cotacoes/reposicao-inteligente"
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <Sparkles size={15} className="text-muted" />
              <span className="hidden sm:inline">Sugestão de reposição</span>
            </Link>
            <button
              type="button"
              onClick={novaCotacao}
              disabled={pendente}
              className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              <Plus size={15} />
              {pendente ? "Abrindo…" : "Nova cotação"}
            </button>
          </div>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EstadoVazio
          icon={<FileQuestion size={20} />}
          titulo="Você ainda não tem cotações"
          descricao="Monte a lista do que você precisa, escolha os fornecedores e deixe eles disputarem o preço."
          acao={
            podePedir ? (
              <button
                type="button"
                onClick={novaCotacao}
                disabled={pendente}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
              >
                {pendente ? "Abrindo…" : "Criar primeira cotação"}
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((l) => {
            const prazo = l.status === "ABERTA" ? prazoTexto(l.prazoResposta) : null;
            const rotulo = statusVisivel(
              l.status,
              l.totalConvidados,
              l.totalRespondidos,
              l.totalRecusados,
            );
            const respondeuTudo = rotulo.id === "RESPONDIDA";
            return (
              <li key={l.id}>
                <Link
                  href={`/cotacoes/${l.id}`}
                  className="group flex items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-muted">
                        {l.numero}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          rotulo.classe,
                        )}
                      >
                        {rotulo.label}
                      </span>
                      {prazo && (
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            prazo.urgente ? "text-accent" : "text-faint",
                          )}
                        >
                          {prazo.texto}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-display text-[15px] font-semibold text-ink">
                      {l.titulo}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {l.totalItens} {l.totalItens === 1 ? "item" : "itens"} · {l.siteNome}
                      {l.status === "ABERTA" &&
                        ` · ${andamento(l.totalConvidados, l.totalRespondidos)}`}
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <p
                      className={cn(
                        "font-mono text-[13px] font-semibold tabular-nums",
                        respondeuTudo ? "text-ok" : "text-ink",
                      )}
                    >
                      {l.totalRespondidos}/{l.totalConvidados}
                    </p>
                    <p className="text-[11px] text-faint">responderam</p>
                  </div>

                  <div className="hidden shrink-0 text-right md:block">
                    {l.melhorTotal === null ? (
                      <p className="text-[12px] text-faint">sem proposta cheia</p>
                    ) : (
                      <>
                        <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                          {fmtMoney(l.melhorTotal)}
                        </p>
                        <p className="text-[11px] text-faint">melhor proposta</p>
                      </>
                    )}
                  </div>

                  <ChevronRight
                    size={17}
                    className="shrink-0 text-faint transition-colors group-hover:text-brand"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}
