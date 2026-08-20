"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, Trash2, Pencil, PackageSearch, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtQtd } from "../_catalogo/ui";
import { Thumb } from "../_ui";
import type { CotacaoDetalhe, ProdutoOpcao } from "../_compra-types";
import { adicionarItemAction, editarItemAction, removerItemAction } from "../_compra-actions";
import { useRouter } from "next/navigation";

// ── Itens da cotação ────────────────────────────────────────
// A lista é a pergunta que o fornecedor vai ler. Aceita produto do catálogo
// (o caminho normal, que depois vira pedido) e texto livre — porque às vezes
// se cota algo que ainda não está cadastrado. Estoque atual/mínimo aparece
// junto para o operador não precisar checar em outra tela se o item já é
// urgente.

export function ItensCotacao({
  cotacao,
  produtos,
  editavel,
  usaMinimo,
}: {
  cotacao: CotacaoDetalhe;
  produtos: ProdutoOpcao[];
  editavel: boolean;
  /** Mostra o mínimo só quando a estratégia de estoque do tenant usa piso (MINIMO/MINIMO_IDEAL). */
  usaMinimo: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  // Lista OTIMISTA: o item aparece no clique e a gravação corre atrás. Esperar
  // a Server Action mais o `router.refresh()` (a página inteira voltando do
  // servidor) para desenhar uma linha fazia parecer que o botão não pegou —
  // e quem monta lista de 30 itens clica de novo.
  type Item = CotacaoDetalhe["itens"][number];
  const chaveServidor = cotacao.itens.map((i) => `${i.id}:${i.quantidade}`).join("|");
  const [vistoDoServidor, setVistoDoServidor] = useState(chaveServidor);
  const [itens, setItens] = useState<Item[]>(cotacao.itens);
  if (vistoDoServidor !== chaveServidor) {
    setVistoDoServidor(chaveServidor);
    setItens(cotacao.itens);
  }

  const buscaRef = useRef<HTMLInputElement>(null);

  function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    startTransition(async () => {
      try {
        await fn();
        setEditando(null);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
        router.refresh();
      }
    });
  }

  /** Desenha o item na hora, grava depois e devolve o foco para a busca. */
  function adicionar(novo: Omit<Item, "id">) {
    const provisorio = `novo:${novo.descricao}:${Date.now()}`;
    setItens((atual) => [...atual, { ...novo, id: provisorio }]);
    // O próximo item começa a ser digitado antes de o anterior terminar de
    // gravar — é assim que se monta uma lista de compra.
    buscaRef.current?.focus();
    startTransition(async () => {
      try {
        const criado = await adicionarItemAction({
          quotationId: cotacao.id,
          productId: novo.productId,
          packagingId: novo.packagingId,
          descricao: novo.descricao,
          quantidade: novo.quantidade,
        });
        setItens((atual) =>
          atual.map((i) => (i.id === provisorio ? { ...i, id: criado.id } : i)),
        );
        router.refresh();
      } catch (e) {
        setItens((atual) => atual.filter((i) => i.id !== provisorio));
        setErro(e instanceof Error ? e.message : "Não foi possível adicionar.");
      }
    });
  }

  function remover(item: Item) {
    setItens((atual) => atual.filter((i) => i.id !== item.id));
    rodar(() => removerItemAction(item.id));
  }

  function mudarQuantidade(item: Item, quantidade: number) {
    setItens((atual) =>
      atual.map((i) => (i.id === item.id ? { ...i, quantidade } : i)),
    );
    setEditando(null);
    rodar(() =>
      editarItemAction({ id: item.id, descricao: item.descricao, quantidade }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {editavel && (
        <NovoItem
          produtos={produtos}
          onAdicionar={adicionar}
          pendente={pendente}
          buscaRef={buscaRef}
        />
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {itens.length === 0 ? (
        <EstadoVazio
          icon={<PackageSearch size={20} />}
          titulo="A lista está vazia"
          descricao="Adicione o que você quer comprar. É essa lista que o fornecedor vai receber."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {itens.map((item) => (
            <li key={item.id} className="px-4 py-3">
              {editando === item.id ? (
                <LinhaEdicao
                  item={item}
                  pendente={pendente}
                  onCancelar={() => setEditando(null)}
                  onSalvar={(quantidade) => mudarQuantidade(item, quantidade)}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <Thumb url={item.imagemUrl} nome={item.descricao} size={36} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{item.descricao}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 truncate text-[12px] text-muted">
                      {item.sku ? (
                        <span className="font-mono text-[11px] text-faint">{item.sku}</span>
                      ) : (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                          fora do catálogo
                        </span>
                      )}
                      {item.estoqueAtual !== null && (
                        <span
                          className={cn(
                            usaMinimo &&
                              item.estoqueMinimo !== null &&
                              item.estoqueAtual <= item.estoqueMinimo
                              ? "text-accent"
                              : undefined,
                          )}
                        >
                          estoque {fmtQtd(item.estoqueAtual)}
                          {usaMinimo &&
                            item.estoqueMinimo !== null &&
                            ` (mín. ${fmtQtd(item.estoqueMinimo)})`}
                        </span>
                      )}
                      {item.observacao && <span className="truncate">· {item.observacao}</span>}
                    </p>
                  </div>

                  {/* Número sozinho não diz nada: 2 pode ser duas garrafas ou
                      duas caixas de doze, e o fornecedor cota o que estiver
                      escrito aqui. */}
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[15px] font-semibold tabular-nums text-ink">
                      {fmtQtd(item.quantidade)}
                    </span>
                    <span className="block text-[11px] text-faint">
                      {item.embalagemNome ??
                        (item.quantidade === 1 ? "unidade" : "unidades")}
                    </span>
                  </span>

                  {editavel && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditando(item.id)}
                        title="Editar"
                        aria-label={`Editar ${item.descricao}`}
                        className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remover(item)}
                        disabled={pendente}
                        title="Remover"
                        aria-label={`Remover ${item.descricao}`}
                        className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Adicionar item ──────────────────────────────────────────

function NovoItem({
  produtos,
  onAdicionar,
  pendente,
  buscaRef,
}: {
  produtos: ProdutoOpcao[];
  onAdicionar: (item: Omit<CotacaoDetalhe["itens"][number], "id">) => void;
  pendente: boolean;
  buscaRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<ProdutoOpcao | null>(null);
  const [packagingId, setPackagingId] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [descricaoLivre, setDescricaoLivre] = useState("");

  const sugestoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    // Menos de três letras devolve meio catálogo: a lista fica inútil e o
    // operador precisa ler dez linhas para achar a que ele já sabia qual era.
    if (q.length < 3) return [];
    return produtos
      .filter((p) => `${p.nome} ${p.sku}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [busca, produtos]);

  const qtd = Number(quantidade.replace(",", ".")) || 0;
  const podeSalvar =
    qtd > 0 && (escolhido !== null || descricaoLivre.trim().length >= 2) && !pendente;

  function selecionar(p: ProdutoOpcao) {
    setEscolhido(p);
    setBusca(p.nome);
    setPackagingId(p.packagings.find((e) => e.isCompraDefault)?.id ?? "");
  }

  function limpar() {
    setEscolhido(null);
    setBusca("");
    setPackagingId("");
    setQuantidade("1");
    setDescricaoLivre("");
  }

  function salvar() {
    const embalagem = escolhido?.packagings.find((e) => e.id === packagingId);
    onAdicionar({
      productId: escolhido?.id ?? null,
      packagingId: packagingId || null,
      descricao: escolhido ? escolhido.nome : descricaoLivre.trim(),
      quantidade: qtd,
      observacao: null,
      ordem: 0,
      sku: escolhido?.sku ?? null,
      imagemUrl: escolhido?.imagemUrl ?? null,
      // Sem o fator em mãos aqui, o rótulo provisório é o nome da embalagem; o
      // servidor devolve "Caixa (12 un.)" no refresh seguinte.
      embalagemNome: embalagem ? embalagem.nome : escolhido ? "Unidade" : null,
      estoqueAtual: null,
      estoqueMinimo: null,
    });
    limpar();
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem_auto] md:items-end">
        <div className="relative flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Produto</span>
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setEscolhido(null);
            }}
            onKeyDown={(e) => {
              // Enter fecha o item: quem digita lista não solta o teclado.
              if (e.key === "Enter" && podeSalvar) salvar();
            }}
            placeholder="Busque por nome ou SKU (mín. 3 letras)"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {sugestoes.length > 0 && !escolhido && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-float)]">
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selecionar(p)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-brand-soft"
                  >
                    <Thumb url={p.imagemUrl} nome={p.nome} size={28} />
                    <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{p.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Embalagem</span>
          <select
            value={packagingId}
            onChange={(e) => setPackagingId(e.target.value)}
            disabled={!escolhido}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            <option value="">Unidade</option>
            {escolhido?.packagings.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Quantidade</span>
          <input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="decimal"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-right font-mono text-sm tabular-nums text-ink"
          />
        </label>

        <button
          type="button"
          onClick={salvar}
          disabled={!podeSalvar}
          className="flex h-[38px] items-center justify-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          <Plus size={15} />
          Adicionar
        </button>
      </div>

      {!escolhido && busca.trim().length >= 2 && sugestoes.length === 0 && (
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">
            Não achou no catálogo? Descreva para o fornecedor
          </span>
          <input
            value={descricaoLivre}
            onChange={(e) => setDescricaoLivre(e.target.value)}
            placeholder="Ex.: Cerveja pilsen lata 350ml, caixa com 12"
            className="rounded-[var(--radius)] border border-dashed border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <span className="text-[11px] text-faint">
            Item fora do catálogo entra na cotação, mas não vira pedido sozinho — vincule a
            um produto antes de fechar.
          </span>
        </label>
      )}
    </div>
  );
}

// ── Edição inline ───────────────────────────────────────────

/**
 * Edição inline: só a QUANTIDADE.
 *
 * Descrição e observação saíram porque a linha já foi decidida no momento de
 * adicionar — o que muda depois é quanto se quer comprar. Menos campos aqui é
 * menos jeito de mandar ao fornecedor uma lista diferente da que o operador
 * acha que mandou.
 */
function LinhaEdicao({
  item,
  pendente,
  onCancelar,
  onSalvar,
}: {
  item: CotacaoDetalhe["itens"][number];
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (quantidade: number) => void;
}) {
  const [quantidade, setQuantidade] = useState(String(item.quantidade));

  const qtd = Number(quantidade.replace(",", ".")) || 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.descricao}</p>
        <p className="text-[11px] text-faint">
          {item.embalagemNome ?? (qtd === 1 ? "unidade" : "unidades")}
        </p>
      </div>
      <input
        autoFocus
        value={quantidade}
        onChange={(e) => setQuantidade(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && qtd > 0) onSalvar(qtd);
          if (e.key === "Escape") onCancelar();
        }}
        onFocus={(e) => e.currentTarget.select()}
        inputMode="decimal"
        aria-label={`Quantidade de ${item.descricao}`}
        className="w-24 rounded-[var(--radius)] border border-line bg-surface px-3 py-1.5 text-right font-mono text-sm tabular-nums text-ink"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSalvar(qtd)}
          disabled={pendente || qtd <= 0}
          aria-label="Salvar item"
          className={cn(
            "grid h-8 w-8 place-items-center rounded-full text-on-brand transition-colors",
            "bg-brand hover:bg-brand-strong disabled:opacity-50",
          )}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          onClick={onCancelar}
          aria-label="Cancelar edição"
          className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
