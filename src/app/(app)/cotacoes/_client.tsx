"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Copy,
  FileQuestion,
  LayoutGrid,
  List,
  MoreVertical,
  Package,
  Plus,
  Sparkles,
  Trash2,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { EstadoVazio, fmtMoney } from "./_catalogo/ui";
import {
  criarCotacaoAction,
  duplicarCotacaoAction,
  excluirCotacaoAction,
} from "./_compra-actions";
import type { CotacaoRow, CotacaoStatus } from "./_compra-types";
import { statusVisivel } from "./_status";

// ── Lista de cotações ───────────────────────────────────────
// A cotação é uma pergunta que envelhece: o que importa na lista é o tamanho
// dela (itens), quem foi consultado (fornecedores) e quanto tempo resta. Esses
// três viram ícone + número, porque em lista longa a pessoa varre a coluna, não
// lê a frase.
//
// Duas visões porque são dois usos: LISTA para varrer muitas cotações
// (densidade), CARTÕES para olhar poucas com calma (o número grande da melhor
// proposta aparece inteiro). CARTÕES é o padrão — quem tem poucas cotações é a
// maioria. A escolha fica guardada em cookie e volta na próxima visita.

export type Visao = "lista" | "cards";

/** Nome do cookie que guarda o formato escolhido. Lido em `page.tsx`. */
export const COOKIE_VISAO = "nohub-cotacoes-visao";

const FILTROS: { id: "ativas" | "todas" | CotacaoStatus; label: string }[] = [
  { id: "ativas", label: "Ativas" },
  { id: "RASCUNHO", label: "Rascunhos" },
  { id: "ABERTA", label: "Aguardando resposta" },
  { id: "DECIDIDA", label: "Viraram pedido" },
  { id: "todas", label: "Todas" },
];

/** Quanto tempo resta — o que decide se dá para esperar mais um dia. */
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
  descricao,
  visaoInicial,
}: {
  linhas: CotacaoRow[];
  /** Contagem ao vivo de `loadSugestoesReposicao` — mesma fonte da Reposição Inteligente. */
  produtosSugeridos: number;
  /** Mais de uma loja no tenant. Com uma só, dizer o nome dela é ruído. */
  multiSite: boolean;
  podePedir: boolean;
  descricao?: string;
  /** Formato que a pessoa escolheu da última vez (cookie, lido no servidor). */
  visaoInicial: Visao;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["id"]>("ativas");
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<CotacaoRow | null>(null);

  // Guardar em COOKIE e não em localStorage: assim o servidor já renderiza no
  // formato certo. Com localStorage, a primeira pintura viria sempre em lista e
  // trocaria na frente da pessoa (ou quebraria a hidratação).
  function escolherVisao(nova: Visao) {
    setVisao(nova);
    document.cookie = `${COOKIE_VISAO}=${nova}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }

  const visiveis = linhas.filter((l) => {
    if (filtro === "todas") return true;
    if (filtro === "ativas") return l.status === "RASCUNHO" || l.status === "ABERTA";
    return l.status === filtro;
  });

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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Cotações"
        icon={navIcon("/cotacoes")}
        description={descricao}
        innerClassName="max-w-none"
        actions={
          podePedir ? (
            <div className="flex items-center gap-2">
              <Link
                href="/cotacoes/reposicao-inteligente"
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                <Sparkles size={15} className="text-muted" />
                <span className="hidden sm:inline">Sugestão de reposição</span>
                {produtosSugeridos > 0 && (
                  <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-accent">
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
          ) : undefined
        }
      />

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

        <div
          role="group"
          aria-label="Formato da lista"
          className="flex gap-0.5 rounded-full border border-line bg-surface p-0.5"
        >
          <BotaoVisao
            ativo={visao === "lista"}
            onClick={() => escolherVisao("lista")}
            rotulo="Ver em lista"
          >
            <List size={15} />
          </BotaoVisao>
          <BotaoVisao
            ativo={visao === "cards"}
            onClick={() => escolherVisao("cards")}
            rotulo="Ver em cartões"
          >
            <LayoutGrid size={15} />
          </BotaoVisao>
        </div>
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
        <ul
          className={cn(
            visao === "lista"
              ? "flex flex-col gap-2"
              : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {visiveis.map((l, indice) => (
            <li key={l.id} className="group relative">
              {visao === "lista" ? (
                <LinhaCotacao linha={l} multiSite={multiSite} />
              ) : (
                <CartaoCotacao linha={l} multiSite={multiSite} />
              )}

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
                  emCartao={visao === "cards"}
                  /* As duas últimas linhas abrem o menu para CIMA: para baixo
                     ele passaria do fim da lista e ficaria cortado. */
                  paraCima={
                    visao === "lista" &&
                    indice >= visiveis.length - 2 &&
                    visiveis.length > 2
                  }
                />
              )}
            </li>
          ))}
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

function BotaoVisao({
  ativo,
  onClick,
  rotulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full transition-colors",
        ativo ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ── Dados que as duas visões compartilham ───────────────────

/** Itens · fornecedores · prazo, cada um com seu ícone. */
function Metadados({
  linha,
  multiSite,
}: {
  linha: CotacaoRow;
  multiSite: boolean;
}) {
  const prazo = linha.status === "ABERTA" ? prazoTexto(linha.prazoResposta) : null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      <span className="inline-flex items-center gap-1">
        <Package size={13} className="text-faint" />
        {linha.totalItens} {linha.totalItens === 1 ? "item" : "itens"}
      </span>

      <span className="inline-flex items-center gap-1">
        <Truck size={13} className="text-faint" />
        {linha.status === "RASCUNHO" || linha.totalConvidados === 0
          ? `${linha.totalConvidados} ${linha.totalConvidados === 1 ? "fornecedor" : "fornecedores"}`
          : `${linha.totalRespondidos}/${linha.totalConvidados} responderam`}
      </span>

      {prazo && (
        <span
          className={cn("inline-flex items-center gap-1", prazo.urgente && "text-accent")}
        >
          <CalendarClock size={13} className={cn(!prazo.urgente && "text-faint")} />
          {prazo.texto}
        </span>
      )}

      {multiSite && <span className="truncate">{linha.siteNome}</span>}
    </p>
  );
}

function Identificacao({ linha, espalhar }: { linha: CotacaoRow; espalhar?: boolean }) {
  const rotulo = statusVisivel(
    linha.status,
    linha.totalConvidados,
    linha.totalRespondidos,
    linha.totalRecusados,
  );
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        espalhar ? "justify-between" : "flex-wrap",
      )}
    >
      <span className="font-mono text-[12px] font-semibold text-muted">{linha.numero}</span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          rotulo.classe,
        )}
      >
        {rotulo.label}
      </span>
    </div>
  );
}

function LinhaCotacao({ linha, multiSite }: { linha: CotacaoRow; multiSite: boolean }) {
  return (
    <Link
      href={`/cotacoes/${linha.id}`}
      className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5 transition-colors hover:border-brand"
    >
      <div className="min-w-0 flex-1">
        <Identificacao linha={linha} />
        <p className="mt-0.5 truncate font-display text-[15px] font-semibold text-ink">
          {linha.titulo}
        </p>
        <div className="mt-1">
          <Metadados linha={linha} multiSite={multiSite} />
        </div>
      </div>

      <div className="hidden w-28 shrink-0 text-right md:block">
        {linha.melhorTotal !== null && (
          <>
            <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">
              {fmtMoney(linha.melhorTotal)}
            </p>
            <p className="text-[11px] text-faint">melhor proposta</p>
          </>
        )}
      </div>

      {/* Espaço do menu de ações: ele mora fora do link (senão abriria a
          cotação junto), então a linha reserva o lugar. */}
      <span className="w-8 shrink-0" aria-hidden />
    </Link>
  );
}

function CartaoCotacao({ linha, multiSite }: { linha: CotacaoRow; multiSite: boolean }) {
  return (
    <Link
      href={`/cotacoes/${linha.id}`}
      className="flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-4 transition-colors hover:border-brand"
    >
      <Identificacao linha={linha} espalhar />
      <p className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink">
        {linha.titulo}
      </p>
      {/* O menu de ações mora sobre esta linha, à direita — daí o recuo. */}
      <div className="pr-9">
        <Metadados linha={linha} multiSite={multiSite} />
      </div>

      {linha.melhorTotal !== null && (
        <p className="mt-auto border-t border-line pt-2">
          <span className="font-mono text-[17px] font-semibold tabular-nums text-ink">
            {fmtMoney(linha.melhorTotal)}
          </span>
          <span className="ml-1.5 text-[11px] text-faint">melhor proposta</span>
        </p>
      )}
    </Link>
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
  emCartao,
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
  emCartao: boolean;
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
          "absolute right-3 z-40 grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50",
          emCartao ? "bottom-3" : "top-1/2 -translate-y-1/2",
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
            emCartao ? "bottom-12" : paraCima ? "bottom-1/2 mb-5" : "top-1/2 mt-5",
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
          <span className="font-mono">{cotacao.numero}</span>) e seus {cotacao.totalItens}{" "}
          {cotacao.totalItens === 1 ? "item" : "itens"} somem de vez. Isso não pode ser
          desfeito.
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
