"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  CornerDownLeft,
  Loader2,
  Wine,
  PackageOpen,
  Plus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { semAcento } from "@/lib/normalize";
import {
  NAV_GROUPS,
  itemVisivel,
  type NavItem,
  type NavToggles,
} from "@/components/app/nav-config";
import {
  ProductSidePanel,
  TIPO_LABEL,
} from "@/components/app/product-side-panel";
import { searchProducts } from "@/app/(app)/produtos/actions";
import type { ProductRow } from "@/app/(app)/produtos/_types";
import type { Acesso, Permissao } from "@/lib/permissoes";
import { podeEmAlguma } from "@/lib/permissoes";

/**
 * Paleta de comandos (Ctrl/⌘+K). O app tem mais telas do que cabe num menu:
 * a sidebar mostra o caminho principal e a paleta alcança o resto — inclusive
 * o que está marcado como `ocultoNoMenu`, que existe justamente para isso.
 *
 * Fonte dos destinos é o mesmo `nav-config` do menu, filtrado pelas mesmas
 * permissões: a paleta nunca oferece uma tela que o guard vai negar.
 */

type Destino = {
  id: string;
  label: string;
  /** Trilha até o item: "Estoque › Validade". */
  trilha: string;
  descricao?: string;
  icon: LucideIcon;
  href: string;
};

type Acao = {
  id: string;
  label: string;
  descricao: string;
  icon: LucideIcon;
  href: string;
  permissao?: Permissao;
};

const ACOES: Acao[] = [
  {
    id: "acao:produto",
    label: "Novo produto",
    descricao: "Cadastrar um item simples no catálogo.",
    icon: Plus,
    href: "/produtos/novo/simples",
    permissao: "produto.editar",
  },
  {
    id: "acao:venda",
    label: "Abrir o PDV",
    descricao: "Registrar uma venda agora.",
    icon: Plus,
    href: "/vendas",
    permissao: "venda.registrar",
  },
  {
    id: "acao:ajuste",
    label: "Ajustar estoque",
    descricao: "Corrigir saldo com motivo registrado.",
    icon: Plus,
    href: "/estoque/ajustes",
    permissao: "estoque.ajustar",
  },
  {
    id: "acao:pedido",
    label: "Novo pedido de compra",
    descricao: "Pedir mercadoria a um fornecedor.",
    icon: Plus,
    href: "/compras/pedidos",
    permissao: "compras.pedir",
  },
  {
    id: "acao:consulta",
    label: "Perguntar aos dados",
    descricao: "Montar um relatório do zero e levar em CSV ou PDF.",
    icon: Sparkles,
    href: "/relatorios/consulta",
    permissao: "relatorio.ver",
  },
];

/** Destinos que este operador realmente pode abrir, com a trilha montada. */
function montarDestinos(acessos: Acesso[], toggles: NavToggles): Destino[] {
  const out: Destino[] = [];
  const push = (item: NavItem, pai?: NavItem) => {
    if (!item.enabled || !itemVisivel(item, acessos, toggles)) return;
    out.push({
      id: `${pai?.href ?? ""}${item.href}`,
      label: item.label,
      trilha: pai ? `${pai.label} › ${item.label}` : item.label,
      descricao: item.descricao,
      icon: item.icon,
      href: item.href,
    });
  };

  for (const grupo of NAV_GROUPS) {
    for (const item of grupo.items) {
      // Pai de gaveta é rótulo, não destino — quem entra escolhe a filha.
      // Salvo quando o pai é tela ele mesmo (`indice`), como /relatorios.
      if (item.children) {
        if (!itemVisivel(item, acessos, toggles)) continue;
        if (item.indice) push(item);
        for (const filha of item.children) push(filha, item);
      } else {
        push(item);
      }
    }
  }
  return out;
}

type Linha =
  | { tipo: "destino"; chave: string; destino: Destino }
  | { tipo: "acao"; chave: string; acao: Acao }
  | { tipo: "produto"; chave: string; produto: ProductRow };

export function CommandPalette({
  open,
  onClose,
  acessos,
  toggles,
}: {
  open: boolean;
  onClose: () => void;
  acessos: Acesso[];
  toggles: NavToggles;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [produtos, setProdutos] = React.useState<ProductRow[]>([]);
  const [buscando, setBuscando] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const [selecionado, setSelecionado] = React.useState<ProductRow | null>(null);
  const debounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const listaRef = React.useRef<HTMLDivElement>(null);

  const destinos = React.useMemo(
    () => montarDestinos(acessos, toggles),
    [acessos, toggles],
  );
  const acoes = React.useMemo(
    () =>
      ACOES.filter((a) => !a.permissao || podeEmAlguma(acessos, a.permissao)),
    [acessos],
  );

  // Reabrir sempre começa limpo: a paleta é um salto, não um histórico.
  // Ajuste durante o render (mesmo padrão da gaveta do menu) — sem effect e
  // sem render em cascata.
  const [abertaAntes, setAbertaAntes] = React.useState(open);
  if (abertaAntes !== open) {
    setAbertaAntes(open);
    setQ("");
    setProdutos([]);
    setCursor(0);
  }

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Produto vem do banco; nav e ações são locais e filtram na hora.
  React.useEffect(() => {
    const termo = q.trim();
    if (!open || termo.length < 2) return;

    let vivo = true;
    debounce.current = setTimeout(() => {
      setBuscando(true);
      searchProducts(termo)
        .then((rows) => vivo && setProdutos(rows.slice(0, 6)))
        .catch(() => vivo && setProdutos([]))
        .finally(() => vivo && setBuscando(false));
    }, 250);

    return () => {
      vivo = false;
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, open]);

  // Termo curto não zera o estado — só deixa de mostrar. Assim o efeito acima
  // não precisa de `setState` síncrono, que dispara render em cascata.
  const produtosVisiveis = React.useMemo(
    () => (q.trim().length < 2 ? [] : produtos),
    [q, produtos],
  );

  const termo = semAcento(q);
  const casa = (...campos: (string | undefined)[]) =>
    termo === "" || campos.some((c) => c && semAcento(c).includes(termo));

  const destinosFiltrados = React.useMemo(
    () => destinos.filter((d) => casa(d.trilha, d.descricao)).slice(0, 8),
    // `casa` depende só de `termo`, que já está na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinos, termo],
  );
  const acoesFiltradas = React.useMemo(
    () =>
      termo === "" ? acoes.slice(0, 3) : acoes.filter((a) => casa(a.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acoes, termo],
  );

  // Lista achatada: é sobre ela que as setas andam, ignorando os títulos.
  const linhas = React.useMemo<Linha[]>(
    () => [
      ...destinosFiltrados.map((d) => ({
        tipo: "destino" as const,
        chave: d.id,
        destino: d,
      })),
      ...produtosVisiveis.map((p) => ({
        tipo: "produto" as const,
        chave: `produto:${p.id}`,
        produto: p,
      })),
      ...acoesFiltradas.map((a) => ({
        tipo: "acao" as const,
        chave: a.id,
        acao: a,
      })),
    ],
    [destinosFiltrados, produtosVisiveis, acoesFiltradas],
  );

  // Lista mudou, o destaque volta pro topo — quem acabou de digitar quer o
  // primeiro resultado, não a posição antiga.
  const [totalAntes, setTotalAntes] = React.useState(linhas.length);
  if (totalAntes !== linhas.length) {
    setTotalAntes(linhas.length);
    setCursor(0);
  }

  const executar = React.useCallback(
    (linha: Linha) => {
      if (linha.tipo === "produto") {
        // O painel de produto já existe e é a resposta certa aqui: quem busca
        // um SKU quer ver a ficha, não trocar de tela.
        setSelecionado(linha.produto);
        onClose();
        return;
      }
      onClose();
      router.push(
        linha.tipo === "destino" ? linha.destino.href : linha.acao.href,
      );
    },
    [onClose, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (linhas.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % linhas.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + linhas.length) % linhas.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      executar(linhas[cursor]);
    }
  }

  // Mantém a opção destacada dentro da área visível ao andar com as setas.
  React.useEffect(() => {
    listaRef.current
      ?.querySelector('[data-ativo="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-70 flex items-start justify-center p-4 pt-[10vh] print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar e navegar"
        >
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[fade_120ms_ease-out]"
            onClick={onClose}
            aria-hidden
          />

          <div className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)]">
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4">
              <Search size={18} className="shrink-0 text-faint" aria-hidden />
              {/* Foco no campo ao abrir: a paleta só existe para ser digitada. */}
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar tela, produto ou ação…"
                aria-label="Buscar tela, produto ou ação"
                aria-activedescendant={linhas[cursor]?.chave}
                className="h-14 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none"
              />
              {buscando && (
                <Loader2 size={16} className="animate-spin text-faint" />
              )}
            </div>

            <div
              ref={listaRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
            >
              {linhas.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-muted">
                  Nada encontrado para{" "}
                  <span className="font-medium text-ink">{q}</span>.
                </p>
              ) : (
                linhas.map((linha, i) => (
                  <React.Fragment key={linha.chave}>
                    {(i === 0 || linhas[i - 1].tipo !== linha.tipo) && (
                      <Secao titulo={SECAO_LABEL[linha.tipo]} />
                    )}
                    <Opcao
                      linha={linha}
                      ativo={i === cursor}
                      onHover={() => setCursor(i)}
                      onClick={() => executar(linha)}
                    />
                  </React.Fragment>
                ))
              )}
            </div>

            <div className="flex shrink-0 items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
              <span className="flex items-center gap-1">
                <Tecla>↑</Tecla>
                <Tecla>↓</Tecla> navegar
              </span>
              <span className="flex items-center gap-1">
                <Tecla>
                  <CornerDownLeft size={10} />
                </Tecla>{" "}
                abrir
              </span>
              <span className="flex items-center gap-1">
                <Tecla>Esc</Tecla> fechar
              </span>
            </div>
          </div>

          <style>{`@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
            @media (prefers-reduced-motion: reduce) {
              .animate-\\[fade_120ms_ease-out\\] { animation: none !important }
            }`}</style>
        </div>
      )}

      {selecionado && (
        <ProductSidePanel
          key={selecionado.id}
          product={selecionado}
          onClose={() => setSelecionado(null)}
          onEdit={() => router.push(`/produtos/${selecionado.id}/editar`)}
        />
      )}
    </>
  );
}

const SECAO_LABEL: Record<Linha["tipo"], string> = {
  destino: "Ir para",
  produto: "Produtos",
  acao: "Ações",
};

function Secao({ titulo }: { titulo: string }) {
  return (
    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-faint">
      {titulo}
    </p>
  );
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[10px] text-muted">
      {children}
    </kbd>
  );
}

function Opcao({
  linha,
  ativo,
  onHover,
  onClick,
}: {
  linha: Linha;
  ativo: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const base = cn(
    "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
    ativo ? "bg-brand-soft text-brand" : "text-ink hover:bg-surface-2",
  );

  if (linha.tipo === "produto") {
    const p = linha.produto;
    return (
      <button
        type="button"
        id={linha.chave}
        data-ativo={ativo}
        onMouseMove={onHover}
        onClick={onClick}
        className={base}
      >
        {p.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imagemUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-[var(--radius-sm)] border border-line object-cover"
          />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
            {p.tipo === "INSUMO" ? (
              <PackageOpen size={15} />
            ) : (
              <Wine size={15} />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.nome}</span>
          <span className="block truncate text-xs text-muted">
            {TIPO_LABEL[p.tipo]} · <span className="font-mono">{p.sku}</span>
          </span>
        </span>
        {p.precoVenda != null && (
          <span className="shrink-0 font-mono text-xs text-muted">
            {brl(p.precoVenda)}
          </span>
        )}
      </button>
    );
  }

  const {
    icon: Icone,
    label,
    descricao,
  } = linha.tipo === "destino"
    ? {
        icon: linha.destino.icon,
        label: linha.destino.trilha,
        descricao: linha.destino.descricao,
      }
    : {
        icon: linha.acao.icon,
        label: linha.acao.label,
        descricao: linha.acao.descricao,
      };

  return (
    <button
      type="button"
      id={linha.chave}
      data-ativo={ativo}
      onMouseMove={onHover}
      onClick={onClick}
      className={base}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-muted">
        <Icone size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {descricao && (
          <span className="block truncate text-xs text-muted">{descricao}</span>
        )}
      </span>
    </button>
  );
}
