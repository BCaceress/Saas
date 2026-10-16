"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Calculator,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  NotebookPen,
  Receipt,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import { cfopDeEntrada } from "@/lib/fiscal/cfop";
import { SugestoesPendentes } from "@/components/fornecedor/sincronizacao";
import {
  contarSituacoes,
  pendenciaDoItem,
  TabelaDePara,
} from "@/components/recebimento/tabela-de-para";
import { fmtMoney, fmtQtd, fmtQuando } from "../../cotacoes/_catalogo/ui";
import {
  criarPedidoDaNotaAction,
  desvincularPedidoAction,
  receberSemPedidoAction,
  salvarObservacaoAction,
  vincularPedidoAction,
} from "../conferencia-actions";
import type { ItemNotaView, RecebimentoView, SubcategoriaCadastro } from "../_data";
import { RodapeAcao, Topo } from "./_partes";
import { abrirXmlEmNovaAba, buscarXmlDaNota, salvarComoArquivo } from "./_xml";

// ============================================================
// Etapa 1 — Nota e produtos.
//
// Tudo o que o XML diz, numa tela, em duas colunas:
//
//   À esquerda, o trabalho. Em cima, de quem é a nota e qual pedido ela
//   fatura — a única decisão que não é sobre produto. Embaixo, as abas: a
//   relação dos produtos (onde se passa quase todo o tempo) e, um clique ao
//   lado, o que se consulta de vez em quando — composição do valor, dados
//   fiscais e a história do recebimento.
//
//   À direita, o que se lê sem clicar: quanto a nota cobra, quanto do de-para
//   já andou, o documento em si e a anotação livre de quem recebe.
//
// Saber o pedido encurta o de-para (os itens dele entram como palpite), por
// isso ele mora logo acima da tabela.
//
// Nada aqui mexe em estoque. Enquanto a conferência não é aberta, a resposta
// do pedido fica na URL e pode ser trocada sem desfazer nada no banco. Depois
// de aberta, a etapa continua visitável: o de-para segue editável e trocar o
// pedido passa a pedir confirmação, porque desfaz a contagem.
// ============================================================

/** Id de um pedido, ou as duas formas de não ter pedido. */
type Origem = string | "novo" | "sem";

type Aba = "produtos" | "resumo" | "fiscal" | "historico";

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "produtos", rotulo: "Produtos" },
  { id: "resumo", rotulo: "Resumo da nota" },
  { id: "fiscal", rotulo: "Informações fiscais" },
  { id: "historico", rotulo: "Histórico" },
];

type NotaView = NonNullable<RecebimentoView["nota"]>;

const dia = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

/** Botão de cartão: a mesma cápsula do `Button` secundário, para links também. */
const BOTAO_CARTAO =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-button bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function EtapaNota({
  dados,
  nota,
  podeReceber,
  podeTratarNota,
  podeCriarProduto,
  podeEditarFornecedor,
  podeBaixarXml,
  mostrarSku,
  subcategorias,
}: {
  dados: RecebimentoView;
  nota: NotaView;
  /** Falso = a pessoa trata a NOTA, não a mercadoria: não responde do pedido. */
  podeReceber: boolean;
  podeTratarNota: boolean;
  podeCriarProduto: boolean;
  podeEditarFornecedor: boolean;
  /** Abre e baixa o XML guardado (`fiscal.baixar`). */
  podeBaixarXml: boolean;
  /** SKU ligado nas configurações de produto. */
  mostrarSku: boolean;
  subcategorias: SubcategoriaCadastro[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { recebimento, sugestoes, itensNota, fornecedor, pedido } = dados;
  const [salvando, setSalvando] = React.useState(false);
  const [aba, setAba] = React.useState<Aba>("produtos");
  const [escolhendoPedido, setEscolhendoPedido] = React.useState(false);
  /** Qual botão do XML está esperando o servidor. */
  const [buscandoXml, setBuscandoXml] = React.useState<"ver" | "baixar" | null>(null);

  async function abrirXml(modo: "ver" | "baixar") {
    setBuscandoXml(modo);
    try {
      if (modo === "ver") await abrirXmlEmNovaAba(nota.id, nota.chave);
      else salvarComoArquivo(await buscarXmlDaNota(nota.id, nota.chave));
    } catch (e) {
      toast.error(
        modo === "ver" ? "Não deu para abrir o XML" : "Não deu para baixar o XML",
        e instanceof Error ? e.message : "Tente de novo.",
      );
    } finally {
      setBuscandoXml(null);
    }
  }

  // ── Em que pé está o recebimento ──
  const encerrado = recebimento.status === "FINALIZADO" || recebimento.status === "CANCELADO";
  /** A conferência ainda não foi aberta: o pedido é uma resposta em aberto. */
  const decidindo = dados.escolherPorta && !encerrado;
  /** Nota descartada, de serviço ou já lançada não aceita de-para nem conferência. */
  const notaAberta = nota.status === "PENDENTE" || nota.status === "CONCILIADO";

  // ── O pedido ──
  const origemUrl = params.get("origem");
  const origemValida =
    origemUrl === "novo" ||
    origemUrl === "sem" ||
    sugestoes.some((s) => s.purchaseOrderId === origemUrl);
  // Havendo pedido em aberto do fornecedor, o mais parecido já vem marcado:
  // quem concorda só segue, quem discorda troca.
  const origem: Origem =
    origemValida && origemUrl ? origemUrl : (sugestoes[0]?.purchaseOrderId ?? "sem");
  const pedidoEscolhido = sugestoes.find((s) => s.purchaseOrderId === origem) ?? null;

  /**
   * A resposta fica na URL, sem ir ao servidor: a tabela refaz os palpites
   * sozinha quando o pedido muda, e o F5 cai na mesma resposta.
   */
  function escolher(o: Origem) {
    const p = new URLSearchParams(params.toString());
    p.set("origem", o);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }

  // ── Produtos ──
  const situacoes = contarSituacoes(itensNota);
  const pendentes = itensNota.filter((i) => pendenciaDoItem(i) !== "PRONTO");
  const semProduto = itensNota.filter((i) => !i.productId);
  const unidades = itensNota.reduce(
    (s, i) => s + (i.productId ? i.quantidade * i.fatorConversao : 0),
    0,
  );

  // ── Valores ──
  const valores = valoresDaNota(nota, itensNota);
  const parcelas = nota.duplicatas;

  // ── Abrir a conferência ──
  async function abrirConferencia() {
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
      router.replace(`/recebimento/${recebimento.id}`);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para abrir a conferência", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(false);
    }
  }

  /** Com a conferência aberta, trocar o pedido é desfazê-la e voltar a escolher. */
  async function trocarPedido() {
    setSalvando(true);
    try {
      await desvincularPedidoAction({ receiptId: recebimento.id, inboundId: nota.id });
      toast.info("Conferência desfeita.", "Escolha de novo o pedido desta nota.");
      // O painel continua aberto: com a conferência desfeita ele passa a
      // mostrar a escolha, que é o que a pessoa veio fazer.
      router.refresh();
    } catch (e) {
      toast.error("Não deu para trocar o pedido", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  const impedimento =
    origem === "novo" && semProduto.length > 0
      ? `${semProduto.length} ${semProduto.length === 1 ? "item precisa" : "itens precisam"} de produto para o pedido ser criado.`
      : null;

  const cta =
    origem === "novo"
      ? { rotulo: "Criar pedido e conferir", Icone: FilePlus2 }
      : origem === "sem"
        ? { rotulo: "Ir para a conferência", Icone: ClipboardCheck }
        : { rotulo: "Vincular e conferir", Icone: Link2 };

  const sugestoesFornecedor =
    podeEditarFornecedor && !encerrado ? (fornecedor?.sugestoes ?? []) : [];
  // Só quem recebe responde do pedido, e só a nota que nasceu do XML pode
  // voltar a escolher — o recebimento aberto pelo pedido É daquele pedido.
  const podeTrocarPedido =
    podeReceber && notaAberta && !encerrado && (decidindo || recebimento.origem === "XML");

  // ── O que o cartão do pedido diz ──
  const temPedido = decidindo ? Boolean(pedidoEscolhido) : Boolean(pedido);
  const pedidoTitulo = !decidindo ? (
    pedido ? (
      <>
        Pedido <span className="font-mono">{pedido.numero}</span>
      </>
    ) : (
      "Sem pedido vinculado"
    )
  ) : pedidoEscolhido ? (
    <>
      Pedido <span className="font-mono">{pedidoEscolhido.numero}</span>
    </>
  ) : origem === "novo" ? (
    "Criar pedido pela nota"
  ) : (
    "Sem pedido vinculado"
  );
  const pedidoDetalhe = !decidindo
    ? pedido
      ? nota.vinculoAutomatico
        ? "Encontrado automaticamente pela nota."
        : "Vinculado a esta nota."
      : "A nota é a referência do que deveria vir."
    : pedidoEscolhido
      ? `${pedidoEscolhido.itens} ${pedidoEscolhido.itens === 1 ? "item" : "itens"} · ${fmtMoney(pedidoEscolhido.valorTotal)}` +
        (sugestoes.length > 1
          ? ` · mais ${sugestoes.length - 1} em aberto`
          : " · o único em aberto deste fornecedor")
      : origem === "novo"
        ? `Nasce com ${itensNota.length === 1 ? "o item" : `os ${itensNota.length} itens`} da nota ao abrir a conferência.`
        : sugestoes.length === 0
          ? "Nenhum pedido em aberto deste fornecedor nesta loja."
          : `Há ${sugestoes.length} ${sugestoes.length === 1 ? "pedido em aberto" : "pedidos em aberto"} deste fornecedor.`;

  return (
    // `@container`: as duas colunas dependem da largura da ÁREA de conteúdo, não
    // da janela — o menu lateral aberto ou recolhido muda uma sem mudar a outra,
    // e a tabela é quem mais sofre quando sobra pouco.
    <div className="@container flex min-h-full flex-col gap-5">
      <Topo
        dados={dados}
        etapa="nota"
        podeTratarNota={podeTratarNota}
        podeBaixarXml={podeBaixarXml}
      />

      <div className="grid items-start gap-5 @[72rem]:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ══ O trabalho ══ */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <CartaoTopo
              icone={<Truck size={20} aria-hidden />}
              // Fornecedor com logo no cadastro aparece com ela; sem logo (ou
              // sem cadastro), o caminhão de sempre.
              imagemUrl={fornecedor?.logoUrl}
              tom="bg-brand-soft text-brand"
              rotulo="Fornecedor"
              titulo={fornecedor?.nome ?? recebimento.supplierNome ?? nota.fornecedor}
              detalhe={
                <>
                  CNPJ <span className="font-mono">{maskCnpj(nota.cnpj)}</span>
                  {nota.uf && ` · ${nota.uf}`}
                  {/* Só quando a nota mudou alguma coisa no cadastro — "CNPJ
                      reconhecido" em toda nota era ruído. */}
                  {!fornecedor
                    ? " · sem cadastro vinculado"
                    : fornecedor.criado
                      ? " · cadastrado agora pela nota"
                      : fornecedor.automaticas.length > 0
                        ? ` · ${fornecedor.automaticas.length} ${fornecedor.automaticas.length === 1 ? "dado atualizado" : "dados atualizados"} pelo XML`
                        : ""}
                </>
              }
              acao={
                fornecedor && (
                  <Link href={`/fornecedores/${fornecedor.supplierId}`} className={BOTAO_CARTAO}>
                    <ExternalLink size={14} aria-hidden />
                    Ver cadastro
                  </Link>
                )
              }
            />

            <CartaoTopo
              icone={<FileText size={20} aria-hidden />}
              tom="bg-info-soft text-info"
              rotulo="Pedido de compra"
              titulo={pedidoTitulo}
              detalhe={pedidoDetalhe}
              acao={
                podeTrocarPedido && (
                  <button
                    type="button"
                    onClick={() => setEscolhendoPedido(true)}
                    className={BOTAO_CARTAO}
                  >
                    <Link2 size={14} aria-hidden />
                    {temPedido ? "Trocar pedido" : "Vincular pedido"}
                  </button>
                )
              }
            />
          </div>

          {/* A única coisa que a nota pergunta sobre o fornecedor. O bloco se
              anuncia sozinho — o cartão acima não precisa contar que ele existe. */}
          {sugestoesFornecedor.length > 0 && (
            <SugestoesPendentes
              sugestoes={sugestoesFornecedor}
              onResolvido={() => router.refresh()}
            />
          )}

          <div>
            <div
              role="tablist"
              aria-label="Seções da nota"
              className="flex flex-wrap gap-x-1 border-b border-line"
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const i = ABAS.findIndex((a) => a.id === aba);
                const proxima =
                  ABAS[(i + (e.key === "ArrowRight" ? 1 : ABAS.length - 1)) % ABAS.length];
                setAba(proxima.id);
                document.getElementById(`aba-${proxima.id}`)?.focus();
              }}
            >
              {ABAS.map((a) => {
                const ativa = a.id === aba;
                return (
                  <button
                    key={a.id}
                    id={`aba-${a.id}`}
                    type="button"
                    role="tab"
                    aria-selected={ativa}
                    aria-controls={`painel-${a.id}`}
                    tabIndex={ativa ? 0 : -1}
                    onClick={() => setAba(a.id)}
                    className={cn(
                      "-mb-px flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset",
                      ativa
                        ? "border-brand font-semibold text-ink"
                        : "border-transparent text-muted hover:text-ink",
                    )}
                  >
                    {a.rotulo}
                    {a.id === "produtos" && (
                      <span className="rounded-full bg-brand-softer px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold text-accent">
                        {itensNota.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* A tabela fica montada nas outras abas: filtro, busca e linhas
                marcadas não podem zerar porque alguém foi olhar a chave da nota. */}
            <div
              id="painel-produtos"
              role="tabpanel"
              aria-labelledby="aba-produtos"
              hidden={aba !== "produtos"}
              className="pt-4"
            >
              <TabelaDePara
                inboundId={nota.id}
                itens={itensNota}
                sugestoesIniciais={dados.sugestoesDePara}
                editavel={notaAberta && !encerrado}
                podeCriarProduto={podeCriarProduto}
                supplierId={nota.supplierId}
                siteId={nota.siteId}
                subcategorias={subcategorias}
                purchaseOrderId={
                  decidindo ? (pedidoEscolhido?.purchaseOrderId ?? null) : (pedido?.id ?? null)
                }
                pedidoDasSugestoes={dados.pedidoDasSugestoes}
                mostrarSku={mostrarSku}
                // NCM diferente é conversa do contador; na doca era só ruído.
                mostrarFiscal={podeTratarNota}
              />
            </div>

            {aba === "resumo" && (
              <div id="painel-resumo" role="tabpanel" aria-labelledby="aba-resumo" className="pt-4">
                <AbaResumo
                  nota={nota}
                  itens={itensNota}
                  valores={valores}
                  unidades={unidades}
                  semProduto={semProduto.length}
                />
              </div>
            )}

            {aba === "fiscal" && (
              <div id="painel-fiscal" role="tabpanel" aria-labelledby="aba-fiscal" className="pt-4">
                <AbaFiscal nota={nota} itens={itensNota} />
              </div>
            )}

            {aba === "historico" && (
              <div
                id="painel-historico"
                role="tabpanel"
                aria-labelledby="aba-historico"
                className="pt-4"
              >
                <AbaHistorico eventos={dados.timeline} />
              </div>
            )}
          </div>
        </div>

        {/* ══ O que se lê sem clicar ══ */}
        <aside
          // Sem largura para ficar ao lado, os cartões descem para baixo da
          // tabela em duas colunas — uma pilha estreita de quatro seria rolagem
          // à toa.
          className="grid min-w-0 gap-4 @[40rem]:grid-cols-2 @[72rem]:grid-cols-1"
          aria-label="Resumo da nota"
        >
          <CartaoLateral icone={<Calculator size={15} aria-hidden />} titulo="Valores da nota">
            <dl className="flex flex-col gap-2.5 text-[13px]">
              <Linha rotulo="Total dos itens" valor={fmtMoney(valores.itens)} />
              <Linha rotulo="Acréscimos e tributos" valor={fmtMoney(valores.acrescimos)} />
              <Linha rotulo="Descontos" valor={fmtMoney(valores.descontos)} />
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-3 rounded-[var(--radius-sm)] bg-brand-soft px-3 py-2.5">
              <span className="text-[13px] font-medium text-accent">Total da nota</span>
              <span className="font-display text-[20px] font-semibold text-ink tabular-nums">
                {fmtMoney(nota.valorTotal)}
              </span>
            </div>
            {valores.suspeito && (
              // A soma dos itens raramente fecha com o total — frete, ST e IPI
              // entram fora da mercadoria. Acima de 15% o parse provavelmente
              // perdeu linha, e esse aviso não pode ficar atrás de uma aba.
              <p className="mt-2.5 flex items-start gap-1.5 text-[12px] font-medium text-warn">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Diferença grande para ser só frete e imposto — confira se falta item na leitura.
              </p>
            )}
          </CartaoLateral>

          {itensNota.length > 0 && (
            <CartaoLateral icone={<ListChecks size={15} aria-hidden />} titulo="Andamento">
              <Andamento
                total={itensNota.length}
                relacionados={situacoes.RELACIONADO}
                pendentes={situacoes.PENDENTE}
                divergentes={situacoes.DIVERGENCIA}
              />
            </CartaoLateral>
          )}

          <CartaoLateral icone={<Receipt size={15} aria-hidden />} titulo="Documento fiscal">
            <dl className="flex flex-col gap-2 text-[13px]">
              <Linha rotulo="NF-e" valor={<span className="font-mono">{nota.numero}</span>} />
              <Linha rotulo="Série" valor={<span className="font-mono">{nota.serie}</span>} />
              <Linha rotulo="Emissão" valor={dia(nota.dataEmissao)} />
              <Linha
                rotulo="Vencimento"
                valor={
                  parcelas.length === 0
                    ? "sem parcelas"
                    : parcelas.length === 1
                      ? dia(parcelas[0].vencimento)
                      : `${dia(parcelas[0].vencimento)} · 1ª de ${parcelas.length}`
                }
              />
            </dl>
            {!nota.temXml ? (
              <p className="mt-3 text-[12px] text-faint">Esta nota não tem XML guardado.</p>
            ) : !podeBaixarXml ? (
              <p className="mt-3 text-[12px] text-faint">
                Abrir o XML é permissão de quem cuida dos documentos fiscais.
              </p>
            ) : (
              <div className="mt-3.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void abrirXml("ver")}
                  disabled={buscandoXml !== null}
                  className={cn(BOTAO_CARTAO, "min-w-0 flex-1")}
                >
                  {buscandoXml === "ver" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <FileCode2 size={14} aria-hidden />
                  )}
                  Ver XML original
                </button>
                <button
                  type="button"
                  onClick={() => void abrirXml("baixar")}
                  disabled={buscandoXml !== null}
                  className={cn(BOTAO_CARTAO, "w-9 px-0")}
                  aria-label="Baixar o XML da nota"
                  title="Baixar o XML da nota"
                >
                  {buscandoXml === "baixar" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <Download size={14} aria-hidden />
                  )}
                </button>
              </div>
            )}
          </CartaoLateral>

          {(podeReceber && !encerrado) || recebimento.observacao ? (
            <CartaoLateral icone={<NotebookPen size={15} aria-hidden />} titulo="Observações">
              <Observacoes
                receiptId={recebimento.id}
                inicial={recebimento.observacao}
                editavel={podeReceber && !encerrado}
              />
            </CartaoLateral>
          ) : null}
        </aside>
      </div>

      {decidindo && notaAberta && !podeReceber && (
        <p className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3 text-[13px] text-muted">
          Você trata a nota: relacionar os itens aos produtos é a sua parte. Quem recebe a
          mercadoria diz de qual pedido ela é e confere o que chegou.
        </p>
      )}

      {decidindo && notaAberta && podeReceber && (
        <RodapeAcao>
          {/* O andamento do de-para já está ao lado da tabela. Aqui cabe só o
              que acontece ao apertar o botão. */}
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {impedimento ? (
              impedimento
            ) : pendentes.length > 0 ? (
              // Não bloqueia: com o caminhão na porta, contar primeiro e
              // relacionar depois é a ordem certa.
              "Dá para conferir já e relacionar depois. A entrada só fecha com todos os itens resolvidos."
            ) : (
              <>
                Entram <span className="font-mono text-ink-2">+{fmtQtd(unidades)} UN</span> no
                estoque quando a conferência fechar.
              </>
            )}
          </p>
          <Button
            onClick={() => void abrirConferencia()}
            disabled={salvando || impedimento !== null}
            className="w-full shrink-0 sm:w-auto"
          >
            {salvando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <cta.Icone className="h-4 w-4" aria-hidden />
            )}
            {salvando ? "Abrindo conferência…" : cta.rotulo}
          </Button>
        </RodapeAcao>
      )}

      {!dados.escolherPorta && !encerrado && (
        <RodapeAcao>
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {pendentes.length > 0
              ? "A conferência já está aberta. A entrada só fecha com todos os itens resolvidos."
              : "Nota e produtos em ordem."}
          </p>
          <Button
            onClick={() => router.push(`/recebimento/${recebimento.id}`)}
            className="w-full shrink-0 sm:w-auto"
          >
            Ir para a conferência
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </RodapeAcao>
      )}

      {/* ── De qual pedido é esta nota ── */}
      <Sheet
        open={escolhendoPedido && podeTrocarPedido}
        onClose={() => setEscolhendoPedido(false)}
        title={decidindo ? "Pedido desta nota" : "Trocar pedido"}
        description={
          decidindo
            ? "Sabendo o pedido, os produtos dele entram como sugestão na tabela. Nada é gravado até você abrir a conferência."
            : "Com a conferência aberta, trocar o pedido é desfazê-la e escolher de novo."
        }
        width="md"
        footer={
          decidindo ? (
            <div className="flex justify-end">
              <Button onClick={() => setEscolhendoPedido(false)}>Pronto</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setEscolhendoPedido(false)}
                disabled={salvando}
                className="flex-1"
              >
                Manter
              </Button>
              <Button onClick={() => void trocarPedido()} disabled={salvando} className="flex-1">
                {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Trocar pedido
              </Button>
            </div>
          )
        }
      >
        {!decidindo ? (
          <p className="text-[13px] text-ink-2">
            {dados.resumo.conferidos > 0
              ? `${dados.resumo.conferidos === 1 ? "A contagem já feita é apagada" : `As ${dados.resumo.conferidos} contagens já feitas são apagadas`} e você volta a escolher de qual pedido é a mercadoria.`
              : "Nada foi contado ainda — você só volta a escolher de qual pedido é a mercadoria."}
          </p>
        ) : sugestoes.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-[var(--radius)] bg-surface-2 px-3.5 py-3 text-[13px] text-muted">
              Não há pedido em aberto deste fornecedor nesta loja. A conferência usa a nota como
              referência do que deveria vir.
            </p>
            <RegistrarComoPedido
              marcado={origem === "novo"}
              onMarcar={(v) => escolher(v ? "novo" : "sem")}
              itens={itensNota.length}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Pedido desta nota">
            <p className="mb-1 text-[13px] font-medium text-ink">Esta nota fatura um pedido seu?</p>
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
                destaque={
                  s.motivos.join(" · ") || (i === 0 ? "O mais parecido com esta nota" : undefined)
                }
              />
            ))}

            <Resposta
              selecionada={origem === "sem" || origem === "novo"}
              onSelecionar={() => escolher("sem")}
              titulo="Não, chegou sem pedido"
              ajuda="A nota é a referência do que deveria vir."
            >
              {/* Segunda decisão, só para quem respondeu "não": como porta de
                  peso igual, o operador lia as três para descobrir que duas
                  eram a mesma coisa com um registro a mais. */}
              <RegistrarComoPedido
                marcado={origem === "novo"}
                onMarcar={(v) => escolher(v ? "novo" : "sem")}
                itens={itensNota.length}
              />
            </Resposta>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ── Valores ─────────────────────────────────────────────────

type Valores = {
  /** Soma do valor de mercadoria das linhas. */
  itens: number;
  /** Tudo que entra por fora da mercadoria: frete, ST, IPI e o que mais houver. */
  acrescimos: number;
  descontos: number;
  frete: number;
  ipi: number;
  icmsSt: number;
  fcpSt: number;
  /** Acréscimo que nenhuma linha explica (seguro, despesas acessórias). */
  outros: number;
  /** A soma das linhas está longe demais do total para ser só imposto. */
  suspeito: boolean;
};

/**
 * Do que o total da nota é feito, de um jeito que sempre fecha:
 * `itens + acrescimos − descontos = total`.
 *
 * Desconto dado no rodapé da nota (e não por linha) aparece como diferença
 * negativa — entra em descontos, em vez de virar um "acréscimo" abaixo de zero.
 */
function valoresDaNota(nota: NotaView, itens: ItemNotaView[]): Valores {
  const soma = (campo: "valorTotal" | "valorDesconto" | "valorFrete" | "valorIpi" | "valorIcmsSt" | "valorFcpSt") =>
    itens.reduce((s, i) => s + i[campo], 0);

  const mercadoria = soma("valorTotal");
  const descontoDasLinhas = soma("valorDesconto");
  const frete = soma("valorFrete");
  const ipi = soma("valorIpi");
  const icmsSt = soma("valorIcmsSt");
  const fcpSt = soma("valorFcpSt");

  const fora = nota.valorTotal - mercadoria + descontoDasLinhas;
  const acrescimos = Math.max(0, fora);
  const descontos = descontoDasLinhas + Math.max(0, -fora);

  return {
    itens: mercadoria,
    acrescimos,
    descontos,
    frete,
    ipi,
    icmsSt,
    fcpSt,
    outros: Math.max(0, acrescimos - frete - ipi - icmsSt - fcpSt),
    suspeito:
      itens.length > 0 &&
      nota.valorTotal > 0 &&
      Math.abs(nota.valorTotal - mercadoria) / nota.valorTotal >= 0.15,
  };
}

// ── Cartões ─────────────────────────────────────────────────

/**
 * Um dos dois cartões do topo: quem (fornecedor) e contra o quê (pedido). O
 * quadrado colorido não é enfeite — é o que faz a pessoa achar "o do pedido"
 * de relance, sem ler os rótulos.
 */
function CartaoTopo({
  icone,
  imagemUrl,
  tom,
  rotulo,
  titulo,
  detalhe,
  acao,
}: {
  icone: React.ReactNode;
  /** Imagem no lugar do ícone (logo do fornecedor). Falhou ao carregar, volta o ícone. */
  imagemUrl?: string | null;
  /** Fundo e cor do ícone. */
  tom: string;
  rotulo: string;
  titulo: React.ReactNode;
  detalhe: React.ReactNode;
  acao?: React.ReactNode;
}) {
  // Guarda QUAL url falhou, não um booleano: trocar de fornecedor com outra
  // logo tenta de novo, sem efeito para resetar.
  const [quebrou, setQuebrou] = React.useState<string | null>(null);
  const imagem = imagemUrl && imagemUrl !== quebrou ? imagemUrl : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5">
      {imagem ? (
        // Logo é URL de terceiro colada no cadastro — host arbitrário não passa
        // pelo next/image (mesmo padrão do cabeçalho do fornecedor).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imagem}
          alt=""
          onError={() => setQuebrou(imagem)}
          className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)] border border-line bg-surface-2 object-contain p-1"
        />
      ) : (
        <span
          className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)]", tom)}
        >
          {icone}
        </span>
      )}
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-[11px] text-muted">{rotulo}</p>
        <p className="truncate text-[14px] font-semibold text-ink">{titulo}</p>
        <p className="text-[12px] text-muted">{detalhe}</p>
      </div>
      {acao}
    </div>
  );
}

function CartaoLateral({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="text-muted">{icone}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Rótulo à esquerda, valor à direita. */
function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="text-right text-ink tabular-nums">{valor}</dd>
    </div>
  );
}

// ── Andamento ───────────────────────────────────────────────

/**
 * Quanto do de-para já andou. O anel é o medidor desta etapa: verde é o que
 * já virou produto, vermelho o que pede revisão, e o trilho claro é o que
 * falta — de longe, lê-se a proporção antes do número.
 */
function Andamento({
  total,
  relacionados,
  pendentes,
  divergentes,
}: {
  total: number;
  relacionados: number;
  pendentes: number;
  divergentes: number;
}) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const fracRel = total > 0 ? relacionados / total : 0;
  const fracDiv = total > 0 ? divergentes / total : 0;

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 shrink-0">
          <svg
            viewBox="0 0 100 100"
            className="h-full w-full -rotate-90"
            role="img"
            aria-label={`${relacionados} de ${total} ${total === 1 ? "item relacionado" : "itens relacionados"}`}
          >
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" className="stroke-brand-softer" />
            {/* A divergência vem depois do que está pronto: desenhada primeiro,
                por baixo, e o arco verde cobre o começo dela. */}
            {fracDiv > 0 && (
              <circle
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth="10"
                strokeDasharray={`${(fracRel + fracDiv) * C} ${C}`}
                className="stroke-danger transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
              />
            )}
            {fracRel > 0 && (
              <circle
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${fracRel * C} ${C}`}
                className="stroke-ok transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
              />
            )}
          </svg>
          <p className="absolute inset-0 grid place-content-center text-center" aria-hidden>
            <span className="font-display text-[24px] leading-none font-semibold text-ink tabular-nums">
              {relacionados}
            </span>
            <span className="mt-0.5 text-[11px] text-muted">de {total}</span>
          </p>
        </div>

        <ul className="flex min-w-0 flex-col gap-2 text-[12px] text-ink-2">
          <Legenda ponto="bg-ok" n={relacionados} um="item relacionado" varios="itens relacionados" />
          <Legenda ponto="bg-brand" n={pendentes} um="item pendente" varios="itens pendentes" />
          <Legenda ponto="bg-danger" n={divergentes} um="com divergência" varios="com divergência" />
        </ul>
      </div>
    </>
  );
}

function Legenda({
  ponto,
  n,
  um,
  varios,
}: {
  ponto: string;
  n: number;
  um: string;
  varios: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", ponto)} aria-hidden />
      <span>
        <span className="font-semibold text-ink tabular-nums">{n}</span> {n === 1 ? um : varios}
      </span>
    </li>
  );
}

// ── Observações ─────────────────────────────────────────────

const LIMITE_OBSERVACAO = 500;

/**
 * A anotação livre de quem recebe. Grava sozinha ao sair do campo — não há
 * "Salvar" para esquecer de apertar — e diz que gravou, porque sem sinal
 * ninguém confia num campo que salva sozinho.
 */
function Observacoes({
  receiptId,
  inicial,
  editavel,
}: {
  receiptId: string;
  inicial: string | null;
  editavel: boolean;
}) {
  const [texto, setTexto] = React.useState(inicial ?? "");
  const [gravado, setGravado] = React.useState(inicial ?? "");
  const [estado, setEstado] = React.useState<"parado" | "salvando" | "salvo">("parado");

  async function salvar() {
    if (texto.trim() === gravado.trim()) return;
    setEstado("salvando");
    try {
      await salvarObservacaoAction({ receiptId, observacao: texto });
      setGravado(texto);
      setEstado("salvo");
    } catch (e) {
      setEstado("parado");
      toast.error("Não deu para salvar a observação", e instanceof Error ? e.message : "Tente de novo.");
    }
  }

  if (!editavel) {
    return <p className="text-[13px] whitespace-pre-wrap text-ink-2">{inicial}</p>;
  }

  return (
    <>
      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setEstado("parado");
        }}
        onBlur={() => void salvar()}
        rows={3}
        maxLength={LIMITE_OBSERVACAO}
        placeholder="Ex.: o motorista avisou que o resto vem na sexta."
        aria-label="Observações deste recebimento"
        className="w-full resize-y rounded-[var(--radius-sm)] border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      />
      <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-faint">
        <span role="status">
          {estado === "salvando" ? "Salvando…" : estado === "salvo" ? "Salvo." : ""}
        </span>
        <span className="tabular-nums">
          {texto.length}/{LIMITE_OBSERVACAO}
        </span>
      </p>
    </>
  );
}

// ── Abas ────────────────────────────────────────────────────

const CARTAO_ABA = "rounded-[var(--radius-lg)] border border-line bg-surface";
const TITULO_SECAO = "text-[13px] font-semibold text-ink";

/**
 * Resumo da nota: do que o total é feito e o que a nota vai gerar quando a
 * entrada for confirmada — títulos a pagar e unidades no estoque. A lateral
 * mostra o total em quatro linhas; aqui ele se abre.
 */
function AbaResumo({
  nota,
  itens,
  valores,
  unidades,
  semProduto,
}: {
  nota: NotaView;
  itens: ItemNotaView[];
  valores: Valores;
  unidades: number;
  semProduto: number;
}) {
  const parcelas = nota.duplicatas;
  const relacionados = itens.length - semProduto;
  const composicao: { rotulo: string; valor: number; sinal?: "−" }[] = [
    { rotulo: "Mercadoria", valor: valores.itens },
    { rotulo: "Frete", valor: valores.frete },
    { rotulo: "IPI", valor: valores.ipi },
    { rotulo: "ICMS ST", valor: valores.icmsSt },
    { rotulo: "FCP ST", valor: valores.fcpSt },
    { rotulo: "Outros acréscimos", valor: valores.outros },
    { rotulo: "Descontos", valor: valores.descontos, sinal: "−" },
  ];

  return (
    <div className={cn(CARTAO_ABA, "grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0")}>
      <section className="p-4 sm:p-5">
        <h3 className={TITULO_SECAO}>Composição do valor</h3>
        <dl className="mt-3 flex flex-col gap-2 text-[13px]">
          {composicao
            // Mercadoria sempre aparece; o resto, só o que a nota cobrou.
            .filter((c, i) => i === 0 || c.valor > 0.005)
            .map((c) => (
              <Linha
                key={c.rotulo}
                rotulo={c.rotulo}
                valor={
                  <span className="font-mono">
                    {c.sinal}
                    {c.sinal ? " " : ""}
                    {fmtMoney(c.valor)}
                  </span>
                }
              />
            ))}
          <div className="mt-1 border-t border-line pt-2.5">
            <Linha
              rotulo="Total da nota"
              valor={<span className="font-mono font-semibold">{fmtMoney(nota.valorTotal)}</span>}
            />
          </div>
        </dl>
      </section>

      <div className="flex flex-col divide-y divide-line">
        <section className="p-4 sm:p-5">
          <h3 className={TITULO_SECAO}>Contas a pagar</h3>
          {parcelas.length > 0 ? (
            <>
              <p className="mt-1 text-[12px] text-muted">
                {parcelas.length === 1 ? "A parcela vira título" : "As parcelas viram títulos"} a
                pagar quando a entrada for confirmada.
              </p>
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {parcelas.map((p, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted">
                      {parcelas.length > 1 && (
                        <span className="mr-2 font-mono text-faint">
                          {i + 1}/{parcelas.length}
                        </span>
                      )}
                      {dia(p.vencimento)}
                    </span>
                    <span className="font-mono text-ink">{fmtMoney(p.valor)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-muted">
              A nota não traz parcelas. Nasce um título só, de {fmtMoney(nota.valorTotal)}, com
              vencimento pelo prazo do fornecedor, quando a entrada for confirmada.
            </p>
          )}
        </section>

        <section className="p-4 sm:p-5">
          <h3 className={TITULO_SECAO}>Entrada no estoque</h3>
          {itens.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted">Esta nota não tem itens de mercadoria.</p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">
              <span className="font-mono font-semibold text-ink">+{fmtQtd(unidades)} UN</span> em{" "}
              {relacionados} {relacionados === 1 ? "item relacionado" : "itens relacionados"}, pela
              quantidade da nota. A conferência pode mudar esse número.
              {semProduto > 0 &&
                ` ${semProduto === 1 ? "1 item ainda sem produto não entra" : `${semProduto} itens ainda sem produto não entram`} na conta.`}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Informações fiscais: o que o contador confere. A chave do documento e a
 * classificação que o fornecedor declarou em cada linha — o CFOP aparece nos
 * dois sentidos porque a saída dele é a nossa entrada.
 */
function AbaFiscal({ nota, itens }: { nota: NotaView; itens: ItemNotaView[] }) {
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);

  return (
    <div className={cn(CARTAO_ABA, "overflow-hidden")}>
      <div className="flex flex-col gap-2 px-4 py-4 text-[13px] sm:px-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted">Chave de acesso</span>
          <span className="font-mono text-[12px] break-all text-ink">{nota.chave}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(nota.chave);
              toast.success("Chave copiada.");
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <Copy size={11} aria-hidden />
            Copiar
          </button>
        </p>
        <p className="text-muted">
          Emitente <span className="text-ink">{nota.fornecedor}</span>
          {" · CNPJ "}
          <span className="font-mono text-ink">{maskCnpj(nota.cnpj)}</span>
          {nota.uf && (
            <>
              {" · UF "}
              <span className="text-ink">{nota.uf}</span>
            </>
          )}
        </p>
      </div>

      {ordenados.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[44rem] border-collapse text-[12px]">
            <thead className="bg-surface-2/70 text-left text-[11px] text-ink-2">
              <tr>
                <th scope="col" className="w-10 py-2 pr-2.5 pl-4 font-medium sm:pl-5">
                  #
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  Produto na nota
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  NCM
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  CEST
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  CFOP
                </th>
                <th scope="col" className="px-2.5 py-2 text-right font-medium">
                  ICMS ST
                </th>
                <th scope="col" className="py-2 pr-4 pl-2.5 text-right font-medium sm:pr-5">
                  IPI
                </th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((i, idx) => {
                const entrada = cfopDeEntrada(i.cfop);
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="py-2 pr-2.5 pl-4 font-semibold text-ink tabular-nums sm:pl-5">
                      {idx + 1}
                    </td>
                    <td className="px-2.5 py-2 text-ink">{i.descricao}</td>
                    <td className="px-2.5 py-2 font-mono whitespace-nowrap text-ink-2">
                      {i.ncm ?? "—"}
                    </td>
                    <td className="px-2.5 py-2 font-mono whitespace-nowrap text-ink-2">
                      {i.cest ?? "—"}
                    </td>
                    <td className="px-2.5 py-2 font-mono whitespace-nowrap text-ink-2">
                      {i.cfop ?? "—"}
                      {entrada && <span className="text-faint"> → {entrada}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono whitespace-nowrap text-ink-2">
                      {i.valorIcmsSt + i.valorFcpSt > 0.005
                        ? fmtMoney(i.valorIcmsSt + i.valorFcpSt)
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 pl-2.5 text-right font-mono whitespace-nowrap text-ink-2 sm:pr-5">
                      {i.valorIpi > 0.005 ? fmtMoney(i.valorIpi) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A história deste recebimento, do mais antigo ao mais recente. */
function AbaHistorico({ eventos }: { eventos: RecebimentoView["timeline"] }) {
  if (eventos.length === 0) {
    return (
      <p className={cn(CARTAO_ABA, "px-4 py-8 text-center text-[13px] text-muted")}>
        Nada registrado ainda. Vincular o pedido, contar e receber aparecem aqui, com quem fez e
        quando.
      </p>
    );
  }
  return (
    <ol className={cn(CARTAO_ABA, "divide-y divide-line")}>
      {eventos.map((e) => (
        <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-3 text-[13px] sm:px-5">
          <span className="w-28 shrink-0 font-mono text-[12px] text-faint">
            {new Date(e.createdAt).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="min-w-0 flex-1 basis-56 text-ink-2">
            {e.descricao}
            {e.autor && <span className="text-faint"> · {e.autor}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── Escolha do pedido ───────────────────────────────────────

/** A nota chegou sem pedido — e o operador quer que ela vire um mesmo assim. */
function RegistrarComoPedido({
  marcado,
  onMarcar,
  itens,
}: {
  marcado: boolean;
  onMarcar: (marcado: boolean) => void;
  itens: number;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-2">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => onMarcar(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-line-button accent-[var(--color-brand)]"
      />
      <span>
        Registrar também como pedido de compra
        <span className="block text-[12px] text-muted">
          O NoHub cria o pedido com {itens === 1 ? "o item" : `os ${itens} itens`} da nota. Útil
          para o histórico de pedidos; não muda o que entra no estoque. Exige todos os itens com
          produto.
        </span>
      </span>
    </label>
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
        "rounded-[var(--radius)] border transition-colors",
        selecionada ? "border-brand bg-brand-soft/60" : "border-line bg-surface",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selecionada}
        onClick={onSelecionar}
        className="flex w-full cursor-pointer items-start gap-3 rounded-[var(--radius)] px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
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
          {destaque && <span className="mt-0.5 block text-[12px] text-accent">{destaque}</span>}
        </span>
      </button>
      {selecionada && children && (
        <div className="border-t border-line/70 px-4 py-3">{children}</div>
      )}
    </div>
  );
}
