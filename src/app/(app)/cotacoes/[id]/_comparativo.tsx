"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Scale,
  Target,
  Trophy,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { precoNaQuantidade, type LimitesEscala } from "@/lib/compras/escalas";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { toast } from "@/components/ui/toast";
import { EstadoVazio, fmtMoney, fmtPreco, unidadeDaQtd } from "../_catalogo/ui";
import { SupplierAvatar, Thumb } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, ItemCotacao } from "../_compra-types";
import { gerarPedidosAction } from "../_compra-actions";
import { LenteOportunidade, type Sugestao } from "./_escala";
import { LeituraDaCotacao } from "./_resumo";
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
type FiltroItens = "todos" | "pendentes" | "promocao" | "marca";

const ROTULO_FILTRO: Record<FiltroItens, string> = {
  todos: "Todos",
  pendentes: "Sem escolha",
  promocao: "Com promoção",
  marca: "Marca divergente",
};

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
}: {
  cotacao: CotacaoDetalhe;
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

  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA");

  // itemId → conviteId com o menor preço disponível.
  const melhorPorItem = useMemo(() => {
    const mapa = new Map<string, { conviteId: string; preco: number }>();
    for (const item of cotacao.itens) {
      for (const convite of respondidos) {
        const r = convite.respostas.find((x) => x.quotationItemId === item.id);
        if (!r?.disponivel) continue;
        const atual = mapa.get(item.id);
        if (!atual || r.precoUnitario < atual.preco) {
          mapa.set(item.id, { conviteId: convite.id, preco: r.precoUnitario });
        }
      }
    }
    return mapa;
  }, [cotacao.itens, respondidos]);

  const [escolhas, setEscolhas] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      cotacao.itens.map((i) => [i.id, melhorPorItem.get(i.id)?.conviteId ?? null]),
    ),
  );

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

  const totaisCheios = respondidos
    .filter(cobreTudo)
    .map((c) => ({ id: c.id, nome: c.supplierNome, total: totalDe(c) }));

  const melhorCheio = totaisCheios.length
    ? totaisCheios.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

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

  function gerar() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      try {
        const r = await gerarPedidosAction({
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
          enviar: true,
        });
        if (r.semProduto.length > 0) {
          avisar(
            "aviso",
            `Ficaram de fora ${r.semProduto.length} ${r.semProduto.length === 1 ? "item que não está" : "itens que não estão"} vinculados ao catálogo: ${r.semProduto.join(", ")}.`,
          );
        } else if (mobile) {
          toast.success("Pedidos gerados");
        }
        setConfirmando(false);
        router.refresh();
      } catch (e) {
        avisar("erro", e instanceof Error ? e.message : "Não foi possível gerar os pedidos.");
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

  /** Em quantos pedidos a escolha vai virar, e de quanto cada um. */
  const pedidosPrevistos = respondidos
    .map((c) => {
      const itens = cotacao.itens.filter((i) => escolhas[i.id] === c.id);
      return {
        id: c.id,
        nome: c.supplierNome,
        logoUrl: c.supplierLogoUrl,
        itens: itens.length,
        total: itens.reduce((acc, i) => {
          const preco = precoDe(i, c);
          return preco === null ? acc : acc + preco * quantidadeDe(i);
        }, 0),
      };
    })
    .filter((x) => x.itens > 0);

  /**
   * Um pedido ou vários? A resposta é a contagem de fornecedores escolhidos, e
   * não o modo: "melhor preço por item" pode terminar com um fornecedor só, e
   * aí o plural prometeria uma divisão que não vai acontecer.
   */
  const umPedidoSo = pedidosPrevistos.length === 1;
  const rotuloGerar = umPedidoSo
    ? `Gerar pedido para ${pedidosPrevistos[0].nome}`
    : pedidosPrevistos.length > 1
      ? `Gerar ${pedidosPrevistos.length} pedidos de compra`
      : "Gerar pedido de compra";

  /** Alguém ofereceu promoção por volume neste item? */
  function temPromocaoNoItem(item: ItemCotacao): boolean {
    return respondidos.some((c) => {
      const r = c.respostas.find((x) => x.quotationItemId === item.id);
      return !!r?.disponivel && r.faixas.length > 0;
    });
  }

  function passaNoFiltro(item: ItemCotacao, f: FiltroItens): boolean {
    if (f === "pendentes") return !escolhas[item.id];
    if (f === "promocao") return temPromocaoNoItem(item);
    if (f === "marca") return marcasDivergemNoItem(item.id);
    return true;
  }

  const contagemFiltro = {
    todos: cotacao.itens.length,
    pendentes: cotacao.itens.filter((i) => passaNoFiltro(i, "pendentes")).length,
    promocao: cotacao.itens.filter((i) => passaNoFiltro(i, "promocao")).length,
    marca: cotacao.itens.filter((i) => passaNoFiltro(i, "marca")).length,
  } satisfies Record<FiltroItens, number>;

  const itensVisiveis = cotacao.itens.filter((i) => passaNoFiltro(i, filtro));

  return (
    <div className="flex flex-col gap-4">
      {temFaixa && (
        <AlternadorLente lente={lente} onLente={setLente} onNecessidade={zerarQuantidades} />
      )}

      {/* Os três números do totalizador saíram: "cesta escolhida" repetia o
          rodapé fixo, "melhor fornecedor único" repetia o cabeçalho da coluna
          vencedora e a economia contra a pior já é a primeira frase da
          leitura. Sobra a leitura — que é o que a tabela NÃO diz. */}
      <LeituraDaCotacao resumo={resumo} />

      {lente === "oportunidade" && (
        <LenteOportunidade
          itens={cotacao.itens}
          respondidos={respondidos}
          superficie={superficie}
          limites={limites}
          onLimites={setLimites}
          escolhas={escolhas}
          quantidades={quantidades}
          editavel={podePedir && !decidida}
          onAplicarFaixa={aplicarFaixa}
          onAplicarTodas={aplicarSugestoes}
        />
      )}

      {lente === "necessidade" && (
        <>
      <div
        className={cn(
          "overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface",
          // A matriz não volta em NENHUMA largura da superfície mobile: dentro
          // da casca do /m, 52rem de tabela é rolagem lateral às cegas — que é
          // exatamente o que o card por produto existe para evitar.
          mobile ? "hidden" : "hidden md:block",
        )}
      >
        {/* A largura mínima cresceu junto com a coluna de total: espremida,
            a coluna do item truncava o nome no terceiro caractere. */}
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              {/* Peso declarado: sem largura, o navegador dá à coluna de texto o
                  que sobra das colunas de número — e sobra pouco. */}
              <th className="w-[34%] min-w-[16rem] px-4 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qtd</th>
              {/* Cabeçalho enxuto: quem é e por quanto fecha. O troféu diz o
                  resto — quatro linhas de altura por coluna empurravam a
                  primeira linha de preço para fora da tela. */}
              {respondidos.map((c) => {
                const eleito = modo === "fornecedor" && fornecedorUnico === c.id;
                const melhorGeral = melhorCheio?.id === c.id;
                const atende = cotacao.itens.filter((i) =>
                  c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
                ).length;
                return (
                  <th
                    key={c.id}
                    aria-current={eleito ? "true" : undefined}
                    title={
                      cobreTudo(c)
                        ? `${c.supplierNome} — cotou os ${cotacao.itens.length} itens`
                        : `${c.supplierNome} — cotou só ${atende} de ${cotacao.itens.length} itens`
                    }
                    className={cn(
                      "px-3 py-2 text-right align-top font-medium",
                      eleito ? "bg-brand-soft" : melhorGeral && "bg-ok-soft/40",
                    )}
                  >
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {/* Sem logo: o cabeçalho é uma coluna de NÚMEROS, e a
                            imagem competia com eles pela atenção sem ajudar a
                            comparar preço. O nome basta para identificar. */}
                        {melhorGeral && <Trophy size={11} className="shrink-0 text-ok" />}
                        <span
                          className={cn(
                            "max-w-[9rem] truncate normal-case text-[12px]",
                            eleito ? "font-semibold text-brand" : "text-ink-2",
                          )}
                        >
                          {c.supplierNome}
                        </span>
                      </span>

                      <span
                        className={cn(
                          "font-mono text-[13px] font-semibold tabular-nums",
                          melhorGeral ? "text-ok" : "text-ink",
                        )}
                      >
                        {fmtMoney(totalDe(c))}
                      </span>
                      {!cobreTudo(c) && (
                        <span className="text-[10px] normal-case text-accent">
                          {atende}/{cotacao.itens.length} itens
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
              {/* O total da linha saiu de dentro das células: ele pertence a
                  UMA coluna — a escolhida —, e repetido em cada fornecedor era
                  o mesmo número dito N vezes. */}
              <th className="px-4 py-2 text-right font-medium">Total do item</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {cotacao.itens.map((item, linha) => {
              const melhor = melhorPorItem.get(item.id);
              // Preços da linha na quantidade escolhida — a base da diferença
              // que cada célula mostra.
              const precosDaLinha = respondidos
                .map((c) => precoDe(item, c))
                .filter((x): x is number => x !== null);
              const marcasDivergem = marcasDivergemNoItem(item.id);
              const conviteEscolhido = escolhas[item.id];
              const precoEscolhido = conviteEscolhido
                ? (precoDe(item, respondidos.find((c) => c.id === conviteEscolhido)!) ?? null)
                : null;

              return (
                <tr
                  key={item.id}
                  // Zebra em vez de pintar cada célula: a faixa separa as
                  // linhas sem competir com a cor que marca a escolha.
                  className={linha % 2 === 1 ? "bg-surface-2/40" : undefined}
                >
                  {/* Foto no ITEM, e só nele: é onde ela trabalha — o operador
                      reconhece o produto pelo rótulo antes de ler o nome. */}
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <Thumb url={item.imagemUrl} nome={item.descricao} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{item.descricao}</span>
                        {item.sku ? (
                          <span className="block font-mono text-[11px] text-faint">
                            {item.sku}
                          </span>
                        ) : (
                          <span className="block text-[11px] text-faint">fora do catálogo</span>
                        )}
                      </span>
                    </span>
                  </td>
                  {/* A quantidade que vai no pedido, não a que foi perguntada:
                      levada uma promoção, elas deixam de ser a mesma coisa e a
                      cotada continua à vista, riscada. */}
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-muted">
                    {quantidadeDe(item) > item.quantidade ? (
                      <span className="flex flex-col items-end">
                        <span className="font-semibold text-accent">
                          {fmtQtd(quantidadeDe(item))}
                        </span>
                        <span className="text-[11px] text-faint line-through">
                          {fmtQtd(item.quantidade)}
                        </span>
                      </span>
                    ) : (
                      fmtQtd(item.quantidade)
                    )}
                    {/* Número sem unidade não diz se são duas garrafas ou duas
                        caixas de doze — e é o preço disso que está na linha. */}
                    <span className="block font-sans text-[11px] normal-case text-faint">
                      {unidadeDaQtd(quantidadeDe(item), item.embalagemNome)}
                    </span>
                  </td>

                  {respondidos.map((c) => {
                    const r = c.respostas.find((x) => x.quotationItemId === item.id);
                    const escolhido = escolhas[item.id] === c.id;
                    const ehMelhor = melhor?.conviteId === c.id;
                    const eleito = modo === "fornecedor" && fornecedorUnico === c.id;
                    const colunaVencedora = melhorCheio?.id === c.id;

                    if (!r?.disponivel) {
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "px-3 py-2 text-right text-[12px] text-faint",
                            eleito
                              ? "bg-brand-soft/40"
                              : colunaVencedora && "bg-ok-soft/25",
                          )}
                        >
                          não tem
                        </td>
                      );
                    }

                    // Na quantidade escolhida — se ela alcança uma faixa deste
                    // fornecedor, é o preço da faixa que a célula mostra. Um
                    // preço na tela e outro no total é o que faz o operador
                    // parar de confiar no comparativo.
                    const preco = precoDe(item, c) ?? r.precoUnitario;
                    const comFaixa = preco < r.precoUnitario;
                    const dif = diferencaNaLinha(precosDaLinha, preco);
                    const falta = faltaTexto(r.quantidadeOfertada, item.quantidade);
                    const marca = marcasDivergem ? r.marca : null;

                    /**
                     * UMA nota por célula, por gravidade: o que impede a compra
                     * vem antes do que a barateia, e o preço da escolha vem
                     * antes de tudo que é só contexto. O resto vive no `title`.
                     */
                    const nota = falta
                      ? { texto: falta, tom: "accent" as const }
                      : comFaixa
                        ? { texto: "promoção por volume", tom: "accent" as const }
                        : marca
                          ? { texto: marca, tom: "faint" as const }
                          : // Diferença só na célula ESCOLHIDA que não é a mais
                            // barata: é o custo consciente da decisão. Em toda
                            // célula, ela repetia o que a coluna de números já
                            // diz pela posição.
                            escolhido && !ehMelhor && dif && !dif.ganho
                            ? { texto: `+${fmtPreco(dif.valor)}`, tom: "faint" as const }
                            : null;

                    const detalhes = [
                      falta,
                      comFaixa ? "promoção por volume" : null,
                      r.marca,
                      dif ? `${dif.ganho ? "−" : "+"}${fmtPreco(dif.valor)} na linha` : null,
                      `${fmtMoney(preco * quantidadeDe(item))} no total do item`,
                    ].filter(Boolean);

                    return (
                      <td
                        key={c.id}
                        className={cn(
                          "px-3 py-2 text-right",
                          eleito
                            ? "bg-brand-soft/40"
                            : colunaVencedora && "bg-ok-soft/25",
                        )}
                      >
                        <button
                          type="button"
                          disabled={!podePedir || decidida}
                          onClick={() => {
                            setModo("manual");
                            setEscolhas((e) => ({
                              ...e,
                              [item.id]: e[item.id] === c.id ? null : c.id,
                            }));
                          }}
                          aria-pressed={escolhido}
                          title={detalhes.join(" · ")}
                          className={cn(
                            "inline-flex flex-col items-end gap-0.5 rounded-[var(--radius)] px-2.5 py-1 transition-colors",
                            escolhido
                              ? "bg-brand text-on-brand"
                              : ehMelhor
                                ? "text-ok hover:bg-surface-2"
                                : "text-ink hover:bg-surface-2",
                            (!podePedir || decidida) && "cursor-default",
                          )}
                        >
                          <span
                            className={cn(
                              "font-mono text-[13px] tabular-nums",
                              escolhido || ehMelhor ? "font-semibold" : "font-normal",
                            )}
                          >
                            {fmtPreco(preco)}
                          </span>

                          {nota && (
                            <span
                              className={cn(
                                "text-[10px] font-medium",
                                escolhido
                                  ? "text-on-brand/80"
                                  : nota.tom === "accent"
                                    ? "text-accent"
                                    : "text-faint",
                              )}
                            >
                              {nota.texto}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}

                  <td className="px-4 py-2 text-right">
                    {precoEscolhido === null ? (
                      <span className="text-[12px] text-faint">—</span>
                    ) : (
                      <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
                        {fmtMoney(precoEscolhido * quantidadeDe(item))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

        </table>
      </div>

      {/* Celular: um produto por vez. */}
      <div className={cn("flex flex-col gap-3", !mobile && "md:hidden")}>
        {/* Com lista curta o filtro é mais UI do que ajuda; a partir de cinco
            itens ele é o que responde "o que ainda falta decidir?". */}
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
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      ativo ? "text-on-brand/80" : "text-faint",
                    )}
                  >
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
                melhorConviteId={melhorPorItem.get(item.id)?.conviteId ?? null}
                escolhido={escolhas[item.id] ?? null}
                editavel={podePedir && !decidida}
                mostrarMarca={marcasDivergemNoItem(item.id)}
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
            "sticky z-20 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-float)]",
            mobile ? "gap-2 px-3 py-2.5" : "bottom-0 gap-2.5 px-4 py-3",
          )}
        >
          {/* Escolher a estratégia e fechar a compra são o mesmo gesto, e agora
              moram no mesmo lugar: o operador decide "de quem" e "gerar" sem
              subir a tela de volta.

              No celular a escolha da estratégia desce para uma folha: as duas
              opções, a fila de fornecedores e o parágrafo somavam quase metade
              de uma tela de 390px em cima de onde a compra fecha. */}
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
                {/* Gerar pedido é irreversível e o botão está colado no
                    polegar: no celular ele abre a conferência, não dispara. */}
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  disabled={pendente || itensEscolhidos === 0}
                  aria-haspopup="dialog"
                  className="min-h-11 shrink-0 rounded-full bg-brand px-5 text-sm font-semibold text-on-brand transition-colors disabled:opacity-50"
                >
                  {pendente ? "Gerando…" : umPedidoSo ? "Gerar pedido" : "Gerar pedidos"}
                </button>
              </div>
            </>
          ) : (
            <>
              {respondidos.length > 0 && (
                <EstrategiaCompra
                  modo={modo}
                  respondidos={respondidos}
                  totalItens={cotacao.itens.length}
                  fornecedorUnico={fornecedorUnico}
                  onMelhorPreco={aplicarMelhorPreco}
                  onFornecedor={aplicarFornecedor}
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2.5">
                <p className="text-[13px] text-muted">
                  {itensEscolhidos === 0
                    ? "Escolha de quem comprar cada item."
                    : `${itensEscolhidos} ${itensEscolhidos === 1 ? "item escolhido" : "itens escolhidos"}${
                        modo === "fornecedor" && nomeFornecedorUnico
                          ? ` de ${nomeFornecedorUnico}`
                          : ""
                      }${foraDoFornecedor > 0 ? ` · ${foraDoFornecedor} sem cotação dele` : ""}${
                        comPromocao > 0 ? ` · ${comPromocao} acima do cotado por promoção` : ""
                      } · `}
                  {itensEscolhidos > 0 && (
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                      {fmtMoney(totalEscolhido)}
                    </span>
                  )}
                  {/* O que dividir a compra rende contra fechar tudo com o mais
                      barato. Zero não vira selo: dizer "economia de R$ 0,00" só
                      ensina o operador a ignorar o rótulo. */}
                  {economiaDividindo > 0.005 && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[12px] font-medium text-ok">
                      <TrendingDown size={12} />
                      Economia estimada{" "}
                      <span className="font-mono font-semibold tabular-nums">
                        {fmtMoney(economiaDividindo)}
                      </span>
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={gerar}
                  disabled={pendente || itensEscolhidos === 0}
                  className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
                >
                  {pendente ? "Gerando…" : rotuloGerar}
                </button>
              </div>
            </>
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
            onMelhorPreco={aplicarMelhorPreco}
            onFornecedor={aplicarFornecedor}
            comTitulo={false}
          />
        </BottomSheet>
      )}

      {/* ── Folha: conferência antes de gerar ─────────────── */}
      {mobile && podePedir && !decidida && (
        <BottomSheet
          open={confirmando}
          onClose={() => setConfirmando(false)}
          titulo={umPedidoSo ? "Gerar pedido de compra" : "Gerar pedidos de compra"}
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
              onClick={gerar}
              disabled={pendente}
              className="min-h-12 w-full rounded-full bg-brand text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              {pendente
                ? "Gerando…"
                : umPedidoSo
                  ? "Confirmar e enviar o pedido"
                  : `Confirmar e enviar os ${pedidosPrevistos.length} pedidos`}
            </button>
          }
        >
          <ul className="flex flex-col gap-2">
            {pedidosPrevistos.map((x) => (
              <li
                key={x.id}
                className="flex items-center gap-2.5 rounded-[var(--radius)] border border-line px-3 py-2.5"
              >
                <SupplierAvatar nome={x.nome} logoUrl={x.logoUrl} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {x.nome}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {x.itens} {x.itens === 1 ? "item" : "itens"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-ink">
                  {fmtMoney(x.total)}
                </span>
              </li>
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
            Os pedidos são criados e enviados aos fornecedores. A partir daí a cotação fica
            decidida.
          </p>
        </BottomSheet>
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
  onMelhorPreco,
  onFornecedor,
  comTitulo = true,
}: {
  modo: "melhor" | "fornecedor" | "manual";
  respondidos: ConviteCotacao[];
  totalItens: number;
  fornecedorUnico: string | null;
  onMelhorPreco: () => void;
  onFornecedor: (conviteId: string) => void;
  /** Dentro da folha o título já é o cabeçalho dela — repetido, vira eco. */
  comTitulo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {comTitulo && (
        <span className="text-[12px] font-medium text-ink">Como deseja comprar?</span>
      )}

      <div role="radiogroup" aria-label="Como deseja comprar" className="grid gap-2 sm:grid-cols-2">
        <OpcaoCompra
          ativo={modo === "melhor"}
          titulo="Melhor preço por item"
          descricao="Divide os itens entre fornecedores para chegar no menor custo."
          onClick={onMelhorPreco}
        />
        <OpcaoCompra
          ativo={modo === "fornecedor"}
          titulo="Um único fornecedor"
          descricao="Compra tudo de um só — uma entrega, um mínimo, uma conversa."
          onClick={() => onFornecedor(fornecedorUnico ?? respondidos[0].id)}
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
          <span className="font-medium text-ink-2">Escolha personalizada</span> — você mexeu em
          células específicas. Clicar numa das opções acima refaz a seleção.
        </p>
      )}
    </div>
  );
}

function OpcaoCompra({
  ativo,
  titulo,
  descricao,
  onClick,
}: {
  ativo: boolean;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={onClick}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-left transition-colors",
        ativo
          ? "border-brand bg-brand-soft"
          : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
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
  melhorConviteId,
  escolhido,
  editavel,
  mostrarMarca,
  onEscolher,
}: {
  item: ItemCotacao;
  /** Quanto vai ser pedido — sobe quando uma promoção por volume é levada. */
  quantidade: number;
  respondidos: ConviteCotacao[];
  /** Preço deste item naquele fornecedor, já na quantidade escolhida. */
  precoDe: (c: ConviteCotacao) => number | null;
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
  }));

  const disponiveis = linhas
    .filter((l) => l.resposta?.disponivel && l.preco !== null)
    .sort((a, b) => (a.preco as number) - (b.preco as number));
  const ausentes = linhas.filter((l) => !l.resposta?.disponivel);

  // Mesma base do desktop: a diferença de cada proposta contra a melhor da
  // linha só existe quando há com o que comparar.
  const precosDaLinha = disponiveis.map((l) => l.preco as number);

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
          {disponiveis.map(({ convite: c, resposta, preco: precoBruto }) => {
            const r = resposta!;
            const preco = precoBruto as number;
            const marcado = escolhido === c.id;
            const ehMelhor = melhorConviteId === c.id;
            const falta = faltaTexto(r.quantidadeOfertada, item.quantidade);
            const dif = diferencaNaLinha(precosDaLinha, preco);
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
                      {fmtPreco(preco)}
                    </span>
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
