"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Scale, Sparkles, Target, Trophy, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { precoNaQuantidade, type LimitesEscala } from "@/lib/compras/escalas";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney, fmtPreco } from "../_catalogo/ui";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, CotacaoDetalhe, ItemCotacao } from "../_compra-types";
import { gerarPedidosAction } from "../_compra-actions";
import { LenteOportunidade, type Sugestao } from "./_escala";

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

export function ComparativoCotacao({
  cotacao,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
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

  const totaisCheios = respondidos
    .filter((c) =>
      cotacao.itens.every((i) =>
        c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
      ),
    )
    .map((c) => ({ nome: c.supplierNome, total: c.total }));

  const piorCheio = totaisCheios.length
    ? Math.max(...totaisCheios.map((t) => t.total))
    : null;
  const melhorCheio = totaisCheios.length
    ? totaisCheios.reduce((a, b) => (b.total < a.total ? b : a))
    : null;

  const itensEscolhidos = Object.entries(escolhas).filter(([, v]) => v !== null).length;

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
      {podePedir && !decidida && respondidos.length > 0 && (
        <EstrategiaCompra
          modo={modo}
          respondidos={respondidos}
          totalItens={cotacao.itens.length}
          fornecedorUnico={fornecedorUnico}
          onMelhorPreco={aplicarMelhorPreco}
          onFornecedor={aplicarFornecedor}
        />
      )}

      <MetricaGrid className="lg:grid-cols-3">
        <Metrica
          label="Cesta escolhida"
          valor={fmtMoney(totalEscolhido)}
          sub={`${itensEscolhidos} de ${cotacao.itens.length} itens`}
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
          valor={piorCheio !== null ? fmtMoney(Math.max(0, piorCheio - totalEscolhido)) : "—"}
          sub="proposta cheia mais cara"
          tom="ok"
          icon={<TrendingDown size={13} />}
        />
      </MetricaGrid>

      <div className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface md:block">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Qtd</th>
              {respondidos.map((c) => (
                <th key={c.id} className="px-3 py-2.5 text-right font-medium">
                  <span className="block truncate normal-case text-[12px] text-ink-2">
                    {c.supplierNome}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {cotacao.itens.map((item) => {
              const melhor = melhorPorItem.get(item.id);
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
                        <span className="font-semibold text-accent">{quantidadeDe(item)}</span>
                        <span className="text-[11px] text-faint line-through">
                          {item.quantidade}
                        </span>
                      </span>
                    ) : (
                      item.quantidade
                    )}
                  </td>

                  {respondidos.map((c) => {
                    const r = c.respostas.find((x) => x.quotationItemId === item.id);
                    const escolhido = escolhas[item.id] === c.id;
                    const ehMelhor = melhor?.conviteId === c.id;

                    if (!r?.disponivel) {
                      return (
                        <td key={c.id} className="px-3 py-2.5 text-right text-[12px] text-faint">
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

                    return (
                      <td key={c.id} className="px-3 py-2.5 text-right">
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
                          <span
                            className={cn(
                              "font-mono text-[11px] tabular-nums",
                              escolhido ? "text-on-brand/80" : "text-faint",
                            )}
                          >
                            {fmtMoney(preco * quantidadeDe(item))}
                          </span>
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

          <tfoot className="border-t border-line bg-surface-2">
            <tr>
              <td className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">
                Total cheio
              </td>
              <td />
              {respondidos.map((c) => {
                const cobreTudo = cotacao.itens.every((i) =>
                  c.respostas.some((r) => r.quotationItemId === i.id && r.disponivel),
                );
                // Recalculado com as quantidades da tela (e não `c.total`, que é
                // a soma da leitura): senão a linha do total ignoraria a
                // promoção que as células acima já estão mostrando.
                const soma =
                  cotacao.itens.reduce((acc, i) => {
                    const preco = precoDe(i, c);
                    return preco === null ? acc : acc + preco * quantidadeDe(i);
                  }, 0) + (c.frete ?? 0);
                return (
                  <td
                    key={c.id}
                    className="px-3 py-2.5 text-right font-mono text-[13px] font-semibold tabular-nums text-ink"
                  >
                    {cobreTudo ? fmtMoney(soma) : <span className="text-faint">parcial</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
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

      {erro && <p className="text-[13px] text-danger">{erro}</p>}
      {aviso && (
        <p className="rounded-[var(--radius)] border border-line bg-accent-soft px-3.5 py-2 text-[13px] text-accent">
          {aviso}
        </p>
      )}

      {podePedir && !decidida && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-float)]">
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
      )}

      {decidida && (
        <p className="rounded-[var(--radius)] border border-line bg-ok-soft px-3.5 py-2 text-[13px] text-ok">
          Esta cotação já virou pedido de compra. Acompanhe o resto em Pedidos.
        </p>
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
}: {
  modo: "melhor" | "fornecedor" | "manual";
  respondidos: ConviteCotacao[];
  totalItens: number;
  fornecedorUnico: string | null;
  onMelhorPreco: () => void;
  onFornecedor: (conviteId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink">Fechar a compra</span>
        <button
          type="button"
          onClick={onMelhorPreco}
          aria-pressed={modo === "melhor"}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            modo === "melhor"
              ? "bg-brand text-on-brand"
              : "border border-line bg-surface text-muted hover:text-ink",
          )}
        >
          Melhor preço por item
        </button>
        {modo === "manual" && (
          <span className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink-2">
            Escolha personalizada
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">Ou tudo de um fornecedor:</span>
        {respondidos.map((c) => {
          const ativo = modo === "fornecedor" && fornecedorUnico === c.id;
          const atende = c.itensAtendidos;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onFornecedor(c.id)}
              aria-pressed={ativo}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                ativo
                  ? "bg-brand text-on-brand"
                  : "border border-line bg-surface text-ink hover:bg-surface-2",
              )}
            >
              <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={18} />
              {c.supplierNome}
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
    </div>
  );
}

// ── Card de item (celular) ──────────────────────────────────

function CardItem({
  item,
  quantidade,
  respondidos,
  melhorConviteId,
  escolhido,
  editavel,
  onEscolher,
}: {
  item: ItemCotacao;
  /** Quanto vai ser pedido — sobe quando uma promoção por volume é levada. */
  quantidade: number;
  respondidos: ConviteCotacao[];
  melhorConviteId: string | null;
  escolhido: string | null;
  editavel: boolean;
  onEscolher: (conviteId: string) => void;
}) {
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
          {item.embalagemNome ? ` ${item.embalagemNome}` : ""}
        </span>
      </div>

      <ul className="mt-2.5 flex flex-col gap-1.5">
        {respondidos.map((c) => {
          const r = c.respostas.find((x) => x.quotationItemId === item.id);
          const marcado = escolhido === c.id;
          const ehMelhor = melhorConviteId === c.id;
          const falta = faltaTexto(r?.quantidadeOfertada, item.quantidade);
          const preco = r
            ? precoNaQuantidade(
                { quantidadePedida: item.quantidade, precoBase: r.precoUnitario },
                r.faixas,
                quantidade,
              ).preco
            : 0;

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
