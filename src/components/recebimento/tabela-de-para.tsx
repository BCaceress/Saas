"use client";

import {
  Fragment,
  forwardRef,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  Gift,
  Loader2,
  Plus,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import {
  RelacionarProduto,
  type ItemDeNota,
} from "@/components/recebimento/relacionar-produto";
import { fatorDaNota } from "@/lib/fiscal/fator";
import { origemDoFator, type OrigemFator } from "@/lib/fiscal/vinculo";
import { fmtMoney, fmtQtd } from "@/app/(app)/cotacoes/_ui";
import {
  desrelacionarItemAction,
  relacionarEmLoteAction,
  relacionarItemAction,
  sugestoesDaNotaAction,
  type SubcategoriaCadastro,
} from "@/app/(app)/recebimento/actions";
import type { SugestaoDePara } from "@/lib/compras/sugestao-de-para";

// ============================================================
// A tabela de-para: cada linha do XML × o produto do catálogo.
//
// É o trabalho que trava tudo o mais — sem produto relacionado não há
// conferência, não há custo e não há entrada. Por isso ela é uma etapa
// própria, e por isso vive aqui: a fila fiscal e o recebimento fazem
// exatamente este trabalho, e duas tabelas diferentes para a mesma decisão
// significavam dois estoques diferentes para a mesma nota.
//
// Os dois lados ficam em colunas vizinhas porque a pergunta que o operador faz
// é sempre a mesma: "esse aí virou qual produto meu?". Pendências sobem para o
// topo — em nota de 40 linhas, procurar o que falta é o trabalho, não a
// conferência.
// ============================================================

/** Uma linha do XML com tudo que a decisão de de-para precisa. */
export type ItemDePara = {
  id: string;
  ordem: number;
  codigoFornecedor: string;
  gtin: string | null;
  descricao: string;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorFcpSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
  productId: string | null;
  productNome: string | null;
  productSku: string | null;
  /**
   * Unidade de MEDIDA do produto (UN, ML, G). NÃO é o que entra numa compra:
   * a entrada soma `estoqueFechado`, que conta unidades fechadas — 12 garrafas
   * entram como 12, mesmo num suco medido em ml. O ml só aparece no saldo
   * ABERTO, quando alguém abre uma garrafa para usar em receita.
   */
  productUnidade: string | null;
  /** Conteúdo de uma unidade fechada, na unidadeBase (1000 ml na garrafa). */
  productConteudo: number | null;
  productImagemUrl: string | null;
  /** Custo médio atual — base do alerta de custo fora da curva. */
  productCustoMedio: number | null;
  /**
   * Embalagens de compra do produto relacionado. Ficam aqui para o ajuste de
   * conversão acontecer NA LINHA: antes, mudar "12 por caixa" para 24 exigia
   * desfazer o de-para, buscar o produto de novo e relacionar outra vez.
   */
  productEmbalagens: { id: string; nome: string; fator: number }[];
  /** Sabor gravado no de-para — preservado quando só o fator muda. */
  variantId: string | null;
  packagingId: string | null;
  fatorConversao: number;
};

type Sugestao = SugestaoDePara;

/**
 * Fator salvo × fator que a nota declara. Divergência é erro de estoque
 * esperando acontecer: ou o fornecedor mudou o fardo, ou o de-para nasceu
 * errado. Quem decide é o operador — a tela só não deixa passar calado.
 */
export function fatorDivergente(i: ItemDePara): number | null {
  const daNota = fatorDaNota(i);
  return daNota != null && daNota !== i.fatorConversao ? daNota : null;
}

/**
 * Em que pé está o de-para desta linha. Três estados, porque são três
 * trabalhos diferentes: nada a fazer, escolher o produto, ou conferir um
 * palpite que não fecha com o que a nota declara.
 */
export type EstadoItem = "OK" | "PENDENTE" | "REVISAR";

export function estadoDoItem(i: ItemDePara): EstadoItem {
  if (!i.productId) return "PENDENTE";
  return fatorDivergente(i) != null ? "REVISAR" : "OK";
}

/** Custo real do item: mercadoria + ST + IPI + frete − desconto. */
export function custoItem(i: ItemDePara): number {
  if (i.bonificacao) return 0;
  return Math.max(
    0,
    i.valorTotal -
      i.valorDesconto +
      i.valorIcmsSt +
      i.valorFcpSt +
      i.valorIpi +
      i.valorFrete,
  );
}

/**
 * Quanto o custo desta linha destoa do custo médio do produto. Acima de 30%
 * quase sempre é fator de conversão errado — a caixa entrando como unidade.
 * Depois de receber, isso vira preço de venda errado e margem que ninguém
 * explica; aqui é uma linha vermelha antes de receber.
 */
export function desvioDeCusto(i: ItemDePara): number | null {
  if (!i.productId || i.bonificacao) return null;
  const base = i.productCustoMedio ?? 0;
  const unidades = i.quantidade * i.fatorConversao;
  if (base <= 0 || unidades <= 0) return null;
  const desvio = (custoItem(i) / unidades - base) / base;
  return Math.abs(desvio) >= 0.3 ? desvio : null;
}

/** Item da nota → o que o painel de relacionar precisa saber dele. */
export function paraRelacionar(i: ItemDePara): ItemDeNota {
  return {
    inboundItemId: i.id,
    descricao: i.descricao,
    gtin: i.gtin,
    codigoFornecedor: i.codigoFornecedor,
    unidade: i.unidade,
    quantidade: i.quantidade,
    unidadeTributavel: i.unidadeTributavel,
    quantidadeTributavel: i.quantidadeTributavel,
    fatorConversao: i.fatorConversao,
    custoLinha: custoItem(i),
    productId: i.productId,
  };
}

const ORIGEM_FATOR: Record<OrigemFator, string> = {
  CADASTRO: "cadastro",
  NOTA: "declarado na nota",
  MANUAL: "definido à mão",
  SEM_CONVERSAO: "sem conversão",
};

const ESTADO_UI: Record<
  EstadoItem,
  { label: string; ponto: string; texto: string; linha: string }
> = {
  OK: { label: "Relacionado", ponto: "bg-ok", texto: "text-ok", linha: "" },
  PENDENTE: {
    label: "Produto não identificado",
    ponto: "bg-warn",
    texto: "text-warn",
    linha: "bg-warn-soft/40",
  },
  // Achou o produto, mas a conta da embalagem não fecha com o que a nota
  // declara. Não é erro nem acerto — é conferência.
  REVISAR: {
    label: "Produto identificado — revisar",
    ponto: "bg-info",
    texto: "text-info",
    linha: "bg-info-soft/40",
  },
};

/**
 * Compra entra em UNIDADE FECHADA — sempre.
 *
 * `registrarEntrada` soma `estoqueFechado`, que conta garrafas, latas e caixas
 * inteiras. A `unidadeBase` do produto (ML, G) mede outra coisa: o saldo
 * ABERTO, o que sobra dentro da garrafa que alguém abriu para uma receita.
 * Rotular a entrada com a unidadeBase dizia "entra 12 ML" onde entram 12
 * garrafas — e mandava o operador caçar no cadastro um erro que não existia.
 */
const UNIDADE_ENTRADA = "UN";

/** "1000 ml" — o conteúdo de cada unidade fechada, quando o produto é medido. */
function medidaDoProduto(item: ItemDePara): string | null {
  const u = item.productUnidade;
  if (!u || u.toUpperCase() === UNIDADE_ENTRADA) return null;
  if (!item.productConteudo || item.productConteudo <= 0) return u.toLowerCase();
  return `${fmtQtd(item.productConteudo)} ${u.toLowerCase()}`;
}

/** Nota com mais linhas que isto ganha campo de busca. */
const LIMIAR_BUSCA = 12;

export function TabelaDePara({
  inboundId,
  itens,
  sugestoesIniciais,
  editavel,
  podeCriarProduto,
  supplierId,
  siteId,
  subcategorias,
  atalhosAtivos = true,
}: {
  inboundId: string;
  itens: ItemDePara[];
  /** Palpites já calculados no servidor — a tabela nasce com eles. */
  sugestoesIniciais: Sugestao[];
  /** Nota ainda mexível E a pessoa pode mexer. Falso = tabela só de leitura. */
  editavel: boolean;
  podeCriarProduto: boolean;
  /** Fornecedor da nota — dá contexto de histórico à busca do painel. */
  supplierId?: string | null;
  /** Loja da entrada — o saldo mostrado é o de lá. */
  siteId?: string | null;
  /** Quem já carregou no servidor passa; quem não passou, busca sob demanda. */
  subcategorias?: SubcategoriaCadastro[];
  /** A tela hospedeira desliga os atalhos quando abre outro diálogo. */
  atalhosAtivos?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [relacionando, setRelacionando] = useState<ItemDePara | null>(null);
  /**
   * Palpites. Começam prontos do servidor e são REFEITOS depois de cada
   * de-para — relacionar uma linha pode criar embalagem/EAN que muda o palpite
   * das outras. Null = recalculando.
   */
  const [palpites, setPalpites] = useState<Sugestao[] | null>(
    sugestoesIniciais,
  );
  // Props novas do servidor (refresh depois de gravar) mandam. Ajuste durante o
  // render, não efeito: assim a tabela nunca pinta com o palpite velho.
  const [ultimoServidor, setUltimoServidor] = useState(sugestoesIniciais);
  if (ultimoServidor !== sugestoesIniciais) {
    setUltimoServidor(sugestoesIniciais);
    setPalpites(sugestoesIniciais);
  }
  /** Linha gravando agora — o giro fica nela, não numa barra global. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  /** Gravando o lote inteiro. */
  const [emLote, setEmLote] = useState(false);
  const [busca, setBusca] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
  // O anel só aparece na navegação por teclado: desenhar um em cada linha que
  // o mouse passa transforma feedback em ruído.
  const [porTeclado, setPorTeclado] = useState(false);
  const linhasRef = useRef<Record<string, HTMLTableRowElement | null>>({});

  const faltam = itens.filter((i) => !i.productId).length;
  // Derivado, não sincronizado: nota já resolvida não tem palpite a mostrar.
  const sugestoes = editavel && faltam > 0 ? palpites : [];

  /**
   * Palpites por código de barras — os que dá para gravar em lote. EAN batendo
   * é prova; palpite por nome continua um a um, porque ali a decisão é do
   * operador e não da máquina.
   */
  const porCodigo = (sugestoes ?? []).filter((s) => s.motivo === "EAN");

  const q = busca.trim().toLowerCase();
  const visiveis = q
    ? itens.filter((i) =>
        [i.descricao, i.codigoFornecedor, i.gtin, i.productNome, i.productSku]
          .filter(Boolean)
          .some((c) => String(c).toLowerCase().includes(q)),
      )
    : itens;

  // O que trava o recebimento vem primeiro, depois o que pede conferência, e
  // por último o que já está resolvido — cada bloco na ordem original da nota.
  // Bloco vazio não vira cabeçalho, e nota inteira num estado só não ganha
  // separador nenhum.
  const grupos = (
    [
      ["PENDENTE", "Precisam de você", "bg-warn-soft text-warn"],
      ["REVISAR", "Conferir a conversão", "bg-info-soft text-info"],
      ["OK", "Já relacionados", "bg-surface-2 text-muted"],
    ] as const
  )
    .map(([chave, titulo, tom]) => ({
      chave,
      titulo,
      tom,
      itens: visiveis.filter((i) => estadoDoItem(i) === chave),
    }))
    .filter((g) => g.itens.length > 0);

  const ordemVisual = grupos.flatMap((g) => g.itens);

  /** Refaz os palpites depois de mexer no de-para. */
  function recalcularPalpites() {
    setPalpites(null);
    sugestoesDaNotaAction(inboundId)
      .then(setPalpites)
      .catch(() => setPalpites([]));
  }

  /** Grava de uma vez tudo que o código de barras já provou. */
  function confirmarTodasPorCodigo() {
    if (porCodigo.length === 0) return;
    setEmLote(true);
    start(async () => {
      try {
        const r = await relacionarEmLoteAction(
          porCodigo.map((s) => ({
            itemId: s.itemId,
            productId: s.productId,
            variantId: s.variantId,
            packagingId: s.packagingId,
            fatorConversao: s.fatorConversao,
          })),
        );
        toast.success(
          `${r.relacionados} ${r.relacionados === 1 ? "item relacionado" : "itens relacionados"}.`,
          r.falhas > 0
            ? `${r.falhas} linha(s) não deram certo — continuam na lista.`
            : "Todos por código de barras do fornecedor.",
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Falha ao relacionar em lote.",
        );
      } finally {
        setEmLote(false);
      }
    });
  }

  /** Grava o palpite como o servidor propôs. Um clique, sem formulário. */
  function confirmarSugestao(s: Sugestao) {
    // Qual linha está gravando. Em nota de 40 itens o operador confirma em
    // sequência: sem o giro NA LINHA que ele clicou, o clique parece não ter
    // pegado e ele clica de novo — e a segunda gravação briga com a primeira.
    setConfirmando(s.itemId);
    start(async () => {
      try {
        const r = await relacionarItemAction({
          itemId: s.itemId,
          productId: s.productId,
          variantId: s.variantId,
          packagingId: s.packagingId,
          fatorConversao: s.fatorConversao,
        });
        toast.success(
          `${s.nome} relacionado.`,
          r.irmaos > 0
            ? `Mais ${r.irmaos} linha(s) com o mesmo código entraram junto.`
            : "Nas próximas notas deste fornecedor ele entra sozinho.",
          // Na fila rápida o operador confirma em sequência e só percebe o
          // engano na linha seguinte. Sem isto, desfazer é fechar tudo, achar
          // a linha na tabela e clicar em "desfazer".
          {
            rotulo: "Desfazer",
            onClick: () => desrelacionar({ id: s.itemId }),
          },
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao relacionar.");
      } finally {
        setConfirmando(null);
      }
    });
  }

  /**
   * Muda só a conversão, mantendo produto e sabor.
   *
   * Antes, corrigir "12 por caixa" para 24 obrigava a desfazer o de-para,
   * buscar o produto de novo no painel e relacionar outra vez — três passos
   * para mexer num número que já estava na tela. Reaproveita a mesma ação de
   * relacionar, então o mapa do fornecedor aprende o fator novo junto.
   */
  function ajustarFator(
    item: ItemDePara,
    fator: number,
    packagingId: string | null,
  ) {
    if (!item.productId) return;
    setConfirmando(item.id);
    start(async () => {
      try {
        await relacionarItemAction({
          itemId: item.id,
          productId: item.productId!,
          variantId: item.variantId,
          packagingId,
          fatorConversao: fator,
        });
        toast.success(
          "Conversão ajustada.",
          `1 ${item.unidade} passa a entrar como ${fmtQtd(fator)} unidade(s) fechada(s). Nas próximas notas deste fornecedor já vem assim.`,
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Falha ao ajustar a conversão.",
        );
      } finally {
        setConfirmando(null);
      }
    });
  }

  function desrelacionar(item: Pick<ItemDePara, "id">) {
    setConfirmando(item.id);
    start(async () => {
      try {
        await desrelacionarItemAction(item.id);
        toast.success(
          "Relação desfeita.",
          "O de-para salvo para este código do fornecedor também foi apagado.",
        );
        recalcularPalpites();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao desfazer.");
      } finally {
        setConfirmando(null);
      }
    });
  }

  // Teclado: recebimento é trabalho repetitivo, e tirar a mão do teclado a
  // cada linha custa mais que a linha inteira. Só age quando nenhum diálogo
  // está aberto e o foco não está num campo.
  useEffect(() => {
    if (!editavel || !atalhosAtivos || relacionando) return;

    function onKey(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter")
        return;

      const ids = ordemVisual.map((i) => i.id);
      if (ids.length === 0) return;
      const atual = foco ? ids.indexOf(foco) : -1;

      if (e.key === "Enter") {
        const item = ordemVisual.find((i) => i.id === foco);
        if (!item) return;
        e.preventDefault();
        const s = sugestoes?.find((x) => x.itemId === item.id);
        if (s) confirmarSugestao(s);
        else setRelacionando(item);
        return;
      }

      e.preventDefault();
      setPorTeclado(true);
      const proximo =
        e.key === "ArrowDown"
          ? Math.min(atual + 1, ids.length - 1)
          : Math.max(atual <= 0 ? 0 : atual - 1, 0);
      const id = ids[proximo];
      setFoco(id);
      linhasRef.current[id]?.scrollIntoView({ block: "nearest" });
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {editavel && (porCodigo.length > 0 || itens.length > LIMIAR_BUSCA) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* Trinta linhas com o código de barras do fornecedor batendo são
              trinta cliques para dizer "sim" trinta vezes. EAN é prova — o
              lote grava o que a máquina não precisava perguntar. */}
          {porCodigo.length > 0 && (
            <Button
              size="sm"
              onClick={confirmarTodasPorCodigo}
              disabled={emLote || pending}
            >
              {emLote ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <CheckCheck size={14} />
              )}
              {emLote
                ? "Relacionando…"
                : `Confirmar ${porCodigo.length} por código de barras`}
            </Button>
          )}

          {itens.length > LIMIAR_BUSCA && (
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Achar item na nota"
                aria-label="Achar item na nota"
                className="h-9 w-full rounded-full border border-line-button bg-surface pr-3 pl-8 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* `overflow-x-auto`: seis colunas não cabem num celular, e espremer até
          ficar ilegível é pior que rolar. Recebimento é trabalho de doca. */}
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 text-left text-[10px] uppercase tracking-wider text-faint">
            <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-surface-2">
              <th className="w-6 rounded-tl-[var(--radius-md)] py-2 pl-3">
                <span className="sr-only">Situação</span>
              </th>
              <th className="px-3 py-2 font-medium">Item da nota</th>
              <th className="px-3 py-2 font-medium">Produto no catálogo</th>
              <th className="px-3 py-2 text-right font-medium">Recebido</th>
              <th className="px-3 py-2 text-right font-medium">
                Entra no estoque
              </th>
              <th className="rounded-tr-[var(--radius-md)] px-3 py-2 pr-3 text-right font-medium">
                Custo
              </th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td:first-child]:rounded-bl-[var(--radius-md)] [&>tr:last-child>td:last-child]:rounded-br-[var(--radius-md)]">
            {grupos.map((g) => (
              <Fragment key={g.chave}>
                {grupos.length > 1 && (
                  <tr>
                    <td
                      colSpan={6}
                      className={cn(
                        "border-y border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider",
                        g.tom,
                      )}
                    >
                      {g.titulo} · {g.itens.length}
                    </td>
                  </tr>
                )}
                {g.itens.map((i) => (
                  <LinhaItem
                    key={i.id}
                    ref={(el) => {
                      linhasRef.current[i.id] = el;
                    }}
                    item={i}
                    editavel={editavel && !pending}
                    salvando={confirmando === i.id}
                    focado={foco === i.id && porTeclado}
                    sugestao={sugestoes?.find((s) => s.itemId === i.id) ?? null}
                    buscandoSugestao={sugestoes === null}
                    onFocar={() => {
                      setFoco(i.id);
                      setPorTeclado(false);
                    }}
                    onConfirmar={confirmarSugestao}
                    onRelacionar={() => setRelacionando(i)}
                    onAjustarFator={(fator, packagingId) =>
                      ajustarFator(i, fator, packagingId)
                    }
                    onDesrelacionar={() => desrelacionar(i)}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {q && visiveis.length === 0 && (
        <p className="mt-2 rounded-[var(--radius)] border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">
          Nenhum item da nota com “{busca.trim()}”.{" "}
          <button
            type="button"
            onClick={() => setBusca("")}
            className="font-medium text-brand underline"
          >
            Ver os {itens.length} itens
          </button>
        </p>
      )}

      {editavel && itens.length > 3 && (
        <p className="mt-2 text-[11px] text-faint">
          Atalhos: <span className="font-mono text-muted">↑</span>{" "}
          <span className="font-mono text-muted">↓</span> percorrem as linhas,{" "}
          <span className="font-mono text-muted">Enter</span> confirma a
          sugestão ou abre a busca.
        </p>
      )}

      {relacionando && (
        <RelacionarProduto
          // Instância nova por item: ao avançar na fila, busca e formulário
          // nascem limpos, sem efeito espelhando prop em state.
          key={relacionando.id}
          item={paraRelacionar(relacionando)}
          restantes={Math.max(0, faltam - 1)}
          podeCriarProduto={podeCriarProduto}
          supplierId={supplierId}
          siteId={siteId}
          subcategorias={subcategorias}
          onFechar={() => setRelacionando(null)}
          onPular={() => {
            // Item duvidoso não pode travar a fila: pula para o próximo
            // pendente e deixa este para o fim, em vez de o operador fechar o
            // painel inteiro e perder o embalo.
            const proximo = itens.find(
              (i) => !i.productId && i.id !== relacionando.id,
            );
            setRelacionando(proximo ?? null);
          }}
          onRelacionado={(itemId) => {
            // Fila: emenda no próximo pendente em vez de fechar e obrigar o
            // operador a caçar a próxima linha vermelha na tabela.
            const proximo = itens.find((i) => !i.productId && i.id !== itemId);
            setRelacionando(proximo ?? null);
            recalcularPalpites();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Uma linha da nota, em duas alturas: em cima o que interessa (descrição ×
 * produto × quantidades), embaixo o que só se lê quando dá problema (código
 * do fornecedor, CFOP, origem do fator). Linha sem produto é clicável inteira
 * — em nota grande, mirar num botão pequeno é imposto de tempo.
 */
const LinhaItem = forwardRef<
  HTMLTableRowElement,
  {
    item: ItemDePara;
    editavel: boolean;
    /** Esta linha está gravando agora. */
    salvando: boolean;
    focado: boolean;
    sugestao: Sugestao | null;
    buscandoSugestao: boolean;
    onFocar: () => void;
    onConfirmar: (s: Sugestao) => void;
    onRelacionar: () => void;
    /** Só a conversão muda — produto e sabor continuam os mesmos. */
    onAjustarFator: (fator: number, packagingId: string | null) => void;
    onDesrelacionar: () => void;
  }
>(function LinhaItem(
  {
    item,
    editavel,
    salvando,
    focado,
    sugestao,
    buscandoSugestao,
    onFocar,
    onConfirmar,
    onRelacionar,
    onAjustarFator,
    onDesrelacionar,
  },
  ref,
) {
  const [editandoFator, setEditandoFator] = useState(false);
  const estado = estadoDoItem(item);
  const ui = ESTADO_UI[estado];
  const divergente = fatorDivergente(item);
  // O que entra na compra é SEMPRE unidade fechada. Rotular com a unidadeBase
  // fazia a tela dizer "entra 12 ML" numa caixa de 12 garrafas de suco — e o
  // operador ia procurar no cadastro do produto um erro que não existia.
  const medida = medidaDoProduto(item);
  const entra = item.quantidade * item.fatorConversao;
  const desvio = desvioDeCusto(item);
  const origem = origemDoFator(item);
  // Fator 1 numa unidade de compra que não é unidade fechada é o chute mais
  // caro desta tela: entra 3 caixas como 3 unidades e ninguém percebe.
  const chutou =
    origem === "SEM_CONVERSAO" &&
    Boolean(item.productId) &&
    item.unidade.trim().toUpperCase() !== UNIDADE_ENTRADA;
  // Com palpite à vista, o clique solto na linha abriria a busca justamente
  // quando o operador queria confirmar. Aí a ação é só pelos botões.
  const clicavel = editavel && !item.productId && !sugestao;

  return (
    <tr
      ref={ref}
      onMouseEnter={onFocar}
      onClick={clicavel ? onRelacionar : undefined}
      className={cn(
        "border-b border-line align-top last:border-b-0",
        ui.linha,
        clicavel && "cursor-pointer transition-colors hover:bg-warn-soft/70",
        !clicavel && "transition-colors hover:bg-surface-2",
        focado && editavel && "ring-1 ring-brand/60 ring-inset",
      )}
    >
      <td className="py-2.5 pl-3">
        <span
          className={cn("mt-1.5 block h-2 w-2 rounded-full", ui.ponto)}
          title={ui.label}
          aria-label={ui.label}
        />
      </td>

      <td className="px-3 py-2.5">
        <p className="text-ink">{item.descricao}</p>
        <p className="font-mono text-[11px] text-faint">
          {item.codigoFornecedor}
          {item.gtin ? ` · ${item.gtin}` : ""}
          {item.cfop ? ` · CFOP ${item.cfop}` : ""}
        </p>
      </td>

      <td className="px-3 py-2.5">
        {item.productId ? (
          <div className="flex items-start gap-2">
            <ProdutoThumb
              url={item.productImagemUrl}
              nome={item.productNome}
              size="xs"
            />
            <div className="min-w-0">
              <p className="font-medium text-ink">{item.productNome}</p>
              <p className="font-mono text-[11px] text-faint">
                {item.productSku}
                {editavel && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={onRelacionar}
                      className="font-sans font-medium text-brand underline"
                    >
                      alterar
                    </button>
                    {" · "}
                    <button
                      type="button"
                      onClick={onDesrelacionar}
                      className="font-sans font-medium text-muted underline hover:text-danger"
                    >
                      desfazer
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        ) : sugestao ? (
          // Palpite do servidor: um clique resolve. O motivo aparece porque
          // "mesmo código de barras" é prova e "nome parecido" é chute — e o
          // operador confia diferente em cada um.
          <div
            className="flex items-start gap-2"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <ProdutoThumb
              url={sugestao.imagemUrl}
              nome={sugestao.nome}
              size="xs"
            />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-faint">
                <Sparkles size={11} className="text-brand" />
                {sugestao.motivo === "EAN"
                  ? "mesmo código de barras"
                  : "nome parecido"}
              </p>
              <p className="font-medium text-ink">{sugestao.nome}</p>
              <p className="font-mono text-[11px] text-faint">{sugestao.sku}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!editavel || salvando}
                  onClick={() => onConfirmar(sugestao)}
                >
                  {salvando ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Check size={14} />
                  )}
                  {salvando ? "Relacionando…" : "Confirmar"}
                </Button>
                {!salvando && (
                  <button
                    type="button"
                    onClick={onRelacionar}
                    className="text-xs font-medium text-brand underline"
                  >
                    outro produto
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="font-medium text-warn">
              {buscandoSugestao && editavel
                ? "Procurando no catálogo…"
                : "Nenhum produto relacionado"}
            </p>
            {editavel ? (
              // Só "relacionar". Cadastrar produto novo mora DENTRO do painel
              // de relacionar (e em Produtos): a busca vem primeiro porque o
              // produto quase sempre já existe, e o atalho para cadastrar aqui
              // fazia nascer duplicata do que estava a uma busca de distância.
              <div
                className="mt-1.5 flex flex-wrap items-center gap-2"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <Button size="sm" variant="secondary" onClick={onRelacionar}>
                  <Plus size={14} /> Relacionar produto
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-faint">
                Este item não entrou no estoque.
              </p>
            )}
          </>
        )}
      </td>

      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <p className="font-mono text-ink-2">
          {fmtQtd(item.quantidade)} {item.unidade}
        </p>
      </td>

      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        {item.productId ? (
          editandoFator ? (
            <EditorFator
              item={item}
              sugeridoPelaNota={divergente ?? fatorDaNota(item)}
              salvando={salvando}
              onCancelar={() => setEditandoFator(false)}
              onSalvar={(fator, packagingId) => {
                setEditandoFator(false);
                onAjustarFator(fator, packagingId);
              }}
            />
          ) : (
            <>
              <p className="font-mono font-semibold text-brand-strong">
                {fmtQtd(entra)} {UNIDADE_ENTRADA}
              </p>
              {/* Produto medido em ml/g: dizer o conteúdo evita a leitura
                  errada de que o saldo passou a ser contado em mililitro. */}
              {medida && (
                <p
                  className="font-mono text-[11px] text-faint"
                  title="A compra soma unidades fechadas. O mililitro só conta no saldo aberto, quando alguém abre uma para usar em receita."
                >
                  {medida} cada
                </p>
              )}
              {item.fatorConversao !== 1 ? (
                <p
                  className={cn(
                    "font-mono text-[11px]",
                    divergente ? "text-info" : "text-faint",
                  )}
                  title={
                    divergente
                      ? `A nota declara ${fmtQtd(item.quantidadeTributavel ?? 0)} ${
                          item.unidadeTributavel
                        } — dá ${fmtQtd(divergente)} por ${item.unidade}.`
                      : `Fator ${ORIGEM_FATOR[origem]}.`
                  }
                >
                  1 {item.unidade} = {fmtQtd(item.fatorConversao)} {UNIDADE_ENTRADA}
                  <span className="text-faint"> · {ORIGEM_FATOR[origem]}</span>
                  {divergente ? ` · nota: ${fmtQtd(divergente)}` : ""}
                </p>
              ) : chutou ? (
                <p
                  className="font-mono text-[11px] text-warn"
                  title={`A nota veio em  e o estoque conta unidade fechada, mas ninguém disse quantas cabem. Confira antes de receber.`}
                >
                  sem conversão — confira
                </p>
              ) : null}

              {/* Corrigir a conversão é mexer num número, não refazer o
                  de-para. Fica na própria célula que mostra o resultado. */}
              {editavel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditandoFator(true);
                  }}
                  className={cn(
                    "mt-0.5 text-[11px] font-medium underline",
                    chutou ? "text-warn" : "text-brand",
                  )}
                >
                  {chutou ? "informar quantas unidades" : "ajustar conversão"}
                </button>
              )}
            </>
          )
        ) : (
          <p className="font-mono text-faint">—</p>
        )}
      </td>

      <td className="px-3 py-2.5 pr-3 text-right whitespace-nowrap">
        {item.bonificacao ? (
          <Badge tone="accent">
            <Gift size={11} /> bonificação
          </Badge>
        ) : (
          <>
            <p className="font-mono text-ink-2">{fmtMoney(custoItem(item))}</p>
            {desvio != null && (
              <p
                className={cn(
                  "flex items-center justify-end gap-0.5 font-mono text-[11px]",
                  desvio > 0 ? "text-danger" : "text-ok",
                )}
                title={`Custo médio atual: ${fmtMoney(item.productCustoMedio ?? 0)} por unidade fechada. Diferença grande costuma ser fator de conversão errado.`}
              >
                {desvio > 0 ? (
                  <TrendingUp size={11} />
                ) : (
                  <TrendingDown size={11} />
                )}
                {desvio > 0 ? "+" : ""}
                {Math.round(desvio * 100)}% vs. médio
              </p>
            )}
          </>
        )}
      </td>
    </tr>
  );
});

/**
 * "Quantas unidades vêm nessa caixa?" — respondido na própria linha.
 *
 * Três caminhos, do mais rápido ao mais manual: uma embalagem já cadastrada
 * do produto, o que o fornecedor declarou na nota (qTrib/qCom), ou o número
 * digitado. Os três gravam pelo mesmo caminho do de-para, então o mapa do
 * fornecedor aprende e a próxima nota já chega certa.
 */
function EditorFator({
  item,
  sugeridoPelaNota,
  salvando,
  onCancelar,
  onSalvar,
}: {
  item: ItemDePara;
  /** Fator que a nota declara, quando declara. */
  sugeridoPelaNota: number | null;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (fator: number, packagingId: string | null) => void;
}) {
  const [valor, setValor] = useState(String(item.fatorConversao));
  const fator = Number(valor.replace(",", ".")) || 0;
  const entra = item.quantidade * fator;
  const custoUnitario = fator > 0 && entra > 0 ? custoItem(item) / entra : null;
  const medida = medidaDoProduto(item);

  return (
    <div
      className="flex flex-col items-end gap-1.5 text-right"
      onClick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div className="flex items-center gap-1.5">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && fator > 0) onSalvar(fator, null);
            if (e.key === "Escape") onCancelar();
          }}
          inputMode="decimal"
          autoFocus
          aria-label={`Unidades por ${item.unidade}`}
          className="h-8 w-20 rounded-[var(--radius-sm)] border border-line-button bg-surface px-2 text-right font-mono text-sm text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        <span className="text-[11px] whitespace-nowrap text-muted">
          {UNIDADE_ENTRADA} por {item.unidade}
        </span>
      </div>

      {/* Embalagem já cadastrada é o caminho certo: grava o packagingId junto,
          e aí a conversão passa a vir do CADASTRO, não de um número solto. */}
      {item.productEmbalagens.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {item.productEmbalagens.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={salvando}
              onClick={() => onSalvar(e.fator, e.id)}
              className="rounded-full border border-line-button px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              {e.nome} ({fmtQtd(e.fator)})
            </button>
          ))}
        </div>
      )}

      {sugeridoPelaNota != null && sugeridoPelaNota !== fator && (
        <button
          type="button"
          onClick={() => setValor(String(sugeridoPelaNota))}
          className="text-[11px] font-medium text-brand underline"
        >
          usar {fmtQtd(sugeridoPelaNota)}, como o fornecedor declarou
        </button>
      )}

      {fator > 0 && (
        <p className="font-mono text-[11px] text-faint">
          entra {fmtQtd(entra)} {UNIDADE_ENTRADA}
          {medida && ` de ${medida}`}
          {custoUnitario != null && ` · ${fmtMoney(custoUnitario)}/un`}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancelar}
          disabled={salvando}
          className="text-[11px] font-medium text-muted underline"
        >
          cancelar
        </button>
        <Button
          size="sm"
          disabled={salvando || fator <= 0}
          onClick={() => onSalvar(fator, null)}
        >
          {salvando ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Check size={13} />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
