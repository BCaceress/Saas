"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  FilePlus2,
  History,
  Loader2,
  ScanLine,
  Search,
  SkipForward,
  TriangleAlert,
  X,
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
import {
  TabelaComparacao,
  type LinhaComparacao,
} from "@/components/recebimento/comparacao-xml";
import { cfopDeEntrada } from "@/lib/fiscal/cfop";
import { casaPorCodigo, inferirVinculo } from "@/lib/fiscal/vinculo";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";
import {
  fatorDaUnidade,
  frasesDeConversao,
  rotuloDaUnidade,
  unidadeComercial,
  unidadesDaLinha,
} from "@/lib/fiscal/unidades";
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
// Duas perguntas, dois passos. Primeiro QUAL produto (busca, lista enxuta,
// um clique), depois QUANTAS unidades vêm em cada volume da nota. Enquanto as
// duas moravam na mesma linha, a busca vinha com dez painéis de conversão
// empilhados e o operador escolhia o fator antes de ter escolhido o produto.
//
// O campo "quantas unidades por caixa" fica À VISTA no passo 2 — a embalagem
// cadastrada só preenche o número. O antigo botão "Unidade" respondia 1 em
// silêncio e punha 3 caixas de long neck como 3 garrafas.
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
  /** Classificação fiscal declarada no XML — alimenta a tela de revisão. */
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  unidade?: string | null;
  quantidade?: number | null;
  unidadeTributavel?: string | null;
  quantidadeTributavel?: number | null;
  /** vUnCom — preço na unidade do fornecedor. */
  valorUnitario?: number | null;
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

/** Ruído de descrição de nota — não ajuda a achar nada no catálogo. */
const RUIDO = new Set([
  "com",
  "sem",
  "para",
  "cx",
  "fd",
  "pct",
  "und",
  "unid",
  "un",
  "kg",
  "gr",
  "ml",
  "lt",
  "pet",
  "gfa",
  "gar",
  "emb",
]);

/**
 * Termos mais curtos para tentar quando a frase inteira não acha nada.
 *
 * A descrição do fornecedor vem embolada ("REFRIG COCA COLA 2L PET FD6") e a
 * busca casa por texto: sobra a frase toda, não sobra resultado. Oferecer as
 * palavras que valem a pena poupa o operador de descobrir isso apagando
 * palavra por palavra.
 */
function termosAlternativosDaDescricao(descricao: string, atual: string): string[] {
  const norm = (t: string) =>
    t
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  const jaTentado = norm(atual.trim());
  const palavras = descricao
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !RUIDO.has(norm(w)));

  const vistos = new Set<string>();
  const out: string[] = [];
  for (const w of palavras) {
    const k = norm(w);
    if (k === jaTentado || vistos.has(k)) continue;
    vistos.add(k);
    out.push(w);
    if (out.length === 3) break;
  }
  return out;
}

type DonoDoCodigo = Awaited<ReturnType<typeof donoDoCodigoAction>>;

/**
 * De onde veio o número que a tela sugere como conversão.
 *
 * "NOTA" é o que o fornecedor assinou em qTrib/qCom; "UNIDADE" é o que a sigla
 * significa em qualquer produto (milheiro, dúzia, cento). O número às vezes é o
 * mesmo — a frase que o explica, não: dizer "como o fornecedor declarou" sobre
 * uma conversão que a nota nunca declarou é mentira que o operador confere.
 */
type OrigemSugerida = "NOTA" | "UNIDADE" | null;

/** Embalagem e fator que o par (produto, item da nota) sugere. */
function vinculoDoProduto(p: ProdutoBuscado, item: ItemDeNota) {
  return inferirVinculo(
    {
      ean: p.ean,
      packagings: p.embalagens.map((e) => ({
        id: e.id,
        ean: e.ean,
        fatorConversao: e.fator,
      })),
    },
    {
      gtin: item.gtin,
      // uCom entra na conta: é ela que sabe que 0,6 MI são 600 unidades
      // quando a nota não declara qTrib.
      unidade: item.unidade ?? null,
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
  /** Linha destacada pelo teclado. */
  const [ativo, setAtivo] = React.useState(0);
  /**
   * Produto escolhido na busca — passo 2 (quantas unidades entram).
   *
   * Guardado junto com o item da nota a que pertence: quando a fila avança, a
   * escolha do item anterior deixa de valer sozinha, sem efeito para limpar.
   */
  const [selecionado, setSelecionado] = React.useState<{
    itemId: string | null;
    produto: ProdutoBuscado;
  } | null>(null);
  const escolhido =
    selecionado && selecionado.itemId === item.inboundItemId
      ? selecionado.produto
      : null;
  const listaRef = React.useRef<Record<string, HTMLLIElement | null>>({});
  const buscaRef = React.useRef<HTMLInputElement>(null);

  /**
   * O que a nota declara em qTrib/qCom, e — na falta dela — o que a própria
   * sigla da unidade já diz (milheiro é mil). Padrão do ajuste fino e aviso.
   */
  const daNota = fatorDaNota({
    quantidade: item.quantidade ?? 0,
    unidadeTributavel: item.unidadeTributavel ?? null,
    quantidadeTributavel: item.quantidadeTributavel ?? null,
  });
  const daUnidade = fatorDaUnidade(item.unidade);
  const sugeridoPelaNota = daNota ?? daUnidade;
  /** De onde saiu o número sugerido — muda o texto do atalho, não o número. */
  const origemSugerida: OrigemSugerida = daNota != null ? "NOTA" : daUnidade != null ? "UNIDADE" : null;

  // Leitor USB/Bluetooth — bipar o código de barras físico do produto (que
  // pode não ser o mesmo que a nota trouxe) já filtra a busca por ele.
  const aoBipar = React.useCallback((codigo: string) => setTermo(codigo), []);
  useLeitorTeclado(aoBipar, { ativo: !cadastrando && !escolhido });

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
      setSelecionado(null);
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
  /** Atalhos de busca — só valem quando o que está digitado não achou nada. */
  const termosAlternativos =
    !buscando && buscou && resultados.length === 0
      ? termosAlternativosDaDescricao(item.descricao, termo)
      : [];

  /**
   * ↑↓ percorrem os resultados e Enter leva o destacado para o passo 2, com
   * o cursor já no campo de unidades. Sem isto o fluxo era teclado na tabela →
   * mouse no painel → teclado de novo.
   */
  function aoTeclar(e: React.KeyboardEvent) {
    if (cadastrando || escolhido || lista.length === 0) return;
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
      setSelecionado({ itemId: item.inboundItemId, produto: p });
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
      title={item.productId ? "Trocar produto" : "Relacionar produto"}
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
            origemSugerida={origemSugerida}
            subcategoriasProp={subcategoriasProp}
            salvando={salvando}
            onCancelar={() => setCadastrando(false)}
            onSalvar={criarERelacionar}
          />
        ) : escolhido ? (
          /* Passo 2 — o produto já está decidido; falta só quanto entra. */
          <ConfirmarVinculo
            produto={escolhido}
            item={item}
            sugeridoPelaNota={sugeridoPelaNota}
            origemSugerida={origemSugerida}
            salvando={salvando}
            onVoltar={() => setSelecionado(null)}
            onConfirmar={(packagingId, fatorConversao) =>
              escolher(escolhido.id, packagingId, fatorConversao)
            }
          />
        ) : (
          <>
            {/* O que a nota diz sobre o item fica visível o tempo todo: é a
                referência que o operador usa para escolher o produto certo. */}
            {item.quantidade != null && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-[var(--radius-md)] border border-line bg-surface-2 px-4 py-2.5 text-[12px]">
                <span className="text-muted">
                  Na nota:{" "}
                  <span className="text-ink-2" title={rotuloDaUnidade(item.unidade)}>
                    {fmtQtd(item.quantidade)} {(item.unidade ?? "").toUpperCase()}
                  </span>
                  {/* "0,6 MI" sozinho lê-se como "menos de um". O que a sigla
                      vale em unidades é a informação que falta ali. */}
                  {daUnidade != null && daUnidade > 1 && (
                    <span className="text-faint">
                      {" · "}
                      {frasesDeConversao((item.unidade ?? "").toUpperCase(), daUnidade)}
                    </span>
                  )}
                </span>
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
                  ref={buscaRef}
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  placeholder="Buscar por nome, SKU ou código de barras"
                  aria-label="Buscar produto no catálogo"
                  autoFocus
                  onKeyDown={aoTeclar}
                  className="h-10 w-full rounded-full border border-line-button bg-surface pr-16 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
                {buscando && (
                  <Loader2
                    className="absolute top-1/2 right-9 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-faint"
                    aria-hidden
                  />
                )}
                {/* A busca nasce preenchida com a descrição da nota. Limpar
                    tem que ser um clique — não apagar 40 caracteres na tecla. */}
                {termo.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTermo("");
                      buscaRef.current?.focus();
                    }}
                    aria-label="Limpar busca"
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-faint transition-colors hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
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

            {/* A descrição do fornecedor vem cheia de ruído ("REFRIG COCA 2L
                PET FD6"). Buscar por um pedaço acha o que a frase inteira não
                acha — e o operador não deveria ter que descobrir isso
                apagando palavra por palavra. */}
            {termosAlternativos.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-faint">Tentar por:</span>
                {termosAlternativos.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTermo(t)}
                    className="rounded-full border border-line-button px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand hover:text-brand"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

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
                  : "Escolha o produto do catálogo. Quantas unidades entram no estoque é a próxima pergunta. ↑ ↓ percorrem, Enter escolhe."}
            </p>

            {mostrandoHistorico && (
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
                <History size={11} aria-hidden />
                Já veio deste fornecedor
              </p>
            )}

            <ul className="space-y-1.5">
              {lista.map((p, i) => (
                <Resultado
                  key={p.id}
                  ref={(el) => {
                    listaRef.current[p.id] = el;
                  }}
                  produto={p}
                  item={item}
                  focado={i === ativo}
                  onSelecionar={(produto) =>
                    setSelecionado({ itemId: item.inboundItemId, produto })
                  }
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

/**
 * Só responde "é este produto?".
 *
 * Antes cada linha carregava junto os botões de embalagem, o campo de fator e
 * o botão de relacionar — dez painéis de conversão empilhados numa busca de
 * dez resultados, e o operador escolhendo a conversão antes de ter escolhido
 * o produto. A conversão saiu daqui e virou o passo 2.
 */
const Resultado = React.forwardRef<
  HTMLLIElement,
  {
    produto: ProdutoBuscado;
    item: ItemDeNota;
    /** Linha destacada pelo teclado. */
    focado: boolean;
    onSelecionar: (produto: ProdutoBuscado) => void;
  }
>(function Resultado({ produto: p, item, focado, onSelecionar }, ref) {
  const casa = casaPorCodigo(
    {
      ean: p.ean,
      packagings: p.embalagens.map((e) => ({
        id: e.id,
        ean: e.ean,
        fatorConversao: e.fator,
      })),
    },
    item.gtin,
  );
  const medida = medidaDoProduto(p);

  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={() => onSelecionar(p)}
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left transition-colors",
          casa
            ? "border-ok/40 bg-ok-soft/25 hover:bg-ok-soft/40"
            : "border-line hover:border-line-button hover:bg-surface-2/60",
          focado && "ring-1 ring-brand/60 ring-inset",
        )}
      >
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
            {medida ? ` · ${medida}` : ""}
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

        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </button>
    </li>
  );
});

// ── Passo 2: quantas unidades entram ────────────────────────

/**
 * Produto escolhido — falta a conversão.
 *
 * Uma pergunta por vez: a busca decide QUAL produto, esta tela decide QUANTAS
 * unidades a nota traz. A embalagem cadastrada é um atalho para preencher o
 * número, nunca o número escondido atrás de um botão: o antigo "Unidade"
 * respondia 1 em silêncio e punha 3 caixas de long neck como 3 garrafas.
 */
function ConfirmarVinculo({
  produto: p,
  item,
  sugeridoPelaNota,
  origemSugerida,
  salvando,
  onVoltar,
  onConfirmar,
}: {
  produto: ProdutoBuscado;
  item: ItemDeNota;
  sugeridoPelaNota: number | null;
  origemSugerida: OrigemSugerida;
  salvando: boolean;
  onVoltar: () => void;
  onConfirmar: (packagingId: string | null, fator: number) => void;
}) {
  // Mesma regra que o palpite automático usa no servidor: embalagem com o
  // código de barras da nota manda, depois o que a nota declara, e 1 é o
  // último recurso. Duplicar essa decisão aqui era o que fazia a caixa de
  // long neck entrar como 5 garrafas.
  const vinculo = React.useMemo(() => vinculoDoProduto(p, item), [p, item]);
  const [embalagemId, setEmbalagemId] = React.useState<string | null>(
    vinculo.packagingId,
  );
  const [fator, setFator] = React.useState(String(vinculo.fatorConversao));

  const uCom = (item.unidade ?? "").trim().toUpperCase() || UNIDADE_ENTRADA;
  const unidadeInfo = unidadeComercial(item.unidade);
  const fatorNum = num(fator);
  /**
   * Peça é indivisível: 0,5 CX × 3 = 1,5 garrafas não existe, e o servidor
   * recusa gravar. Melhor travar o botão com a conta na frente do que deixar
   * clicar para receber um erro.
   */
  const conversao = unidadesDaLinha(item.quantidade ?? 0, fatorNum);
  const fracionada = fatorNum > 0 && item.quantidade != null && !conversao.exata;
  const unidades = (item.quantidade ?? 0) * fatorNum;
  const medida = medidaDoProduto(p);
  const sugerida = item.gtin
    ? p.embalagens.find((e) => e.ean === item.gtin)
    : undefined;
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

  /** Fator digitado à mão solta a embalagem: gravar o packagingId com um
   *  fator diferente do cadastro é afirmar que a caixa mudou de tamanho. */
  function digitar(v: string) {
    setFator(v);
    const e = p.embalagens.find((x) => x.id === embalagemId);
    if (e && num(v) !== e.fator) setEmbalagemId(null);
  }

  function usarEmbalagem(e: { id: string; fator: number }) {
    setEmbalagemId(e.id);
    setFator(String(e.fator));
  }

  return (
    <div className="space-y-3">
      {/* Quem foi escolhido, e a saída para trocar sem fechar o painel. */}
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-brand/40 bg-brand-soft/25 px-3 py-2.5">
        <ProdutoThumb url={p.imagemUrl} nome={p.nome} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
          <p className="truncate font-mono text-[11px] text-muted">
            {p.sku}
            {medida ? ` · ${medida}` : ""}
            {p.custoMedio > 0 ? ` · médio ${fmtMoney(p.custoMedio)}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={salvando}
          onClick={onVoltar}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Trocar
        </Button>
      </div>

      <div className="rounded-[var(--radius)] border border-line bg-surface-2/60 px-4 py-3.5">
        <p className="text-[13px] font-medium text-ink">
          {unidadeInfo?.classe === "MEDIDA"
            ? `${fmtQtd(item.quantidade ?? 0)} ${uCom}: quantas unidades entram no estoque?`
            : `Quantas unidades vêm em 1 ${uCom}?`}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">
          É este número que decide quanto entra no estoque
          {item.quantidade != null && (
            <>
              {" — "}a nota traz{" "}
              <span className="font-mono text-ink-2" title={rotuloDaUnidade(item.unidade)}>
                {fmtQtd(item.quantidade)} {uCom}
              </span>
            </>
          )}
          .
        </p>

        {/* Embalagem cadastrada é atalho para o número, não caminho paralelo:
            clicar preenche o campo e o operador vê o que escolheu. */}
        {p.embalagens.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {p.embalagens.map((e) => (
              <Button
                key={e.id}
                type="button"
                size="sm"
                variant={embalagemId === e.id ? "primary" : "secondary"}
                disabled={salvando}
                onClick={() => usarEmbalagem(e)}
              >
                {e.nome} ({fmtQtd(e.fator)} un)
                {sugerida?.id === e.id && " · código da nota"}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-faint uppercase">
              Unidades por {uCom}
            </span>
            <input
              value={fator}
              onChange={(e) => digitar(e.target.value)}
              inputMode="decimal"
              autoFocus
              aria-label={`Unidades fechadas por ${item.unidade ?? "item da nota"}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && fatorNum > 0 && !fracionada && !salvando) {
                  e.preventDefault();
                  onConfirmar(embalagemId, fatorNum);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onVoltar();
                }
              }}
              className="h-10 w-28 rounded-[var(--radius)] border border-line-button bg-surface px-3 font-mono text-base text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            />
          </label>

          <div className="min-w-0 flex-1 text-[12px] text-muted">
            {/* As duas quantidades lado a lado, nunca uma no lugar da outra: a
                do XML é o que o fiscal guarda, a convertida é o que o estoque
                recebe. */}
            {item.quantidade != null && fatorNum !== 1 && (
              <p className="font-mono text-[11px] text-faint">
                {fmtQtd(item.quantidade)} {uCom} × {fmtQtd(fatorNum)} ={" "}
                {frasesDeConversao(uCom, fatorNum)}
              </p>
            )}
            {/* Peça é indivisível. Com a conta na frente, o operador vê o que
                está errado — o botão travado sozinho só irritaria. */}
            {fracionada && (
              <p className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {fmtQtd(item.quantidade ?? 0)} {uCom} × {fmtQtd(fatorNum)} dá{" "}
                  {fmtQtd(conversao.bruto)} unidades. O estoque conta peça inteira.
                </span>
              </p>
            )}
            {item.quantidade != null && fatorNum > 0 && !fracionada && (
              <p>
                Entra no estoque:{" "}
                <span className="font-mono text-ink-2">
                  {fmtQtd(unidades)} {UNIDADE_ENTRADA}
                </span>
                {/* Produto medido em ml/g: a compra soma garrafas inteiras, e
                    o mililitro só conta no saldo aberto. Dizer o conteúdo
                    evita a leitura de que o saldo virou mililitro. */}
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
                onClick={() => {
                  setEmbalagemId(null);
                  setFator(String(sugeridoPelaNota));
                }}
                className="mt-0.5 text-[12px] font-medium text-brand underline"
              >
                Usar {fmtQtd(sugeridoPelaNota)},{" "}
                {origemSugerida === "UNIDADE"
                  ? `conversão padrão do ${(unidadeInfo?.nome ?? uCom).toLowerCase()}`
                  : "como o fornecedor declarou"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={salvando}
          onClick={onVoltar}
        >
          Voltar à busca
        </Button>
        <Button
          type="button"
          disabled={salvando || fatorNum <= 0 || fracionada}
          onClick={() => onConfirmar(embalagemId, fatorNum)}
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Relacionar com {fmtQtd(fatorNum)} un
        </Button>
      </div>
    </div>
  );
}

// ── Cadastro-relâmpago ──────────────────────────────────────

/**
 * O que a nota diz × o que o NoHub vai guardar.
 *
 * O XML declara o que o FORNECEDOR está faturando — não o que o mercado
 * precisa para operar o produto. "1 CX" com "uTrib UN" só vira "1 caixa = 60
 * garrafas" quando qTrib/qCom fecha em inteiro (ver `fatorDaNota`); em KG, em
 * L, ou em razão quebrada, aquilo é peso por caixa e não peça por caixa. Por
 * isso a conversão aparece aqui como afirmação a CONFIRMAR, nunca como número
 * já gravado: fator errado é estoque errado em silêncio.
 */
function CadastroRapido({
  item,
  sugeridoPelaNota,
  origemSugerida,
  subcategoriasProp,
  salvando,
  onCancelar,
  onSalvar,
}: {
  item: ItemDeNota;
  sugeridoPelaNota: number | null;
  origemSugerida: OrigemSugerida;
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
  const uCom = item.unidade?.trim().toUpperCase() || "item";
  const uTrib = item.unidadeTributavel?.trim() || null;
  /** Quanto a sigla vale sozinha (milheiro, dúzia) — 1.000 não se digita. */
  const daUnidade = fatorDaUnidade(item.unidade);

  // A nota vende na própria unidade de prateleira quando não há uTrib ou ele é
  // igual ao uCom. Aí não há o que perguntar: 1 = 1, e obrigar a confirmar
  // seria pedágio em cima do caso mais comum do mercadinho.
  //
  // Sigla de múltiplo fixo nunca cai aqui: "MI" com uTrib "MI" ainda são mil
  // maços por milheiro, e tratar como "sem conversão" gravava 0,6 no saldo.
  const semConversao =
    (daUnidade == null || daUnidade === 1) &&
    (!uTrib || uTrib.toUpperCase() === uCom.toUpperCase());

  const [nome, setNome] = React.useState(item.descricao.trim());
  const [subcategoryId, setSubcategoryId] = React.useState("");
  const [fator, setFator] = React.useState(
    sugeridoPelaNota ? String(sugeridoPelaNota) : semConversao ? "1" : "",
  );
  // Só o palpite da nota precisa de aval. Sem conversão nenhuma o operador não
  // é interrompido; sem palpite ele TEM de digitar, e aí não há o que confirmar.
  const [confirmado, setConfirmado] = React.useState(!sugeridoPelaNota);
  const [editandoFator, setEditandoFator] = React.useState(!sugeridoPelaNota && !semConversao);
  // "CX" vira "Caixa" — a sigla do fornecedor não é nome de embalagem. E é só
  // o nome: quantas cabem é o campo de unidades ao lado, não parte do texto.
  const [embalagem, setEmbalagem] = React.useState(() => nomeDaEmbalagem(item.unidade));
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
  const cfopEntrada = cfopDeEntrada(item.cfop);
  const valido =
    nome.trim().length >= 2 && subcategoryId !== "" && fatorNum > 0 && confirmado;

  /** Linha da tabela de revisão. Sem valor no XML, a linha não existe. */
  const linhas: LinhaComparacao[] = [
    {
      rotulo: "Descrição",
      xml: item.descricao,
      nohub: nome.trim() || "—",
    },
    {
      rotulo: "Código do fornecedor",
      xml: item.codigoFornecedor ?? null,
      nohub: "de-para deste fornecedor",
    },
    {
      rotulo: "GTIN",
      xml: item.gtin,
      nohub:
        fatorNum > 1
          ? `código de barras da ${embalagem.trim() || "embalagem"}`
          : "código de barras do produto",
    },
    {
      rotulo: "Unidade",
      xml: uCom,
      nohub: fatorNum > 1 ? `${embalagem.trim() || "embalagem"} → UN` : "UN",
    },
    {
      rotulo: "Quantidade",
      xml: item.quantidade != null ? `${fmtQtd(item.quantidade)} ${uCom}` : null,
      nohub:
        unidades > 0 ? (
          <span className="font-medium text-ink">{fmtQtd(unidades)} UN</span>
        ) : (
          "—"
        ),
    },
    {
      rotulo: "Valor unitário",
      xml: item.valorUnitario ? `${fmtMoney(item.valorUnitario)} / ${uCom}` : null,
      nohub: custoUnitario > 0 ? `${fmtMoney(custoUnitario)} / UN` : "—",
    },
    {
      rotulo: "NCM",
      xml: item.ncm ?? null,
      nohub: "perfil fiscal — a revisar",
    },
    { rotulo: "CEST", xml: item.cest ?? null, nohub: "perfil fiscal — a revisar" },
    {
      rotulo: "CFOP",
      xml: item.cfop ?? null,
      // O CFOP da nota é a saída do fornecedor; a mesma operação, do nosso
      // lado, é entrada. Mostrar os dois evita a pergunta "por que mudou?".
      nohub: cfopEntrada ? `${cfopEntrada} (entrada)` : "—",
    },
    { rotulo: "Unidade tributável", xml: uTrib, nohub: uTrib ?? "—" },
    {
      rotulo: "Quantidade tributável",
      xml:
        item.quantidadeTributavel != null
          ? `${fmtQtd(item.quantidadeTributavel)} ${uTrib ?? ""}`.trim()
          : null,
      nohub:
        item.quantidadeTributavel != null
          ? fmtQtd(item.quantidadeTributavel)
          : "—",
    },
  ];

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-line bg-surface-2/40 p-4">
      <div>
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <FilePlus2 className="h-4 w-4 text-brand" aria-hidden />
          Novo produto identificado
        </p>
        <p className="mt-1 text-[12px] text-muted">
          O que o XML já sabe entra sozinho: código de barras, custo, fornecedor,
          embalagem de compra e classificação fiscal. Confira e complete o que
          só você sabe.
        </p>
      </div>

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

      {/* ── Conversão: afirmação a confirmar, não campo a preencher ── */}
      {(!semConversao || sugeridoPelaNota != null) && (
        <div
          className={cn(
            "rounded-[var(--radius)] border px-4 py-3",
            confirmado && !editandoFator
              ? "border-ok/30 bg-ok-soft"
              : "border-warn/40 bg-warn-soft",
          )}
        >
          {editandoFator ? (
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
              Quantas unidades vêm em 1 {uCom}?
              <span className="flex items-center gap-2">
                <input
                  value={fator}
                  onChange={(e) => {
                    setFator(e.target.value);
                    setConfirmado(num(e.target.value) > 0);
                  }}
                  inputMode="decimal"
                  autoFocus
                  placeholder="60"
                  className="h-10 w-28 rounded-[var(--radius)] border border-line-button bg-surface px-3 font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
                <span className="text-[12px] font-normal text-muted">
                  {sugeridoPelaNota == null
                    ? `A nota não declara — ela fatura em ${uCom} e tributa em ${uTrib}. Use 1 se comprar avulso.`
                    : origemSugerida === "UNIDADE"
                      ? `${rotuloDaUnidade(item.unidade)}: ${frasesDeConversao(uCom, sugeridoPelaNota)}.`
                      : `A nota declara ${fmtQtd(sugeridoPelaNota)}.`}
                </span>
              </span>
            </label>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="min-w-0 flex-1">
                <span className="block font-mono text-[15px] font-semibold text-ink">
                  1 {uCom} = {fmtQtd(fatorNum)} UN
                </span>
                <span className="block text-[11px] text-muted">
                  {confirmado
                    ? "Confirmado — vale para as próximas notas deste fornecedor."
                    : origemSugerida === "UNIDADE"
                      ? `Conversão padrão de ${rotuloDaUnidade(item.unidade)}. Confirme antes de cadastrar.`
                      : `Declarado pela nota (${fmtQtd(item.quantidadeTributavel ?? 0)} ${uTrib ?? uCom} ÷ ${fmtQtd(item.quantidade ?? 0)} ${uCom}). Confirme antes de cadastrar.`}
                </span>
              </p>
              {confirmado ? (
                <button
                  type="button"
                  onClick={() => setEditandoFator(true)}
                  className="text-[12px] font-medium text-brand hover:underline"
                >
                  Alterar
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setConfirmado(true)}
                  >
                    Confirmar
                  </Button>
                  <button
                    type="button"
                    onClick={() => setEditandoFator(true)}
                    className="text-[12px] font-medium text-muted hover:text-ink"
                  >
                    Não é isso
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
            Só o nome — a quantidade ({fmtQtd(fatorNum)} por {embalagem.trim().toLowerCase() ||
              "embalagem"}) já é o campo acima. Fica no cadastro com o código de barras da nota.
          </span>
        </label>
      )}

      {/* ── XML × NoHub ── */}
      <TabelaComparacao linhas={linhas} />

      {item.ncm && (
        <p className="flex items-start gap-2 text-[11px] text-muted">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          O perfil fiscal nasce marcado como <em>a revisar</em>: NCM certo não
          significa alíquota certa — a tributação depende do seu regime, não do
          regime de quem vendeu.
        </p>
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

