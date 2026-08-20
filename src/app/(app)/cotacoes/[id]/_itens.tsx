"use client";

import { useMemo, useState, useTransition } from "react";
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

  function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    startTransition(async () => {
      try {
        await fn();
        setEditando(null);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {editavel && <NovoItem cotacaoId={cotacao.id} produtos={produtos} onSalvar={rodar} pendente={pendente} />}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {cotacao.itens.length === 0 ? (
        <EstadoVazio
          icon={<PackageSearch size={20} />}
          titulo="A lista está vazia"
          descricao="Adicione o que você quer comprar. É essa lista que o fornecedor vai receber."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {cotacao.itens.map((item) => (
            <li key={item.id} className="px-4 py-3">
              {editando === item.id ? (
                <LinhaEdicao
                  item={item}
                  pendente={pendente}
                  onCancelar={() => setEditando(null)}
                  onSalvar={(d) =>
                    rodar(() =>
                      editarItemAction({
                        id: item.id,
                        descricao: d.descricao,
                        quantidade: d.quantidade,
                        observacao: d.observacao || null,
                      }),
                    )
                  }
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
                      {item.embalagemNome && <span>{item.embalagemNome}</span>}
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

                  <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-ink">
                    {fmtQtd(item.quantidade)}
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
                        onClick={() => rodar(() => removerItemAction(item.id))}
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
  cotacaoId,
  produtos,
  onSalvar,
  pendente,
}: {
  cotacaoId: string;
  produtos: ProdutoOpcao[];
  onSalvar: (fn: () => Promise<unknown>) => void;
  pendente: boolean;
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
    onSalvar(async () => {
      await adicionarItemAction({
        quotationId: cotacaoId,
        productId: escolhido?.id ?? null,
        packagingId: packagingId || null,
        descricao: escolhido ? escolhido.nome : descricaoLivre.trim(),
        quantidade: qtd,
      });
      limpar();
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem_auto] md:items-end">
        <div className="relative flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Produto</span>
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setEscolhido(null);
            }}
            placeholder="Busque por nome ou SKU"
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

function LinhaEdicao({
  item,
  pendente,
  onCancelar,
  onSalvar,
}: {
  item: CotacaoDetalhe["itens"][number];
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (d: { descricao: string; quantidade: number; observacao: string }) => void;
}) {
  const [descricao, setDescricao] = useState(item.descricao);
  const [quantidade, setQuantidade] = useState(String(item.quantidade));
  const [observacao, setObservacao] = useState(item.observacao ?? "");

  const qtd = Number(quantidade.replace(",", ".")) || 0;

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_6rem_auto] md:items-center">
      <input
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        className="rounded-[var(--radius)] border border-line bg-surface px-3 py-1.5 text-sm text-ink"
      />
      <input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Observação"
        className="rounded-[var(--radius)] border border-line bg-surface px-3 py-1.5 text-[13px] text-ink"
      />
      <input
        value={quantidade}
        onChange={(e) => setQuantidade(e.target.value)}
        inputMode="decimal"
        className="rounded-[var(--radius)] border border-line bg-surface px-3 py-1.5 text-right font-mono text-sm tabular-nums text-ink"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSalvar({ descricao, quantidade: qtd, observacao })}
          disabled={pendente || qtd <= 0 || descricao.trim().length < 2}
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
