"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Clock,
  Layers,
  Scale,
  Send,
  Sparkles,
  Target,
  Trophy,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { precoNaQuantidade, type LimitesEscala } from "@/lib/compras/escalas";
import { EstadoVazio, Metrica, fmtMoney, fmtPreco, unidadeDaQtd } from "../_catalogo/ui";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, ItemCotacao } from "../_compra-types";
import { gerarPedidosAction, type Envio } from "../_compra-actions";
import { LenteOportunidade, type Sugestao } from "./_escala";
import { EnvioSheet } from "./_envio";
import { ResumoCotacaoPainel } from "./_resumo";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import type { PedidoDaCotacao } from "@/lib/compras/cotacao-economia";

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
  pedidos,
  podePedir,
  onEnviado,
}: {
  cotacao: CotacaoDetalhe;
  /** Leitura em texto do que os números dizem — fica logo abaixo do totalizador. */
  resumo: ResumoCotacao;
  /** Pedidos já gerados. Vazio enquanto a cotação não foi decidida. */
  pedidos: PedidoDaCotacao[];
  podePedir: boolean;
  /**
   * A cobrança de quem ainda não respondeu sai daqui, mas a folha de mensagens
   * prontas é a mesma do resto da tela — quem monta a página a exibe.
   */
  onEnviado?: (envios: Envio[]) => void;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
  const [limites, setLimites] = useState<LimitesEscala>(cotacao.limitesEscala);

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
  const aguardando = cotacao.convites.filter((c) => c.status === "ENVIADA");
  const [cobrando, setCobrando] = useState(false);
  const [aguardarQuieto, setAguardarQuieto] = useState(false);

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

  const piorCheio = totaisCheios.length
    ? Math.max(...totaisCheios.map((t) => t.total))
    : null;
  const melhorCheio = totaisCheios.length
    ? totaisCheios.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  const itensEscolhidos = Object.entries(escolhas).filter(([, v]) => v !== null).length;

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
          setAviso(
            `Ficaram de fora ${r.semProduto.length} ${r.semProduto.length === 1 ? "item que não está" : "itens que não estão"} vinculados ao catálogo: ${r.semProduto.join(", ")}.`,
          );
        }
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível gerar os pedidos.");
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

  return (
    <div className="flex flex-col gap-4">
      {temFaixa && (
        <AlternadorLente lente={lente} onLente={setLente} onNecessidade={zerarQuantidades} />
      )}

      <StatusPropostas
        recebidas={respondidos.length}
        recusadas={cotacao.convites.filter((c) => c.status === "RECUSADA").length}
        aguardando={aguardando}
        quieto={aguardarQuieto}
        onAguardar={() => setAguardarQuieto(true)}
        onCobrar={podePedir && !decidida ? () => setCobrando(true) : undefined}
      />

      {/* O totalizador vale para as duas lentes: a cesta é a mesma escolha,
          e trocar de pergunta não pode fazer o total sumir da tela. */}
      <CestaEscolhida
        numeroCotacao={cotacao.numero}
        total={totalEscolhido}
        itensEscolhidos={itensEscolhidos}
        totalItens={cotacao.itens.length}
        melhorCheio={melhorCheio}
        piorCheio={piorCheio}
        pedidos={pedidos}
      />

      {/* A leitura confirma os números que acabaram de ser lidos, e só depois
          vem a matriz — texto primeiro, tabela depois. */}
      <ResumoCotacaoPainel resumo={resumo} />

      {lente === "oportunidade" && (
        <LenteOportunidade
          itens={cotacao.itens}
          respondidos={respondidos}
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
      <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface md:block">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd</th>
              {/* O cabeçalho é a coluna inteira resumida: quem é, se é a
                  melhor proposta cheia, e por quanto ele fecha. Colunas
                  idênticas obrigam a somar de cabeça antes de decidir. */}
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
                    className={cn(
                      "px-3 py-2.5 text-right align-top font-medium",
                      eleito && "bg-brand-soft",
                    )}
                  >
                    <span className="flex flex-col items-end gap-1">
                      <span className="flex items-center gap-1.5">
                        <SupplierAvatar
                          nome={c.supplierNome}
                          logoUrl={c.supplierLogoUrl}
                          size={18}
                        />
                        <span
                          className={cn(
                            "max-w-[9rem] truncate normal-case text-[12px]",
                            eleito ? "font-semibold text-brand" : "text-ink-2",
                          )}
                        >
                          {c.supplierNome}
                        </span>
                      </span>

                      {melhorGeral ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-semibold normal-case text-ok">
                          <Trophy size={10} />
                          Melhor opção
                        </span>
                      ) : eleito ? (
                        <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold normal-case text-on-brand">
                          Escolhido
                        </span>
                      ) : null}

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
                          só {atende} de {cotacao.itens.length} itens
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {cotacao.itens.map((item) => {
              const melhor = melhorPorItem.get(item.id);
              // Preços da linha na quantidade escolhida — a base da diferença
              // que cada célula mostra.
              const precosDaLinha = respondidos
                .map((c) => precoDe(item, c))
                .filter((x): x is number => x !== null);
              return (
                <tr key={item.id}>
                  <td className="max-w-0 px-4 py-2.5">
                    <span className="block truncate text-ink">{item.descricao}</span>
                    {!item.productId && (
                      <span className="text-[11px] text-faint">fora do catálogo</span>
                    )}
                  </td>
                  {/* A quantidade que vai no pedido, não a que foi perguntada:
                      levada uma promoção, elas deixam de ser a mesma coisa e a
                      cotada continua à vista, riscada. */}
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums text-muted">
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

                    if (!r?.disponivel) {
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            "px-3 py-2.5 text-right text-[12px] text-faint",
                            eleito && "bg-brand-soft/40",
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

                    return (
                      <td
                        key={c.id}
                        className={cn("px-3 py-2.5 text-right", eleito && "bg-brand-soft/40")}
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
                          className={cn(
                            "inline-flex flex-col items-end gap-0.5 rounded-[var(--radius)] px-2.5 py-1 transition-colors",
                            escolhido
                              ? "bg-brand text-on-brand"
                              : ehMelhor
                                ? "bg-accent-soft text-accent hover:bg-accent-soft/70"
                                : "text-ink hover:bg-surface-2",
                            (!podePedir || decidida) && "cursor-default",
                          )}
                        >
                          <span className="font-mono text-[13px] font-semibold tabular-nums">
                            {fmtPreco(preco)}
                          </span>
                          {/* O ganho (ou o custo) de escolher esta célula, no
                              lugar de repetir o mesmo número embaixo. */}
                          {dif && (
                            <span
                              className={cn(
                                "flex items-center gap-0.5 text-[11px] font-medium",
                                escolhido
                                  ? "text-on-brand/80"
                                  : dif.ganho
                                    ? "text-ok"
                                    : "text-faint",
                              )}
                            >
                              {dif.ganho ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                              <span className="font-mono tabular-nums">{fmtPreco(dif.valor)}</span>
                            </span>
                          )}
                          {quantidadeDe(item) > 1 && (
                            <span
                              className={cn(
                                "font-mono text-[11px] tabular-nums",
                                escolhido ? "text-on-brand/80" : "text-faint",
                              )}
                            >
                              {fmtMoney(preco * quantidadeDe(item))}
                            </span>
                          )}
                          {comFaixa && (
                            <span
                              className={cn(
                                "text-[10px] font-medium",
                                escolhido ? "text-on-brand/80" : "text-accent",
                              )}
                            >
                              promoção por volume
                            </span>
                          )}
                          {r.marca && (
                            <span
                              className={cn(
                                "text-[10px]",
                                escolhido ? "text-on-brand/80" : "text-faint",
                              )}
                            >
                              {r.marca}
                            </span>
                          )}
                          {faltaTexto(r.quantidadeOfertada, item.quantidade) && (
                            <span
                              className={cn(
                                "text-[10px] font-medium",
                                escolhido ? "text-on-brand/80" : "text-accent",
                              )}
                            >
                              {faltaTexto(r.quantidadeOfertada, item.quantidade)}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

        </table>
      </div>

      {/* Celular: um produto por vez. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {cotacao.itens.map((item) => (
          <CardItem
            key={item.id}
            item={item}
            quantidade={quantidadeDe(item)}
            respondidos={respondidos}
            precoDe={(c) => precoDe(item, c)}
            melhorConviteId={melhorPorItem.get(item.id)?.conviteId ?? null}
            escolhido={escolhas[item.id] ?? null}
            editavel={podePedir && !decidida}
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
        </>
      )}

      {cobrando && (
        <EnvioSheet
          cotacaoId={cotacao.id}
          alvos={aguardando}
          reenvio
          prazoAtual={cotacao.prazoResposta}
          onFechar={() => setCobrando(false)}
          onEnviado={(r) => {
            setCobrando(false);
            onEnviado?.(r);
          }}
        />
      )}

      {erro && <p className="text-[13px] text-danger">{erro}</p>}
      {aviso && (
        <p className="rounded-[var(--radius)] border border-line bg-accent-soft px-3.5 py-2 text-[13px] text-accent">
          {aviso}
        </p>
      )}

      {podePedir && !decidida && (
        <div className="sticky bottom-0 z-20 flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
          {/* Escolher a estratégia e fechar a compra são o mesmo gesto, e agora
              moram no mesmo lugar: o operador decide "de quem" e "gerar" sem
              subir a tela de volta. */}
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
              {pendente
                ? "Gerando…"
                : modo === "fornecedor" && nomeFornecedorUnico
                  ? `Gerar pedido para ${nomeFornecedorUnico}`
                  : "Gerar pedidos de compra"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Totalizador da cesta ────────────────────────────────────
// Os três números que fecham a decisão, num grid só com divisores — três
// cartões soltos custam mais atenção do que informam.
//
// Decidida, o cartão ganha a faixa dos PEDIDOS: quem volta nesta tela depois
// da compra não quer o total de novo, quer o número do pedido e o fornecedor
// que ficou com ele. Por isso o número vem em mono, grande, e leva direto ao
// pedido — o resto do cartão é contexto dele.

function CestaEscolhida({
  numeroCotacao,
  total,
  itensEscolhidos,
  totalItens,
  melhorCheio,
  piorCheio,
  pedidos,
}: {
  numeroCotacao: string;
  total: number;
  itensEscolhidos: number;
  totalItens: number;
  melhorCheio: { nome: string; total: number } | null;
  piorCheio: number | null;
  pedidos: PedidoDaCotacao[];
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metrica
          label="Cesta escolhida"
          valor={fmtMoney(total)}
          sub={`${itensEscolhidos} de ${totalItens} itens · cotação ${numeroCotacao}`}
          tom="brand"
          icon={<Sparkles size={13} />}
        />
        <Metrica
          label="Melhor fornecedor único"
          valor={melhorCheio ? fmtMoney(melhorCheio.total) : "—"}
          sub={melhorCheio ? melhorCheio.nome : "ninguém cotou a lista inteira"}
          icon={<Scale size={13} />}
        />
        <Metrica
          label="Economia contra a pior"
          valor={piorCheio !== null ? fmtMoney(Math.max(0, piorCheio - total)) : "—"}
          sub="proposta cheia mais cara"
          tom="ok"
          icon={<TrendingDown size={13} />}
        />
      </div>

      {pedidos.length > 0 && (
        <div className="border-t border-line bg-surface-2 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            {pedidos.length === 1 ? "Pedido gerado" : `${pedidos.length} pedidos gerados`} · a
            partir da cotação {numeroCotacao}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {pedidos.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pedidos?pedido=${p.id}`}
                  className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[15px] font-semibold leading-tight text-ink">
                      {p.numero}
                    </span>
                    <span className="mt-0.5 block max-w-[13rem] truncate text-[12px] text-muted">
                      {p.supplierNome}
                    </span>
                  </span>
                  <span className="shrink-0 font-display text-[13px] font-semibold text-ink">
                    {fmtMoney(p.valorTotal)}
                  </span>
                  <ArrowUpRight size={13} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
}: {
  modo: "melhor" | "fornecedor" | "manual";
  respondidos: ConviteCotacao[];
  totalItens: number;
  fornecedorUnico: string | null;
  onMelhorPreco: () => void;
  onFornecedor: (conviteId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-ink">Como deseja comprar?</span>

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
                  "flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
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
        <span className="mt-0.5 hidden text-[11px] leading-snug text-muted sm:block">
          {descricao}
        </span>
      </span>
    </button>
  );
}

// ── Quem respondeu, quem falta ──────────────────────────────
// A compra pode estar sendo fechada antes de a melhor proposta chegar, e a
// tela não pode deixar isso passar em silêncio. Duas saídas, as duas
// legítimas: esperar, ou cobrar agora — e cobrar abre a mesma folha de
// mensagens prontas que a aba de fornecedores usa.

function StatusPropostas({
  recebidas,
  recusadas,
  aguardando,
  quieto,
  onAguardar,
  onCobrar,
}: {
  recebidas: number;
  recusadas: number;
  aguardando: ConviteCotacao[];
  /** O operador já disse que vai esperar — o aviso encolhe e para de insistir. */
  quieto: boolean;
  onAguardar: () => void;
  onCobrar?: () => void;
}) {
  const falta = aguardando.length;
  return (
    <section
      aria-label="Propostas da cotação"
      className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
        <span className="font-semibold">
          {recebidas} {recebidas === 1 ? "proposta recebida" : "propostas recebidas"}
        </span>
        {recusadas > 0 && (
          <span className="text-[12px] text-muted">
            · {recusadas} {recusadas === 1 ? "recusou cotar" : "recusaram cotar"}
          </span>
        )}
      </p>

      {falta > 0 &&
        (quieto ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Clock size={12} className="shrink-0" />
            Aguardando {falta} {falta === 1 ? "fornecedor" : "fornecedores"}:{" "}
            {aguardando.map((c) => c.supplierNome).join(", ")}.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-2.5">
            <p className="text-[13px] font-medium text-accent">
              {falta}{" "}
              {falta === 1
                ? "fornecedor ainda não respondeu"
                : "fornecedores ainda não responderam"}
            </p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {aguardando.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5">
                  <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={18} />
                  <span className="max-w-[14rem] truncate text-[13px] text-ink">
                    {c.supplierNome}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              {onCobrar && (
                <button
                  type="button"
                  onClick={onCobrar}
                  className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  <Send size={13} />
                  Reenviar solicitação
                </button>
              )}
              <button
                type="button"
                onClick={onAguardar}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2"
              >
                <Clock size={13} />
                Aguardar resposta
              </button>
            </div>
          </div>
        ))}
    </section>
  );
}

// ── Card de item (celular) ──────────────────────────────────

function CardItem({
  item,
  quantidade,
  respondidos,
  precoDe,
  melhorConviteId,
  escolhido,
  editavel,
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
  onEscolher: (conviteId: string) => void;
}) {
  // Mesma base do desktop: a diferença de cada proposta contra a melhor da
  // linha só existe quando há com o que comparar.
  const precosDaLinha = respondidos
    .map((c) => precoDe(c))
    .filter((x): x is number => x !== null);
  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{item.descricao}</p>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
          {quantidade > item.quantidade && (
            <span className="mr-1.5 text-faint line-through">{fmtQtd(item.quantidade)}</span>
          )}
          <span className={quantidade > item.quantidade ? "font-semibold text-accent" : ""}>
            {fmtQtd(quantidade)}
          </span>
          <span className="ml-1 font-sans text-faint">
            {unidadeDaQtd(quantidade, item.embalagemNome)}
          </span>
        </span>
      </div>

      <ul className="mt-2.5 flex flex-col gap-1.5">
        {respondidos.map((c) => {
          const r = c.respostas.find((x) => x.quotationItemId === item.id);
          const marcado = escolhido === c.id;
          const ehMelhor = melhorConviteId === c.id;
          const falta = faltaTexto(r?.quantidadeOfertada, item.quantidade);
          const preco = precoDe(c) ?? 0;
          const dif = diferencaNaLinha(precosDaLinha, preco);

          if (!r?.disponivel) {
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-dashed border-line px-3 py-2"
              >
                <span className="min-w-0 truncate text-[13px] text-faint">{c.supplierNome}</span>
                <span className="shrink-0 text-[12px] text-faint">não tem</span>
              </li>
            );
          }

          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={!editavel}
                onClick={() => onEscolher(c.id)}
                aria-pressed={marcado}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-[var(--radius)] border px-3 py-2 text-left transition-colors",
                  marcado
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface hover:bg-surface-2",
                  !editavel && "cursor-default",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {c.supplierNome}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]",
                      marcado ? "text-on-brand/80" : "text-muted",
                    )}
                  >
                    <span>{fmtMoney(preco * quantidade)} no total</span>
                    {dif && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 font-medium",
                          marcado ? "" : dif.ganho ? "text-ok" : "text-faint",
                        )}
                      >
                        {dif.ganho ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
                        {fmtPreco(dif.valor)}
                      </span>
                    )}
                    {preco < r.precoUnitario && (
                      <span className={marcado ? "" : "font-medium text-accent"}>
                        promoção por volume
                      </span>
                    )}
                    {r.marca && <span>{r.marca}</span>}
                    {falta && (
                      <span className={marcado ? "" : "font-medium text-accent"}>{falta}</span>
                    )}
                    {ehMelhor && !marcado && (
                      <span className="inline-flex items-center gap-1 font-medium text-accent">
                        <Trophy size={11} />
                        melhor preço
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
                  {fmtPreco(preco)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
