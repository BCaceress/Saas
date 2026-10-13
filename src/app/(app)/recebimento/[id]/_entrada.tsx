"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Copy,
  FilePlus2,
  Link2,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import { SugestoesPendentes } from "@/components/fornecedor/sincronizacao";
import { pendenciaDoItem, TabelaDePara } from "@/components/recebimento/tabela-de-para";
import { fmtMoney, fmtQtd, fmtQuando } from "../../cotacoes/_catalogo/ui";
import {
  criarPedidoDaNotaAction,
  receberSemPedidoAction,
  vincularPedidoAction,
} from "../conferencia-actions";
import type { RecebimentoView, SubcategoriaCadastro } from "../_data";
import { PainelNota } from "./_painel-nota";
import {
  Cabecalho,
  ETAPAS_COM_NOTA,
  MedidorRodape,
  RodapeAcao,
  Trilho,
  type EtapaId,
} from "./_partes";

// ============================================================
// A entrada da nota: do XML recém-importado até a porta da conferência.
//
// Três perguntas, uma por tela, na ordem em que cada resposta encurta a
// seguinte:
//
//   1. Nota     — validação rápida, não painel: três linhas (fornecedor,
//                 pedido, produtos), o dinheiro numa linha que se abre e um
//                 único próximo passo. Quem lê e concorda só segue.
//   2. Pedido   — esta nota fatura um pedido seu? Vem ANTES dos produtos de
//                 propósito: sabendo o pedido, o de-para procura entre os vinte
//                 itens dele em vez de no catálogo inteiro.
//   3. Produtos — a tabela da nota, com o que falta no topo.
//
// Nada aqui mexe em estoque. A resposta do pedido fica na URL até o fim da
// etapa 3 — é só ali que a conferência é montada, e o operador pode voltar e
// trocar de ideia sem desfazer nada no banco.
// ============================================================

type Etapa = "nota" | "pedido" | "produtos";
/** Id de um pedido, ou as duas formas de não ter pedido. */
type Origem = string | "novo" | "sem";

export function EntradaDaNota({
  dados,
  nota,
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  podeEditarFornecedor,
  subcategorias,
}: {
  dados: RecebimentoView;
  nota: NonNullable<RecebimentoView["nota"]>;
  /** Falso = a pessoa trata a NOTA, não a mercadoria: não responde do pedido. */
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  podeEditarFornecedor: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { sugestoes, itensNota, fornecedor } = dados;
  const [salvando, setSalvando] = React.useState(false);

  // ── Onde a pessoa está ──
  const etapaUrl = params.get("etapa");
  const etapa: Etapa =
    etapaUrl === "produtos" || (etapaUrl === "pedido" && podeReceber) ? etapaUrl : "nota";

  const origemUrl = params.get("origem");
  const origemValida =
    origemUrl === "novo" ||
    origemUrl === "sem" ||
    sugestoes.some((s) => s.purchaseOrderId === origemUrl);
  // Havendo pedido em aberto do fornecedor, o mais parecido já vem marcado:
  // quem concorda só segue, quem discorda troca.
  const origem: Origem | null = origemValida
    ? (origemUrl as Origem)
    : (sugestoes[0]?.purchaseOrderId ?? null);
  const pedidoEscolhido = sugestoes.find((s) => s.purchaseOrderId === origem) ?? null;

  /**
   * Troca de etapa sem ir ao servidor: os dados são os mesmos nas três, e uma
   * ida ao banco a cada "Continuar" faria a tela piscar. A URL muda para o
   * voltar do navegador e o F5 caírem na etapa certa.
   */
  function ir(proxima: Etapa, novaOrigem?: Origem) {
    const p = new URLSearchParams(params.toString());
    p.set("etapa", proxima);
    const o = novaOrigem ?? origem;
    if (o) p.set("origem", o);
    window.history.pushState(null, "", `?${p.toString()}`);
    window.scrollTo({ top: 0 });
  }
  function escolher(o: Origem) {
    const p = new URLSearchParams(params.toString());
    p.set("etapa", "pedido");
    p.set("origem", o);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }

  // ── Produtos ──
  const pendentes = itensNota.filter((i) => pendenciaDoItem(i) !== "PRONTO");
  const semProduto = itensNota.filter((i) => !i.productId);
  const totalItens = itensNota.reduce((s, i) => s + i.valorTotal, 0);
  const unidades = itensNota.reduce(
    (s, i) => s + (i.productId ? i.quantidade * i.fatorConversao : 0),
    0,
  );

  // ── Abrir a conferência ──
  async function abrirConferencia() {
    if (!origem) return;
    setSalvando(true);
    try {
      if (origem === "novo") {
        await criarPedidoDaNotaAction(nota.id);
        toast.success("Pedido criado a partir da nota.", "Já nasce conciliado — falta conferir.");
      } else if (origem === "sem") {
        await receberSemPedidoAction(nota.id);
        toast.success("Conferência aberta sem pedido.", "A nota é a referência do que deveria vir.");
      } else {
        await vincularPedidoAction({ inboundId: nota.id, purchaseOrderId: origem });
        toast.success("Nota vinculada ao pedido.", "Confira a mercadoria para receber no estoque.");
      }
      router.replace(`/recebimento/${dados.recebimento.id}`);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para abrir a conferência", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(false);
    }
  }

  const sugestoesFornecedor = podeEditarFornecedor ? (fornecedor?.sugestoes.length ?? 0) : 0;
  const cabecalho = (
    <>
      <Cabecalho recebimento={dados.recebimento} nota={nota} pedidoNumero={null} />
      <Trilho
        etapas={ETAPAS_COM_NOTA}
        atual={etapa}
        avisos={{ nota: sugestoesFornecedor, produtos: etapa === "produtos" ? 0 : pendentes.length }}
        onIr={(e: EtapaId) => {
          if (e === "nota" || e === "pedido" || e === "produtos") ir(e);
        }}
      />
    </>
  );

  // ════════════════════════════════════════════════════════════
  // 1 · Nota
  // ════════════════════════════════════════════════════════════
  if (etapa === "nota") {
    // Sem pedido em aberto não há o que perguntar na etapa 2: a resposta já é
    // "sem pedido", dada aqui mesmo. Quem quiser registrar a nota também como
    // pedido chega lá pelo "Alterar".
    const pulaPedido = podeReceber && sugestoes.length === 0;
    const proxima: Etapa = podeReceber && !pulaPedido ? "pedido" : "produtos";
    const continuar = () => ir(proxima, pulaPedido && !origem ? "sem" : undefined);

    const reconhecidos = itensNota.length - pendentes.length;
    const comPalpite = semProduto.filter((i) =>
      dados.sugestoesDePara.some((s) => s.itemId === i.id),
    ).length;
    const soConversao = pendentes.length - semProduto.length;
    const nomeFornecedor = fornecedor?.nome ?? nota.fornecedor;

    const corpo = (partes?: { alertas: React.ReactNode; acoes: React.ReactNode }) => (
      <>
        {partes?.alertas}

        {/* Uma lista só: o que a nota diz e se o NoHub concorda. Antes eram
            cinco blocos (leitura, soma, fornecedor, histórico, documento) para
            uma decisão — "a leitura está certa?". */}
        <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <Leitura
            ok={sugestoesFornecedor === 0}
            titulo={
              !fornecedor
                ? "Fornecedor sem cadastro"
                : fornecedor.criado
                  ? "Fornecedor cadastrado agora"
                  : "Fornecedor identificado"
            }
            detalhe={
              <>
                <span className="text-ink-2">{nomeFornecedor}</span>
                {" · "}
                {!fornecedor
                  ? `CNPJ ${maskCnpj(nota.cnpj)} sem cadastro vinculado`
                  : fornecedor.criado
                    ? "com os dados da nota"
                    : sugestoesFornecedor > 0
                      ? `${sugestoesFornecedor} ${sugestoesFornecedor === 1 ? "contato novo espera" : "contatos novos esperam"} sua decisão`
                      : fornecedor.automaticas.length > 0
                        ? `${fornecedor.automaticas.length} ${fornecedor.automaticas.length === 1 ? "dado atualizado" : "dados atualizados"} pelo XML`
                        : "CNPJ reconhecido"}
              </>
            }
            acao={
              fornecedor && (
                <Link href={`/fornecedores/${fornecedor.supplierId}`} className={ACAO_LINHA}>
                  Abrir cadastro
                </Link>
              )
            }
          >
            {/* Só a pergunta. O histórico de compras mora na ficha do
                fornecedor — aqui ele não muda o que a pessoa faz a seguir. */}
            {fornecedor && sugestoesFornecedor > 0 && (
              <SugestoesPendentes
                sugestoes={fornecedor.sugestoes}
                onResolvido={() => router.refresh()}
              />
            )}
          </Leitura>

          <Leitura
            ok
            titulo={
              pedidoEscolhido ? (
                <>
                  Pedido <span className="font-mono">{pedidoEscolhido.numero}</span>
                </>
              ) : (
                "Compra sem pedido"
              )
            }
            detalhe={
              pedidoEscolhido
                ? (pedidoEscolhido.motivos[0] ??
                    `Em aberto deste fornecedor, de ${fmtQuando(String(pedidoEscolhido.criadoEm))}.`) +
                  (sugestoes.length > 1 ? ` Há mais ${sugestoes.length - 1} em aberto.` : "")
                : origem === "novo"
                  ? "Um pedido de compra será criado com os itens da nota."
                  : "A entrada pode continuar sem vincular um pedido de compra."
            }
            acao={
              podeReceber && (
                <button type="button" onClick={() => ir("pedido")} className={ACAO_LINHA}>
                  Alterar
                </button>
              )
            }
          />

          <Leitura
            ok={pendentes.length === 0}
            titulo={
              pendentes.length === 0
                ? `${itensNota.length} ${itensNota.length === 1 ? "produto reconhecido" : "produtos reconhecidos"}`
                : semProduto.length > 0
                  ? `${semProduto.length} ${semProduto.length === 1 ? "produto precisa ser relacionado" : "produtos precisam ser relacionados"}`
                  : `${soConversao} ${soConversao === 1 ? "conversão a confirmar" : "conversões a confirmar"}`
            }
            detalhe={
              pendentes.length === 0
                ? "Todos os itens já têm produto e conversão."
                : [
                    `${reconhecidos} de ${itensNota.length} itens já foram reconhecidos`,
                    comPalpite > 0 ? `${comPalpite} com palpite pronto` : null,
                    semProduto.length > 0 && soConversao > 0
                      ? `${soConversao} com conversão a confirmar`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") + "."
            }
            acao={pendentes.length > 0 && <Badge tone="accent">Pendente</Badge>}
          />

          <DetalhesFiscais nota={nota} totalItens={totalItens} acoes={partes?.acoes} />
        </div>

        <RodapeAcao>
          {/* Uma mensagem só, e ela diz o que fazer — a contagem já está na
              linha de produtos, repeti-la aqui era o mesmo aviso duas vezes. */}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">
              {proxima === "pedido"
                ? "Próximo passo: confirmar o pedido"
                : pendentes.length > 0
                  ? "Próximo passo: relacionar produtos"
                  : "Leitura sem pendências"}
            </p>
            <p className="text-[12px] text-muted">
              {pendentes.length > 0 ? (
                proxima === "pedido" ? (
                  `Depois, relacione ${pendentes.length === 1 ? "o item restante" : `os ${pendentes.length} itens restantes`}.`
                ) : (
                  `Relacione ${pendentes.length === 1 ? "o item restante" : `os ${pendentes.length} itens restantes`} antes de concluir o recebimento.`
                )
              ) : (
                <>
                  Entram <span className="font-mono text-ink-2">+{fmtQtd(unidades)} UN</span> quando
                  a conferência fechar.
                </>
              )}
            </p>
          </div>
          <Button onClick={continuar} className="w-full sm:w-auto">
            {proxima === "pedido" ? "Continuar para o pedido" : "Continuar para produtos"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </RodapeAcao>
      </>
    );

    return (
      <div className="flex min-h-full flex-col gap-5">
        <Cabecalho
          recebimento={dados.recebimento}
          nota={nota}
          pedidoNumero={null}
          titulo="Conferir nota fiscal"
          semParcelas
        />
        {/* A pendência de produtos tem um lugar só nesta tela: a linha dela. */}
        <Trilho etapas={ETAPAS_COM_NOTA} atual="nota" avisos={{ nota: sugestoesFornecedor }} />

        {podeTratarNota ? (
          <PainelNota nota={nota} faltamRelacionar={semProduto.length} emConferencia={false}>
            {corpo}
          </PainelNota>
        ) : (
          corpo()
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // 2 · Pedido
  // ════════════════════════════════════════════════════════════
  if (etapa === "pedido") {
    const semPedido = origem === "sem" || origem === "novo";

    return (
      <div className="flex min-h-full flex-col gap-5">
        {cabecalho}

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] font-semibold text-ink">
            Esta nota fatura um pedido seu?
          </h2>

          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Pedido desta nota">
            {sugestoes.map((s, i) => (
              <Resposta
                key={s.purchaseOrderId}
                selecionada={origem === s.purchaseOrderId}
                onSelecionar={() => escolher(s.purchaseOrderId)}
                titulo={
                  <>
                    Sim, o pedido <span className="font-mono">{s.numero}</span>
                  </>
                }
                ajuda={`${s.itens} ${s.itens === 1 ? "item" : "itens"} · ${fmtMoney(s.valorTotal)} · ${fmtQuando(String(s.criadoEm))}`}
                destaque={s.motivos.join(" · ") || (i === 0 ? "O mais parecido com esta nota" : undefined)}
              />
            ))}

            <Resposta
              selecionada={semPedido}
              onSelecionar={() => escolher("sem")}
              titulo="Não, chegou sem pedido"
              ajuda={
                sugestoes.length === 0
                  ? "Não há pedido em aberto deste fornecedor nesta loja. A nota é a referência do que deveria vir."
                  : "A nota é a referência do que deveria vir."
              }
            >
              {/* Segunda decisão, só para quem respondeu "não": antes era uma
                  terceira porta de peso igual, e o operador lia as três para
                  descobrir que duas eram a mesma coisa com um registro a mais. */}
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-2">
                <input
                  type="checkbox"
                  checked={origem === "novo"}
                  onChange={(e) => escolher(e.target.checked ? "novo" : "sem")}
                  className="mt-0.5 h-4 w-4 rounded border-line-button accent-[var(--color-brand)]"
                />
                <span>
                  Registrar também como pedido de compra
                  <span className="block text-[12px] text-muted">
                    O NoHub cria o pedido com os {itensNota.length} itens da nota (
                    {fmtMoney(totalItens)}). Útil para o histórico de pedidos; não muda o que
                    entra no estoque. Exige todos os itens com produto.
                  </span>
                </span>
              </label>
            </Resposta>
          </div>
        </section>

        <RodapeAcao>
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {pedidoEscolhido
              ? `Os produtos do pedido ${pedidoEscolhido.numero} entram como palpite na próxima etapa.`
              : origem
                ? "Você pode voltar e trocar esta resposta até abrir a conferência."
                : "Escolha uma resposta para continuar."}
          </p>
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Button variant="secondary" onClick={() => ir("nota")} className="flex-1 sm:flex-none">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </Button>
            <Button onClick={() => ir("produtos")} disabled={!origem} className="flex-1 sm:flex-none">
              Continuar
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </RodapeAcao>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // 3 · Produtos
  // ════════════════════════════════════════════════════════════
  const impedimento = !origem
    ? "Responda se esta nota tem pedido."
    : origem === "novo" && semProduto.length > 0
      ? `${semProduto.length} ${semProduto.length === 1 ? "item precisa" : "itens precisam"} de produto para o pedido ser criado.`
      : null;

  const cta =
    origem === "novo"
      ? { rotulo: "Criar pedido e conferir", Icone: FilePlus2 }
      : origem === "sem" || !origem
        ? { rotulo: "Ir para a conferência", Icone: ClipboardCheck }
        : { rotulo: "Vincular e conferir", Icone: Link2 };

  return (
    <div className="flex min-h-full flex-col gap-5">
      {cabecalho}

      <section>
        <TabelaDePara
          inboundId={nota.id}
          itens={itensNota}
          sugestoesIniciais={dados.sugestoesDePara}
          editavel
          podeCriarProduto={podeCriarProduto}
          supplierId={nota.supplierId}
          siteId={nota.siteId}
          subcategorias={subcategorias}
          purchaseOrderId={pedidoEscolhido?.purchaseOrderId ?? null}
          pedidoDasSugestoes={dados.pedidoDasSugestoes}
          sempreAberta
        />
      </section>

      {!podeReceber && (
        <p className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Você trata a nota: relacionar os itens aos produtos é a sua etapa. Quem recebe a
          mercadoria diz de qual pedido ela é e confere o que chegou.
        </p>
      )}

      <RodapeAcao>
        <div className="min-w-0 flex-1">
          <MedidorRodape
            total={itensNota.length}
            feitos={itensNota.length - pendentes.length}
            atencao={0}
            rotulo="item pronto"
            rotuloPlural="itens prontos"
          />
          <p className="mt-1.5 text-[12px] text-muted">
            {pendentes.length === 0 ? (
              <>
                Entram <span className="font-mono text-ink-2">+{fmtQtd(unidades)} UN</span> no
                estoque quando a conferência fechar.
              </>
            ) : origem === "novo" ? (
              "O pedido é feito de produtos: resolva a fila para criá-lo."
            ) : (
              // Não bloqueia: com o caminhão na porta, contar primeiro e
              // relacionar depois é a ordem certa.
              "Dá para conferir já e relacionar depois. A entrada só fecha com todos os itens resolvidos."
            )}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col items-stretch gap-1 sm:w-auto sm:items-end">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => ir(podeReceber ? "pedido" : "nota")}
              disabled={salvando}
              className="flex-1 sm:flex-none"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </Button>
            {podeReceber && (
              <Button
                onClick={() => void abrirConferencia()}
                disabled={salvando || impedimento !== null}
                className="flex-1 sm:flex-none"
              >
                {salvando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <cta.Icone className="h-4 w-4" aria-hidden />
                )}
                {salvando ? "Abrindo conferência…" : cta.rotulo}
              </Button>
            )}
          </div>
          {podeReceber && impedimento && (
            <p className="text-[11px] text-muted sm:text-right">{impedimento}</p>
          )}
        </div>
      </RodapeAcao>
    </div>
  );
}

const ACAO_LINHA =
  "cursor-pointer rounded-full border border-line-button bg-surface px-3 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

/**
 * Uma linha da leitura: o que o NoHub entendeu de um assunto da nota. O ícone
 * diz se há algo esperando a pessoa; o título diz o quê; a ação, quando existe,
 * fica na ponta. `children` é a decisão que a linha pede, aberta logo abaixo.
 */
function Leitura({
  ok,
  titulo,
  detalhe,
  acao,
  children,
}: {
  ok: boolean;
  titulo: React.ReactNode;
  detalhe: React.ReactNode;
  acao?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
            ok ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent",
          )}
        >
          {ok ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <TriangleAlert className="h-3 w-3" aria-hidden />
          )}
          <span className="sr-only">{ok ? "Em ordem" : "Pede atenção"}</span>
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[14px] font-semibold text-ink">{titulo}</p>
          <p className="text-[13px] text-muted">{detalhe}</p>
        </div>
        {acao && <div className="shrink-0 pl-8 sm:pl-0">{acao}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * O dinheiro e o documento, numa linha que se abre.
 *
 * À vista fica só o que confere a nota com ela mesma: itens, o que entrou fora
 * da mercadoria e quando vence. Chave de acesso, parcelas e as decisões do
 * documento (descartar, dar entrada sem conferir) são coisas que se usa uma vez
 * por nota — ficam um clique abaixo, não num card próprio.
 */
function DetalhesFiscais({
  nota,
  totalItens,
  acoes,
}: {
  nota: NonNullable<RecebimentoView["nota"]>;
  totalItens: number;
  /** Decisões do documento — só para quem trata a nota. */
  acoes?: React.ReactNode;
}) {
  const dif = nota.valorTotal - totalItens;
  // A soma dos itens raramente fecha com o total — frete, ST e IPI entram fora
  // da mercadoria. Acima de 15% o parse provavelmente perdeu linha, e esse
  // aviso não pode ficar dobrado dentro dos detalhes.
  const suspeito = nota.valorTotal > 0 && Math.abs(dif) / nota.valorTotal >= 0.15;
  const parcelas = nota.duplicatas;
  const dia = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px] text-muted focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset sm:px-5 [&::-webkit-details-marker]:hidden">
        <span>
          Itens: <span className="font-mono text-ink-2">{fmtMoney(totalItens)}</span>
        </span>
        <span className={cn(suspeito && "font-medium text-warn")}>
          {dif >= 0 ? "Acréscimos e tributos" : "Descontos"}:{" "}
          <span className="font-mono">{fmtMoney(Math.abs(dif))}</span>
        </span>
        <span>
          {parcelas.length === 0
            ? "Sem parcelas na nota"
            : parcelas.length === 1
              ? `Vencimento: ${dia(parcelas[0].vencimento)}`
              : `${parcelas.length} parcelas · a primeira em ${dia(parcelas[0].vencimento)}`}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-brand">
          Detalhes fiscais
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </span>
      </summary>

      {suspeito && (
        <p className="flex items-start gap-2 border-t border-warn/30 bg-warn-soft px-4 py-2.5 text-[12px] font-medium text-warn sm:px-5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Diferença grande para ser só frete e imposto — confira se falta item na leitura.
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-line/70 bg-surface-2/40 px-4 py-3.5 text-[12px] text-muted sm:px-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>CNPJ</span>
          <span className="font-mono text-ink-2">{maskCnpj(nota.cnpj)}</span>
          {nota.uf && <span>· {nota.uf}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Chave de acesso</span>
          <span className="font-mono break-all text-ink-2">{nota.chave}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(nota.chave);
              toast.success("Chave copiada.");
            }}
            className="cursor-pointer text-muted transition-colors hover:text-brand"
            aria-label="Copiar chave de acesso"
            title="Copiar chave de acesso"
          >
            <Copy size={12} />
          </button>
        </p>

        {parcelas.length > 0 ? (
          <div>
            <p>
              {parcelas.length === 1 ? "Parcela" : "Parcelas"} — viram contas a pagar quando a
              entrada for confirmada:
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-ink-2">
              {parcelas.map((d, i) => (
                <li key={i}>
                  {dia(d.vencimento)} · {fmtMoney(d.valor)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>
            Nasce um título só, com vencimento pelo prazo do fornecedor, quando a entrada for
            confirmada.
          </p>
        )}

        {!suspeito && Math.abs(dif) > 0.005 && (
          <p className="text-faint">
            A diferença entre itens e total é compatível com frete, ST e IPI.
          </p>
        )}

        {(nota.temXml || acoes) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
            {nota.temXml && (
              <a href={`/api/fiscal/entrada/${nota.id}/xml`} className={ACAO_LINHA}>
                Baixar XML
              </a>
            )}
            {acoes}
          </div>
        )}
      </div>
    </details>
  );
}

/** Uma resposta da pergunta do pedido. Aberta, mostra o que só ela precisa. */
function Resposta({
  selecionada,
  onSelecionar,
  titulo,
  ajuda,
  destaque,
  children,
}: {
  selecionada: boolean;
  onSelecionar: () => void;
  titulo: React.ReactNode;
  ajuda: string;
  destaque?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border transition-colors",
        selecionada ? "border-brand bg-brand-soft/25" : "border-line bg-surface",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selecionada}
        onClick={onSelecionar}
        className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <span
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
            selecionada ? "border-brand bg-brand" : "border-line-button",
          )}
          aria-hidden
        >
          {selecionada && <Check className="h-2.5 w-2.5 text-on-brand" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">{titulo}</span>
          <span className="block text-[12px] text-muted">{ajuda}</span>
          {destaque && <span className="mt-0.5 block text-[12px] text-brand">{destaque}</span>}
        </span>
      </button>
      {selecionada && children && (
        <div className="border-t border-line/70 px-4 py-3">{children}</div>
      )}
    </div>
  );
}
