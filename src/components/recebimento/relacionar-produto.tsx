"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  History,
  Loader2,
  ScanLine,
  Search,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { termoDeBuscaDoItem } from "@/lib/compras/conciliacao-regras";
import { fatorDaNota } from "@/lib/fiscal/fator";
import { casaPorCodigo, inferirVinculo } from "@/lib/fiscal/vinculo";
import { fmtMoney, fmtQtd } from "@/app/(app)/cotacoes/_ui";
import {
  buscarProdutosRelacionarAction,
  criarProdutoDoItemAction,
  donoDoCodigoAction,
  produtosDoFornecedorAction,
  relacionarItemAction,
  subcategoriasAction,
  type SubcategoriaCadastro,
} from "@/app/(app)/recebimento/actions";
import type { ProdutoBuscado } from "@/lib/compras/busca-produto";

// ============================================================
// De-para: item da nota ↔ produto do catálogo.
//
// UM componente para as duas telas que fazem essa pergunta (fila fiscal e
// conferência de recebimento). Antes eram duas — e as duas escolhiam o fator
// de conversão do próprio jeito, o que fazia a mesma caixa de long neck entrar
// como 5 garrafas numa tela e 12 na outra.
//
// O caminho rápido é um clique: a embalagem cujo código de barras é o da nota
// já vem destacada. Mas o campo "quantas unidades por caixa" fica À VISTA em
// todo resultado — produto sem embalagem cadastrada só tinha o botão
// "Unidade", que responde 1 em silêncio e põe 3 caixas como 3 garrafas.
// ============================================================

/**
 * O que a tela sabe do item. Só `inboundItemId`, `descricao` e `gtin` são
 * obrigatórios: a conferência conhece a linha inteira, a fila da nota conhece
 * mais ainda, e o resto do formulário melhora conforme o que chega.
 */
export type ItemDeNota = {
  /** Null = linha que não veio da nota (excedente contado na porta). */
  inboundItemId: string | null;
  descricao: string;
  gtin: string | null;
  codigoFornecedor?: string | null;
  unidade?: string | null;
  quantidade?: number | null;
  unidadeTributavel?: string | null;
  quantidadeTributavel?: number | null;
  /** Fator já gravado no de-para, quando existe. */
  fatorConversao?: number | null;
  /** Custo total da linha (mercadoria + ST + IPI + frete − desconto). */
  custoLinha?: number | null;
  productId?: string | null;
};

/** "a, b e c" — lista curta em português, sem vírgula antes do "e". */
const listar = (itens: string[]) =>
  itens.length <= 1
    ? (itens[0] ?? "")
    : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;

const num = (v: string) => Number(v.replace(",", ".")) || 0;

type DonoDoCodigo = Awaited<ReturnType<typeof donoDoCodigoAction>>;

/** Embalagem/sabor/fator que o par (produto, item da nota) sugere. */
function vinculoDoProduto(p: ProdutoBuscado, item: ItemDeNota) {
  return inferirVinculo(
    {
      ean: p.ean,
      packagings: p.embalagens.map((e) => ({
        id: e.id,
        ean: e.ean,
        fatorConversao: e.fator,
      })),
      variacoes: p.variacoes,
    },
    {
      gtin: item.gtin,
      quantidade: item.quantidade ?? 0,
      unidadeTributavel: item.unidadeTributavel ?? null,
      quantidadeTributavel: item.quantidadeTributavel ?? null,
    },
  );
}

const dia = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

/**
 * Compra entra em UNIDADE FECHADA — sempre, inclusive nos produtos medidos.
 *
 * `registrarEntrada` soma `estoqueFechado`: 12 garrafas de suco entram como
 * 12, não como 12 000 ml. A `unidadeBase` (ML, G) mede o saldo ABERTO, o que
 * sobra dentro da garrafa que alguém abriu para usar numa receita. Rotular a
 * entrada com ela dizia "entra 12 ML" e mandava o operador procurar no
 * cadastro do produto um erro que não existia.
 */
const UNIDADE_ENTRADA = "UN";

/** "1000 ml" — conteúdo de cada unidade fechada, quando o produto é medido. */
function medidaDoProduto(p: ProdutoBuscado): string | null {
  if (!p.unidadeBase || p.unidadeBase.toUpperCase() === UNIDADE_ENTRADA) return null;
  if (!p.conteudoPorUnidade || p.conteudoPorUnidade <= 0) return p.unidadeBase.toLowerCase();
  return `${fmtQtd(p.conteudoPorUnidade)} ${p.unidadeBase.toLowerCase()}`;
}

export function RelacionarProduto({
  item,
  restantes = 0,
  podeCriarProduto,
  supplierId,
  siteId,
  subcategorias: subcategoriasProp,
  onFechar,
  onPular,
  onRelacionado,
}: {
  item: ItemDeNota;
  /** Quantos outros itens desta nota ainda esperam relacionar — vira fila. */
  restantes?: number;
  podeCriarProduto: boolean;
  /** Fornecedor da nota — histórico como ponto de partida e "última compra". */
  supplierId?: string | null;
  /** Loja da entrada — o saldo mostrado é o de lá. */
  siteId?: string | null;
  /** Quem já carregou no servidor passa; quem não passou, busca sob demanda. */
  subcategorias?: SubcategoriaCadastro[];
  onFechar: () => void;
  /** Deixar este para depois e ir ao próximo pendente. */
  onPular?: () => void;
  /** Relacionado com sucesso. Quem conhece a fila decide se avança ou fecha. */
  onRelacionado: (inboundItemId: string | null) => void;
}) {
  const router = useRouter();
  const [termo, setTermo] = React.useState(termoDeBuscaDoItem(item.descricao));
  const [resultados, setResultados] = React.useState<ProdutoBuscado[]>([]);
  /** Sugestões do histórico do fornecedor — enquanto a busca não tem resposta. */
  const [doFornecedor, setDoFornecedor] = React.useState<ProdutoBuscado[]>([]);
  const [buscando, setBuscando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [camera, setCamera] = React.useState(false);
  const [cadastrando, setCadastrando] = React.useState(false);
  /** Já existe dono para o código de barras da nota? */
  const [dono, setDono] = React.useState<DonoDoCodigo | null | undefined>(
    undefined,
  );
  // Sabor escolhido por produto da lista. Sem saldo próprio: a escolha só diz
  // QUAL variação esta linha da nota trouxe — o estoque é do produto principal.
  const [sabor, setSabor] = React.useState<Record<string, string>>({});
  /** Linha destacada pelo teclado. */
  const [ativo, setAtivo] = React.useState(0);
  const listaRef = React.useRef<Record<string, HTMLLIElement | null>>({});

  /** O que a nota declara em qTrib/qCom: padrão do ajuste fino e aviso. */
  const sugeridoPelaNota = fatorDaNota({
    quantidade: item.quantidade ?? 0,
    unidadeTributavel: item.unidadeTributavel ?? null,
    quantidadeTributavel: item.quantidadeTributavel ?? null,
  });

  // Leitor USB/Bluetooth — bipar o código de barras físico do produto (que
  // pode não ser o mesmo que a nota trouxe) já filtra a busca por ele.
  const aoBipar = React.useCallback((codigo: string) => setTermo(codigo), []);
  useLeitorTeclado(aoBipar, { ativo: !cadastrando });

  React.useEffect(() => {
    const alvo = termo.trim();
    let vivo = true;
    // Tudo dentro do timeout, inclusive limpar a lista: mexer no estado no
    // corpo do efeito dispara render em cascata a cada tecla.
    const t = setTimeout(async () => {
      if (alvo.length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        // A ordem vem pronta do servidor: relevância ao que foi digitado, com
        // o código de barras do item como desempate.
        const r = await buscarProdutosRelacionarAction(alvo, item.gtin, {
          supplierId,
          siteId,
        });
        if (!vivo) return;
        setResultados(r);
        setAtivo(0);
      } catch {
        if (vivo) toast.error("Falha ao buscar produtos.");
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [termo, item.gtin, supplierId, siteId]);

  // Ponto de partida: o que este fornecedor já mandou. Buscado uma vez, usado
  // só quando a busca por texto não tem resposta — lista vazia com o cursor
  // piscando faz o operador digitar no escuro.
  React.useEffect(() => {
    if (!supplierId) return;
    let vivo = true;
    produtosDoFornecedorAction(supplierId, siteId)
      .then((r) => vivo && setDoFornecedor(r))
      .catch(() => vivo && setDoFornecedor([]));
    return () => {
      vivo = false;
    };
  }, [supplierId, siteId]);

  // Dono do código de barras da nota. Se já existe, cadastrar de novo criaria
  // duplicata — e o PDV passaria a vender o produto errado ao bipar.
  React.useEffect(() => {
    const gtin = item.gtin;
    // Sem código de barras não há dono a procurar — o estado nasce nulo.
    if (!gtin) return;
    let vivo = true;
    donoDoCodigoAction(gtin)
      .then((r) => vivo && setDono(r))
      .catch(() => vivo && setDono(null));
    return () => {
      vivo = false;
    };
  }, [item.gtin]);

  async function escolher(
    productId: string,
    packagingId: string | null,
    fator: number,
    variantId: string | null = null,
  ) {
    if (!item.inboundItemId) {
      toast.error(
        "Este item não veio da nota",
        "Só itens da nota podem ser relacionados.",
      );
      return;
    }
    setSalvando(true);
    try {
      const r = await relacionarItemAction({
        itemId: item.inboundItemId,
        productId,
        variantId,
        packagingId,
        fatorConversao: fator,
      });
      toast.success(
        r.irmaos > 0
          ? `Item relacionado — e mais ${r.irmaos} ${r.irmaos === 1 ? "linha" : "linhas"} com o mesmo código.`
          : "Item relacionado.",
        // O que a nota completou no cadastro merece ser dito: é trabalho que o
        // operador não vai precisar fazer depois, e ele não veria sozinho.
        r.preenchidos.length
          ? `Do XML veio ${listar(r.preenchidos)}. Nas próximas notas deste fornecedor ele entra sozinho.`
          : "Nas próximas notas deste fornecedor ele entra sozinho.",
      );
      // Fila: o pai decide se há próximo pendente (avança) ou fecha. Sempre
      // reabilita o form — se avançar, o efeito acima troca termo/resultados.
      onRelacionado(item.inboundItemId);
      setSalvando(false);
      router.refresh();
    } catch (e) {
      toast.error(
        "Não deu para relacionar",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setSalvando(false);
    }
  }

  /** Cadastra com o que o XML já sabe (EAN, custo, fornecedor, embalagem) e
   *  relaciona na mesma ação — sem sair da nota. */
  async function criarERelacionar(dados: {
    nome: string;
    subcategoryId: string;
    fatorConversao: number;
    embalagemNome?: string;
  }) {
    if (!item.inboundItemId) {
      toast.error(
        "Este item não veio da nota",
        "Só itens da nota podem virar produto aqui.",
      );
      return;
    }
    setSalvando(true);
    try {
      const r = await criarProdutoDoItemAction({
        itemId: item.inboundItemId,
        ...dados,
      });
      toast.success(
        `${dados.nome} cadastrado como ${r.sku}.`,
        "O item da nota já ficou relacionado a ele.",
      );
      onRelacionado(item.inboundItemId);
      setSalvando(false);
      setCadastrando(false);
      router.refresh();
    } catch (e) {
      toast.error(
        "Não deu para cadastrar",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setSalvando(false);
    }
  }

  const podeCadastrar = podeCriarProduto && Boolean(item.inboundItemId);
  const buscou = termo.trim().length >= 2;
  /**
   * O que a lista mostra. Sem busca útil, o histórico do fornecedor toma o
   * lugar da lista vazia — quase sempre a resposta veio no caminhão anterior.
   */
  const lista = resultados.length > 0 || buscou ? resultados : doFornecedor;
  const mostrandoHistorico = lista === doFornecedor && lista.length > 0;

  /**
   * ↑↓ percorrem os resultados e Enter escolhe a opção destacada com a
   * embalagem que o código de barras da nota indica. Sem isto o fluxo era
   * teclado na tabela → mouse no painel → teclado de novo.
   */
  function aoTeclar(e: React.KeyboardEvent) {
    if (cadastrando || lista.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => Math.min(i + 1, lista.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const p = lista[ativo];
      if (!p || salvando) return;
      e.preventDefault();
      const v = vinculoDoProduto(p, item);
      void escolher(
        p.id,
        v.packagingId,
        v.fatorConversao,
        sabor[p.id] || v.variantId,
      );
    }
  }

  React.useEffect(() => {
    listaRef.current[lista[ativo]?.id ?? ""]?.scrollIntoView({
      block: "nearest",
    });
  }, [ativo, lista]);

  return (
    <Sheet
      open
      onClose={onFechar}
      title={item.productId ? "Alterar produto" : "Relacionar ao catálogo"}
      description={
        <>
          {item.codigoFornecedor && (
            <>
              <span className="font-mono">{item.codigoFornecedor}</span>
              {" — "}
            </>
          )}
          <span className="text-ink-2">{item.descricao}</span>
          {item.gtin && (
            <>
              {" · "}
              <span className="font-mono">{item.gtin}</span>
            </>
          )}
          {restantes > 0 && (
            <>
              {" · "}
              <span className="font-medium text-accent">
                {restantes === 1
                  ? "mais 1 item por relacionar"
                  : `mais ${restantes} itens por relacionar`}
              </span>
            </>
          )}
        </>
      }
      width="2xl"
    >
      <div className="space-y-3">
        {camera && (
          <Scanner
            onCodigo={(codigo) => {
              setCamera(false);
              setTermo(codigo);
            }}
            onFechar={() => setCamera(false)}
            dica="Bipe o código de barras do produto"
          />
        )}

        {cadastrando ? (
          <CadastroRapido
            item={item}
            sugeridoPelaNota={sugeridoPelaNota}
            subcategoriasProp={subcategoriasProp}
            salvando={salvando}
            onCancelar={() => setCadastrando(false)}
            onSalvar={criarERelacionar}
          />
        ) : (
          <>
            {/* O que a nota diz sobre o item fica visível o tempo todo: é a
                referência que o operador usa para escolher o produto certo. */}
            {item.quantidade != null && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-[var(--radius-md)] border border-line bg-surface-2 px-4 py-2.5 text-[12px]">
                <span className="text-muted">
                  Na nota:{" "}
                  <span className="text-ink-2">
                    {fmtQtd(item.quantidade)} {item.unidade ?? ""}
                  </span>
                </span>
                {sugeridoPelaNota != null && (
                  <span className="text-muted">
                    O fornecedor declara:{" "}
                    <span className="font-mono text-ink-2">
                      {fmtQtd(sugeridoPelaNota)} por {item.unidade ?? "volume"}
                    </span>
                  </span>
                )}
                {item.custoLinha != null && item.custoLinha > 0 && (
                  <span className="text-muted">
                    Custo do item:{" "}
                    <span className="font-mono text-ink-2">
                      {fmtMoney(item.custoLinha)}
                    </span>
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <input
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Buscar por nome, SKU ou código de barras"
                  aria-label="Buscar produto no catálogo"
                  autoFocus
                  onKeyDown={aoTeclar}
                  className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCamera(true)}
              >
                <ScanLine className="h-4 w-4" aria-hidden />
                Bipar
              </Button>
            </div>

            {/* Código de barras que já tem dono. Cadastrar de novo criaria
                duplicata, e aí o PDV passa a vender o produto errado ao bipar
                — erro que só aparece no inventário que não fecha. */}
            {dono && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-info/40 bg-info-soft px-3.5 py-2.5 text-[12px] text-info">
                <TriangleAlert size={14} className="shrink-0" aria-hidden />
                <span>
                  O código <span className="font-mono">{item.gtin}</span> já é{" "}
                  {dono.onde} de{" "}
                  <span className="font-medium">{dono.nome}</span> ({dono.sku}).
                  Provavelmente é este produto — cadastrar outro faria o leitor
                  apontar para dois.
                </span>
              </p>
            )}

            <p className="text-[12px] text-muted">
              {buscando
                ? "Procurando…"
                : mostrandoHistorico
                  ? "Comece pelo que este fornecedor já mandou antes — ou digite para buscar no catálogo inteiro."
                  : "Escolha a unidade em que o fornecedor vende — é ela que define quantas unidades entram no estoque. ↑ ↓ percorrem, Enter escolhe."}
            </p>

            {mostrandoHistorico && (
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
                <History size={11} aria-hidden />
                Já veio deste fornecedor
              </p>
            )}

            <ul className="space-y-2">
              {lista.map((p, i) => (
                <Resultado
                  key={p.id}
                  ref={(el) => {
                    listaRef.current[p.id] = el;
                  }}
                  produto={p}
                  item={item}
                  sugeridoPelaNota={sugeridoPelaNota}
                  salvando={salvando}
                  focado={i === ativo}
                  sabor={sabor[p.id] ?? ""}
                  onSabor={(v) => setSabor((s) => ({ ...s, [p.id]: v }))}
                  onEscolher={escolher}
                />
              ))}
            </ul>

            {!buscando &&
              termo.trim().length >= 2 &&
              resultados.length === 0 && (
                <p className="rounded-[var(--radius)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                  {podeCadastrar
                    ? `Nenhum produto com "${termo.trim()}". Tente outro termo — ou cadastre este item agora, com o que a nota já traz.`
                    : `Nenhum produto com "${termo.trim()}". Tente outro termo — ou cadastre o produto e volte aqui, a nota continua esperando.`}
                </p>
              )}

            {podeCadastrar && (
              <button
                type="button"
                onClick={() => setCadastrando(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-line-button px-4 py-2.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft/40"
              >
                <FilePlus2 className="h-4 w-4" aria-hidden />
                Não achou? Cadastrar produto novo
              </button>
            )}

            {onPular && restantes > 0 && (
              // Item duvidoso não pode travar a fila. Pular deixa este para o
              // fim em vez de o operador fechar o painel e perder o embalo.
              <button
                type="button"
                onClick={onPular}
                disabled={salvando}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-[12px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                Decidir depois — ir para o próximo
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ── Uma linha de resultado ──────────────────────────────────

const Resultado = React.forwardRef<
  HTMLLIElement,
  {
    produto: ProdutoBuscado;
    item: ItemDeNota;
    sugeridoPelaNota: number | null;
    salvando: boolean;
    /** Linha destacada pelo teclado. */
    focado: boolean;
    sabor: string;
    onSabor: (v: string) => void;
    onEscolher: (
      productId: string,
      packagingId: string | null,
      fator: number,
      variantId: string | null,
    ) => void;
  }
>(function Resultado(
  {
    produto: p,
    item,
    sugeridoPelaNota,
    salvando,
    focado,
    sabor,
    onSabor,
    onEscolher,
  },
  ref,
) {
  // Mesma regra que o palpite automático usa no servidor: embalagem com o
  // código de barras da nota manda, depois o que a nota declara, e 1 é o
  // último recurso. Duplicar essa decisão aqui era o que fazia a caixa de
  // long neck entrar como 5 garrafas.
  const vinculo = React.useMemo(() => vinculoDoProduto(p, item), [p, item]);

  const [fator, setFator] = React.useState(String(vinculo.fatorConversao));
  const casa = casaPorCodigo(
    {
      ean: p.ean,
      packagings: p.embalagens.map((e) => ({
        id: e.id,
        ean: e.ean,
        fatorConversao: e.fator,
      })),
      variacoes: p.variacoes,
    },
    item.gtin,
  );
  const sugerida = item.gtin
    ? p.embalagens.find((e) => e.ean === item.gtin)
    : undefined;
  const variantId = sabor || vinculo.variantId || null;
  const fatorNum = num(fator);
  const unidades = (item.quantidade ?? 0) * fatorNum;
  const medida = medidaDoProduto(p);
  const custoUnitario =
    item.custoLinha != null && item.custoLinha > 0 && unidades > 0
      ? item.custoLinha / unidades
      : null;
  // Mesmo limiar da tabela: ±30% do custo médio quase sempre é fator errado.
  const foraDaCurva =
    custoUnitario != null && p.custoMedio > 0
      ? (() => {
          const d = (custoUnitario - p.custoMedio) / p.custoMedio;
          return Math.abs(d) >= 0.3 ? d : null;
        })()
      : null;

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-[var(--radius)] border px-3 py-2.5 transition-colors",
        casa ? "border-ok/40 bg-ok-soft/25" : "border-line",
        focado && "ring-1 ring-brand/60 ring-inset",
      )}
    >
      <div className="flex items-center gap-3">
        <ProdutoThumb url={p.imagemUrl} nome={p.nome} />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {p.nome}
            </span>
            {casa && (
              <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-medium text-ok">
                mesmo código
              </span>
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted">
            {p.sku}
            {medidaDoProduto(p) ? ` · ${medidaDoProduto(p)}` : ""}
            {p.ean ? ` · ${p.ean}` : ""}
          </p>

          {/* O que responde "é este mesmo?" não é o SKU — é o que está na
              prateleira e o que este fornecedor cobrou da última vez. Entre
              dois nomes quase iguais, é isto que decide. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
            <span className={p.saldo > 0 ? "text-muted" : undefined}>
              {p.saldo > 0
                ? `${fmtQtd(p.saldo)} ${UNIDADE_ENTRADA} em estoque`
                : "sem saldo"}
            </span>
            {p.ultimaCompra && (
              <span>
                · última {dia(p.ultimaCompra.data)}:{" "}
                <span className="font-mono">
                  {fmtMoney(p.ultimaCompra.custoUnitario)}
                </span>
                {p.ultimaCompra.doMesmoFornecedor && (
                  <span className="text-brand"> · mesmo fornecedor</span>
                )}
              </span>
            )}
          </p>
        </div>

        <span className="shrink-0 text-right">
          <span className="block font-mono text-[11px] text-muted">
            {p.custoMedio > 0 ? fmtMoney(p.custoMedio) : "sem custo"}
          </span>
          <span className="block text-[10px] text-faint">custo médio</span>
        </span>
      </div>

      {p.variacoes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label
            className="text-[11px] font-medium text-muted"
            htmlFor={`sabor-${p.id}`}
          >
            {p.variacaoLabel?.trim() || "Variação"}
          </label>
          <select
            id={`sabor-${p.id}`}
            value={variantId ?? ""}
            onChange={(ev) => onSabor(ev.target.value)}
            className="h-8 rounded-[var(--radius)] border border-line-button bg-surface px-2 text-[12px] text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <option value="">Não informar</option>
            {p.variacoes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-faint">
            entra no estoque de {p.nome}
          </span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={sugerida ? "secondary" : "primary"}
          disabled={salvando}
          onClick={() => onEscolher(p.id, null, 1, variantId)}
        >
          Unidade
        </Button>
        {p.embalagens.map((e) => (
          <Button
            key={e.id}
            size="sm"
            variant={sugerida?.id === e.id ? "primary" : "secondary"}
            disabled={salvando}
            onClick={() => onEscolher(p.id, e.id, e.fator, variantId)}
          >
            {e.nome} ({fmtQtd(e.fator)} un)
            {sugerida?.id === e.id && " · código da nota"}
          </Button>
        ))}
      </div>

      {/* A conversão fica À VISTA, não atrás de um botão.
          "Quantas unidades tem na caixa de suco?" é a pergunta que decide se o
          estoque nasce certo — e o produto que ainda não tem embalagem
          cadastrada só tinha o botão "Unidade", que responde 1 em silêncio. */}
      <div className="mt-2 flex flex-wrap items-end gap-3 rounded-[var(--radius)] border border-line bg-surface-2/60 px-3 py-2.5">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint uppercase">
            Unidades por {item.unidade ?? "item da nota"}
          </span>
          <input
            value={fator}
            onChange={(e) => setFator(e.target.value)}
            inputMode="decimal"
            aria-label={`Unidades fechadas por ${item.unidade ?? "item da nota"}`}
            className="h-9 w-28 rounded-[var(--radius)] border border-line-button bg-surface px-3 font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </label>

        <div className="min-w-0 flex-1 text-[12px] text-muted">
          {item.quantidade != null && fatorNum > 0 && (
            <p>
              Entra no estoque:{" "}
              <span className="font-mono text-ink-2">
                {fmtQtd(unidades)} {UNIDADE_ENTRADA}
              </span>
              {/* Produto medido em ml/g: a compra soma garrafas inteiras, e o
                  mililitro só conta no saldo aberto. Dizer o conteúdo evita a
                  leitura de que o saldo virou mililitro. */}
              {medida && <span className="text-faint"> de {medida} cada</span>}
            </p>
          )}
          {/* O número que denuncia fator errado não é "entra 24 un" — é o
                custo por unidade que sai dele. R$ 100,80 a garrafa grita; 24
                em vez de 12, não. */}
          {custoUnitario != null && (
            <p>
              Custo por unidade:{" "}
              <span
                className={cn(
                  "font-mono",
                  foraDaCurva === null
                    ? "text-ink-2"
                    : foraDaCurva > 0
                      ? "text-danger"
                      : "text-ok",
                )}
              >
                {fmtMoney(custoUnitario)}
              </span>
              {foraDaCurva != null && (
                <span className={foraDaCurva > 0 ? "text-danger" : "text-ok"}>
                  {" "}
                  ({foraDaCurva > 0 ? "+" : ""}
                  {Math.round(foraDaCurva * 100)}% vs. médio de{" "}
                  {fmtMoney(p.custoMedio)})
                </span>
              )}
            </p>
          )}
          {sugeridoPelaNota != null && fatorNum !== sugeridoPelaNota && (
            <button
              type="button"
              onClick={() => setFator(String(sugeridoPelaNota))}
              className="mt-0.5 text-[12px] font-medium text-brand underline"
            >
              Usar {fmtQtd(sugeridoPelaNota)}, como o fornecedor declarou
            </button>
          )}
        </div>

        <Button
          size="sm"
          disabled={salvando || fatorNum <= 0}
          onClick={() => onEscolher(p.id, null, fatorNum, variantId)}
        >
          Relacionar com {fmtQtd(fatorNum)} un
        </Button>
      </div>
    </li>
  );
});

// ── Cadastro-relâmpago ──────────────────────────────────────

/** Mini-cadastro — nome, categoria e a conversão. O resto do cadastro (preço,
 *  estoque mínimo, fiscal) o produto ganha depois em `/produtos`. */
function CadastroRapido({
  item,
  sugeridoPelaNota,
  subcategoriasProp,
  salvando,
  onCancelar,
  onSalvar,
}: {
  item: ItemDeNota;
  sugeridoPelaNota: number | null;
  subcategoriasProp?: SubcategoriaCadastro[];
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (dados: {
    nome: string;
    subcategoryId: string;
    fatorConversao: number;
    embalagemNome?: string;
  }) => void;
}) {
  const [nome, setNome] = React.useState(item.descricao.trim());
  const [subcategoryId, setSubcategoryId] = React.useState("");
  const [fator, setFator] = React.useState(String(sugeridoPelaNota ?? 1));
  const [embalagem, setEmbalagem] = React.useState(item.unidade || "Caixa");
  const [subs, setSubs] = React.useState<SubcategoriaCadastro[] | null>(
    subcategoriasProp ?? null,
  );

  React.useEffect(() => {
    if (subcategoriasProp) return;
    let vivo = true;
    subcategoriasAction()
      .then((r) => vivo && setSubs(r))
      .catch(() => vivo && setSubs([]));
    return () => {
      vivo = false;
    };
  }, [subcategoriasProp]);

  const fatorNum = num(fator);
  const unidades = (item.quantidade ?? 0) * fatorNum;
  const custoUnitario =
    unidades > 0 && item.custoLinha ? item.custoLinha / unidades : 0;
  const valido =
    nome.trim().length >= 2 && subcategoryId !== "" && fatorNum > 0;

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-line bg-surface-2/40 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <FilePlus2 className="h-4 w-4 text-brand" aria-hidden />
        Cadastrar produto novo
      </p>

      <p className="text-[12px] text-muted">
        O que o XML já sabe entra sozinho: código de barras, custo, fornecedor e
        embalagem de compra. O resto do cadastro você completa depois em
        Produtos.
      </p>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
        Nome
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
        Categoria
        <select
          value={subcategoryId}
          onChange={(e) => setSubcategoryId(e.target.value)}
          className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <option value="">
            {subs === null ? "Carregando…" : "Selecione…"}
          </option>
          {(subs ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.categoriaNome} · {s.nome}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
          Unidades por {item.unidade ?? "item da nota"}
          <input
            value={fator}
            onChange={(e) => setFator(e.target.value)}
            inputMode="decimal"
            className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
          <span className="text-[11px] font-normal text-faint">
            {sugeridoPelaNota
              ? `A nota declara ${fmtQtd(sugeridoPelaNota)} — use 1 se comprar avulso.`
              : "Use 1 se a nota já vem na unidade de venda."}
          </span>
        </label>

        {fatorNum > 1 && (
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
            Nome da embalagem
            <input
              value={embalagem}
              onChange={(e) => setEmbalagem(e.target.value)}
              placeholder="Caixa, fardo, engradado…"
              className="h-10 rounded-[var(--radius)] border border-line-button bg-surface px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
            <span className="text-[11px] font-normal text-faint">
              Fica no cadastro com o código de barras da nota.
            </span>
          </label>
        )}
      </div>

      {item.quantidade != null && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-[12px]">
          <Dado
            rotulo="Quantidade recebida"
            valor={`${fmtQtd(item.quantidade)} ${item.unidade ?? ""}`}
          />
          <Dado
            rotulo="Entra no estoque"
            valor={`${fmtQtd(unidades)} UN`}
            destaque
          />
          {custoUnitario > 0 && (
            <Dado rotulo="Custo por unidade" valor={fmtMoney(custoUnitario)} />
          )}
          {item.gtin && (
            <Dado
              rotulo={fatorNum > 1 ? "Código da embalagem" : "Código de barras"}
              valor={item.gtin}
            />
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancelar}
          disabled={salvando}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!valido || salvando}
          onClick={() =>
            onSalvar({
              nome: nome.trim(),
              subcategoryId,
              fatorConversao: fatorNum,
              embalagemNome: fatorNum > 1 ? embalagem.trim() : undefined,
            })
          }
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Cadastrar e relacionar
        </Button>
      </div>
    </div>
  );
}

function Dado({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <span className="block">
      <span className="block text-[10px] font-medium tracking-wide text-faint uppercase">
        {rotulo}
      </span>
      <span
        className={cn(
          "block font-mono text-[13px]",
          destaque ? "text-ink" : "text-ink-2",
        )}
      >
        {valor}
      </span>
    </span>
  );
}
