"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ClipboardCheck, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ProdutoThumb } from "@/components/recebimento/produto-thumb";
import { fmtMoney, fmtQtd } from "../../cotacoes/_catalogo/ui";
import { finalizarRecebimentoAction } from "../conferencia-actions";
import type { LinhaRecebimento, RecebimentoView } from "../_data";
import {
  Cabecalho,
  ETAPAS_COM_NOTA,
  ETAPAS_SEM_NOTA,
  RodapeAcao,
  Trilho,
  type EtapaId,
} from "./_partes";

// ============================================================
// Fechamento: a última tela antes de a mercadoria virar saldo.
//
// Confirmar a entrada mexe em quatro coisas de uma vez — estoque, custo,
// contas a pagar e histórico de compras — e antes disso cabia tudo numa gaveta
// com um parágrafo. Aqui cada consequência tem o seu bloco, com o número que
// ela vai gravar, e a única que pede decisão (o preço de venda) pede na linha
// do produto que mudou de custo.
//
// Nada desta tela grava antes do botão: o preço novo é rascunho até a entrada
// ser confirmada, e vai junto com ela.
// ============================================================

/** Variação de custo que vale a pena mostrar — abaixo disso é centavo de rateio. */
const VARIACAO_MINIMA = 0.01;

type ProdutoFechamento = {
  productId: string;
  nome: string;
  sku: string | null;
  imagemUrl: string | null;
  unidades: number;
  /** Custo por unidade nesta compra, já com frete, ST, IPI e desconto. */
  custoNovo: number;
  custoMedio: number | null;
  precoVenda: number | null;
  vendavel: boolean;
};

const esperadoDe = (l: LinhaRecebimento) => l.qtdFaturada || l.qtdPedida;
const entrando = (l: LinhaRecebimento) => l.qtdRecebida ?? esperadoDe(l);

const margem = (preco: number | null, custo: number | null) =>
  preco && preco > 0 && custo != null && custo > 0 ? (preco - custo) / preco : null;

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

const paraNumero = (texto: string) => {
  const n = Number(texto.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const paraTexto = (n: number) => n.toFixed(2).replace(".", ",");

/**
 * Uma linha por PRODUTO, não por linha da nota: a mesma cerveja em dois lotes
 * é um preço só para remarcar, com o custo ponderado pelo que entra de cada.
 */
function agruparPorProduto(linhas: LinhaRecebimento[]): ProdutoFechamento[] {
  const grupos = new Map<string, ProdutoFechamento & { custoTotal: number; pagas: number }>();
  for (const l of linhas) {
    const qtd = entrando(l);
    if (!l.productId || qtd <= 0) continue;
    const g = grupos.get(l.productId) ?? {
      productId: l.productId,
      nome: l.descricao,
      sku: l.sku,
      imagemUrl: l.imagemUrl,
      unidades: 0,
      custoNovo: 0,
      custoMedio: l.custoMedio,
      precoVenda: l.precoVenda,
      vendavel: l.vendavel,
      custoTotal: 0,
      pagas: 0,
    };
    g.unidades += qtd;
    // Bonificação entra no saldo e fica fora do custo: brinde não barateia o
    // que foi comprado, e somá-lo derrubaria o preço sugerido.
    if (!l.bonificacao) {
      g.custoTotal += qtd * l.custoFaturado;
      g.pagas += qtd;
    }
    grupos.set(l.productId, g);
  }
  return [...grupos.values()].map(({ custoTotal, pagas, ...g }) => ({
    ...g,
    custoNovo: pagas > 0 ? custoTotal / pagas : 0,
  }));
}

/**
 * O preço que devolve ao produto a margem que ele tinha antes desta compra.
 * Só quando o custo SUBIU: custo caindo é margem a favor, e baixar preço é
 * decisão comercial que a tela não toma por ninguém.
 */
function precoQueMantemMargem(p: ProdutoFechamento): number | null {
  const atual = margem(p.precoVenda, p.custoMedio);
  if (atual == null || atual <= 0 || atual >= 1) return null;
  if (p.custoMedio == null || p.custoNovo <= p.custoMedio * (1 + VARIACAO_MINIMA)) return null;
  return Math.ceil((p.custoNovo / (1 - atual)) * 100) / 100;
}

export function Fechamento({
  dados,
  podeAlterarPreco,
}: {
  dados: RecebimentoView;
  /** Sem `produto.preco` a pessoa vê a conta, mas não remarca. */
  podeAlterarPreco: boolean;
}) {
  const router = useRouter();
  const { recebimento, nota, pedido, linhas, semPedido } = dados;
  const [enviando, setEnviando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  /** Preço novo por produto, como a pessoa digitou. Vazio = não remarca. */
  const [precos, setPrecos] = React.useState<Record<string, string>>({});
  const [verEstaveis, setVerEstaveis] = React.useState(false);

  const voltar = () => router.push(`/recebimento/${recebimento.id}`);

  const itensEntrando = linhas.filter((l) => entrando(l) > 0);
  const unidades = itensEntrando.reduce((s, l) => s + entrando(l), 0);
  const semContagem = linhas.filter((l) => l.qtdRecebida == null).length;
  const semProduto = itensEntrando.filter((l) => !l.productId);

  // Mesma régua do servidor (`divergenciasDaConferencia`): contado diferente
  // do esperado e ainda sem explicação.
  const naoExplicadas = linhas.filter(
    (l) =>
      !l.motivoDivergencia &&
      l.resolucao !== "ACEITO" &&
      l.resolucao !== "IGNORADO" &&
      Math.abs(entrando(l) - esperadoDe(l)) > 0.001,
  );
  const precisaMotivo = naoExplicadas.length > 0;

  const produtos = React.useMemo(() => agruparPorProduto(linhas), [linhas]);
  const comCusto = produtos.filter((p) => p.custoNovo > 0);
  const variacao = (p: ProdutoFechamento) =>
    p.custoMedio && p.custoMedio > 0 ? (p.custoNovo - p.custoMedio) / p.custoMedio : null;
  /** Pede olhar: custo mexeu, produto sem preço, ou venda abaixo do custo. */
  const mudou = (p: ProdutoFechamento) => {
    const v = variacao(p);
    if (v == null || Math.abs(v) >= VARIACAO_MINIMA) return true;
    if (!p.vendavel) return false;
    return !p.precoVenda || p.precoVenda <= p.custoNovo;
  };
  const emFoco = comCusto.filter(mudou);
  const estaveis = comCusto.filter((p) => !mudou(p));

  const remarcados = Object.entries(precos)
    .map(([productId, texto]) => ({ productId, preco: paraNumero(texto) }))
    .filter((p): p is { productId: string; preco: number } => p.preco != null);

  const valorTitulos = nota
    ? nota.duplicatas.length > 0
      ? nota.duplicatas.reduce((s, d) => s + d.valor, 0)
      : nota.valorTotal
    : 0;

  const impedimento =
    semProduto.length > 0
      ? `${semProduto.length} ${semProduto.length === 1 ? "item ainda não tem" : "itens ainda não têm"} produto relacionado.`
      : itensEntrando.length === 0
        ? "Nenhum item foi recebido."
        : precisaMotivo && motivo.trim().length < 3
          ? "Explique a diferença na contagem para confirmar."
          : null;

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await finalizarRecebimentoAction({
        receiptId: recebimento.id,
        motivoDivergencia: motivo.trim() || null,
        precos: remarcados,
      });
      toast.success(
        `Recebimento ${r.numero} finalizado.`,
        [
          pedido
            ? r.pedidoCompleto
              ? `Estoque atualizado. Pedido ${pedido.numero} recebido por completo.`
              : `Estoque atualizado. Pedido ${pedido.numero} segue aberto para o que falta.`
            : "Estoque e custo atualizados.",
          r.precosAtualizados > 0
            ? `${r.precosAtualizados} ${r.precosAtualizados === 1 ? "preço remarcado" : "preços remarcados"}.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      router.replace(`/recebimento/${recebimento.id}`);
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível receber", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  const etapas = nota ? ETAPAS_COM_NOTA : ETAPAS_SEM_NOTA;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <Cabecalho
        recebimento={recebimento}
        nota={nota}
        pedidoNumero={pedido?.numero ?? null}
        semPedido={semPedido}
      />

      <Trilho
        etapas={etapas}
        atual="fechamento"
        onIr={(e: EtapaId) => {
          if (e === "conferencia") voltar();
        }}
      />

      <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        {/* ── Estoque ── */}
        <Bloco
          titulo="Estoque"
          resumo={
            <>
              <span className="font-mono text-ink">+{fmtQtd(unidades)} UN</span> em{" "}
              {itensEntrando.length} {itensEntrando.length === 1 ? "item" : "itens"} · {recebimento.siteNome}
            </>
          }
        >
          {semContagem > 0 && (
            <Aviso tom="accent">
              {semContagem} {semContagem === 1 ? "item não foi contado" : "itens não foram contados"}{" "}
              — {semContagem === 1 ? "entra" : "entram"} com a quantidade{" "}
              {nota ? "da nota" : "do pedido"}.
            </Aviso>
          )}
          {semProduto.length > 0 && (
            <Aviso tom="danger">
              {semProduto.length}{" "}
              {semProduto.length === 1 ? "item sem produto" : "itens sem produto"}:{" "}
              {semProduto
                .slice(0, 3)
                .map((l) => l.descricao)
                .join(", ")}
              {semProduto.length > 3 && "…"}. Volte à conferência e relacione antes de receber.
            </Aviso>
          )}
          {precisaMotivo && (
            // Uma frase, uma vez. Sem ela, a diferença vira daqui a três meses
            // a palavra do estoquista contra a do fornecedor.
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                O que aconteceu com{" "}
                {naoExplicadas.length === 1
                  ? "a linha que não bateu"
                  : `as ${naoExplicadas.length} linhas que não bateram`}
                ?
              </span>
              <ul className="mb-2 space-y-0.5 text-[12px] text-muted">
                {naoExplicadas.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-x-2">
                    <span className="min-w-0 truncate text-ink-2">{l.descricao}</span>
                    <span className="font-mono">
                      esperado {fmtQtd(esperadoDe(l))} · contado {fmtQtd(entrando(l))}
                    </span>
                  </li>
                ))}
                {naoExplicadas.length > 4 && <li>e mais {naoExplicadas.length - 4}.</li>}
              </ul>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={240}
                placeholder="Ex.: veio só metade da carga, o resto o motorista traz amanhã."
                className="w-full rounded-[var(--radius)] border border-line-button bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
              <span className="mt-1 block text-[12px] text-muted">
                Fica na história do recebimento{pedido ? " e do pedido" : ""}.
              </span>
            </label>
          )}
        </Bloco>

        {/* ── Custos e preços ── */}
        <Bloco
          titulo="Custos e preços"
          resumo={
            emFoco.length === 0
              ? "Nenhum custo mudou em relação ao que você já pagava."
              : `${emFoco.length} ${emFoco.length === 1 ? "produto pede" : "produtos pedem"} atenção · o custo médio é recalculado na entrada`
          }
        >
          {emFoco.length > 0 && (
            <ul className="divide-y divide-line rounded-[var(--radius)] border border-line">
              {emFoco.map((p) => (
                <LinhaPreco
                  key={p.productId}
                  produto={p}
                  variacao={variacao(p)}
                  texto={precos[p.productId] ?? ""}
                  onTexto={(t) => setPrecos((atual) => ({ ...atual, [p.productId]: t }))}
                  podeAlterar={podeAlterarPreco}
                />
              ))}
            </ul>
          )}
          {estaveis.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setVerEstaveis((v) => !v)}
                aria-expanded={verEstaveis}
                className="text-[12px] font-medium text-brand underline"
              >
                {verEstaveis ? "Ocultar" : "Ver"} {estaveis.length}{" "}
                {estaveis.length === 1 ? "produto com o mesmo custo" : "produtos com o mesmo custo"}
              </button>
              {verEstaveis && (
                <ul className="mt-2 divide-y divide-line rounded-[var(--radius)] border border-line">
                  {estaveis.map((p) => (
                    <LinhaPreco
                      key={p.productId}
                      produto={p}
                      variacao={variacao(p)}
                      texto={precos[p.productId] ?? ""}
                      onTexto={(t) => setPrecos((atual) => ({ ...atual, [p.productId]: t }))}
                      podeAlterar={podeAlterarPreco}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
          {!podeAlterarPreco && emFoco.length > 0 && (
            <p className="text-[12px] text-muted">
              Seu perfil não remarca preço de venda. Avise quem cuida dos preços sobre os
              produtos acima.
            </p>
          )}
        </Bloco>

        {/* ── Contas a pagar ── */}
        <Bloco
          titulo="Contas a pagar"
          resumo={
            !nota ? (
              "Sem NF-e neste recebimento, nenhum título é gerado agora."
            ) : nota.duplicatas.length > 0 ? (
              <>
                {nota.duplicatas.length} {nota.duplicatas.length === 1 ? "título" : "títulos"} ·{" "}
                <span className="font-mono text-ink">{fmtMoney(valorTitulos)}</span>
              </>
            ) : (
              <>
                1 título de <span className="font-mono text-ink">{fmtMoney(valorTitulos)}</span> ·
                vencimento pelo prazo do fornecedor
              </>
            )
          }
        >
          {nota && nota.duplicatas.length > 0 && (
            <ul className="divide-y divide-line rounded-[var(--radius)] border border-line text-[13px]">
              {nota.duplicatas.map((d) => (
                <li key={d.numero + d.vencimento} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono text-[12px] text-faint">{d.numero}</span>
                  <span className="text-ink-2">
                    vence em {new Date(d.vencimento).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="ml-auto font-mono text-ink">{fmtMoney(d.valor)}</span>
                </li>
              ))}
            </ul>
          )}
          {nota && nota.duplicatas.length === 0 && (
            <p className="text-[12px] text-muted">
              A nota não trouxe parcelas. Confira o vencimento em Contas a pagar quando o
              boleto chegar.
            </p>
          )}
          {nota && (
            <p className="text-[12px] text-muted">
              Os títulos seguem o valor da nota e nascem uma vez só por nota.
              {precisaMotivo &&
                " Se faltou mercadoria, registre a devolução depois da entrada para abater o que se deve."}{" "}
              Estornar a entrada cancela os que ainda estiverem em aberto.
            </p>
          )}
        </Bloco>

        {/* ── Histórico ── */}
        <Bloco
          titulo="Histórico de compras"
          resumo={
            <>
              {recebimento.supplierNome
                ? `Fica registrado em ${recebimento.supplierNome} e em cada produto`
                : "Fica registrado em cada produto"}
              {nota && (
                <>
                  , com a NF <span className="font-mono">{nota.numero}/{nota.serie}</span> e o XML
                  original guardados
                </>
              )}
              .
            </>
          }
        />
      </div>

      <RodapeAcao>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-semibold text-ink">
            <span className="font-mono">+{fmtQtd(unidades)} UN</span> no estoque
            {nota && (
              <>
                {" · "}
                <span className="font-mono">{fmtMoney(valorTitulos)}</span> a pagar
              </>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {impedimento ? (
              <>
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                <span>{impedimento}</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                <span>
                  {remarcados.length > 0
                    ? `${remarcados.length} ${remarcados.length === 1 ? "preço será remarcado" : "preços serão remarcados"} junto com a entrada.`
                    : "Nada é gravado antes de você confirmar."}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <Button variant="secondary" onClick={voltar} disabled={enviando} className="flex-1 sm:flex-none">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Conferência
          </Button>
          <Button
            onClick={() => void confirmar()}
            disabled={enviando || impedimento !== null}
            className="flex-1 sm:flex-none"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ClipboardCheck className="h-4 w-4" aria-hidden />
            )}
            {enviando ? "Recebendo…" : "Confirmar entrada"}
          </Button>
        </div>
      </RodapeAcao>
    </div>
  );
}

/**
 * Um bloco por consequência. O título é o que muda; o resumo é o número que
 * vai ser gravado — quem só bate o olho lê os quatro resumos e confirma.
 */
function Bloco({
  titulo,
  resumo,
  children,
}: {
  titulo: string;
  resumo: React.ReactNode;
  children?: React.ReactNode;
}) {
  const temCorpo = React.Children.toArray(children).length > 0;
  return (
    <section className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:px-5">
      <h2 className="font-display text-[14px] font-semibold text-ink">{titulo}</h2>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-[13px] text-ink-2">{resumo}</p>
        {temCorpo && children}
      </div>
    </section>
  );
}

function Aviso({ tom, children }: { tom: "accent" | "danger"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-[var(--radius)] px-3 py-2 text-[13px]",
        tom === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent",
      )}
    >
      {children}
    </p>
  );
}

/**
 * Custo de antes, custo desta compra e o preço na prateleira — na mesma linha,
 * porque a decisão de remarcar só existe com os três à vista.
 */
function LinhaPreco({
  produto: p,
  variacao,
  texto,
  onTexto,
  podeAlterar,
}: {
  produto: ProdutoFechamento;
  variacao: number | null;
  texto: string;
  onTexto: (t: string) => void;
  podeAlterar: boolean;
}) {
  const digitado = paraNumero(texto);
  const precoFinal = digitado ?? p.precoVenda;
  const margemAntes = margem(p.precoVenda, p.custoMedio);
  const margemDepois = margem(precoFinal, p.custoNovo);
  const sugerido = precoQueMantemMargem(p);
  const noPrejuizo = p.vendavel && precoFinal != null && precoFinal <= p.custoNovo;
  const idCampo = `preco-${p.productId}`;

  return (
    <li className="grid gap-x-4 gap-y-2 px-3 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProdutoThumb url={p.imagemUrl} nome={p.nome} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{p.nome}</p>
          <p className="truncate font-mono text-[11px] text-faint">
            {p.sku ? `${p.sku} · ` : ""}+{fmtQtd(p.unidades)} UN
          </p>
        </div>
      </div>

      <div className="text-[12px] text-muted">
        <p>Custo por unidade</p>
        <p className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-[13px]">
          {p.custoMedio != null && p.custoMedio > 0 ? (
            <>
              <span className="text-faint">{fmtMoney(p.custoMedio)}</span>
              <span className="text-faint" aria-hidden>
                →
              </span>
            </>
          ) : null}
          <span className="font-semibold text-ink">{fmtMoney(p.custoNovo)}</span>
          {variacao != null && Math.abs(variacao) >= VARIACAO_MINIMA && (
            <span className={variacao > 0 ? "text-accent" : "text-ok"}>
              {variacao > 0 ? "▲" : "▼"}
              {pct(Math.abs(variacao))}
            </span>
          )}
          {(p.custoMedio == null || p.custoMedio <= 0) && (
            <span className="font-sans text-[12px] text-muted">primeira compra</span>
          )}
        </p>
      </div>

      {p.vendavel ? (
        <div className="text-[12px] text-muted">
          <label htmlFor={idCampo}>
            Preço de venda
            {p.precoVenda ? (
              <>
                {" "}
                · hoje <span className="font-mono text-ink-2">{fmtMoney(p.precoVenda)}</span>
              </>
            ) : (
              " · sem preço cadastrado"
            )}
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[12px] text-faint">
                R$
              </span>
              <input
                id={idCampo}
                inputMode="decimal"
                value={texto}
                disabled={!podeAlterar}
                onChange={(e) => onTexto(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder={p.precoVenda ? paraTexto(p.precoVenda) : "0,00"}
                className="h-9 w-28 rounded-[var(--radius)] border border-line-button bg-surface pr-2 pl-8 font-mono text-[13px] text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-60"
              />
            </div>
            {podeAlterar && sugerido != null && digitado !== sugerido && (
              <button
                type="button"
                onClick={() => onTexto(paraTexto(sugerido))}
                className="rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent transition-colors hover:border-accent"
              >
                Manter {margemAntes != null ? pct(margemAntes) : "a margem"}:{" "}
                <span className="font-mono">{fmtMoney(sugerido)}</span>
              </button>
            )}
          </div>
          <p className={cn("mt-1", noPrejuizo && "font-medium text-danger")}>
            {noPrejuizo
              ? "Vende abaixo do custo desta compra."
              : margemDepois != null
                ? `Margem com este custo: ${pct(margemDepois)}${
                    margemAntes != null && digitado == null ? ` (era ${pct(margemAntes)})` : ""
                  }`
                : "Informe o preço para ver a margem."}
          </p>
        </div>
      ) : (
        <p className="text-[12px] text-muted">Insumo de uso interno — não tem preço de venda.</p>
      )}
    </li>
  );
}
