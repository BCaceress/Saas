"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Layers,
  Scale,
  Target,
  Trophy,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { precoNaQuantidade, type LimitesEscala } from "@/lib/compras/escalas";
import {
  custoDaProposta,
  fatorPrazo,
  prazoPagamentoEmDias,
  type CustoProposta,
} from "@/lib/compras/custo-efetivo";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { EstadoVazio, fmtMoney, fmtPreco, unidadeDaQtd } from "../_catalogo/ui";
import { SupplierAvatar, Thumb } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, ItemCotacao } from "../_compra-types";
import { concluirCotacaoAction, salvarCustoCapitalAction } from "../_compra-actions";
import { LenteOportunidade, type Sugestao } from "./_escala";
import { LeituraDaCotacao } from "./_resumo";
import { decidirEnvio, type DecisaoEnvio } from "@/lib/compras/conclusao-envio";
import { EnvioPedidoSheet } from "@/components/app/envio-pedido";
import { atencaoDoItem, type Atencao } from "@/lib/compras/atencao-item";

/**
 * Preferência pessoal na conferência: quem sempre revisa antes não precisa
 * desmarcar "enviar agora" toda vez. Só vale para pedido sem aviso — pedido
 * com aviso sempre nasce em "revisar".
 */
const CHAVE_PREFERENCIA_ENVIO = "nohub-conclusao-envio";

function lerPreferenciaEnvio(): "enviar" | "revisar" {
  try {
    return window.localStorage.getItem(CHAVE_PREFERENCIA_ENVIO) === "revisar" ? "revisar" : "enviar";
  } catch {
    return "enviar";
  }
}

function gravarPreferenciaEnvio(v: "enviar" | "revisar") {
  try {
    window.localStorage.setItem(CHAVE_PREFERENCIA_ENVIO, v);
  } catch {
    // sem armazenamento, sem preferência
  }
}

type EscolhaEnvio = "enviar" | "revisar";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";

// ── Comparativo ─────────────────────────────────────────────
// A tela onde a cotação paga o próprio custo. Cada linha é um item, cada
// coluna um fornecedor que respondeu, e o menor preço da linha ganha a
// etiqueta âmbar — a mesma etiqueta de prateleira do resto do módulo.
//
// A escolha é por ITEM, não por fornecedor: comprar tudo do mais barato no
// total costuma ser pior do que pegar cada item de quem tem o melhor preço.
// Por isso o padrão já vem marcado no menor preço de cada linha, e o operador
// só muda o que quiser mudar.
//
// No celular a tabela vira CARD POR PRODUTO. Encolher uma matriz de 6 colunas
// não deixa ela legível — vira rolagem lateral às cegas. Um produto por vez,
// com os fornecedores empilhados embaixo, é a mesma decisão sem a matriz.
//
// Quando a cotação pede ESCALA, a tela ganha uma segunda lente. Não é outra
// tela: a escolha, o rodapé e o botão de gerar pedido são os mesmos — muda o
// corpo. "Minha necessidade" compara o preço na quantidade que eu pedi;
// "Melhor oportunidade" mostra as promoções por volume com a conta de quanto
// custa levá-las. Duas perguntas diferentes sobre a mesma cotação, e o
// operador escolhe qual está fazendo.

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Filtro da lista de cards. Só existe no celular: na matriz o olho varre a
 * coluna e acha sozinho o que falta decidir; empilhado, doze itens são meio
 * metro de rolagem sem atalho.
 */
type FiltroItens = "todos" | "atencao" | "pendentes" | "promocao" | "marca";

const ROTULO_FILTRO: Record<FiltroItens, string> = {
  todos: "Todos",
  atencao: "Precisa de decisão",
  pendentes: "Sem escolha",
  promocao: "Com promoção",
  marca: "Marca divergente",
};

/**
 * Faixa de calor da célula: quanto ela está acima da melhor da linha. Cor só
 * onde há dinheiro — até 5% é empate prático e fica sem tinta.
 */
function calor(valor: number, melhor: number): "melhor" | "neutro" | "acima" | "longe" {
  if (melhor <= 0) return "neutro";
  const pct = (valor - melhor) / melhor;
  if (pct <= 0.0005) return "melhor";
  if (pct <= 0.05) return "neutro";
  if (pct <= 0.15) return "acima";
  return "longe";
}

const CLASSE_CALOR = {
  melhor: "",
  neutro: "",
  acima: "bg-accent-soft/60",
  longe: "bg-danger-soft/50",
} as const;

/** "▲ 4%" contra o último preço deste fornecedor; null abaixo de 2%. */
function variacao(preco: number, referencia: number | undefined): { texto: string; subiu: boolean } | null {
  if (!referencia || referencia <= 0) return null;
  const pct = ((preco - referencia) / referencia) * 100;
  if (Math.abs(pct) < 2) return null;
  return { texto: `${pct > 0 ? "▲" : "▼"}${Math.abs(Math.round(pct))}%`, subiu: pct > 0 };
}

/** "28d" / "à vista" — o prazo de pagamento da proposta, curto. */
function condicaoCurta(c: ConviteCotacao): string | null {
  const dias = c.prazoPagamentoDias ?? prazoPagamentoEmDias(c.condicaoPagamento);
  return dias === null ? null : dias === 0 ? "à vista" : `${dias}d`;
}

type Criterio = "preco" | "custo";

/**
 * Aviso de quantidade parcial: o fornecedor respondeu que só atende parte do
 * pedido. Sem isso o preço mais barato ganha a disputa vendendo metade.
 */
function faltaTexto(
  ofertada: number | null | undefined,
  pedida: number,
): string | null {
  if (ofertada === null || ofertada === undefined) return null;
  if (ofertada >= pedida) return null;
  return `só ${fmtQtd(ofertada)} de ${fmtQtd(pedida)}`;
}

/**
 * O que esta célula muda no bolso, comparada com a melhor da linha.
 *
 * Na MELHOR, é quanto ela economiza contra a segunda colocada — o ganho real
 * de escolher aquele fornecedor naquele item. Nas outras, é quanto custam a
 * mais. Preço sozinho não responde "onde está o dinheiro"; a diferença sim.
 *
 * Com uma resposta só não há comparação, e a linha cala em vez de inventar.
 */
function diferencaNaLinha(
  precos: number[],
  preco: number,
): { ganho: boolean; valor: number } | null {
  if (precos.length < 2) return null;
  const ordenados = [...precos].sort((a, b) => a - b);
  const melhor = ordenados[0];
  const segundo = ordenados[1];
  const valor = preco <= melhor ? segundo - melhor : preco - melhor;
  // Empate no topo (ou centavos de diferença) não é ganho — é ruído.
  if (valor < 0.005) return null;
  return { ganho: preco <= melhor, valor };
}

export function ComparativoCotacao({
  cotacao,
  resumo,
  podePedir,
  superficie = "desktop",
  onProgresso,
  referencias = {},
  onCobrar,
  fase = "decidindo",
  destaque = null,
  onDestaque,
}: {
  /**
   * "recebendo": só leitura (sem escolha, estratégia nem rodapé).
   * "decidindo": seleção, "Como comprar" e conclusão. O celular usa este.
   */
  fase?: "recebendo" | "decidindo";
  /** Fornecedor em foco (hover no chip ou no cabeçalho) — destaca a coluna. */
  destaque?: string | null;
  onDestaque?: (conviteId: string | null) => void;
  /** Cobrar quem ainda não respondeu — a folha de envio mora na página. */
  onCobrar?: (alvos: ConviteCotacao[]) => void;
  cotacao: CotacaoDetalhe;
  /**
   * Último preço que cada fornecedor praticou em cada produto antes desta
   * cotação (`${supplierId}:${productId}`). Vira o "▲ 4%" da célula.
   */
  referencias?: Record<string, number>;
  /** Leitura em texto do que os números dizem — fica logo abaixo do totalizador. */
  resumo: ResumoCotacao;
  podePedir: boolean;
  /**
   * Onde esta tela está rodando. No `/m` a matriz NUNCA aparece — nem em
   * tablet, onde o `md:` do desktop a traria de volta com 52rem de largura
   * dentro de uma casca de 4 de padding. Além disso o rodapé sobe acima da
   * barra de abas flutuante e erro/aviso viram toast, porque no fim de uma
   * lista longa eles nascem fora da tela.
   */
  superficie?: "desktop" | "mobile";
  /** Espelha "quantos itens já foram decididos" para quem desenha a aba. */
  onProgresso?: (p: { escolhidos: number; total: number }) => void;
}) {
  const mobile = superficie === "mobile";
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * No celular a mensagem vai para o toast: erro e aviso moram logo acima do
   * rodapé, e com doze itens na lista isso é meia tela abaixo do polegar.
   */
  function avisar(tom: "erro" | "aviso", texto: string) {
    if (mobile) {
      if (tom === "erro") toast.error(texto);
      else toast.info(texto);
      return;
    }
    if (tom === "erro") setErro(texto);
    else setAviso(texto);
  }

  const respondidos = useMemo(
    () => cotacao.convites.filter((c) => c.status === "RESPONDIDA"),
    [cotacao.convites],
  );

  // ── Critério: preço de nota ou custo efetivo ──────────────
  // Preço é o que sai no boleto. Custo efetivo soma o frete rateado e desconta
  // o prazo pelo custo do dinheiro — é o que a compra custa de verdade, em
  // reais de hoje.
  const [criterio, setCriterio] = useState<Criterio>("preco");
  const [taxaMes, setTaxaMes] = useState(cotacao.custoCapitalMesPct);

  /** Custo efetivo de cada proposta, na quantidade cotada. */
  const custos = useMemo(() => {
    const mapa = new Map<string, CustoProposta>();
    for (const c of respondidos) {
      const linhas = cotacao.itens.flatMap((i) => {
        const r = c.respostas.find((x) => x.quotationItemId === i.id);
        return r?.disponivel ? [{ itemId: i.id, quantidade: i.quantidade, preco: r.precoUnitario }] : [];
      });
      mapa.set(
        c.id,
        custoDaProposta(
          linhas,
          {
            prazoPagamentoDias: c.prazoPagamentoDias ?? prazoPagamentoEmDias(c.condicaoPagamento),
            frete: c.frete,
          },
          taxaMes,
        ),
      );
    }
    return mapa;
  }, [respondidos, cotacao.itens, taxaMes]);

  /** Melhor proposta de cada item pelo critério pedido (na quantidade cotada). */
  function calcularMelhores(crit: Criterio) {
    const mapa = new Map<string, { conviteId: string; preco: number; valor: number }>();
    for (const item of cotacao.itens) {
      for (const convite of respondidos) {
        const r = convite.respostas.find((x) => x.quotationItemId === item.id);
        if (!r?.disponivel) continue;
        const valor =
          crit === "custo"
            ? (custos.get(convite.id)?.linhas.get(item.id)?.unitario ?? r.precoUnitario)
            : r.precoUnitario;
        const atual = mapa.get(item.id);
        if (!atual || valor < atual.valor) {
          mapa.set(item.id, { conviteId: convite.id, preco: r.precoUnitario, valor });
        }
      }
    }
    return mapa;
  }

  // itemId → quem vence no critério atual.
  const melhorPorItem = calcularMelhores(criterio);

  const [escolhas, setEscolhas] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      cotacao.itens.map((i) => [i.id, melhorPorItem.get(i.id)?.conviteId ?? null]),
    ),
  );

  function trocarCriterio(novo: Criterio) {
    setCriterio(novo);
    // Na estratégia "melhor por item", mudar a régua muda quem ganha — a
    // seleção acompanha. Escolha personalizada ou fornecedor único ficam.
    if (modo === "melhor") {
      const melhores = calcularMelhores(novo);
      setEscolhas(
        Object.fromEntries(cotacao.itens.map((i) => [i.id, melhores.get(i.id)?.conviteId ?? null])),
      );
    }
  }

  // Quanto pedir de cada item. Começa na quantidade cotada e só sobe quando o
  // operador leva uma faixa de promoção — a lente de necessidade nunca mexe
  // nisto, e por isso ela continua sendo a tela de sempre.
  const [quantidades, setQuantidades] = useState<Record<string, number>>(() =>
    Object.fromEntries(cotacao.itens.map((i) => [i.id, i.quantidade])),
  );

  const [lente, setLente] = useState<"necessidade" | "oportunidade">("necessidade");

  // Celular: a estratégia e a confirmação do pedido moram em folhas. Empilhadas
  // no rodapé fixo elas comiam 40% de uma tela de 390px — e o rodapé é onde a
  // compra fecha, não onde ela é explicada.
  const [estrategiaAberta, setEstrategiaAberta] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroItens>("todos");
  /** Na conferência: o que fazer com o pedido de cada fornecedor (por convite). */
  const [envioEscolha, setEnvioEscolha] = useState<Record<string, EscolhaEnvio>>({});
  /** Itens com vencedor claro abertos na tabela (recolhidos por padrão). */
  const [mostrarClaros, setMostrarClaros] = useState(false);
  /** Pedidos que, depois de concluir, vão para a folha de envio. */
  const [enviarIds, setEnviarIds] = useState<string[] | null>(null);
  /** Linha com o foco do teclado na matriz (índice em `itensVisiveis`). */
  const [linhaAtiva, setLinhaAtiva] = useState<number | null>(null);
  const linhasRef = useRef<(HTMLTableRowElement | null)[]>([]);

  const [limites, setLimites] = useState<LimitesEscala>(cotacao.limitesEscala);

  /**
   * A marca só informa quando os fornecedores DIVERGEM nela. Se os três
   * cotaram a mesma, ela é a mesma palavra repetida na linha inteira — ruído
   * multiplicado pelo número de colunas.
   */
  function marcasDivergemNoItem(itemId: string): boolean {
    const marcas = new Set(
      respondidos
        .map((c) => c.respostas.find((x) => x.quotationItemId === itemId))
        .filter((r) => r?.disponivel && r.marca)
        .map((r) => r!.marca!.trim().toLowerCase()),
    );
    return marcas.size > 1;
  }

  /** Quantidade a pedir deste item — a cotada, ou a da faixa levada. */
  const quantidadeDe = (item: ItemCotacao) => quantidades[item.id] ?? item.quantidade;

  /**
   * Preço do item naquele fornecedor NA QUANTIDADE ESCOLHIDA. Enquanto ninguém
   * levou promoção é o preço-base; levada uma faixa, é o preço dela. O total
   * do rodapé passa por aqui — senão a tela mostraria o desconto na lista e
   * cobraria o preço cheio no fim.
   */
  function precoDe(item: ItemCotacao, convite: ConviteCotacao): number | null {
    const r = convite.respostas.find((x) => x.quotationItemId === item.id);
    if (!r?.disponivel) return null;
    return precoNaQuantidade(
      { quantidadePedida: item.quantidade, precoBase: r.precoUnitario },
      r.faixas,
      quantidadeDe(item),
    ).preco;
  }

  /**
   * Custo efetivo por unidade NA QUANTIDADE ESCOLHIDA. Reaproveita o frete
   * rateado da proposta e aplica ao preço da faixa, se houver.
   */
  function custoDe(item: ItemCotacao, convite: ConviteCotacao): number | null {
    const preco = precoDe(item, convite);
    if (preco === null) return null;
    const r = convite.respostas.find((x) => x.quotationItemId === item.id);
    const linha = custos.get(convite.id)?.linhas.get(item.id);
    if (!r || !linha || r.precoUnitario <= 0) return preco;
    const fp = fatorPrazo(
      convite.prazoPagamentoDias ?? prazoPagamentoEmDias(convite.condicaoPagamento),
      taxaMes,
    );
    return (preco + linha.freteUnit) * fp;
  }

  /** O número que a comparação usa — preço ou custo, conforme o critério. */
  const valorDe = (item: ItemCotacao, convite: ConviteCotacao) =>
    criterio === "custo" ? custoDe(item, convite) : precoDe(item, convite);

  /** Levar uma faixa: escolhe o fornecedor E sobe a quantidade, junto. */
  function aplicarFaixa(itemId: string, conviteId: string, quantidade: number) {
    setModo("manual");
    setEscolhas((e) => ({ ...e, [itemId]: conviteId }));
    setQuantidades((q) => ({ ...q, [itemId]: quantidade }));
  }

  function aplicarSugestoes(sugestoes: Sugestao[]) {
    setModo("manual");
    setEscolhas((e) => ({
      ...e,
      ...Object.fromEntries(sugestoes.map((x) => [x.itemId, x.conviteId])),
    }));
    setQuantidades((q) => ({
      ...q,
      ...Object.fromEntries(sugestoes.map((x) => [x.itemId, x.oportunidade.quantidade])),
    }));
  }

  /** Itens que vão sair acima do cotado — o aviso honesto do rodapé. */
  const comPromocao = cotacao.itens.filter(
    (i) => escolhas[i.id] && quantidadeDe(i) > i.quantidade,
  ).length;

  /** Alguém respondeu com faixa? Sem isso a segunda lente não tem o que dizer. */
  const temFaixa = cotacao.pedeEscala &&
    cotacao.convites.some((c) => c.respostas.some((r) => r.disponivel && r.faixas.length > 0));

  // Duas formas legítimas de fechar a compra, e a tela não deve escolher pelo
  // operador:
  //
  //  · MELHOR PREÇO POR ITEM rende mais no papel, mas parte a compra em vários
  //    pedidos — várias entregas, vários mínimos, várias conversas.
  //  · UM FORNECEDOR SÓ costuma custar um pouco mais e resolve numa entrega;
  //    é o que ganha quando o frete, o prazo ou a relação valem mais que a
  //    diferença de centavos.
  //
  // Mexer numa célula depois disso vira "personalizado": a tela para de
  // reescrever a escolha por baixo da mão de quem está decidindo.
  const [modo, setModo] = useState<"melhor" | "fornecedor" | "manual">("melhor");
  const [fornecedorUnico, setFornecedorUnico] = useState<string | null>(null);

  // Quem recebeu a lista e ainda não voltou. Decidir a compra sem saber que
  // falta gente é o erro caro desta tela — a proposta que não chegou pode ser
  // a boa.

  /** Volta tudo à quantidade cotada — trocar de estratégia zera a promoção. */
  function zerarQuantidades() {
    setQuantidades(Object.fromEntries(cotacao.itens.map((i) => [i.id, i.quantidade])));
  }

  function aplicarMelhorPreco() {
    setModo("melhor");
    setFornecedorUnico(null);
    zerarQuantidades();
    setEscolhas(
      Object.fromEntries(
        cotacao.itens.map((i) => [i.id, melhorPorItem.get(i.id)?.conviteId ?? null]),
      ),
    );
  }

  function aplicarFornecedor(conviteId: string) {
    setModo("fornecedor");
    setFornecedorUnico(conviteId);
    zerarQuantidades();
    const convite = respondidos.find((c) => c.id === conviteId);
    setEscolhas(
      Object.fromEntries(
        cotacao.itens.map((i) => {
          const r = convite?.respostas.find((x) => x.quotationItemId === i.id);
          // O que ele não tem fica de fora em vez de cair no vizinho: quem
          // pediu "tudo de um fornecedor" quer ver o buraco, não um remendo.
          return [i.id, r?.disponivel ? conviteId : null];
        }),
      ),
    );
  }

  const decidida = cotacao.status === "DECIDIDA";

  // Cesta escolhida × a mesma cesta no fornecedor único mais barato: a
  // diferença entre as duas é o que a cotação rendeu.
  const totalEscolhido = cotacao.itens.reduce((acc, item) => {
    const conviteId = escolhas[item.id];
    const convite = conviteId ? respondidos.find((c) => c.id === conviteId) : undefined;
    if (!convite) return acc;
    const preco = precoDe(item, convite);
    return preco === null ? acc : acc + preco * quantidadeDe(item);
  }, 0);

  /** Ele cotou a lista inteira? Sem isso o total dele não é comparável. */
  function cobreTudo(c: ConviteCotacao): boolean {
    return cotacao.itens.every((i) =>
      c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
    );
  }

  /**
   * Total deste fornecedor com as quantidades da TELA, frete incluso — e não
   * `c.total`, que é a soma da leitura. Senão o cabeçalho ignoraria a promoção
   * que as células logo abaixo estão mostrando.
   */
  function totalDe(c: ConviteCotacao): number {
    return (
      cotacao.itens.reduce((acc, i) => {
        const preco = precoDe(i, c);
        return preco === null ? acc : acc + preco * quantidadeDe(i);
      }, 0) + (c.frete ?? 0)
    );
  }

  /**
   * Total do fornecedor na quantidade COTADA, com frete. É a conta das duas
   * prévias da decisão: elas comparam estratégias, e comparar com a promoção
   * já levada num dos lados responderia outra pergunta.
   */
  function totalBaseDe(c: ConviteCotacao): number {
    return (
      cotacao.itens.reduce((acc, i) => {
        const r = c.respostas.find((x) => x.quotationItemId === i.id);
        return r?.disponivel ? acc + r.precoUnitario * i.quantidade : acc;
      }, 0) + (c.frete ?? 0)
    );
  }

  const totaisCheios = respondidos
    .filter(cobreTudo)
    .map((c) => ({ id: c.id, nome: c.supplierNome, total: totalDe(c) }));

  const melhorCheio = totaisCheios.length
    ? totaisCheios.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  /**
   * O que cada estratégia CUSTA, calculado antes de o operador escolher.
   *
   * A pergunta "como deseja comprar?" só é respondível com o número ao lado:
   * dividir entre fornecedores rende mais no papel, mas quanto? Sem a conta, a
   * escolha vira preferência — e é dinheiro.
   *
   * Fretes entram nos dois lados, e é aí que a divisão às vezes perde: três
   * fornecedores são três fretes.
   */
  const previaMelhor = (() => {
    let total = 0;
    let itens = 0;
    const deQuem = new Set<string>();
    for (const i of cotacao.itens) {
      const m = melhorPorItem.get(i.id);
      if (!m) continue;
      itens += 1;
      total += m.preco * i.quantidade;
      deQuem.add(m.conviteId);
    }
    for (const id of deQuem) total += respondidos.find((c) => c.id === id)?.frete ?? 0;
    return { itens, total, fornecedores: deQuem.size };
  })();

  /** O fornecedor único em avaliação: o escolhido, ou o mais barato que cobre tudo. */
  const conviteUnico =
    respondidos.find((c) => c.id === (fornecedorUnico ?? melhorCheio?.id)) ??
    respondidos[0] ??
    null;

  const previaUnico = conviteUnico
    ? {
        nome: conviteUnico.supplierNome,
        total: totalBaseDe(conviteUnico),
        atende: cotacao.itens.filter((i) =>
          conviteUnico.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
        ).length,
      }
    : null;

  const resultadoMelhor = `${previaMelhor.itens} ${previaMelhor.itens === 1 ? "item" : "itens"} · ${fmtMoney(previaMelhor.total)}${previaMelhor.fornecedores > 1 ? ` · ${previaMelhor.fornecedores} pedidos` : ""}`;

  const resultadoUnico = previaUnico
    ? `${previaUnico.nome} · ${fmtMoney(previaUnico.total)}${previaUnico.atende < cotacao.itens.length ? ` · ${previaUnico.atende} de ${cotacao.itens.length} itens` : ""}`
    : null;

  /**
   * Quem a opção "um único fornecedor" seleciona ao ser clicada — o MESMO que
   * a prévia dela anuncia. Sem isto, o cartão dizia "FLAMARSUL · R$ 215,64" e
   * o clique caía no primeiro convite da lista, que quase nunca é ele.
   */
  const idUnicoSugerido = conviteUnico?.id ?? null;

  const itensEscolhidos = Object.entries(escolhas).filter(([, v]) => v !== null).length;

  /**
   * O chip da aba no celular dizia "Comparar (3)" — fornecedores que
   * responderam, que não é a pergunta em aberto. Quantos itens ainda faltam
   * decidir só existe aqui dentro, então sai por aqui.
   */
  const totalItens = cotacao.itens.length;
  useEffect(() => {
    onProgresso?.({ escolhidos: itensEscolhidos, total: totalItens });
  }, [onProgresso, itensEscolhidos, totalItens]);

  /**
   * O que a estratégia atual rende contra comprar tudo do fornecedor único mais
   * barato. É a pergunta do rodapé — "vale a pena dividir?" — e não a economia
   * contra a pior proposta, que já está no totalizador lá em cima.
   */
  const economiaDividindo = melhorCheio ? melhorCheio.total - totalEscolhido : 0;

  /**
   * Conclui a cotação. NÃO envia nada ao fornecedor: os pedidos nascem em
   * rascunho e ficam esperando a revisão — o botão de enviar mora na tela do
   * pedido, que é onde o comprador ainda pode cortar quantidade e conferir o
   * combinado. Aqui o clique só fecha a decisão.
   *
   * `pendente` trava o botão enquanto roda e o servidor é idempotente, então
   * duplo clique e F5 não geram uma segunda leva de pedidos.
   */
  function concluir() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      try {
        const r = await concluirCotacaoAction({
          quotationId: cotacao.id,
          escolhas: Object.entries(escolhas)
            .filter(([, conviteId]) => conviteId !== null)
            .map(([quotationItemId, conviteId]) => ({
              quotationItemId,
              conviteId: conviteId as string,
              // O servidor reconfere o preço desta quantidade contra as faixas
              // gravadas — aqui vai só o "quanto", nunca o "por quanto".
              quantidade: quantidades[quotationItemId] ?? null,
            })),
        });
        const recados = [
          r.semProduto.length > 0
            ? `Ficaram de fora ${r.semProduto.length} ${r.semProduto.length === 1 ? "item que não está" : "itens que não estão"} vinculados ao catálogo: ${r.semProduto.join(", ")}.`
            : null,
          r.jaTinhamPedido.length > 0
            ? `${r.jaTinhamPedido.join(", ")} já ${r.jaTinhamPedido.length === 1 ? "tinha" : "tinham"} pedido desta cotação — nenhum pedido novo foi criado para ${r.jaTinhamPedido.length === 1 ? "ele" : "eles"}.`
            : null,
        ].filter(Boolean) as string[];

        if (recados.length > 0) {
          avisar("aviso", recados.join(" "));
        } else if (mobile && paraEnviar === 0) {
          toast.success(
            r.pedidos.length === 1
              ? "Pedido criado em rascunho"
              : `${r.pedidos.length} pedidos criados em rascunho`,
          );
        }
        setConfirmando(false);
        // Os pedidos marcados "enviar agora" seguem para a folha de envio. Os
        // outros ficam em rascunho, e o painel "Compra definida" aponta para eles.
        const fornecedoresParaEnviar = new Set(
          pedidosPrevistos.filter((x) => escolhaDe(x) === "enviar").map((x) => x.supplierId),
        );
        const ids = r.pedidos
          .filter((p) => p.status === "RASCUNHO" && fornecedoresParaEnviar.has(p.supplierId))
          .map((p) => p.id);
        if (ids.length > 0) setEnviarIds(ids);
        router.refresh();
      } catch (e) {
        avisar("erro", e instanceof Error ? e.message : "Não foi possível concluir a cotação.");
      }
    });
  }

  if (respondidos.length === 0) {
    return (
      <EstadoVazio
        icon={<Scale size={20} />}
        titulo="Ninguém respondeu ainda"
        descricao="Assim que você registrar a primeira resposta, o comparativo aparece aqui com o melhor preço de cada item."
      />
    );
  }

  const nomeFornecedorUnico = fornecedorUnico
    ? (respondidos.find((c) => c.id === fornecedorUnico)?.supplierNome ?? null)
    : null;

  // Itens que o fornecedor escolhido não atende — o preço de fechar com ele.
  const foraDoFornecedor =
    modo === "fornecedor"
      ? cotacao.itens.filter((i) => escolhas[i.id] === null).length
      : 0;

  /** A estratégia em uma linha — é o que a barra do celular mostra. */
  const rotuloModo =
    modo === "melhor"
      ? "Melhor preço por item"
      : modo === "fornecedor"
        ? (nomeFornecedorUnico ?? "Um único fornecedor")
        : "Escolha personalizada";

  /**
   * O parágrafo do rodapé do desktop concatena tudo numa frase. Em 390px ela
   * embrulha em quatro linhas e empurra o botão para fora — aqui vira uma
   * linha só, truncada, com o total assumindo o destaque sozinho.
   */
  const detalheRodape =
    itensEscolhidos === 0
      ? "Escolha de quem comprar cada item."
      : [
          `${itensEscolhidos}/${cotacao.itens.length} escolhidos`,
          foraDoFornecedor > 0 ? `${foraDoFornecedor} sem cotação dele` : null,
          comPromocao > 0 ? `${comPromocao} acima do cotado` : null,
          economiaDividindo > 0.005 ? `economia ${fmtMoney(economiaDividindo)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  /** Em quantos pedidos a escolha vai virar, de quanto cada um, e se dá para enviar já. */
  const pedidosPrevistos = respondidos
    .map((c) => {
      const itens = cotacao.itens.filter((i) => escolhas[i.id] === c.id);
      const total = itens.reduce((acc, i) => {
        const preco = precoDe(i, c);
        return preco === null ? acc : acc + preco * quantidadeDe(i);
      }, 0);
      const avisosCusto = custos.get(c.id)?.avisos ?? [];
      const decisao: DecisaoEnvio = decidirEnvio({
        itensForaDoCatalogo: itens.filter((i) => !i.productId).length,
        itensAcimaDoCotado: itens.filter((i) => quantidadeDe(i) > i.quantidade).length,
        itensComMarcaDivergente: itens.filter((i) => marcasDivergemNoItem(i.id)).length,
        total,
        pedidoMinimo: c.supplierPedidoMinimo,
        respostaManual: c.origemResposta === "manual",
        prazoDesconhecido: avisosCusto.includes("prazo-desconhecido"),
        temContato:
          !!(c.telefone || c.email) || c.contatos.some((x) => !!(x.telefone || x.email)),
        jaTemPedido: !!c.purchaseOrderId,
      });
      return {
        id: c.id,
        supplierId: c.supplierId,
        nome: c.supplierNome,
        logoUrl: c.supplierLogoUrl,
        itens: itens.length,
        total,
        decisao,
      };
    })
    .filter((x) => x.itens > 0);

  /** O que cada pedido vai fazer: a escolha da pessoa, ou a sugestão da regra. */
  const escolhaDe = (x: (typeof pedidosPrevistos)[number]): EscolhaEnvio =>
    x.decisao.bloqueio ? "revisar" : (envioEscolha[x.id] ?? x.decisao.sugestao);
  const paraEnviar = pedidosPrevistos.filter((x) => escolhaDe(x) === "enviar").length;
  const paraRevisar = pedidosPrevistos.length - paraEnviar;

  /** Abre a conferência com a sugestão de cada fornecedor já marcada. */
  function abrirConferencia() {
    const preferencia = lerPreferenciaEnvio();
    setEnvioEscolha(
      Object.fromEntries(
        pedidosPrevistos.map((x) => [
          x.id,
          x.decisao.sugestao === "enviar" && preferencia === "enviar" ? "enviar" : "revisar",
        ]),
      ),
    );
    setConfirmando(true);
  }

  function escolherEnvio(conviteId: string, v: EscolhaEnvio) {
    setEnvioEscolha((e) => ({ ...e, [conviteId]: v }));
    // Só pedido limpo ensina a preferência — trocar um pedido com aviso para
    // "revisar" não diz nada sobre o hábito da pessoa.
    const x = pedidosPrevistos.find((p) => p.id === conviteId);
    if (x && x.decisao.sugestao === "enviar") gravarPreferenciaEnvio(v);
  }

  /**
   * Um pedido ou vários? A resposta é a contagem de fornecedores escolhidos, e
   * não o modo: "melhor preço por item" pode terminar com um fornecedor só, e
   * aí o plural prometeria uma divisão que não vai acontecer.
   */
  const umPedidoSo = pedidosPrevistos.length === 1;
  /**
   * "Gerar pedido para FLAMARSUL" mentia duas vezes: escondia que a COTAÇÃO
   * termina aqui e sugeria que algo sai para o fornecedor. O rótulo agora diz
   * as duas coisas que acontecem de fato — conclui e gera — e conta quantos.
   */
  const rotuloConcluir = umPedidoSo
    ? "Concluir e gerar pedido"
    : pedidosPrevistos.length > 1
      ? `Concluir e gerar ${pedidosPrevistos.length} pedidos`
      : "Concluir cotação";

  /** O botão da conferência diz o que acontece com os pedidos. */
  const rotuloConfirmar =
    paraEnviar === 0
      ? umPedidoSo
        ? "Concluir e revisar o pedido"
        : "Concluir e revisar os pedidos"
      : paraRevisar === 0
        ? umPedidoSo
          ? "Concluir e enviar o pedido"
          : `Concluir e enviar ${paraEnviar} pedidos`
        : `Concluir · enviar ${paraEnviar} e revisar ${paraRevisar}`;

  /** Alguém ofereceu promoção por volume neste item? */
  function temPromocaoNoItem(item: ItemCotacao): boolean {
    return respondidos.some((c) => {
      const r = c.respostas.find((x) => x.quotationItemId === item.id);
      return !!r?.disponivel && r.faixas.length > 0;
    });
  }

  /** Por que este item pede decisão — ou null, quando o vencedor é claro. */
  function atencaoDe(item: ItemCotacao): Atencao | null {
    const melhor = melhorPorItem.get(item.id);
    const respostaMelhor = melhor
      ? respondidos
          .find((c) => c.id === melhor.conviteId)
          ?.respostas.find((x) => x.quotationItemId === item.id)
      : undefined;
    return atencaoDoItem({
      valores: respondidos
        .map((c) => valorDe(item, c))
        .filter((v): v is number => v !== null),
      respondidos: respondidos.length,
      melhorParcial:
        respostaMelhor?.quantidadeOfertada != null &&
        respostaMelhor.quantidadeOfertada < item.quantidade,
      marcasDivergem: marcasDivergemNoItem(item.id),
      temPromocao: temPromocaoNoItem(item),
    });
  }
  const atencaoPorItem = new Map(cotacao.itens.map((i) => [i.id, atencaoDe(i)]));

  function passaNoFiltro(item: ItemCotacao, f: FiltroItens): boolean {
    if (f === "pendentes") return !escolhas[item.id];
    if (f === "atencao") return !decidida && !!atencaoPorItem.get(item.id);
    if (f === "promocao") return temPromocaoNoItem(item);
    if (f === "marca") return marcasDivergemNoItem(item.id);
    return true;
  }

  const contagemFiltro = {
    todos: cotacao.itens.length,
    pendentes: cotacao.itens.filter((i) => passaNoFiltro(i, "pendentes")).length,
    atencao: cotacao.itens.filter((i) => passaNoFiltro(i, "atencao")).length,
    promocao: cotacao.itens.filter((i) => passaNoFiltro(i, "promocao")).length,
    marca: cotacao.itens.filter((i) => passaNoFiltro(i, "marca")).length,
  } satisfies Record<FiltroItens, number>;

  // Tabela COMPLETA, com o que pede decisão no topo (ordenação estável: dentro
  // de cada grupo, a ordem da lista que o comprador montou).
  const itensVisiveis = cotacao.itens
    .filter((i) => passaNoFiltro(i, filtro))
    .sort((a, b) =>
      decidida ? 0 : (atencaoPorItem.get(a.id) ? 0 : 1) - (atencaoPorItem.get(b.id) ? 0 : 1),
    );
  /** A cotação não aceita mais resposta: quem não respondeu, não responde mais. */
  const fechada = cotacao.status !== "ABERTA";

  /** Convidados que ainda podem responder — colunas cinza na matriz. */
  const aguardando = cotacao.convites.filter(
    (c) => c.status === "ENVIADA" || c.status === "PENDENTE",
  );



  const editavelMatriz = podePedir && !decidida;
  /** Tabela só de leitura: recebendo propostas, concluída, ou sem permissão. */
  const leitura = fase === "recebendo" || !editavelMatriz;
  /**
   * Há algo além do preço que muda a conta? Frete, ou prazos de pagamento
   * diferentes entre quem respondeu. Sem isso, "comparar por" não existe.
   */
  const temExtras =
    respondidos.some((c) => (c.frete ?? 0) > 0) ||
    new Set(respondidos.map((c) => c.prazoPagamentoDias ?? prazoPagamentoEmDias(c.condicaoPagamento) ?? -1))
      .size > 1;

  type Recomendacao = {
    id: string;
    texto: string;
    tom: "acao" | "info" | "alerta";
    acao?: { rotulo: string; onClick: () => void };
  };
  const recomendacoes: Recomendacao[] = [];
  if (editavelMatriz) {
    const unico = melhorCheio ? respondidos.find((c) => c.id === melhorCheio.id) : undefined;
    if (unico && previaMelhor.fornecedores > 1 && modo !== "fornecedor") {
      const extra = totalBaseDe(unico) - previaMelhor.total;
      recomendacoes.push({
        id: "um-so",
        tom: "acao",
        texto:
          extra <= 0.005
            ? `Fechar tudo com ${unico.supplierNome} sai pelo mesmo valor e vira 1 pedido em vez de ${previaMelhor.fornecedores}.`
            : `Fechar tudo com ${unico.supplierNome} custa ${fmtMoney(extra)} a mais e vira 1 pedido em vez de ${previaMelhor.fornecedores}.`,
        acao: { rotulo: "Fechar com um só", onClick: () => aplicarFornecedor(unico.id) },
      });
    }
    if (modo !== "melhor" && previaMelhor.itens > 0) {
      const ganho = totalEscolhido - previaMelhor.total;
      if (ganho > 0.005) {
        recomendacoes.push({
          id: "melhor",
          tom: "acao",
          texto: `O melhor preço por item economiza ${fmtMoney(ganho)} em relação à escolha atual.`,
          acao: { rotulo: "Usar melhor preço", onClick: aplicarMelhorPreco },
        });
      }
    }
  }
  const quemFalta = aguardando.filter((c) => c.status === "ENVIADA");
  if (quemFalta.length > 0 && !fechada) {
    recomendacoes.push({
      id: "cobrar",
      tom: "alerta",
      texto: `${quemFalta.map((c) => c.supplierNome).join(", ")} ainda não ${quemFalta.length === 1 ? "respondeu" : "responderam"} — a proposta que falta pode ser a melhor.`,
      acao: onCobrar && editavelMatriz
        ? { rotulo: quemFalta.length === 1 ? "Cobrar" : "Cobrar todos", onClick: () => onCobrar(quemFalta) }
        : undefined,
    });
  }
  const ninguem = cotacao.itens.filter((i) => atencaoPorItem.get(i.id)?.tipo === "ninguem").length;
  if (ninguem > 0 && !decidida) {
    recomendacoes.push({
      id: "ninguem",
      tom: "info",
      texto: `${ninguem} ${ninguem === 1 ? "item não recebeu" : "itens não receberam"} nenhuma proposta e ${ninguem === 1 ? "fica" : "ficam"} fora dos pedidos.`,
    });
  }

  /**
   * Teclado na matriz: ↑/↓ (ou j/k) andam de linha, 1–9 escolhem o fornecedor
   * daquela coluna, 0 limpa. Quem decide 40 itens não quer mirar 40 cliques.
   */
  function aoTeclarMatriz(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const total = linhasNaTela.length;
    if (total === 0) return;
    const atual = linhaAtiva ?? -1;
    let proxima: number | null = null;
    if (e.key === "ArrowDown" || e.key === "j") proxima = Math.min(total - 1, atual + 1);
    else if (e.key === "ArrowUp" || e.key === "k") proxima = Math.max(0, atual - 1);
    if (proxima !== null) {
      e.preventDefault();
      setLinhaAtiva(proxima);
      linhasRef.current[proxima]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (linhaAtiva === null || !editavelMatriz) return;
    const item = linhasNaTela[linhaAtiva];
    if (!item) return;
    if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setModo("manual");
      setEscolhas((x) => ({ ...x, [item.id]: null }));
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const convite = respondidos[Number(e.key) - 1];
      if (!convite || precoDe(item, convite) === null) return;
      e.preventDefault();
      setModo("manual");
      setEscolhas((x) => ({ ...x, [item.id]: convite.id }));
      // Escolheu, desce: o ritmo de quem está decidindo a lista inteira.
      const seguinte = Math.min(total - 1, linhaAtiva + 1);
      setLinhaAtiva(seguinte);
      linhasRef.current[seguinte]?.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Tabela do computador ───────────────────────────────────
  // RECEBENDO (ou concluída): só leitura, na ordem da lista. DECIDINDO: o que
  // pede decisão sobe, e os itens com vencedor claro ficam recolhidos numa
  // linha — a tabela inteira continua a um clique.
  const itensTabela = leitura
    ? cotacao.itens
    : [...cotacao.itens].sort(
        (a, b) => (atencaoPorItem.get(a.id) ? 0 : 1) - (atencaoPorItem.get(b.id) ? 0 : 1),
      );
  const qtdAtencaoTab = leitura ? 0 : itensTabela.filter((i) => atencaoPorItem.get(i.id)).length;
  const recolher = !leitura && qtdAtencaoTab > 0 && !mostrarClaros;
  const linhasNaTela = recolher ? itensTabela.slice(0, qtdAtencaoTab) : itensTabela;
  const itensClaros = itensTabela.slice(qtdAtencaoTab);
  const totalClaros = itensClaros.reduce((acc, item) => {
    const c = respondidos.find((x) => x.id === escolhas[item.id]);
    const preco = c ? precoDe(item, c) : null;
    return preco === null ? acc : acc + preco * quantidadeDe(item);
  }, 0);
  const colunas = respondidos.length + aguardando.length + 2;
  const recomendacao = leitura ? null : (recomendacoes.find((r) => r.tom === "acao") ?? null);

  return (
    <div className="flex flex-col gap-3">
      {/* DECIDINDO: como comprar, numa linha. */}
      {!mobile && !leitura && (
        <BarraDecisao
          modo={modo}
          totalMelhor={previaMelhor.total}
          pedidosMelhor={previaMelhor.fornecedores}
          opcoesUnico={respondidos.map((c) => ({
            id: c.id,
            nome: c.supplierNome,
            total: totalBaseDe(c),
            atende: c.itensAtendidos,
          }))}
          totalItens={cotacao.itens.length}
          unicoAtual={fornecedorUnico ?? idUnicoSugerido}
          totalManual={modo === "manual" ? totalEscolhido : null}
          onMelhor={aplicarMelhorPreco}
          onFornecedor={aplicarFornecedor}
          criterio={
            temExtras ? (
              <SeletorCriterio
                criterio={criterio}
                onCriterio={trocarCriterio}
                taxaMes={taxaMes}
                onTaxaMes={setTaxaMes}
                taxaPadrao={cotacao.custoCapitalMesPct}
                podeSalvar={podePedir}
              />
            ) : null
          }
          recomendacao={recomendacao}
        />
      )}

      {!leitura && temFaixa && (
        <AlternadorLente lente={lente} onLente={setLente} onNecessidade={zerarQuantidades} />
      )}

      {!leitura && lente === "oportunidade" && (
        <LenteOportunidade
          itens={cotacao.itens}
          respondidos={respondidos}
          superficie={superficie}
          limites={limites}
          onLimites={setLimites}
          escolhas={escolhas}
          quantidades={quantidades}
          editavel={editavelMatriz}
          onAplicarFaixa={aplicarFaixa}
          onAplicarTodas={aplicarSugestoes}
        />
      )}

      {(leitura || lente === "necessidade") && (
        <>
          <div
            tabIndex={leitura ? undefined : 0}
            onKeyDown={leitura ? undefined : aoTeclarMatriz}
            onFocus={() => {
              if (!leitura && linhaAtiva === null && linhasNaTela.length > 0) setLinhaAtiva(0);
            }}
            aria-label={
              leitura
                ? "Preços recebidos"
                : "Escolha de quem comprar. Setas mudam de item; teclas 1 a 9 escolhem o fornecedor; 0 limpa."
            }
            className={cn(
              "max-h-[70vh] overflow-auto rounded-[var(--radius-lg)] border border-line bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
              mobile ? "hidden" : "hidden md:block",
            )}
          >
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="sticky top-0 left-0 z-30 w-[36%] min-w-[15rem] border-b border-line bg-surface-2 px-3 py-2 text-left font-medium">
                    Item
                  </th>
                  <th className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-2 text-right font-medium">
                    Qtd
                  </th>
                  {respondidos.map((c, coluna) => {
                    const melhorGeral = melhorCheio?.id === c.id && respondidos.length > 1;
                    const foco = destaque === c.id;
                    const eleito = !leitura && modo === "fornecedor" && fornecedorUnico === c.id;
                    return (
                      <th
                        key={c.id}
                        onMouseEnter={() => onDestaque?.(c.id)}
                        onMouseLeave={() => onDestaque?.(null)}
                        title={[
                          c.supplierNome,
                          cobreTudo(c)
                            ? `cotou os ${cotacao.itens.length} itens`
                            : `cotou ${c.itensAtendidos} de ${cotacao.itens.length} itens`,
                          condicaoCurta(c),
                          !leitura && coluna < 9 ? `tecla ${coluna + 1}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        className={cn(
                          "sticky top-0 z-20 border-b border-line px-3 py-2 text-right font-medium transition-colors",
                          foco || eleito ? "bg-brand-soft" : "bg-surface-2",
                        )}
                      >
                        <span className="flex items-center justify-end gap-1">
                          {melhorGeral && <Trophy size={11} className="shrink-0 text-ok" aria-hidden />}
                          <span
                            className={cn(
                              "max-w-[9rem] truncate normal-case text-[12px]",
                              foco || eleito ? "text-brand" : "text-ink-2",
                            )}
                          >
                            {c.supplierNome}
                          </span>
                        </span>
                      </th>
                    );
                  })}
                  {aguardando.map((c) => (
                    <th
                      key={c.id}
                      onMouseEnter={() => onDestaque?.(c.id)}
                      onMouseLeave={() => onDestaque?.(null)}
                      className={cn(
                        "sticky top-0 z-20 border-b border-line px-3 py-2 text-right font-medium transition-colors",
                        destaque === c.id ? "bg-brand-soft" : "bg-surface-2",
                      )}
                    >
                      <span className="block max-w-[9rem] truncate text-[12px] normal-case text-faint">
                        {c.supplierNome}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {qtdAtencaoTab > 0 && (
                  <tr>
                    <td
                      colSpan={colunas}
                      className="border-b border-line bg-accent-soft/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent"
                    >
                      Precisa da sua decisão · {qtdAtencaoTab}
                    </td>
                  </tr>
                )}
                {linhasNaTela.map((item, linha) => {
                  const melhor = melhorPorItem.get(item.id);
                  const precosDaLinha = respondidos
                    .map((c) => valorDe(item, c))
                    .filter((x): x is number => x !== null);
                  const melhorDaLinha = precosDaLinha.length ? Math.min(...precosDaLinha) : 0;
                  const marcasDivergem = marcasDivergemNoItem(item.id);
                  const ativa = !leitura && linhaAtiva === linha;
                  const atencao = leitura ? null : (atencaoPorItem.get(item.id) ?? null);
                  // Ao abrir os recolhidos, eles ganham o próprio cabeçalho.
                  const inicioClaros = !leitura && qtdAtencaoTab > 0 && linha === qtdAtencaoTab;
                  return (
                    <Fragment key={item.id}>
                      {inicioClaros && (
                        <tr>
                          <td colSpan={colunas} className="border-b border-line px-3 py-1.5">
                            <button
                              type="button"
                              onClick={() => setMostrarClaros(false)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-faint hover:text-ink"
                            >
                              <ChevronDown size={12} aria-hidden />
                              Com vencedor claro · {itensClaros.length}
                            </button>
                          </td>
                        </tr>
                      )}
                      <tr
                        ref={(el) => {
                          linhasRef.current[linha] = el;
                        }}
                        onClick={leitura ? undefined : () => setLinhaAtiva(linha)}
                        aria-selected={ativa || undefined}
                        className={cn(
                          "border-b border-line last:border-b-0",
                          ativa && "outline-2 -outline-offset-2 outline-brand",
                        )}
                      >
                        <td
                          className="sticky left-0 z-10 bg-surface px-3 py-1.5"
                          title={[item.descricao, item.sku ?? "fora do catálogo"].join(" · ")}
                        >
                          <span className="flex items-center gap-2">
                            <Thumb url={item.imagemUrl} nome={item.descricao} size={24} />
                            <span className="min-w-0 truncate text-[13px] text-ink">{item.descricao}</span>
                            {atencao && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                <AlertTriangle size={10} aria-hidden />
                                {atencao.texto}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-[12px] text-muted">
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              quantidadeDe(item) > item.quantidade ? "font-semibold text-accent" : "text-ink-2",
                            )}
                          >
                            {fmtQtd(quantidadeDe(item))}
                          </span>{" "}
                          {unidadeDaQtd(quantidadeDe(item), item.embalagemNome)}
                        </td>

                        {respondidos.map((c) => {
                          const r = c.respostas.find((x) => x.quotationItemId === item.id);
                          const foco = destaque === c.id;
                          if (!r?.disponivel) {
                            return (
                              <td
                                key={c.id}
                                className={cn(
                                  "px-3 py-1.5 text-right text-[12px] text-faint transition-colors",
                                  foco && "bg-brand-soft/40",
                                )}
                              >
                                não tem
                              </td>
                            );
                          }
                          const preco = precoDe(item, c) ?? r.precoUnitario;
                          const valor = valorDe(item, c) ?? preco;
                          const escolhido = !leitura && escolhas[item.id] === c.id;
                          const ehMelhor = melhor?.conviteId === c.id && precosDaLinha.length > 1;
                          const tom = precosDaLinha.length > 1 ? calor(valor, melhorDaLinha) : "neutro";
                          const acimaPct =
                            precosDaLinha.length > 1 && melhorDaLinha > 0 && valor - melhorDaLinha >= 0.005
                              ? ((valor - melhorDaLinha) / melhorDaLinha) * 100
                              : null;
                          const falta = faltaTexto(r.quantidadeOfertada, item.quantidade);
                          const comFaixa = preco < r.precoUnitario;
                          const vari = item.productId
                            ? variacao(r.precoUnitario, referencias[`${c.supplierId}:${item.productId}`])
                            : null;
                          const nota = falta ?? (comFaixa ? "promoção por volume" : marcasDivergem ? r.marca : null);
                          const titulo = [
                            criterio === "custo" ? `preço ${fmtPreco(preco)} · efetivo ${fmtPreco(valor)}` : null,
                            falta,
                            comFaixa ? "promoção por volume" : null,
                            r.marca ? `marca ${r.marca}` : null,
                            vari ? `${vari.texto} contra a última compra` : null,
                            `${fmtMoney(preco * quantidadeDe(item))} no item`,
                          ]
                            .filter(Boolean)
                            .join(" · ");

                          const conteudo = (
                            <>
                              <span className="flex items-center justify-end gap-1.5">
                                {ehMelhor && (
                                  <Trophy
                                    size={11}
                                    className={cn("shrink-0", escolhido ? "text-on-brand" : "text-ok")}
                                    aria-label="melhor da linha"
                                  />
                                )}
                                <span
                                  className={cn(
                                    "font-mono text-[13px] tabular-nums",
                                    escolhido || ehMelhor ? "font-semibold" : "",
                                  )}
                                >
                                  {fmtPreco(valor)}
                                </span>
                                {acimaPct !== null && (
                                  <span
                                    className={cn(
                                      "font-mono text-[10px] tabular-nums",
                                      escolhido
                                        ? "text-on-brand/80"
                                        : tom === "longe"
                                          ? "text-danger"
                                          : tom === "acima"
                                            ? "text-accent"
                                            : "text-faint",
                                    )}
                                  >
                                    +{acimaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                                  </span>
                                )}
                              </span>
                              {nota && (
                                <span
                                  className={cn(
                                    "block text-[10px]",
                                    escolhido ? "text-on-brand/80" : "text-accent",
                                  )}
                                >
                                  {nota}
                                </span>
                              )}
                            </>
                          );

                          return (
                            <td
                              key={c.id}
                              className={cn("px-2 py-1 text-right transition-colors", foco && "bg-brand-soft/40")}
                            >
                              {leitura ? (
                                <span
                                  title={titulo}
                                  className={cn("inline-block px-1.5 py-0.5", ehMelhor ? "text-ok" : "text-ink")}
                                >
                                  {conteudo}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setModo("manual");
                                    setEscolhas((e) => ({
                                      ...e,
                                      [item.id]: e[item.id] === c.id ? null : c.id,
                                    }));
                                  }}
                                  aria-pressed={escolhido}
                                  title={titulo}
                                  className={cn(
                                    "inline-block rounded-full px-2.5 py-0.5 transition-[background-color,color,transform] duration-150 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
                                    escolhido
                                      ? "bg-brand text-on-brand shadow-sm"
                                      : cn(
                                          "hover:bg-surface-2",
                                          ehMelhor ? "text-ok" : "text-ink",
                                          CLASSE_CALOR[tom],
                                        ),
                                  )}
                                >
                                  {conteudo}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        {aguardando.map((c) => (
                          <td
                            key={c.id}
                            className={cn(
                              "px-3 py-1.5 text-right text-[12px] text-faint transition-colors",
                              destaque === c.id && "bg-brand-soft/40",
                            )}
                          >
                            {fechada ? "—" : "…"}
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  );
                })}
                {recolher && (
                  <tr>
                    <td colSpan={colunas} className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setMostrarClaros(true)}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
                      >
                        <ChevronRight size={13} aria-hidden />
                        {itensClaros.length} {itensClaros.length === 1 ? "item" : "itens"} com vencedor
                        claro
                        <span className="font-mono tabular-nums text-muted">
                          · {fmtMoney(totalClaros)}
                        </span>
                        <span className="text-brand">mostrar</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!mobile && !leitura && (
            <div className="hidden md:block">
              <LeituraDaCotacao resumo={resumo} />
            </div>
          )}

          {/* Celular: um produto por vez. */}
          <div className={cn("flex flex-col gap-3", !mobile && "md:hidden")}>
            {temExtras && (
              <SeletorCriterio
                criterio={criterio}
                onCriterio={trocarCriterio}
                taxaMes={taxaMes}
                onTaxaMes={setTaxaMes}
                taxaPadrao={cotacao.custoCapitalMesPct}
                podeSalvar={podePedir}
              />
            )}
            {mobile && cotacao.itens.length >= 5 && (
              <div
                role="radiogroup"
                aria-label="Filtrar itens"
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5"
              >
                {(Object.keys(ROTULO_FILTRO) as FiltroItens[]).map((f) => {
                  const ativo = filtro === f;
                  const n = contagemFiltro[f];
                  if (n === 0 && f !== "todos") return null;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setFiltro(f)}
                      className={cn(
                        "min-h-11 shrink-0 rounded-full border px-3 text-[13px] font-medium transition-colors",
                        ativo
                          ? "border-transparent bg-brand text-on-brand"
                          : "border-line bg-surface text-ink-2",
                      )}
                    >
                      {ROTULO_FILTRO[f]}{" "}
                      <span className={cn("font-mono tabular-nums", ativo ? "text-on-brand/80" : "text-faint")}>
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {itensVisiveis.length === 0 ? (
              <p className="rounded-[var(--radius-lg)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                Nenhum item neste filtro.{" "}
                <button
                  type="button"
                  onClick={() => setFiltro("todos")}
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  Ver todos
                </button>
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {itensVisiveis.map((item) => (
                  <CardItem
                    key={item.id}
                    item={item}
                    quantidade={quantidadeDe(item)}
                    respondidos={respondidos}
                    precoDe={(c) => precoDe(item, c)}
                    valorDe={(c) => valorDe(item, c)}
                    porCusto={criterio === "custo"}
                    melhorConviteId={melhorPorItem.get(item.id)?.conviteId ?? null}
                    escolhido={leitura ? null : (escolhas[item.id] ?? null)}
                    editavel={editavelMatriz}
                    mostrarMarca={marcasDivergemNoItem(item.id)}
                    atencao={leitura ? null : (atencaoPorItem.get(item.id) ?? null)}
                    onEscolher={(conviteId) => {
                      setModo("manual");
                      setEscolhas((e) => ({
                        ...e,
                        [item.id]: e[item.id] === conviteId ? null : conviteId,
                      }));
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}
      {aviso && (
        <p className="rounded-[var(--radius)] border border-line bg-accent-soft px-3.5 py-2 text-[13px] text-accent">
          {aviso}
        </p>
      )}

      {podePedir && !decidida && (
        <div
          style={
            mobile
              ? // A barra de abas do /m é `fixed bottom-0` com 64px de pílula
                // mais a área segura. Com `bottom-0`, o total e o botão de
                // gerar ficavam ATRÁS dela: a ação principal da tela, coberta.
                { bottom: "calc(4rem + max(0.75rem, env(safe-area-inset-bottom)) + 0.5rem)" }
              : undefined
          }
          className={cn(
            // Flutuante, como a barra de ações das Configurações: descolada da
            // borda, com fundo translúcido e desfoque — colada em bottom-0 ela
            // parecia o fim da página e sumia dentro do conteúdo.
            "sticky z-20 flex flex-col rounded-[var(--radius-lg)] border border-line-strong bg-surface/95 shadow-[var(--shadow-float)] backdrop-blur",
            mobile ? "gap-2 px-3 py-2.5" : "bottom-4 gap-2.5 px-4 py-3",
          )}
        >
          {/* O rodapé fixo tem UMA função: mostrar o que a escolha soma e
              fechar a compra. A pergunta "como deseja comprar?" subiu para uma
              seção logo abaixo da comparação, que é onde ela é respondível —
              aqui dentro ela obrigava a decidir olhando para o rodapé, não
              para os preços.

              No celular a estratégia continua numa folha: as duas opções, a
              fila de fornecedores e o parágrafo somavam quase metade de uma
              tela de 390px em cima de onde a compra fecha. */}
          {mobile ? (
            <>
              <button
                type="button"
                onClick={() => setEstrategiaAberta(true)}
                aria-haspopup="dialog"
                className="flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-line px-3 py-1.5 text-left transition-colors active:bg-surface-2"
              >
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">
                  Como comprar
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {rotuloModo}
                </span>
                <ChevronRight size={15} className="shrink-0 text-muted" aria-hidden />
              </button>

              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[17px] font-semibold leading-none tabular-nums text-ink">
                    {itensEscolhidos === 0 ? "—" : fmtMoney(totalEscolhido)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted">{detalheRodape}</p>
                </div>
                {/* Concluir fecha a cotação e o botão está colado no polegar:
                    no celular ele abre a conferência, não dispara. */}
                <button
                  type="button"
                  onClick={abrirConferencia}
                  disabled={pendente || itensEscolhidos === 0}
                  aria-haspopup="dialog"
                  className="min-h-11 shrink-0 rounded-full bg-brand px-5 text-sm font-semibold text-on-brand transition-colors disabled:opacity-50"
                >
                  {pendente ? "Concluindo…" : "Concluir cotação"}
                </button>
              </div>
            </>
          ) : (
            // Uma linha: o total, quem leva quanto, e o botão.
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[18px] font-semibold tabular-nums text-ink">
                  {itensEscolhidos === 0 ? "—" : fmtMoney(totalEscolhido)}
                </span>
                {economiaDividindo > 0.005 && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
                    <TrendingDown size={12} aria-hidden />
                    {fmtMoney(economiaDividindo)} a menos
                  </span>
                )}
                <span className="text-[12px] text-muted">
                  {itensEscolhidos}/{cotacao.itens.length} itens
                </span>
                {pedidosPrevistos.map((x) => (
                  <span
                    key={x.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-[12px]"
                  >
                    <SupplierAvatar nome={x.nome} logoUrl={x.logoUrl} size={16} />
                    <span className="max-w-[8rem] truncate text-ink-2">{x.nome}</span>
                    <span className="font-mono tabular-nums text-ink">{fmtMoney(x.total)}</span>
                  </span>
                ))}
                {(foraDoFornecedor > 0 || comPromocao > 0) && (
                  <span className="text-[12px] text-accent">
                    {[
                      foraDoFornecedor > 0 ? `${foraDoFornecedor} sem cotação dele` : null,
                      comPromocao > 0 ? `${comPromocao} acima do cotado` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={abrirConferencia}
                disabled={pendente || itensEscolhidos === 0}
                aria-haspopup="dialog"
                className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
              >
                {pendente ? "Concluindo…" : rotuloConcluir}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Folha: como deseja comprar? ───────────────────── */}
      {mobile && podePedir && !decidida && (
        <BottomSheet
          open={estrategiaAberta}
          onClose={() => setEstrategiaAberta(false)}
          titulo="Como deseja comprar?"
          descricao="Dividir entre fornecedores rende mais no papel; fechar com um só resolve em uma entrega."
          rodape={
            <button
              type="button"
              onClick={() => setEstrategiaAberta(false)}
              className="min-h-12 w-full rounded-full bg-brand text-sm font-semibold text-on-brand"
            >
              Pronto
            </button>
          }
        >
          <EstrategiaCompra
            modo={modo}
            respondidos={respondidos}
            totalItens={cotacao.itens.length}
            fornecedorUnico={fornecedorUnico}
            resultadoMelhor={resultadoMelhor}
            resultadoUnico={resultadoUnico}
            idUnicoSugerido={idUnicoSugerido}
            onMelhorPreco={aplicarMelhorPreco}
            onFornecedor={aplicarFornecedor}
            comTitulo={false}
          />
        </BottomSheet>
      )}

      {/* ── Conferência antes de gerar (desktop) ──────────── */}
      {!mobile && confirmando && (
        <ConfirmDialog
          tone="brand"
          title="Concluir cotação?"
          confirmLabel={pendente ? "Concluindo…" : rotuloConfirmar}
          cancelLabel="Voltar"
          pending={pendente}
          onCancel={() => setConfirmando(false)}
          onConfirm={concluir}
          description={
            <>
              <p className="mb-2.5">
                A cotação será encerrada e{" "}
                {umPedidoSo ? "o pedido abaixo será criado" : "os pedidos abaixo serão criados"}.
                Escolha o que fazer com cada um:{" "}
                <strong className="font-semibold text-ink">enviar agora</strong> abre o envio ao
                fornecedor em seguida; <strong className="font-semibold text-ink">revisar antes</strong>{" "}
                deixa o pedido em rascunho para você ajustar.
              </p>

              <ul className="flex flex-col gap-1.5">
                {pedidosPrevistos.map((x) => (
                  <LinhaConclusao
                    key={x.id}
                    nome={x.nome}
                    logoUrl={x.logoUrl}
                    itens={x.itens}
                    total={x.total}
                    decisao={x.decisao}
                    escolha={escolhaDe(x)}
                    onEscolha={(v) => escolherEnvio(x.id, v)}
                  />
                ))}
              </ul>

              {(foraDoFornecedor > 0 || comPromocao > 0) && (
                <ul className="mt-2.5 flex flex-col gap-1 text-[12px] text-accent">
                  {foraDoFornecedor > 0 && (
                    <li>
                      {foraDoFornecedor} {foraDoFornecedor === 1 ? "item fica" : "itens ficam"} de
                      fora — o fornecedor escolhido não cotou.
                    </li>
                  )}
                  {comPromocao > 0 && (
                    <li>
                      {comPromocao} {comPromocao === 1 ? "item sai" : "itens saem"} acima da
                      quantidade cotada, por promoção de volume.
                    </li>
                  )}
                </ul>
              )}

              {/* Com vários fornecedores o total de cada linha não responde
                  "quanto vai sair desta compra" — a soma responde. */}
              {pedidosPrevistos.length > 1 && (
                <p className="mt-2.5 flex items-baseline justify-between border-t border-line pt-2.5">
                  <span className="text-[13px] font-medium text-ink">Total</span>
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                    {fmtMoney(totalEscolhido)}
                  </span>
                </p>
              )}

              <p className="mt-2.5">
                Nada sai para o fornecedor sem você confirmar o envio na tela seguinte.
              </p>
            </>
          }
        />
      )}

      {/* ── Folha: conferência antes de concluir (celular) ─── */}
      {mobile && podePedir && !decidida && (
        <BottomSheet
          open={confirmando}
          onClose={() => setConfirmando(false)}
          titulo="Concluir cotação?"
          descricao={
            <span className="flex items-baseline gap-2">
              <span>
                {pedidosPrevistos.length}{" "}
                {pedidosPrevistos.length === 1 ? "pedido" : "pedidos"}
              </span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {fmtMoney(totalEscolhido)}
              </span>
            </span>
          }
          rodape={
            <button
              type="button"
              onClick={concluir}
              disabled={pendente}
              className="min-h-12 w-full rounded-full bg-brand text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              {pendente ? "Concluindo…" : rotuloConfirmar}
            </button>
          }
        >
          <p className="mb-3 text-[13px] leading-relaxed text-muted">
            A cotação será encerrada e{" "}
            {umPedidoSo ? "o pedido abaixo será criado" : "os pedidos abaixo serão criados"}.
            Enviar agora abre o envio em seguida; revisar antes deixa em rascunho.
          </p>

          <ul className="flex flex-col gap-2">
            {pedidosPrevistos.map((x) => (
              <LinhaConclusao
                key={x.id}
                nome={x.nome}
                logoUrl={x.logoUrl}
                itens={x.itens}
                total={x.total}
                decisao={x.decisao}
                escolha={escolhaDe(x)}
                onEscolha={(v) => escolherEnvio(x.id, v)}
              />
            ))}
          </ul>

          {/* O que a barra truncou: aqui há espaço para dizer inteiro, e é o
              último momento em que dá para voltar atrás. */}
          {(foraDoFornecedor > 0 || comPromocao > 0) && (
            <ul className="mt-3 flex flex-col gap-1 text-[12px] text-accent">
              {foraDoFornecedor > 0 && (
                <li>
                  {foraDoFornecedor} {foraDoFornecedor === 1 ? "item fica" : "itens ficam"} de
                  fora — o fornecedor escolhido não cotou.
                </li>
              )}
              {comPromocao > 0 && (
                <li>
                  {comPromocao} {comPromocao === 1 ? "item sai" : "itens saem"} acima da
                  quantidade cotada, por promoção de volume.
                </li>
              )}
            </ul>
          )}

          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Nada sai para o fornecedor sem você confirmar o envio.
          </p>
        </BottomSheet>
      )}

      {/* ── Envio dos pedidos marcados "enviar agora" ─────── */}
      {enviarIds && (
        <EnvioPedidoSheet
          pedidoIds={enviarIds}
          titulo={enviarIds.length === 1 ? "Enviar o pedido" : "Enviar os pedidos"}
          descricao="A cotação foi concluída. Escolha para quem vai cada pedido — o que você não enviar agora fica em rascunho."
          onFechar={() => {
            setEnviarIds(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Linha da conferência de conclusão ───────────────────────
// Um fornecedor, o que ele leva, e a escolha: enviar agora ou revisar antes.
// Os avisos ficam na própria linha — são a razão de a sugestão ser "revisar".

function LinhaConclusao({
  nome,
  logoUrl,
  itens,
  total,
  decisao,
  escolha,
  onEscolha,
}: {
  nome: string;
  logoUrl: string | null;
  itens: number;
  total: number;
  decisao: DecisaoEnvio;
  escolha: EscolhaEnvio;
  onEscolha: (v: EscolhaEnvio) => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius)] border border-line px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <SupplierAvatar nome={nome} logoUrl={logoUrl} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{nome}</span>
          <span className="block text-[11px] text-muted">
            {itens} {itens === 1 ? "item" : "itens"}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-ink">
          {fmtMoney(total)}
        </span>
      </div>

      {decisao.bloqueio ? (
        <p className="text-[12px] text-accent">{decisao.bloqueio}</p>
      ) : (
        <div
          role="radiogroup"
          aria-label={`O que fazer com o pedido de ${nome}`}
          className="flex gap-0.5 self-start rounded-full border border-line bg-surface p-0.5"
        >
          {(
            [
              { id: "enviar", rotulo: "Enviar agora" },
              { id: "revisar", rotulo: "Revisar antes" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={escolha === o.id}
              onClick={() => onEscolha(o.id)}
              className={cn(
                "min-h-9 rounded-full px-3 text-[12px] font-medium transition-colors",
                escolha === o.id ? "bg-brand text-on-brand" : "text-ink-2 hover:bg-surface-2",
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      )}

      {decisao.avisos.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] text-accent">
          {decisao.avisos.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
      )}
    </li>
  );
}


// ── Barra de decisão ────────────────────────────────────────
// "Como comprar" em uma linha: dois caminhos em pílula, cada um com o valor,
// e a escolha feita à mão aparece como etiqueta — não como terceiro botão.
// Uma sugestão por vez, logo abaixo, só quando existe.

function BarraDecisao({
  modo,
  totalMelhor,
  pedidosMelhor,
  opcoesUnico,
  totalItens,
  unicoAtual,
  totalManual,
  onMelhor,
  onFornecedor,
  criterio,
  recomendacao,
}: {
  modo: "melhor" | "fornecedor" | "manual";
  totalMelhor: number;
  pedidosMelhor: number;
  opcoesUnico: { id: string; nome: string; total: number; atende: number }[];
  totalItens: number;
  unicoAtual: string | null;
  totalManual: number | null;
  onMelhor: () => void;
  onFornecedor: (conviteId: string) => void;
  /** Seletor de critério — só quando há algo além do preço a comparar. */
  criterio: React.ReactNode;
  recomendacao: { texto: string; acao?: { rotulo: string; onClick: () => void } } | null;
}) {
  const unico = opcoesUnico.find((o) => o.id === unicoAtual) ?? opcoesUnico[0];
  const pill = (ativo: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors",
      ativo
        ? "border-brand bg-brand-soft text-brand"
        : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2",
    );

  return (
    <section aria-label="Como comprar" className="hidden flex-col gap-1.5 md:flex">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Como comprar
        </span>
        <div role="radiogroup" aria-label="Como comprar" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={modo === "melhor"}
            onClick={onMelhor}
            className={pill(modo === "melhor")}
          >
            <span className="font-medium">Melhor preço por item</span>
            <span className="font-mono font-semibold tabular-nums">{fmtMoney(totalMelhor)}</span>
            <span className="text-[12px] opacity-80">
              · {pedidosMelhor} {pedidosMelhor === 1 ? "pedido" : "pedidos"}
            </span>
          </button>

          {unico && (
            <span className={pill(modo === "fornecedor")}>
              <button
                type="button"
                role="radio"
                aria-checked={modo === "fornecedor"}
                onClick={() => onFornecedor(unico.id)}
                className="font-medium"
              >
                Tudo com
              </button>
              {opcoesUnico.length > 1 ? (
                <select
                  aria-label="Fornecedor único"
                  value={unico.id}
                  onChange={(e) => onFornecedor(e.target.value)}
                  className="max-w-[11rem] cursor-pointer truncate rounded-full bg-transparent py-0.5 font-medium outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                >
                  {opcoesUnico.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome}
                      {o.atende < totalItens ? ` (${o.atende}/${totalItens})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium">{unico.nome}</span>
              )}
              <span className="font-mono font-semibold tabular-nums">{fmtMoney(unico.total)}</span>
              {unico.atende < totalItens && (
                <span className="text-[12px] text-accent">
                  {unico.atende}/{totalItens} itens
                </span>
              )}
            </span>
          )}

          {totalManual !== null && (
            <span
              role="radio"
              aria-checked
              className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-brand px-3 text-[13px] text-brand"
              title="Você mexeu em itens específicos. Escolher um dos caminhos refaz a tabela inteira."
            >
              <span className="font-medium">Do meu jeito</span>
              <span className="font-mono font-semibold tabular-nums">{fmtMoney(totalManual)}</span>
            </span>
          )}
        </div>
        {criterio && <div className="ml-auto">{criterio}</div>}
      </div>

      {recomendacao && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[12px] text-muted">
          <Lightbulb size={13} className="shrink-0 text-brand" aria-hidden />
          <span>{recomendacao.texto}</span>
          {recomendacao.acao && (
            <button
              type="button"
              onClick={recomendacao.acao.onClick}
              className="font-semibold text-brand underline-offset-4 hover:underline"
            >
              {recomendacao.acao.rotulo}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

// ── Seletor de critério ─────────────────────────────────────
// Só existe quando algum fornecedor mandou algo além do preço que muda a conta
// (frete, prazos de pagamento diferentes). Compacto: um select e, no custo
// efetivo, a taxa do dinheiro ao lado.

function SeletorCriterio({
  criterio,
  onCriterio,
  taxaMes,
  onTaxaMes,
  taxaPadrao,
  podeSalvar,
}: {
  criterio: Criterio;
  onCriterio: (c: Criterio) => void;
  taxaMes: number;
  onTaxaMes: (v: number) => void;
  taxaPadrao: number;
  podeSalvar: boolean;
}) {
  const [texto, setTexto] = useState(String(taxaMes).replace(".", ","));
  const [salvando, startSalvar] = useTransition();
  const [salvo, setSalvo] = useState(false);

  function mudarTaxa(v: string) {
    const limpo = v.replace(/[^\d,]/g, "").slice(0, 5);
    setTexto(limpo);
    setSalvo(false);
    const n = Number(limpo.replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 20) onTaxaMes(n);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
      <label className="flex items-center gap-1.5">
        Comparar por
        <select
          value={criterio}
          onChange={(e) => onCriterio(e.target.value as Criterio)}
          className="h-8 cursor-pointer rounded-full border border-line bg-surface px-2.5 text-[12px] font-medium text-ink outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
        >
          <option value="preco">Preço</option>
          <option value="custo">Preço + frete e prazo</option>
        </select>
      </label>
      {criterio === "custo" && (
        <>
          <label
            className="flex items-center gap-1"
            title="Custo do dinheiro da empresa: é ele que transforma prazo de pagamento em desconto."
          >
            <input
              value={texto}
              onChange={(e) => mudarTaxa(e.target.value)}
              inputMode="decimal"
              aria-label="Custo do dinheiro, em % ao mês"
              className="h-8 w-12 rounded-full border border-line bg-surface px-2 text-right font-mono text-[12px] tabular-nums text-ink"
            />
            % a.m.
          </label>
          {podeSalvar && taxaMes !== taxaPadrao && !salvo && (
            <button
              type="button"
              disabled={salvando}
              onClick={() =>
                startSalvar(async () => {
                  try {
                    await salvarCustoCapitalAction(taxaMes);
                    setSalvo(true);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
                  }
                })
              }
              className="font-medium text-brand underline-offset-4 hover:underline disabled:opacity-50"
            >
              {salvando ? "Salvando…" : "usar como padrão"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Alternador de lente ─────────────────────────────────────
// Duas perguntas, não dois modos de comprar: "quanto custa o que eu preciso"
// e "onde estão as promoções que valem a pena". Voltar para a primeira desfaz
// as quantidades levadas — senão o operador olharia a promoção, voltaria, e o
// pedido sairia maior sem que a tela dissesse por quê.

function AlternadorLente({
  lente,
  onLente,
  onNecessidade,
}: {
  lente: "necessidade" | "oportunidade";
  onLente: (l: "necessidade" | "oportunidade") => void;
  onNecessidade: () => void;
}) {
  const opcoes = [
    {
      id: "necessidade" as const,
      label: "Minha necessidade",
      icon: <Target size={13} />,
      sub: "o preço na quantidade que pedi",
    },
    {
      id: "oportunidade" as const,
      label: "Melhor oportunidade",
      icon: <Layers size={13} />,
      sub: "promoções por volume que compensam",
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Como comparar"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-1.5 sm:flex-row"
    >
      {opcoes.map((o) => {
        const ativo = lente === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => {
              if (o.id === "necessidade") onNecessidade();
              onLente(o.id);
            }}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-left transition-colors",
              ativo ? "bg-brand text-on-brand" : "text-ink hover:bg-surface-2",
            )}
          >
            <span className={ativo ? "text-on-brand" : "text-faint"}>{o.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{o.label}</span>
              <span
                className={cn(
                  "block truncate text-[11px]",
                  ativo ? "text-on-brand/80" : "text-muted",
                )}
              >
                {o.sub}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Estratégia da compra ────────────────────────────────────

function EstrategiaCompra({
  modo,
  respondidos,
  totalItens,
  fornecedorUnico,
  resultadoMelhor,
  resultadoUnico,
  resultadoManual = null,
  idUnicoSugerido,
  onMelhorPreco,
  onFornecedor,
  comTitulo = true,
}: {
  /** Total da escolha feita à mão — só existe quando ela existe. */
  resultadoManual?: string | null;
  modo: "melhor" | "fornecedor" | "manual";
  respondidos: ConviteCotacao[];
  totalItens: number;
  fornecedorUnico: string | null;
  /** O que cada caminho custa — a consequência da escolha, ao lado dela. */
  resultadoMelhor: string;
  resultadoUnico: string | null;
  /** Quem o cartão "um único fornecedor" seleciona — é o nome que ele mostra. */
  idUnicoSugerido: string | null;
  onMelhorPreco: () => void;
  onFornecedor: (conviteId: string) => void;
  /** Dentro da folha o título já é o cabeçalho dela — repetido, vira eco. */
  comTitulo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {comTitulo && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          Como comprar
        </span>
      )}

      <div role="radiogroup" aria-label="Como comprar" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <OpcaoCompra
          ativo={modo === "melhor"}
          titulo="Melhor preço por item"
          descricao="Dividir a compra entre fornecedores para obter o menor custo."
          resultado={resultadoMelhor}
          onClick={onMelhorPreco}
        />
        <OpcaoCompra
          ativo={modo === "fornecedor"}
          titulo="Um único fornecedor"
          descricao="Comprar tudo de um fornecedor para simplificar a entrega e o pedido."
          resultado={resultadoUnico}
          onClick={() =>
            onFornecedor(fornecedorUnico ?? idUnicoSugerido ?? respondidos[0].id)
          }
        />
        <OpcaoCompra
          ativo={modo === "manual"}
          titulo="Do meu jeito"
          descricao="Você escolhe item a item, clicando no preço de quem quer na tabela."
          resultado={resultadoManual}
          onClick={() => {}}
          informativo
        />
      </div>

      {/* A lista de fornecedores só aparece depois que a pergunta foi
          respondida: mostrar as duas coisas de uma vez era o que fazia isto
          parecer barra de abas em vez de decisão. */}
      {modo === "fornecedor" && (
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
          <span className="shrink-0 text-[12px] text-muted">De quem:</span>
          {respondidos.map((c) => {
            const ativo = fornecedorUnico === c.id;
            const atende = c.itensAtendidos;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onFornecedor(c.id)}
                aria-pressed={ativo}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                  ativo
                    ? "bg-brand text-on-brand"
                    : "border border-line bg-surface text-ink hover:bg-surface-2",
                )}
              >
                <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={18} />
                <span className="max-w-[9rem] truncate">{c.supplierNome}</span>
                <span
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    ativo ? "text-on-brand/80" : "text-faint",
                  )}
                >
                  {atende}/{totalItens}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {modo === "manual" && (
        <p className="text-[12px] text-muted">
          Você mexeu em itens específicos. Clicar em um dos dois primeiros caminhos refaz a seleção
          da tabela inteira.
        </p>
      )}
    </div>
  );
}

function OpcaoCompra({
  ativo,
  titulo,
  descricao,
  resultado,
  onClick,
  informativo = false,
}: {
  ativo: boolean;
  titulo: string;
  descricao: string;
  /** Quanto custa seguir por aqui. Null quando não há conta a fazer. */
  resultado?: string | null;
  onClick: () => void;
  /** Não se escolhe clicando: acende sozinho quando a pessoa mexe na tabela. */
  informativo?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      aria-disabled={informativo || undefined}
      onClick={onClick}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-left transition-colors",
        ativo
          ? "border-brand bg-brand-soft"
          : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
        informativo && !ativo && "cursor-default border-dashed hover:border-line hover:bg-surface",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
          ativo ? "border-brand" : "border-line-strong",
        )}
      >
        {ativo && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-[13px] font-medium leading-tight",
            ativo ? "text-brand" : "text-ink",
          )}
        >
          {titulo}
        </span>
        {/* A descrição NÃO some no celular: sem ela sobram dois rótulos crus
            e ninguém descobre que uma das opções parte a compra em N pedidos —
            que é justamente a decisão sendo pedida. */}
        <span className="mt-0.5 block text-[11px] leading-snug text-muted">
          {descricao}
        </span>
        {/* A consequência da escolha, em número. Sem ela as duas opções são
            duas frases igualmente razoáveis e o operador chuta. */}
        {resultado && (
          <span
            className={cn(
              "mt-1 block font-mono text-[12px] font-semibold tabular-nums",
              ativo ? "text-brand" : "text-ink",
            )}
          >
            {resultado}
          </span>
        )}
      </span>
    </button>
  );
}


// ── Card de item (celular) ──────────────────────────────────
//
// Um produto por vez, e os fornecedores ORDENADOS PELO PREÇO. Na matriz o olho
// varre a coluna e acha o menor sozinho; empilhado na ordem do convite, ele
// precisa ler todos e comparar de cabeça — que é o trabalho que a tela deveria
// fazer. Quem não tem o item desce para o fim, numa linha só: são fornecedores
// que nunca vão ser escolhidos ocupando o lugar da decisão.
//
// Decidido, o card FECHA. Doze itens × quatro fornecedores é meio metro de
// rolagem onde o resolvido pesa igual ao pendente; fechado, ele vira a linha
// que responde "quem levou, por quanto" e devolve a tela ao que falta.

function CardItem({
  item,
  quantidade,
  respondidos,
  precoDe,
  valorDe,
  porCusto,
  melhorConviteId,
  escolhido,
  editavel,
  mostrarMarca,
  atencao,
  onEscolher,
}: {
  /** Por que este item pede decisão — null quando o vencedor é claro. */
  atencao: Atencao | null;
  item: ItemCotacao;
  /** Quanto vai ser pedido — sobe quando uma promoção por volume é levada. */
  quantidade: number;
  respondidos: ConviteCotacao[];
  /** Preço deste item naquele fornecedor, já na quantidade escolhida. */
  precoDe: (c: ConviteCotacao) => number | null;
  /** O número da comparação: preço, ou custo efetivo quando `porCusto`. */
  valorDe: (c: ConviteCotacao) => number | null;
  porCusto: boolean;
  melhorConviteId: string | null;
  escolhido: string | null;
  editavel: boolean;
  /** Só quando os fornecedores cotaram marcas DIFERENTES — senão é repetição. */
  mostrarMarca: boolean;
  onEscolher: (conviteId: string) => void;
}) {
  const linhas = respondidos.map((c) => ({
    convite: c,
    resposta: c.respostas.find((x) => x.quotationItemId === item.id),
    preco: precoDe(c),
    valor: valorDe(c),
  }));

  const disponiveis = linhas
    .filter((l) => l.resposta?.disponivel && l.preco !== null && l.valor !== null)
    .sort((a, b) => (a.valor as number) - (b.valor as number));
  const ausentes = linhas.filter((l) => !l.resposta?.disponivel);

  // Mesma base do desktop: a diferença de cada proposta contra a melhor da
  // linha só existe quando há com o que comparar.
  const precosDaLinha = disponiveis.map((l) => l.valor as number);

  const escolha = disponiveis.find((l) => l.convite.id === escolhido) ?? null;
  const totalItem = escolha ? (escolha.preco as number) * quantidade : null;

  // Escolheu → fecha; desmarcou → reabre. Trocar de estratégia lá no rodapé
  // chega aqui como mudança de `escolhido`, e o card acompanha sem que a
  // pessoa precise fechar doze cards à mão.
  const [aberto, setAberto] = useState(!escolhido);
  const anterior = useRef(escolhido);
  useEffect(() => {
    if (anterior.current === escolhido) return;
    anterior.current = escolhido;
    setAberto(!escolhido);
  }, [escolhido]);

  // Escolha que não tem preço nesta quantidade não pode virar resumo fechado:
  // o card ficaria mudo. Nesse caso ele fica aberto, dizendo o que sabe.
  const expandido = aberto || escolha === null;

  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-ink">{item.descricao}</p>
          {atencao && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-accent">
              <AlertTriangle size={11} className="shrink-0" aria-hidden />
              {atencao.texto}
            </p>
          )}
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-[12px] tabular-nums text-muted">
            {quantidade > item.quantidade && (
              <span className="text-faint line-through">{fmtQtd(item.quantidade)}</span>
            )}
            <span className={quantidade > item.quantidade ? "font-semibold text-accent" : ""}>
              {fmtQtd(quantidade)}
            </span>
            <span className="font-sans text-faint">
              {unidadeDaQtd(quantidade, item.embalagemNome)}
            </span>
          </p>
        </div>

        {/* O total DESTE item. No desktop é uma coluna inteira; aqui ele estava
            enterrado em 11px dentro da linha escolhida, onde ninguém lê. */}
        <div className="shrink-0 text-right">
          <span className="block text-[10px] uppercase tracking-wide text-faint">total</span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
            {totalItem === null ? "—" : fmtMoney(totalItem)}
          </span>
        </div>
      </div>

      {!expandido && escolha && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-expanded={false}
          className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-[var(--radius)] border border-brand/40 bg-brand-soft px-3 py-2 text-left"
        >
          <SupplierAvatar
            nome={escolha.convite.supplierNome}
            logoUrl={escolha.convite.supplierLogoUrl}
            size={20}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-brand">
            {escolha.convite.supplierNome}
          </span>
          <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-brand">
            {fmtPreco(escolha.preco as number)}
          </span>
          <ChevronDown size={15} className="shrink-0 text-brand/70" aria-hidden />
          <span className="sr-only">Trocar fornecedor deste item</span>
        </button>
      )}

      {expandido && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {disponiveis.map(({ convite: c, resposta, preco: precoBruto, valor: valorBruto }) => {
            const r = resposta!;
            const preco = precoBruto as number;
            const valor = valorBruto as number;
            const marcado = escolhido === c.id;
            const ehMelhor = melhorConviteId === c.id;
            const falta = faltaTexto(r.quantidadeOfertada, item.quantidade);
            const dif = diferencaNaLinha(precosDaLinha, valor);
            const comFaixa = preco < r.precoUnitario;

            /**
             * UMA nota por linha, na mesma ordem de gravidade da célula do
             * desktop: o que impede a compra antes do que a barateia, e o
             * contexto por último. Tudo junto num `flex-wrap` de 11px virava
             * três linhas de sopa embaixo do nome do fornecedor.
             */
            const nota = falta
              ? { texto: falta, forte: true }
              : comFaixa
                ? { texto: "promoção por volume", forte: true }
                : mostrarMarca && r.marca
                  ? { texto: r.marca, forte: false }
                  : null;

            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!editavel}
                  onClick={() => onEscolher(c.id)}
                  aria-pressed={marcado}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius)] border px-3 py-2 text-left transition-colors",
                    marcado
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line bg-surface",
                    !editavel && "cursor-default",
                  )}
                >
                  <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={22} />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-[13px] font-medium">
                        {c.supplierNome}
                      </span>
                      {/* Selo no canto do nome, não texto no meio da sopa: é
                          um estado do fornecedor, não mais uma observação. */}
                      {ehMelhor && !marcado && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          <Trophy size={9} aria-hidden />
                          melhor
                        </span>
                      )}
                    </span>
                    {nota && (
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[11px]",
                          marcado
                            ? "text-on-brand/80"
                            : nota.forte
                              ? "font-medium text-accent"
                              : "text-muted",
                        )}
                      >
                        {nota.texto}
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[15px] font-semibold tabular-nums">
                      {fmtPreco(valor)}
                    </span>
                    {porCusto && Math.abs(valor - preco) >= 0.005 && (
                      <span
                        className={cn(
                          "block font-mono text-[11px] tabular-nums",
                          marcado ? "text-on-brand/70" : "text-faint",
                        )}
                      >
                        nota {fmtPreco(preco)}
                      </span>
                    )}
                    {dif && (
                      <span
                        className={cn(
                          "block font-mono text-[11px] tabular-nums",
                          marcado ? "text-on-brand/80" : dif.ganho ? "text-ok" : "text-faint",
                        )}
                      >
                        {/* Sem seta: em 11px ela vira sujeira antes de virar
                            informação, e o sinal já diz a direção. */}
                        {dif.ganho ? "−" : "+"}
                        {fmtPreco(dif.valor)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}

          {/* Quem não tem o item não disputa nada: uma linha para todos, no
              fim, em vez de N caixas tracejadas no meio da decisão. */}
          {ausentes.length > 0 && (
            <li className="rounded-[var(--radius)] border border-dashed border-line px-3 py-2 text-[11px] leading-snug text-faint">
              {ausentes.length === 1
                ? `${ausentes[0].convite.supplierNome} não tem`
                : `Não têm: ${ausentes.map((l) => l.convite.supplierNome).join(", ")}`}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
