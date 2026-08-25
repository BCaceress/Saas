"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  PackageSearch,
  Check,
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Info,
  Loader2,
  Lock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtQtd, unidadeDaQtd } from "../_catalogo/ui";
import { Thumb } from "../_ui";
import type { CotacaoAnterior, CotacaoDetalhe } from "../_compra-types";
import {
  adicionarItemAction,
  buscarProdutosCotacaoAction,
  copiarItensDeAction,
  editarItemAction,
  removerItemAction,
  reordenarItensAction,
  type ProdutoCotacao,
} from "../_compra-actions";
import { useRouter } from "next/navigation";

// ── Itens da cotação ────────────────────────────────────────
// A lista é a pergunta que o fornecedor vai ler. Aceita produto do catálogo
// (o caminho normal, que depois vira pedido) e texto livre — porque às vezes
// se cota algo que ainda não está cadastrado. Estoque atual/mínimo aparece
// junto para o operador não precisar checar em outra tela se o item já é
// urgente.

type Item = CotacaoDetalhe["itens"][number];

/**
 * O estado da lista — otimista, com adicionar/editar/remover — mora aqui
 * porque duas telas mexem na MESMA lista: o passo "Produtos" do trilho e o
 * card de itens dentro da revisão. Duas cópias dessa lógica seriam duas
 * chances de a linha aparecer numa tela e não na outra.
 */
function useListaItens(cotacao: CotacaoDetalhe) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  /** Recado sem gravidade ("já estava na lista, somei") — não é erro. */
  const [aviso, setAviso] = useState<string | null>(null);
  // Remover é a única ação da linha que não se desfaz — numa lista de 30 itens
  // o alvo do clique é pequeno e o vizinho de baixo sobe no lugar. Pergunta
  // antes, com o nome do item na frase, para o "sim" ser sobre o item certo.
  const [aRemover, setARemover] = useState<Item | null>(null);

  // Lista OTIMISTA: o item aparece no clique e a gravação corre atrás. Esperar
  // a Server Action mais o `router.refresh()` (a página inteira voltando do
  // servidor) para desenhar uma linha fazia parecer que o botão não pegou —
  // e quem monta lista de 30 itens clica de novo.
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

  /**
   * Desenha o item na hora, grava depois e devolve o foco para a busca.
   *
   * Produto que JÁ está na lista não vira segunda linha: a quantidade soma na
   * que existe. Duas linhas do mesmo produto viram duas perguntas sobre a
   * mesma coisa no documento que o fornecedor lê — e ele responde as duas com
   * preços que podem não bater.
   */
  function adicionar(novo: Omit<Item, "id">) {
    const igual = novo.productId
      ? itens.find((i) => i.productId === novo.productId && i.packagingId === novo.packagingId)
      : itens.find(
          (i) =>
            !i.productId &&
            i.descricao.trim().toLowerCase() === novo.descricao.trim().toLowerCase(),
        );
    if (igual) {
      const somado = igual.quantidade + novo.quantidade;
      setAviso(
        `${igual.descricao} já estava na lista — somei ${fmtQtd(novo.quantidade)}, agora são ${fmtQtd(somado)}.`,
      );
      buscaRef.current?.focus();
      mudarQuantidade(igual, somado);
      return;
    }

    // Item novo de verdade: o recado do anterior ("somei na linha que já
    // existia") não vale mais e sai da tela.
    setAviso(null);
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
    setARemover(null);
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

  /**
   * Sobe ou desce um item. A lista redesenha na hora e a nova ordem inteira
   * vai para o servidor — mandar só o par trocado deixaria o resto da lista
   * dependendo de o `ordem` gravado estar sempre coerente.
   */
  function mover(item: Item, direcao: -1 | 1) {
    const i = itens.findIndex((x) => x.id === item.id);
    const j = i + direcao;
    if (i === -1 || j < 0 || j >= itens.length) return;
    const nova = [...itens];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setItens(nova);
    // Item ainda gravando (id provisório) não tem o que reordenar no banco.
    if (nova.some((x) => x.id.startsWith("novo:"))) return;
    rodar(() =>
      reordenarItensAction({ quotationId: cotacao.id, ids: nova.map((x) => x.id) }),
    );
  }

  return {
    itens,
    pendente,
    erro,
    aviso,
    setAviso,
    editando,
    setEditando,
    aRemover,
    setARemover,
    buscaRef,
    adicionar,
    remover,
    mudarQuantidade,
    mover,
  };
}

export function ItensCotacao({
  cotacao,
  editavel,
  travado,
  usaMinimo,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
  /**
   * Por que a lista congelou, quando quem olha TERIA permissão de mexer. Some
   * para quem só pode ver — dizer "não pode porque alguém respondeu" a quem
   * nunca poderia editar é explicar a trava errada.
   */
  travado?: string | null;
  /** Mostra o mínimo só quando a estratégia de estoque do tenant usa piso (MINIMO/MINIMO_IDEAL). */
  usaMinimo: boolean;
}) {
  const {
    itens,
    pendente,
    erro,
    aviso,
    editando,
    setEditando,
    aRemover,
    setARemover,
    buscaRef,
    adicionar,
    remover,
    mudarQuantidade,
    mover,
  } = useListaItens(cotacao);

  return (
    <div className="flex flex-col gap-4" aria-busy={pendente || undefined}>
      {editavel && (
        <NovoItem
          siteId={cotacao.siteId}
          onAdicionar={adicionar}
          pendente={pendente}
          buscaRef={buscaRef}
        />
      )}

      {aviso && (
        <p
          aria-live="polite"
          className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2"
        >
          <Info size={14} className="mt-0.5 shrink-0 text-brand" />
          {aviso}
        </p>
      )}

      {/* A trava aparece ANTES da lista, no lugar onde o formulário estaria:
          é a resposta para "cadê o campo de adicionar item?". */}
      {travado && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <Lock size={14} className="mt-0.5 shrink-0 text-muted" />
          {travado}
        </p>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}

      {itens.length === 0 ? (
        <EstadoVazio
          icon={<PackageSearch size={20} />}
          titulo="A lista está vazia"
          descricao="Adicione o que você quer comprar. É essa lista que o fornecedor vai receber."
        />
      ) : (
        <ListaItens
          itens={itens}
          editavel={editavel}
          usaMinimo={usaMinimo}
          editando={editando}
          pendente={pendente}
          onEditar={setEditando}
          onSalvar={mudarQuantidade}
          onRemover={setARemover}
          onMover={mover}
          className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
        />
      )}

      {aRemover && (
        <ConfirmarRemocao
          item={aRemover}
          pendente={pendente}
          onCancelar={() => setARemover(null)}
          onConfirmar={() => remover(aRemover)}
        />
      )}
    </div>
  );
}

// ── A lista, desenhada uma vez só ───────────────────────────
// O mesmo <ul> serve a lista solta e o card da revisão. Duas cópias do
// desenho viravam duas linhas de produto diferentes na mesma cotação — e a
// linha É o que o fornecedor vai ler.

function ListaItens({
  itens,
  editavel,
  usaMinimo,
  editando,
  pendente,
  onEditar,
  onSalvar,
  onRemover,
  onMover,
  ocultarDoMobileApos,
  className,
}: {
  itens: Item[];
  editavel: boolean;
  /** Mostra o mínimo só quando a estratégia de estoque do tenant usa piso. */
  usaMinimo: boolean;
  editando: string | null;
  pendente: boolean;
  onEditar: (id: string | null) => void;
  onSalvar: (item: Item, quantidade: number) => void;
  onRemover: (item: Item) => void;
  /** Ausente = lista sem reordenação (não vale a pena com prévia recortada). */
  onMover?: (item: Item, direcao: -1 | 1) => void;
  /**
   * A partir deste índice a linha some NO CELULAR e continua no desktop. É
   * CSS, não fatia do array: assim a mesma marcação serve às duas larguras
   * sem a lista remontar quando a janela muda de tamanho.
   */
  ocultarDoMobileApos?: number | null;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-line", className)}>
      {itens.map((item, i) => (
        <li
          key={item.id}
          className={cn(
            "px-4 py-3",
            ocultarDoMobileApos !== null &&
              ocultarDoMobileApos !== undefined &&
              i >= ocultarDoMobileApos &&
              "hidden lg:block",
          )}
        >
          {editando === item.id ? (
            <LinhaEdicao
              item={item}
              pendente={pendente}
              onCancelar={() => onEditar(null)}
              onSalvar={(quantidade) => onSalvar(item, quantidade)}
            />
          ) : (
            <div className="flex items-center gap-3">
              {/* Ordem antes da foto: mexer na posição da linha é ação sobre a
                  LISTA, não sobre o produto — fica na margem, onde a coluna de
                  setas se lê de cima a baixo, longe de editar e remover. */}
              {editavel && onMover && (
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => onMover(item, -1)}
                    disabled={i === 0 || pendente}
                    title="Subir"
                    aria-label={`Subir ${item.descricao}`}
                    className="grid h-4 w-6 cursor-pointer place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMover(item, 1)}
                    disabled={i === itens.length - 1 || pendente}
                    title="Descer"
                    aria-label={`Descer ${item.descricao}`}
                    className="grid h-4 w-6 cursor-pointer place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              )}

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
                      {/* "estoque 60" não diz de quê: a unidade é o que
                          separa 60 garrafas de 60 caixas. */}
                      estoque {fmtQtd(item.estoqueAtual)} un.
                      {usaMinimo &&
                        item.estoqueMinimo !== null &&
                        ` (mín. ${fmtQtd(item.estoqueMinimo)} un.)`}
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
                  {unidadeDaQtd(item.quantidade, item.embalagemNome)}
                </span>
              </span>

              {editavel && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEditar(item.id)}
                    title="Editar"
                    aria-label={`Editar ${item.descricao}`}
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemover(item)}
                    disabled={pendente}
                    title="Remover"
                    aria-label={`Remover ${item.descricao}`}
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
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
  );
}

// ── Itens dentro da revisão ─────────────────────────────────
// Mesma lista, dentro de um card: cabeçalho com a contagem, "Adicionar item"
// que abre o formulário sob demanda (na revisão o operador está conferindo,
// não montando) e as mesmas linhas do painel de produtos — foto, SKU, saldo,
// quantidade. Um desenho só, porque é a mesma lista.

/** Itens que o celular mostra antes de pedir "ver todos". */
const PREVIA_MOBILE = 5;

export function ItensDaCotacaoCard({
  cotacao,
  editavel,
  travado,
  usaMinimo,
  anterior,
  alerta,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
  travado?: string | null;
  usaMinimo: boolean;
  /** Cotação anterior oferecida como molde enquanto a lista está vazia. */
  anterior?: CotacaoAnterior | null;
  /** Validação da revisão ("Adicione pelo menos um item."). */
  alerta?: string | null;
}) {
  const router = useRouter();
  const {
    itens,
    pendente,
    erro,
    aviso,
    editando,
    setEditando,
    aRemover,
    setARemover,
    buscaRef,
    adicionar,
    remover,
    mudarQuantidade,
    mover,
  } = useListaItens(cotacao);
  // Lista vazia = o operador acabou de chegar e a única coisa a fazer é
  // digitar. Abrir fechado cobrava um clique antes da primeira letra.
  const [adicionando, setAdicionando] = useState(cotacao.itens.length === 0);
  const [copiando, startCopia] = useTransition();
  const [erroCopia, setErroCopia] = useState<string | null>(null);
  /** No celular a lista abre com uma prévia; no desktop cabe inteira. */
  const [expandido, setExpandido] = useState(false);

  const unidades = itens.reduce((soma, i) => soma + i.quantidade, 0);
  const temPreviaMobile = !expandido && itens.length > PREVIA_MOBILE;

  function repetirAnterior() {
    if (!anterior) return;
    setErroCopia(null);
    startCopia(async () => {
      try {
        await copiarItensDeAction({ quotationId: cotacao.id, origemId: anterior.id });
        router.refresh();
      } catch (e) {
        setErroCopia(e instanceof Error ? e.message : "Não foi possível copiar a lista.");
      }
    });
  }

  return (
    <section
      aria-labelledby="revisao-itens-titulo"
      // `aria-busy` + o esmaecido: enquanto a gravação corre a coluna diz que
      // está trabalhando, em vez de ficar parada convidando o segundo clique.
      aria-busy={pendente || copiando || undefined}
      // Sem esmaecer o card: `opacity` cria contexto de empilhamento, e a
      // lista de sugestões da busca (z-50) ficaria presa dentro dele, atrás do
      // rodapé fixo. O sinal de trabalho é o texto no cabeçalho.
      className={cn(
        "flex flex-col rounded-[var(--radius-lg)] border bg-surface",
        alerta ? "border-danger" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3
            id="revisao-itens-titulo"
            className="font-display text-[15px] font-semibold text-ink"
          >
            Itens da cotação
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            {itens.length} {itens.length === 1 ? "item" : "itens"} ·{" "}
            <span className="font-mono tabular-nums">{fmtQtd(unidades)}</span>{" "}
            {unidades === 1 ? "unidade" : "unidades"}
            {(pendente || copiando) && (
              <span aria-live="polite" className="flex items-center gap-1 text-faint">
                <Loader2 size={11} aria-hidden className="motion-safe:animate-spin" />
                {copiando ? "copiando…" : "salvando…"}
              </span>
            )}
          </p>
        </div>
        {editavel && (
          <button
            type="button"
            onClick={() => {
              setAdicionando((v) => !v);
              // O campo de busca é o destino do clique — abrir o formulário e
              // deixar o cursor fora dele cobra um segundo clique.
              setTimeout(() => buscaRef.current?.focus(), 0);
            }}
            aria-expanded={adicionando}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            {adicionando ? <X size={14} /> : <Plus size={14} />}
            {adicionando ? "Fechar" : "Adicionar item"}
          </button>
        )}
      </header>

      <div className="flex flex-col gap-3 p-4">
        {adicionando && editavel && (
          <NovoItem
            siteId={cotacao.siteId}
            onAdicionar={adicionar}
            pendente={pendente}
            buscaRef={buscaRef}
          />
        )}

        {travado && (
          <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            <Lock size={14} className="mt-0.5 shrink-0 text-muted" />
            {travado}
          </p>
        )}

        {alerta && <p className="text-[13px] font-medium text-danger">{alerta}</p>}
        {erro && <p className="text-[13px] text-danger">{erro}</p>}
        {erroCopia && <p className="text-[13px] text-danger">{erroCopia}</p>}
        {aviso && (
          <p
            aria-live="polite"
            className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2"
          >
            <Info size={13} className="mt-0.5 shrink-0 text-brand" />
            {aviso}
          </p>
        )}

        {itens.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-line px-4 py-7 text-center">
            <p className="text-[13px] text-muted">
              Nenhum item na cotação. Adicione o que você quer comprar — é essa lista que o
              fornecedor vai receber.
            </p>
            {/* Compra de mercado se repete. Se existe uma lista anterior, o
                caminho mais curto até a de hoje é ela — não trinta buscas. */}
            {anterior && editavel && (
              <button
                type="button"
                onClick={repetirAnterior}
                disabled={copiando}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CopyPlus size={14} className="text-muted" />
                {copiando
                  ? "Copiando…"
                  : `Repetir os ${anterior.totalItens} ${anterior.totalItens === 1 ? "item" : "itens"} de ${anterior.titulo}`}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Sem borda própria: o card já é a moldura, e a linha usa a largura
                inteira dele. As margens negativas devolvem o padding do card. */}
            <ListaItens
              itens={itens}
              editavel={editavel}
              usaMinimo={usaMinimo}
              editando={editando}
              pendente={pendente}
              onEditar={setEditando}
              onSalvar={mudarQuantidade}
              onRemover={setARemover}
              // Com a lista recortada no celular, subir/descer moveria contra
              // linhas que a pessoa não está vendo. Reordenar só com tudo à vista.
              onMover={temPreviaMobile ? undefined : mover}
              ocultarDoMobileApos={temPreviaMobile ? PREVIA_MOBILE : null}
              className="-mx-4 border-t border-line"
            />
            {/* Só no celular: no desktop a coluna de 70% mostra a lista inteira
                e um botão de "ver todos" seria uma pergunta já respondida. */}
            {temPreviaMobile && (
              <button
                type="button"
                onClick={() => setExpandido(true)}
                className="-mb-1 cursor-pointer rounded-full border border-line px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 lg:hidden"
              >
                Ver todos os {itens.length} itens
              </button>
            )}
          </>
        )}
      </div>

      {aRemover && (
        <ConfirmarRemocao
          item={aRemover}
          pendente={pendente}
          onCancelar={() => setARemover(null)}
          onConfirmar={() => remover(aRemover)}
        />
      )}
    </section>
  );
}

// ── Tirar item da lista ─────────────────────────────────────

function ConfirmarRemocao({
  item,
  pendente,
  onCancelar,
  onConfirmar,
}: {
  item: CotacaoDetalhe["itens"][number];
  pendente: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancelar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remover-item-titulo"
        className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
      >
        <h2
          id="remover-item-titulo"
          className="font-display text-[17px] font-semibold text-ink"
        >
          Tirar item da lista
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{item.descricao}</span> sai da cotação —
          o fornecedor não vai ver esse item. Para voltar atrás, é só adicionar de novo.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Manter
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirmar}
            disabled={pendente}
            className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:opacity-90 disabled:opacity-50"
          >
            Tirar da lista
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Adicionar item ──────────────────────────────────────────

/** Mínimo para buscar: com duas letras, meio catálogo volta. */
const MIN_BUSCA = 3;

function NovoItem({
  siteId,
  onAdicionar,
  pendente,
  buscaRef,
}: {
  /** Loja de destino — o saldo mostrado é o da prateleira que vai receber. */
  siteId: string;
  onAdicionar: (item: Omit<CotacaoDetalhe["itens"][number], "id">) => void;
  pendente: boolean;
  buscaRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<ProdutoCotacao | null>(null);
  const [embalagens, setEmbalagens] = useState<
    { id: string; nome: string; isCompraDefault: boolean }[]
  >([]);
  const [packagingId, setPackagingId] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [descricaoLivre, setDescricaoLivre] = useState("");
  const [achados, setAchados] = useState<ProdutoCotacao[]>([]);
  const [buscando, setBuscando] = useState(false);
  /** Opção sob o cursor do teclado. -1 = ninguém; Enter então fecha o item. */
  const [ativo, setAtivo] = useState(-1);
  const listaRef = useRef<HTMLUListElement>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  // A busca acontece no SERVIDOR. Antes o catálogo inteiro vinha no payload da
  // página só para alimentar este campo — milhares de linhas atravessando a
  // rede a cada abertura de cotação, que é o que fazia o clique demorar.
  useEffect(() => {
    const q = busca.trim();
    if (q.length < MIN_BUSCA) return;
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setAchados(await buscarProdutosCotacaoAction({ termo: q, siteId }));
        // Resultado novo, cursor no primeiro: quem digita "coca" e aperta Enter
        // quer o primeiro achado, não uma lista parada.
        setAtivo(0);
      } catch {
        setAchados([]);
        setAtivo(-1);
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [busca, siteId]);

  const sugestoes = busca.trim().length < MIN_BUSCA ? [] : achados;
  const listaAberta = sugestoes.length > 0 && !escolhido;
  /** Buscando e ainda sem nada para mostrar — o painel de espera entra aqui. */
  const procurandoVazio = buscando && !escolhido && sugestoes.length === 0;

  // Com a lista mais alta que a janela dela, andar de seta sem rolar deixa o
  // cursor invisível — a pessoa acha que o teclado parou de responder.
  useEffect(() => {
    if (!listaAberta || ativo < 0) return;
    listaRef.current?.children[ativo]?.scrollIntoView({ block: "nearest" });
  }, [ativo, listaAberta]);

  const qtd = Number(quantidade.replace(",", ".")) || 0;
  const podeSalvar =
    qtd > 0 && (escolhido !== null || descricaoLivre.trim().length >= 2) && !pendente;

  function selecionar(p: ProdutoCotacao) {
    setEscolhido(p);
    setBusca(p.nome);
    setEmbalagens(p.embalagens);
    setPackagingId(p.embalagens.find((e) => e.isCompraDefault)?.id ?? "");
    setAtivo(-1);
    // A quantidade já vem do que falta para o mínimo — quem está repondo não
    // deveria ter de calcular de cabeça.
    if (p.sugerido > 0) setQuantidade(String(p.sugerido));
  }

  // Escolhido o produto, a única pergunta que sobra é "quantos?" — o foco vai
  // sozinho para lá. Num efeito, e não dentro de `selecionar`, para o texto
  // marcado ser o valor JÁ atualizado (o sugerido), não o anterior.
  const escolhidoId = escolhido?.id ?? null;
  useEffect(() => {
    if (!escolhidoId) return;
    qtdRef.current?.focus();
    qtdRef.current?.select();
  }, [escolhidoId]);

  function limpar() {
    setEscolhido(null);
    setBusca("");
    setEmbalagens([]);
    setAchados([]);
    setAtivo(-1);
    setPackagingId("");
    setQuantidade("1");
    setDescricaoLivre("");
  }

  function salvar() {
    const embalagem = embalagens.find((e) => e.id === packagingId);
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
      // Provisórios pelo mesmo motivo do rótulo acima: o fator da embalagem, o
      // giro e a validade típica são leitura de servidor. Vêm no refresh —
      // enquanto isso, a compra por escala só não opina sobre este item.
      fatorEmbalagem: 1,
      custoUnitario: null,
      consumoDiarioUnidades: null,
      validadeTipicaDias: null,
    });
    limpar();
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem_auto] md:items-end">
        <div className="relative flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Produto</span>
          {/* A busca vai ao servidor: sem sinal de que ela está correndo, a
              espera parece campo quebrado e a pessoa digita por cima. */}
          {buscando && (
            <Loader2
              size={15}
              aria-hidden
              className="pointer-events-none absolute right-3 top-[1.9rem] motion-safe:animate-spin text-muted"
            />
          )}
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setEscolhido(null);
              setAtivo(-1);
            }}
            onKeyDown={(e) => {
              // Com a lista aberta, o teclado manda nela: seta anda, Enter
              // escolhe, Esc fecha. Sem lista, Enter fecha o item — quem digita
              // uma lista de 30 produtos não solta o teclado.
              if (listaAberta) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtivo((i) => (i + 1) % sugestoes.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtivo((i) => (i <= 0 ? sugestoes.length - 1 : i - 1));
                  return;
                }
                if (e.key === "Enter" && ativo >= 0) {
                  e.preventDefault();
                  selecionar(sugestoes[ativo]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAchados([]);
                  setAtivo(-1);
                  return;
                }
              }
              if (e.key === "Enter" && podeSalvar) salvar();
            }}
            role="combobox"
            aria-expanded={listaAberta}
            aria-controls="sugestoes-produto"
            aria-autocomplete="list"
            aria-activedescendant={
              listaAberta && ativo >= 0 ? `sugestao-${sugestoes[ativo].id}` : undefined
            }
            aria-busy={buscando || undefined}
            placeholder="Busque por nome ou SKU (mín. 3 letras)"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 pr-9 text-base text-ink sm:text-sm"
          />

          {/* Primeira busca, nada na tela ainda: o painel de "Procurando…"
              ocupa o lugar onde as opções vão aparecer, para a lista não
              nascer do nada embaixo do cursor. */}
          {procurandoVazio && (
            <p className="absolute left-0 right-0 top-full z-50 mt-1 flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-[13px] text-muted shadow-[var(--shadow-float)]">
              <Loader2 size={14} aria-hidden className="motion-safe:animate-spin text-faint" />
              Procurando produtos…
            </p>
          )}

          {listaAberta && (
            <ul
              ref={listaRef}
              id="sugestoes-produto"
              role="listbox"
              aria-label="Produtos encontrados"
              // z-50: a lista tem de cobrir o rodapé fixo do "Criar cotação"
              // (z-20). Opção escondida atrás do rodapé é opção que não existe.
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-float)]"
            >
              {sugestoes.map((p, i) => (
                <li
                  key={p.id}
                  id={`sugestao-${p.id}`}
                  role="option"
                  aria-selected={i === ativo}
                  /* mousedown, não click: click roubaria o foco do campo de
                     busca antes de a escolha acontecer. */
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selecionar(p);
                  }}
                  onMouseEnter={() => setAtivo(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink transition-colors",
                    i === ativo && "bg-brand-soft",
                  )}
                >
                  <Thumb url={p.imagemUrl} nome={p.nome} size={28} />
                  {/* SKU cola no nome porque é o desempate entre dois produtos
                      de nome quase igual; o saldo vai para a borda, onde a
                      coluna de números se lê de cima a baixo. */}
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate">{p.nome}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{p.sku}</span>
                  </span>
                  {p.estoque !== null && (
                    <span className="shrink-0 text-[11px] tabular-nums text-faint">
                      tem {fmtQtd(p.estoque)} un.
                    </span>
                  )}
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
            {embalagens.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-2">Quantidade</span>
          <input
            ref={qtdRef}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            onKeyDown={(e) => {
              // Enter aqui também fecha o item: escolher → digitar quanto →
              // Enter é a batida da lista de compra inteira, sem mouse.
              if (e.key === "Enter" && podeSalvar) {
                e.preventDefault();
                salvar();
              }
            }}
            inputMode="decimal"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-right font-mono text-sm tabular-nums text-ink"
          />
          {/* O campo já vinha preenchido com o que falta para o mínimo, mas em
              silêncio: número que aparece sozinho parece defeito. Dizer de onde
              veio transforma mágica em informação — e deixa claro que dá para
              trocar. */}
          {escolhido && escolhido.sugerido > 0 && (
            <span className="text-[11px] text-faint">
              sugerido {fmtQtd(escolhido.sugerido)} — falta para o mínimo
            </span>
          )}
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

      {!escolhido && busca.trim().length >= MIN_BUSCA && !buscando && sugestoes.length === 0 && (
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
          {unidadeDaQtd(qtd, item.embalagemNome)}
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
