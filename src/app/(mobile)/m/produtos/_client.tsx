"use client";

import * as React from "react";
import Link from "next/link";
import { PackageOpen, Search } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { SaldoUn } from "@/components/mobile/saldo-unidades";
import type { ProdutoLista } from "./_data";

type Filtro = "ativos" | "todos" | "sem-estoque" | "sem-preco";

/**
 * Lista de consulta: buscar, olhar, tocar para abrir a ficha. Nenhuma ação de
 * escrita — nem "novo", nem "editar", nem ajuste de saldo. Quem precisa mexer
 * no cadastro faz isso na tela de mesa; quem precisa mexer no SALDO já tem
 * `/m/estoque`, que é onde as ações moram.
 *
 * Filtro na memória do aparelho, como em `/m/estoque`: um mercadinho tem
 * centenas de itens, e ir ao servidor a cada letra digitada custaria mais que
 * carregar a lista uma vez.
 */
export function ProdutosClient({ produtos }: { produtos: ProdutoLista[] }) {
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<Filtro>("ativos");

  const contagem = React.useMemo(
    () => ({
      ativos: produtos.filter((p) => p.ativo).length,
      todos: produtos.length,
      "sem-estoque": produtos.filter((p) => p.ativo && p.saldo != null && p.saldo <= 0).length,
      "sem-preco": produtos.filter((p) => p.ativo && p.precoVenda == null).length,
    }),
    [produtos],
  );

  // A pessoa vê preço? Sem a permissão o campo vem null do servidor para todo
  // mundo — aí o chip "sem preço" acusaria o catálogo inteiro e mentiria.
  const mostraPreco = React.useMemo(() => produtos.some((p) => p.precoVenda != null), [produtos]);

  const linhas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (
        termo &&
        !`${p.nome} ${p.sku} ${p.ean ?? ""} ${p.marca ?? ""} ${p.categoria ?? ""}`
          .toLowerCase()
          .includes(termo)
      ) {
        return false;
      }
      switch (filtro) {
        case "todos":
          return true;
        case "sem-estoque":
          return p.ativo && p.saldo != null && p.saldo <= 0;
        case "sem-preco":
          return p.ativo && p.precoVenda == null;
        default:
          return p.ativo;
      }
    });
  }, [produtos, busca, filtro]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, marca, SKU ou código"
          aria-label="Buscar produto"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip ativo={filtro === "ativos"} onClick={() => setFiltro("ativos")}>
          Ativos {contagem.ativos}
        </Chip>
        <Chip ativo={filtro === "sem-estoque"} onClick={() => setFiltro("sem-estoque")}>
          Sem estoque {contagem["sem-estoque"]}
        </Chip>
        {mostraPreco && (
          <Chip ativo={filtro === "sem-preco"} onClick={() => setFiltro("sem-preco")}>
            Sem preço {contagem["sem-preco"]}
          </Chip>
        )}
        <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos {contagem.todos}
        </Chip>
      </div>

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Nada por aqui</p>
          <p className="text-sm text-ink-2">
            {busca
              ? "Nenhum produto com esse termo. Confira o nome ou bipe o código."
              : "Nenhum produto neste filtro."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {linhas.map((p) => (
            <LinhaProduto key={p.id} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaProduto({ p }: { p: ProdutoLista }) {
  return (
    <li>
      <Card className="overflow-hidden">
        <Link
          href={`/m/produto/${p.id}`}
          className="flex items-center gap-3 p-3 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          {p.imagemUrl ? (
            /* <img> cru como no resto do app: a URL é arbitrária (Cosmos ou
               upload do tenant) e next/image exigiria allowlist por host. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.imagemUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg border border-line object-contain"
            />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
              <PackageOpen className="h-5 w-5" aria-hidden />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
            <p className="truncate text-xs text-ink-2">
              {[p.marca, p.categoria].filter(Boolean).join(" · ") || "Sem marca"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted">
              {p.sku}
              {p.ean ? ` · ${p.ean}` : ""}
            </p>
          </div>

          <div className="shrink-0 text-right">
            {p.precoVenda != null && (
              <p className="font-display text-base leading-none font-semibold tabular-nums text-ink">
                {brl(p.precoVenda)}
              </p>
            )}
            {p.saldo != null ? (
              // Sempre em unidades — para a garrafa fracionada, `unidadeBase` é
              // ML e o saldo fechado continua sendo garrafa (ver SaldoUn).
              <p className="mt-1 text-xs">
                <SaldoUn
                  fechado={p.saldo}
                  aberto={p.aberto}
                  tom={p.saldo <= 0 ? "text-danger" : "text-ink-2"}
                />
              </p>
            ) : (
              <p className="mt-1 text-xs text-faint">sem controle</p>
            )}
            {!p.ativo && <p className="mt-1 text-[11px] font-medium text-warn">Inativo</p>}
          </div>
        </Link>
      </Card>
    </li>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
