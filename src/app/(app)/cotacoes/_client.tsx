"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Copy, FileQuestion, MoreVertical, Trash2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtMoney } from "./_catalogo/ui";
import {
  criarCotacaoAction,
  duplicarCotacaoAction,
  excluirCotacaoAction,
} from "./_compra-actions";
import type { CotacaoRow, CotacaoStatus } from "./_compra-types";
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
  produtosSugeridos,
  multiSite,
  podePedir,
}: {
  linhas: CotacaoRow[];
  /** Contagem ao vivo de `loadSugestoesReposicao` — mesma fonte da Reposição Inteligente. */
  produtosSugeridos: number;
  /** Mais de uma loja no tenant. Com uma só, dizer o nome dela é ruído. */
  multiSite: boolean;
  podePedir: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("ativas");
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<CotacaoRow | null>(null);

  function excluir(id: string) {
    setErro(null);
    startTransition(async () => {
      try {
        await excluirCotacaoAction(id);
        setAExcluir(null);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível excluir.");
      }
    });
  }

  function duplicar(id: string) {
    setErro(null);
    setMenuAberto(null);
    startTransition(async () => {
      try {
        const nova = await duplicarCotacaoAction(id);
        router.push(`/cotacoes/${nova.id}`);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível duplicar.");
      }
    });
  }

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
              {/* O card de totalizador saiu, mas o número continua valendo:
                  vive no botão que leva justamente para ele. */}
              {produtosSugeridos > 0 && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent tabular-nums">
                  {produtosSugeridos}
                </span>
              )}
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
          {visiveis.map((l, indice) => {
            const prazo = l.status === "ABERTA" ? prazoTexto(l.prazoResposta) : null;
            const rotulo = statusVisivel(
              l.status,
              l.totalConvidados,
              l.totalRespondidos,
              l.totalRecusados,
            );
            const respondeuTudo = rotulo.id === "RESPONDIDA";
            return (
              <li key={l.id} className="group relative">
                <Link
                  href={`/cotacoes/${l.id}`}
                  className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
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
                      {l.totalItens} {l.totalItens === 1 ? "item" : "itens"}
                      {multiSite && ` · ${l.siteNome}`}
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
                    <p className="text-[11px] text-faint">fornecedores responderam</p>
                  </div>

                  {/* Espaço reservado mesmo sem proposta: sem isso a coluna
                      dança de linha em linha. O vazio já diz que ninguém
                      fechou a lista inteira — escrever isso era ruído. */}
                  <div className="hidden w-28 shrink-0 text-right md:block">
                    {l.melhorTotal !== null && (
                      <>
                        <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                          {fmtMoney(l.melhorTotal)}
                        </p>
                        <p className="text-[11px] text-faint">melhor proposta</p>
                      </>
                    )}
                  </div>

                  {/* Espaço do menu de ações: ele mora fora do link (senão
                      abriria a cotação junto), então a linha reserva o lugar. */}
                  <span className="w-8 shrink-0" aria-hidden />
                </Link>

                {podePedir && (
                  <MenuLinha
                    aberto={menuAberto === l.id}
                    onAbrir={() => setMenuAberto(menuAberto === l.id ? null : l.id)}
                    onFechar={() => setMenuAberto(null)}
                    numero={l.numero}
                    pendente={pendente}
                    podeExcluir={l.status === "RASCUNHO"}
                    onDuplicar={() => duplicar(l.id)}
                    onExcluir={() => {
                      setMenuAberto(null);
                      setAExcluir(l);
                    }}
                    /* As duas últimas linhas abrem o menu para CIMA: para baixo
                       ele passaria do fim da lista e ficaria cortado. */
                    paraCima={indice >= visiveis.length - 2 && visiveis.length > 2}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {aExcluir && (
        <ConfirmarExclusao
          cotacao={aExcluir}
          pendente={pendente}
          onCancelar={() => setAExcluir(null)}
          onConfirmar={() => excluir(aExcluir.id)}
        />
      )}
    </div>
  );
}

// ── Menu da linha ───────────────────────────────────────────
// Duplicar é o atalho que a compra de mercado pede: a lista da semana passada é
// quase a desta. Excluir só existe em rascunho — cotação enviada tem promessa
// feita a fornecedor, e para ela existe cancelar.

function MenuLinha({
  aberto,
  onAbrir,
  onFechar,
  numero,
  pendente,
  podeExcluir,
  onDuplicar,
  onExcluir,
  paraCima,
}: {
  aberto: boolean;
  onAbrir: () => void;
  onFechar: () => void;
  numero: string;
  pendente: boolean;
  podeExcluir: boolean;
  onDuplicar: () => void;
  onExcluir: () => void;
  paraCima: boolean;
}) {
  return (
    <>
      {aberto && (
        // Camada invisível: um clique em qualquer lugar fecha o menu, sem
        // listener global preso ao documento.
        <div className="fixed inset-0 z-30" onClick={onFechar} aria-hidden />
      )}
      <button
        type="button"
        onClick={onAbrir}
        disabled={pendente}
        aria-label={`Ações da cotação ${numero}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={cn(
          "absolute top-1/2 right-3 z-40 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50",
          aberto && "bg-surface-2 text-ink",
        )}
      >
        <MoreVertical size={16} />
      </button>

      {aberto && (
        <div
          role="menu"
          className={cn(
            "absolute right-3 z-40 w-48 overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1 shadow-[var(--shadow-float)]",
            paraCima ? "bottom-1/2 mb-5" : "top-1/2 mt-5",
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={onDuplicar}
            disabled={pendente}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Copy size={14} className="text-muted" />
            Duplicar cotação
          </button>
          {podeExcluir && (
            <button
              type="button"
              role="menuitem"
              onClick={onExcluir}
              disabled={pendente}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 size={14} />
              Excluir rascunho
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ConfirmarExclusao({
  cotacao,
  pendente,
  onCancelar,
  onConfirmar,
}: {
  cotacao: CotacaoRow;
  pendente: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="excluir-titulo"
        className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
      >
        <h2 id="excluir-titulo" className="font-display text-[17px] font-semibold text-ink">
          Excluir rascunho
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          A cotação <span className="font-medium text-ink">{cotacao.titulo}</span> (
          <span className="font-mono">{cotacao.numero}</span>) e seus{" "}
          {cotacao.totalItens} {cotacao.totalItens === 1 ? "item" : "itens"} somem de vez. Isso
          não pode ser desfeito.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={pendente}
            className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {pendente ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </div>
    </div>
  );
}
