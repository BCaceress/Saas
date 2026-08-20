"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Eye,
  Mail,
  Package,
  Link as LinkIcon,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { Chip } from "@/components/mobile/acao-estoque";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { SupplierAvatar, Thumb } from "@/app/(app)/cotacoes/_ui";
import type {
  ConviteCotacao,
  CotacaoDetalhe,
  FornecedorOpcao,
} from "@/app/(app)/cotacoes/_compra-types";
import { andamento, statusVisivel } from "@/app/(app)/cotacoes/_status";
import {
  adicionarItemAction,
  buscarProdutoPorCodigoCotacaoAction,
  buscarProdutosCotacaoAction,
  definirConviteAction,
  descartarSeVaziaAction,
  editarCotacaoAction,
  editarItemAction,
  enviarCotacaoAction,
  linkDoConviteAction,
  mensagemDoConviteAction,
  removerItemAction,
  type ProdutoCotacao,
} from "@/app/(app)/cotacoes/_compra-actions";
import { ComparativoCotacao } from "@/app/(app)/cotacoes/[id]/_comparativo";

// ============================================================
// Cotação no celular — o fluxo inteiro, não um resumo.
//
// Duas telas dentro de uma:
//
//  · RASCUNHO → trilho de três passos (produtos → fornecedores → enviar), com
//    um passo por vez e a ação principal fixa no rodapé. Passo a passo aqui
//    não é enfeite: numa tela de 390px, mostrar as três coisas juntas é
//    garantir que nenhuma caiba.
//  · Enviada → acompanhamento (quem viu, quem respondeu, reenviar) e a
//    comparação, que reusa o componente do desktop — abaixo de `md` ele já
//    renderiza card por produto, então duplicar a regra de decisão do
//    comparativo aqui seria manter duas verdades sobre o mesmo dinheiro.
//
// Todas as escritas são as MESMAS Server Actions do desktop. O celular não tem
// regra de negócio própria; tem outra superfície.
// ============================================================

const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Saldo em estoque como etiqueta, não como frase: numa linha de 390px o "tem"
 * come espaço do nome do produto, que é o que o operador está lendo. Ícone de
 * caixa + número + unidade dizem o mesmo em um terço da largura.
 */
function Saldo({ quantidade }: { quantidade: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-faint">
      <Package className="size-3" aria-hidden />
      <span className="font-mono">{fmtQtd(quantidade)}</span>
      <span className="sr-only">unidades em estoque</span>
      <span aria-hidden>un</span>
    </span>
  );
}

type Passo = "produtos" | "fornecedores" | "enviar";

const PASSOS: { id: Passo; label: string }[] = [
  { id: "produtos", label: "Produtos" },
  { id: "fornecedores", label: "Fornecedores" },
  { id: "enviar", label: "Enviar" },
];

type Envio = Awaited<ReturnType<typeof enviarCotacaoAction>>[number];

export function CotacaoMobileDetalhe({
  cotacao,
  fornecedores,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  podePedir: boolean;
}) {
  const router = useRouter();
  const rascunho = cotacao.status === "RASCUNHO";
  // Rascunho que ninguém preencheu não vira linha na lista: some ao sair.
  const vazia =
    cotacao.status === "RASCUNHO" &&
    cotacao.itens.length === 0 &&
    cotacao.convites.length === 0;
  const [passo, setPasso] = React.useState<Passo>("produtos");
  const [aba, setAba] = React.useState<"fornecedores" | "comparar">(
    cotacao.convites.some((c) => c.status === "RESPONDIDA") ? "comparar" : "fornecedores",
  );
  const [envios, setEnvios] = React.useState<Envio[] | null>(null);

  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA").length;
  const recusados = cotacao.convites.filter((c) => c.status === "RECUSADA").length;
  const rotulo = statusVisivel(
    cotacao.status,
    cotacao.convites.length,
    respondidos,
    recusados,
  );

  return (
    <>
      <MobilePageHeader
        titulo={cotacao.titulo}
        voltar="/m/cotacoes"
        onVoltar={
          vazia
            ? () => {
                void descartarSeVaziaAction(cotacao.id);
                router.push("/m/cotacoes");
              }
            : undefined
        }
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px]">{cotacao.numero}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                rotulo.classe,
              )}
            >
              {rotulo.label}
            </span>
            {cotacao.status === "ABERTA" && (
              <span className="text-[12px] text-muted">
                {andamento(cotacao.convites.length, respondidos)}
              </span>
            )}
          </span>
        }
      />

      {rascunho ? (
        <RascunhoTrilho
          cotacao={cotacao}
          fornecedores={fornecedores}
          podePedir={podePedir}
          passo={passo}
          onPasso={setPasso}
          onEnviado={setEnvios}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Chip ativo={aba === "fornecedores"} onClick={() => setAba("fornecedores")}>
              Fornecedores ({cotacao.convites.length})
            </Chip>
            <Chip ativo={aba === "comparar"} onClick={() => setAba("comparar")}>
              Comparar ({respondidos})
            </Chip>
          </div>

          {aba === "fornecedores" ? (
            <Acompanhamento
              cotacao={cotacao}
              podePedir={podePedir}
              onEnviado={setEnvios}
            />
          ) : (
            <ComparativoCotacao cotacao={cotacao} podePedir={podePedir} />
          )}
        </div>
      )}

      <EnviosSheetMobile envios={envios} onFechar={() => setEnvios(null)} />
    </>
  );
}

// ── Rascunho: trilho de três passos ─────────────────────────

function RascunhoTrilho({
  cotacao,
  fornecedores,
  podePedir,
  passo,
  onPasso,
  onEnviado,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  podePedir: boolean;
  passo: Passo;
  onPasso: (p: Passo) => void;
  onEnviado: (e: Envio[]) => void;
}) {
  const i = PASSOS.findIndex((p) => p.id === passo);
  const feito = {
    produtos: cotacao.itens.length > 0,
    fornecedores: cotacao.convites.length > 0,
    enviar: false,
  } as Record<Passo, boolean>;

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-1.5">
        {PASSOS.map((p, idx) => {
          const ativo = passo === p.id;
          return (
            <li key={p.id} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPasso(p.id)}
                aria-current={ativo ? "step" : undefined}
                className={cn(
                  "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[12px] font-medium",
                  ativo
                    ? "bg-brand text-on-brand"
                    : feito[p.id]
                      ? "bg-ok-soft text-ok"
                      : "bg-surface-2 text-muted",
                )}
              >
                {feito[p.id] && !ativo ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span className="font-mono">{idx + 1}</span>
                )}
                {p.label}
              </button>
            </li>
          );
        })}
      </ol>

      {passo === "produtos" && <PassoProdutos cotacao={cotacao} editavel={podePedir} />}
      {passo === "fornecedores" && (
        <PassoFornecedores cotacao={cotacao} fornecedores={fornecedores} editavel={podePedir} />
      )}
      {passo === "enviar" && (
        <PassoEnviar cotacao={cotacao} editavel={podePedir} onEnviado={onEnviado} />
      )}

      {passo !== "enviar" && (
        <div className="sticky bottom-24 z-10 flex gap-2">
          {i > 0 && (
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => onPasso(PASSOS[i - 1].id)}
            >
              Voltar
            </Button>
          )}
          <Button
            size="lg"
            className="flex-[2]"
            disabled={!feito[passo]}
            onClick={() => onPasso(PASSOS[i + 1].id)}
          >
            {feito[passo]
              ? "Continuar"
              : passo === "produtos"
                ? "Adicione um produto"
                : "Escolha um fornecedor"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Passo 1: produtos ───────────────────────────────────────
// Bipe primeiro, busca depois. Quem está na frente da prateleira tem o código
// de barras na mão; quem está no escritório digita o nome.
//
// A lista aqui é OTIMISTA e o servidor vem atrás. Antes cada toque no + fazia
// gravação + \`router.refresh()\` (isto é: a página inteira voltando do servidor)
// antes de o número mudar na tela — meio segundo de nada acontecendo por
// unidade, e o operador tocando de novo achando que não pegou. Agora o número
// muda no toque, as gravações de quantidade são agrupadas (o dedo bate cinco
// vezes, o banco leva uma escrita) e a lista do servidor reassume assim que
// chega.

/** Item como a tela trabalha: o do servidor, ou o que acabou de ser tocado. */
type ItemLocal = {
  id: string;
  productId: string | null;
  descricao: string;
  quantidade: number;
  imagemUrl: string | null;
  sku: string | null;
  estoqueAtual: number | null;
};

const paraLocal = (i: CotacaoDetalhe["itens"][number]): ItemLocal => ({
  id: i.id,
  productId: i.productId,
  descricao: i.descricao,
  quantidade: i.quantidade,
  imagemUrl: i.imagemUrl,
  sku: i.sku,
  estoqueAtual: i.estoqueAtual,
});

/** Espera entre o último toque e a gravação da quantidade. */
const ESPERA_GRAVACAO = 600;

/** Mínimo para buscar: com duas letras, metade do catálogo volta. */
const MIN_BUSCA = 3;

function PassoProdutos({
  cotacao,
  editavel,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
}) {
  const router = useRouter();
  const [lendo, setLendo] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [achados, setAchados] = React.useState<ProdutoCotacao[]>([]);
  const [buscando, setBuscando] = React.useState(false);

  // Lista da tela. Enquanto o servidor não muda, quem manda é o toque; quando a
  // lista do servidor muda (gravação confirmada, outra pessoa mexeu), ela
  // reassume. Ajuste durante o render é o padrão do React para estado derivado
  // de props — e evita o efeito que rodaria um passo atrasado.
  const chaveServidor = cotacao.itens.map((i) => `${i.id}:${i.quantidade}`).join("|");
  const [vistoDoServidor, setVistoDoServidor] = React.useState(chaveServidor);
  const [itens, setItens] = React.useState<ItemLocal[]>(() => cotacao.itens.map(paraLocal));
  if (vistoDoServidor !== chaveServidor) {
    setVistoDoServidor(chaveServidor);
    setItens(cotacao.itens.map(paraLocal));
  }

  // Espelho da lista para as tarefas em fila: elas rodam depois do render e
  // precisam do que está na tela AGORA, não do que estava quando foram criadas.
  const itensRef = React.useRef<ItemLocal[]>(itens);
  React.useEffect(() => {
    itensRef.current = itens;
  }, [itens]);

  // Um timer e uma fila por item: toques seguidos no mesmo produto viram UMA
  // gravação, e gravações do mesmo item nunca se atropelam.
  const timers = React.useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; gravar: () => void }>(),
  );
  const filas = React.useRef(new Map<string, Promise<unknown>>());
  /** Contador dos ids provisórios — não precisa ser único no mundo, só na tela. */
  const sequencia = React.useRef(0);

  function enfileirar(id: string, tarefa: () => Promise<unknown>) {
    const proxima = (filas.current.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(tarefa)
      .catch((e) => {
        toast.error(
          "Não deu para salvar o item",
          e instanceof Error ? e.message : "Tente de novo em instantes.",
        );
        router.refresh();
      });
    filas.current.set(id, proxima);
    return proxima;
  }

  /** Grava a quantidade que ficou de pé depois que o dedo parou. */
  function agendarGravacao(item: ItemLocal, quantidade: number) {
    const anterior = timers.current.get(item.id);
    if (anterior) clearTimeout(anterior.timer);

    const gravar = () => {
      timers.current.delete(item.id);
      void enfileirar(item.id, async () => {
        // Item que ainda nem nasceu no banco não tem o que atualizar: a fila do
        // id provisório já grava a quantidade certa.
        if (item.id.startsWith("novo:")) return;
        if (quantidade <= 0) await removerItemAction(item.id);
        else {
          await editarItemAction({ id: item.id, descricao: item.descricao, quantidade });
        }
        // Só volta ao servidor quando o dedo parou em TODOS os itens: um
        // refresh no meio da contagem traria a lista velha por cima.
        if (timers.current.size === 0) router.refresh();
      });
    };

    timers.current.set(item.id, { timer: setTimeout(gravar, ESPERA_GRAVACAO), gravar });
  }

  // Sair do passo antes do tempo do agrupamento não pode perder o que foi
  // tocado — o que estiver pendente vai embora agora.
  React.useEffect(() => {
    const pendentes = timers.current;
    return () => {
      for (const { timer, gravar } of [...pendentes.values()]) {
        clearTimeout(timer);
        gravar();
      }
    };
  }, []);

  // Busca com respiro: cada tecla disparando uma consulta transforma o campo
  // numa metralhadora de round-trips na rede do mercado.
  React.useEffect(() => {
    const t = termo.trim();
    if (t.length < MIN_BUSCA) return;
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setAchados(await buscarProdutosCotacaoAction({ termo: t, siteId: cotacao.siteId }));
      } catch (e) {
        // Busca que falha calada vira "não existe nenhum produto" na cabeça de
        // quem procura — e o operador desiste do módulo, não da busca.
        toast.error(
          "A busca falhou",
          e instanceof Error ? e.message : "Tente de novo em instantes.",
        );
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, cotacao.siteId]);

  // Resultado antigo não sobrevive ao campo esvaziado — e limpar por derivação
  // evita um render extra só para apagar lista.
  const sugestoes = termo.trim().length < MIN_BUSCA ? [] : achados;

  /** Entra na lista na hora; o id de verdade chega da gravação. */
  function adicionar(produto: {
    productId: string | null;
    descricao: string;
    quantidade: number;
    imagemUrl?: string | null;
    sku?: string | null;
    estoque?: number | null;
  }) {
    const provisorio = `novo:${++sequencia.current}`;
    setItens((atual) => [
      ...atual,
      {
        id: provisorio,
        productId: produto.productId,
        descricao: produto.descricao,
        quantidade: produto.quantidade,
        imagemUrl: produto.imagemUrl ?? null,
        sku: produto.sku ?? null,
        estoqueAtual: produto.estoque ?? null,
      },
    ]);
    setTermo("");
    setAchados([]);

    void enfileirar(provisorio, async () => {
      const criado = await adicionarItemAction({
        quotationId: cotacao.id,
        productId: produto.productId,
        descricao: produto.descricao,
        quantidade: produto.quantidade,
      });
      // Troca o id provisório pelo real: sem isso, o + do item recém-criado
      // gravaria contra um id que não existe.
      setItens((atual) =>
        atual.map((i) => (i.id === provisorio ? { ...i, id: criado.id } : i)),
      );
      filas.current.delete(provisorio);

      // O dedo não espera a gravação: se a quantidade mudou (ou o item saiu da
      // lista) enquanto o item nascia, o banco recebe agora o que está na tela.
      const naTela = itensRef.current.find((i) => i.id === provisorio);
      if (!naTela) await removerItemAction(criado.id);
      else if (naTela.quantidade !== produto.quantidade) {
        await editarItemAction({
          id: criado.id,
          descricao: naTela.descricao,
          quantidade: naTela.quantidade,
        });
      }
      router.refresh();
    });
  }

  async function aoLer(codigo: string) {
    setOcupado(true);
    try {
      const achado = await buscarProdutoPorCodigoCotacaoAction(codigo, cotacao.siteId);
      if (!achado) {
        toast.info("Sem cadastro", `Nada encontrado para ${codigo}.`);
        return;
      }
      // Já está na lista? Bipar de novo soma um — é assim que se conta caixa.
      const existente = itens.find((i) => i.productId === achado.id);
      if (existente) {
        mudarQtd(existente, existente.quantidade + 1);
        toast.success(existente.descricao, `Agora são ${fmtQtd(existente.quantidade + 1)}.`);
        return;
      }
      adicionar({
        productId: achado.id,
        descricao: achado.nome,
        quantidade: achado.sugerido > 0 ? achado.sugerido : 1,
        imagemUrl: achado.imagemUrl,
        sku: achado.sku,
        estoque: achado.estoque,
      });
      toast.success("Item adicionado", achado.nome);
    } finally {
      setOcupado(false);
    }
  }

  /** Zero tira o item da lista — é o "menos" indo até o fim. */
  function mudarQtd(item: ItemLocal, nova: number) {
    if (nova <= 0) {
      setItens((atual) => atual.filter((i) => i.id !== item.id));
    } else {
      setItens((atual) =>
        atual.map((i) => (i.id === item.id ? { ...i, quantidade: nova } : i)),
      );
    }
    agendarGravacao(item, nova);
  }

  return (
    <div className="space-y-3">
      {editavel && (
        <>
          {lendo && (
            <Scanner
              onCodigo={aoLer}
              onFechar={() => setLendo(false)}
              continuo
              ocupado={ocupado}
              dica="Bipe o que você quer cotar"
            />
          )}

          {/* Buscar e bipar são a mesma decisão ("achar o produto"), então
              dividem a mesma linha: o campo ocupa o que sobra e o bipe fica no
              canto do polegar. */}
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome ou SKU"
                className="h-11 w-full rounded-[var(--radius)] border border-line bg-surface pr-3 pl-9 text-sm text-ink"
              />
              {buscando && (
                <Loader2
                  className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-faint"
                  aria-hidden
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => setLendo((v) => !v)}
              aria-pressed={lendo}
              aria-label={lendo ? "Fechar a câmera" : "Bipar produto"}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-[var(--radius)] border",
                lendo
                  ? "border-transparent bg-brand text-on-brand"
                  : "border-line-button bg-surface text-ink-2 active:bg-surface-2",
              )}
            >
              <ScanLine className="size-5" aria-hidden />
            </button>
          </div>

          {sugestoes.length > 0 && (
            <Card className="divide-y divide-line">
              {sugestoes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    adicionar({
                      productId: p.id,
                      descricao: p.nome,
                      quantidade: p.sugerido > 0 ? p.sugerido : 1,
                      imagemUrl: p.imagemUrl,
                      sku: p.sku,
                      estoque: p.estoque,
                    })
                  }
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2"
                >
                  {/* A miniatura ajuda a escolher, mas no celular ela rouba a
                      largura do nome — que é o que de fato identifica o item.
                      Volta a partir do tablet, onde sobra linha. */}
                  <span className="hidden md:block">
                    <Thumb url={p.imagemUrl} nome={p.nome} size={36} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{p.nome}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
                      <span className="font-mono">{p.sku}</span>
                      {p.estoque !== null && (
                        <>
                          <span aria-hidden>·</span>
                          <Saldo quantidade={p.estoque} />
                        </>
                      )}
                      {p.sugerido > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <span>faltam {fmtQtd(p.sugerido)}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <Plus className="size-4 shrink-0 text-brand" aria-hidden />
                </button>
              ))}
            </Card>
          )}

          {termo.trim().length >= MIN_BUSCA && !buscando && sugestoes.length === 0 && (
            <button
              type="button"
              onClick={() =>
                adicionar({ productId: null, descricao: termo.trim(), quantidade: 1 })
              }
              className="w-full rounded-[var(--radius)] border border-dashed border-line px-3 py-2.5 text-left text-[13px] text-ink-2 active:bg-surface-2"
            >
              Cotar <span className="font-medium text-ink">“{termo.trim()}”</span> mesmo sem
              cadastro
            </button>
          )}
        </>
      )}

      {itens.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted">
          Nenhum produto ainda. Bipe ou busque o que você quer cotar.
        </Card>
      ) : (
        <ul className="space-y-2">
          {itens.map((item) => (
            <li key={item.id}>
              <Card className="flex items-center gap-2 p-3">
                <span className="hidden md:block">
                  <Thumb url={item.imagemUrl} nome={item.descricao} size={40} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.descricao}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                    {item.sku ? (
                      <span className="font-mono">{item.sku}</span>
                    ) : (
                      <span>fora do catálogo</span>
                    )}
                    {item.estoqueAtual !== null && (
                      <>
                        <span aria-hidden>·</span>
                        <Saldo quantidade={item.estoqueAtual} />
                      </>
                    )}
                  </p>
                </div>

                {editavel && (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* O menos vai até o fim: chegando a zero, o item sai da
                        lista. Botão de lixeira ao lado seria um segundo jeito
                        de fazer a mesma coisa, no lugar onde o dedo já está. */}
                    <BotaoQtd
                      rotulo={
                        item.quantidade <= 1
                          ? `Tirar ${item.descricao} da cotação`
                          : `Menos um ${item.descricao}`
                      }
                      onClick={() => mudarQtd(item, item.quantidade - 1)}
                    >
                      {item.quantidade <= 1 ? (
                        <Trash2 className="size-4" aria-hidden />
                      ) : (
                        <Minus className="size-4" aria-hidden />
                      )}
                    </BotaoQtd>
                    <span className="w-9 text-center font-display text-base font-semibold text-ink tabular-nums">
                      {fmtQtd(item.quantidade)}
                    </span>
                    <BotaoQtd
                      rotulo={`Mais um ${item.descricao}`}
                      onClick={() => mudarQtd(item, item.quantidade + 1)}
                    >
                      <Plus className="size-4" aria-hidden />
                    </BotaoQtd>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BotaoQtd({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="grid size-9 place-items-center rounded-full border border-line-button bg-surface text-ink-2 active:bg-surface-2"
    >
      {children}
    </button>
  );
}

// ── Passo 2: fornecedores ───────────────────────────────────

function PassoFornecedores({
  cotacao,
  fornecedores,
  editavel,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  editavel: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");

  const convitePorFornecedor = new Map(cotacao.convites.map((c) => [c.supplierId, c]));

  // Marcação OTIMISTA. Antes, cada toque esperava a chamada ao servidor E o
  // `router.refresh()` para pintar o check — na rede do mercado isso é meio
  // segundo de nada acontecendo, e o operador toca de novo achando que falhou.
  //
  // `toques` guarda só o que o dedo disse. O servidor continua sendo a verdade:
  // quando a lista volta com o convite gravado, a marca local passa a dizer o
  // mesmo e deixa de ter efeito — nada para limpar depois.
  const [toques, setToques] = React.useState<Record<string, boolean>>({});
  const estaMarcado = (id: string) => toques[id] ?? convitePorFornecedor.has(id);

  // Uma fila por fornecedor: toques rápidos no mesmo cartão viram chamadas em
  // ordem, e a última é a que fica valendo.
  const filas = React.useRef(new Map<string, Promise<unknown>>());

  const visiveis = fornecedores.filter((f) =>
    f.nome.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  function alternar(f: FornecedorOpcao) {
    if (!editavel) return;
    const estava = estaMarcado(f.id);
    const desejado = !estava;
    setToques((atual) => ({ ...atual, [f.id]: desejado }));

    const anterior = filas.current.get(f.id) ?? Promise.resolve();
    const proxima = anterior
      .catch(() => {})
      .then(async () => {
        try {
          await definirConviteAction({
            quotationId: cotacao.id,
            supplierId: f.id,
            convidado: desejado,
          });
          router.refresh();
        } catch (e) {
          setToques((atual) => ({ ...atual, [f.id]: estava }));
          toast.error(
            "Não deu para mudar o convite",
            e instanceof Error ? e.message : "Tente de novo em instantes.",
          );
        }
      });
    filas.current.set(f.id, proxima);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar fornecedor"
          className="min-h-11 w-full rounded-[var(--radius)] border border-line bg-surface pr-3 pl-9 text-sm text-ink"
        />
      </div>

      {visiveis.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted">
          <Users className="mx-auto mb-2 size-6 text-faint" aria-hidden />
          Nenhum fornecedor ativo com esse nome.
        </Card>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((f) => {
            const escolhido = estaMarcado(f.id);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => alternar(f)}
                  aria-pressed={escolhido}
                  disabled={!editavel}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-m)] border p-3 text-left",
                    escolhido
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface active:bg-surface-2",
                  )}
                >
                  <SupplierAvatar nome={f.nome} logoUrl={f.logoUrl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{f.nome}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {f.telefone
                        ? f.email
                          ? `${f.telefone} · ${f.email}`
                          : f.telefone
                        : (f.email ?? "sem telefone nem e-mail")}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border",
                      escolhido
                        ? "border-transparent bg-brand text-on-brand"
                        : "border-line-button",
                    )}
                  >
                    {escolhido && <Check className="size-3.5" aria-hidden />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Passo 3: revisar e enviar ───────────────────────────────

function PassoEnviar({
  cotacao,
  editavel,
  onEnviado,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
  onEnviado: (e: Envio[]) => void;
}) {
  const router = useRouter();
  const [titulo, setTitulo] = React.useState(cotacao.titulo);
  const [prazo, setPrazo] = React.useState(
    cotacao.prazoResposta ? new Date(cotacao.prazoResposta).toISOString().slice(0, 10) : "",
  );
  const [observacao, setObservacao] = React.useState(cotacao.observacao ?? "");
  const [canais, setCanais] = React.useState<("whatsapp" | "email")[]>(["whatsapp"]);
  const [enviando, setEnviando] = React.useState(false);

  const pendentes = cotacao.convites.filter((c) => c.status === "PENDENTE");
  const semEmail = pendentes.length > 0 && pendentes.every((c) => !c.email);

  function alternarCanal(c: "whatsapp" | "email") {
    setCanais((atual) => {
      if (atual.includes(c)) return atual.length === 1 ? atual : atual.filter((x) => x !== c);
      return [...atual, c];
    });
  }

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    try {
      // Salva antes de mandar: o prazo que o fornecedor lê é o que está na
      // tela, não o que sobrou do rascunho.
      await editarCotacaoAction({
        id: cotacao.id,
        titulo: titulo.trim() || cotacao.titulo,
        prazoResposta: prazo || null,
        observacao: observacao.trim() || null,
      });
      const r = await enviarCotacaoAction({ quotationId: cotacao.id, canais });
      onEnviado(r);
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível enviar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Nome da cotação</span>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            disabled={!editavel}
            className="block h-11 w-full rounded-[var(--radius)] border border-line bg-surface px-3 text-sm text-ink"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Responder até</span>
          {/* Campo de data sem valor mostra "dd/mm/aaaa" na cor do texto e
              parece preenchido. Enquanto está vazio ele fica cinza, como
              qualquer placeholder — e ganha a mesma caixa do campo de nome. */}
          <input
            type="date"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            disabled={!editavel}
            className={cn(
              // Altura fixa + o pseudo-elemento do WebKit: no iOS/Android o miolo do
              // campo de data ancora no topo da caixa e some do meio se a altura
              // vier de padding. Com altura fixa e o valor esticado até o fim, ele
              // fica centrado igual ao campo de nome.
              "block h-11 w-full appearance-none rounded-[var(--radius)] border border-line bg-surface px-3 text-sm",
              "[&::-webkit-date-and-time-value]:h-full [&::-webkit-date-and-time-value]:text-left",
              "[&::-webkit-date-and-time-value]:leading-[2.75rem] [&::-webkit-datetime-edit]:leading-[2.75rem]",
              prazo ? "text-ink" : "text-faint",
            )}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Recado ao fornecedor <span className="text-faint">(opcional)</span>
          </span>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            disabled={!editavel}
            rows={2}
            placeholder="Ex.: entrega só de manhã"
            className="w-full resize-none rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
      </Card>

      <Card className="p-4">
        <p className="text-[13px] font-medium text-ink">
          {cotacao.itens.length} {cotacao.itens.length === 1 ? "produto" : "produtos"} para{" "}
          {cotacao.convites.length}{" "}
          {cotacao.convites.length === 1 ? "fornecedor" : "fornecedores"}
        </p>
        <ul className="mt-2 divide-y divide-line">
          {cotacao.itens.slice(0, 6).map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                {i.descricao}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-muted">
                {fmtQtd(i.quantidade)}
              </span>
            </li>
          ))}
        </ul>
        {cotacao.itens.length > 6 && (
          <p className="mt-1.5 text-[12px] text-faint">
            e mais {cotacao.itens.length - 6}{" "}
            {cotacao.itens.length - 6 === 1 ? "item" : "itens"}
          </p>
        )}
      </Card>

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink">Enviar por</p>
        <div className="flex gap-2">
          <Chip ativo={canais.includes("whatsapp")} onClick={() => alternarCanal("whatsapp")}>
            <span className="flex items-center gap-1.5">
              <MessageCircle className="size-3.5" aria-hidden />
              WhatsApp
            </span>
          </Chip>
          <Chip
            ativo={canais.includes("email")}
            onClick={() => !semEmail && alternarCanal("email")}
          >
            <span className="flex items-center gap-1.5">
              <Mail className="size-3.5" aria-hidden />
              E-mail
            </span>
          </Chip>
        </div>
        {semEmail && canais.includes("email") && (
          <p className="mt-1.5 text-[12px] text-accent">
            Nenhum dos convidados tem e-mail cadastrado — vai só pelo WhatsApp.
          </p>
        )}
      </div>

      <div className="sticky bottom-24 z-10">
        <Button
          onClick={enviar}
          disabled={!editavel || enviando || pendentes.length === 0}
          size="lg"
          className="w-full"
        >
          {enviando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {pendentes.length === 0
            ? "Todos já receberam"
            : enviando
              ? "Enviando…"
              : `Enviar para ${pendentes.length}`}
        </Button>
      </div>
    </div>
  );
}

// ── Enviada: acompanhamento ─────────────────────────────────

function Acompanhamento({
  cotacao,
  podePedir,
  onEnviado,
}: {
  cotacao: CotacaoDetalhe;
  podePedir: boolean;
  onEnviado: (e: Envio[]) => void;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [copiado, setCopiado] = React.useState<string | null>(null);

  async function copiarLink(conviteId: string) {
    setOcupado(conviteId);
    try {
      const { url } = await linkDoConviteAction(conviteId);
      await navigator.clipboard.writeText(url);
      setCopiado(conviteId);
      toast.success("Link copiado", "Cole na conversa com o fornecedor.");
    } catch (e) {
      toast.error(
        "Não deu para pegar o link",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setOcupado(null);
    }
  }

  /** Texto inteiro, com o link dentro — serve para qualquer canal. */
  async function copiarMensagem(conviteId: string) {
    setOcupado(conviteId);
    try {
      const { mensagem } = await mensagemDoConviteAction(conviteId);
      await navigator.clipboard.writeText(mensagem);
      setCopiado(conviteId);
      toast.success("Mensagem copiada", "Cole onde quiser mandar.");
    } catch (e) {
      toast.error(
        "Não deu para montar a mensagem",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setOcupado(null);
    }
  }

  async function reenviar(conviteId: string) {
    setOcupado(conviteId);
    try {
      const r = await enviarCotacaoAction({
        quotationId: cotacao.id,
        conviteIds: [conviteId],
        canais: ["whatsapp"],
        reenviar: true,
      });
      onEnviado(r);
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível reenviar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setOcupado(null);
    }
  }

  if (cotacao.convites.length === 0) {
    return (
      <Card className="p-6 text-center text-[13px] text-muted">
        Nenhum fornecedor nesta cotação.
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {cotacao.convites.map((c) => (
        <li key={c.id}>
          <Card className="p-3">
            <div className="flex items-center gap-3">
              <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{c.supplierNome}</p>
                <p className="truncate text-[12px] text-muted">{situacao(c, cotacao)}</p>
              </div>
              <SinalConvite convite={c} />
            </div>

            {podePedir && c.status !== "RESPONDIDA" && c.status !== "RECUSADA" && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => copiarLink(c.id)}
                  disabled={ocupado === c.id || c.status === "PENDENTE"}
                  className="flex min-h-9 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                >
                  {copiado === c.id ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <LinkIcon className="size-3.5" aria-hidden />
                  )}
                  {copiado === c.id ? "Copiado" : "Copiar link"}
                </button>
                <button
                  type="button"
                  onClick={() => copiarMensagem(c.id)}
                  disabled={ocupado === c.id || c.status === "PENDENTE"}
                  className="flex min-h-9 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                >
                  <Copy className="size-3.5" aria-hidden />
                  Copiar mensagem
                </button>
                <button
                  type="button"
                  onClick={() => reenviar(c.id)}
                  disabled={ocupado === c.id}
                  className="flex min-h-9 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                >
                  {ocupado === c.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  {c.status === "PENDENTE" ? "Enviar" : "Reenviar"}
                </button>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Uma linha que diz onde a conversa parou. */
function situacao(c: ConviteCotacao, cotacao: CotacaoDetalhe): string {
  if (c.status === "RESPONDIDA") {
    return `respondeu ${c.itensAtendidos} de ${cotacao.itens.length} itens`;
  }
  if (c.status === "RECUSADA") return c.observacao ?? "não vai cotar";
  if (c.status === "PENDENTE") return "ainda não recebeu a lista";
  return c.abertoEm ? "abriu o link e não respondeu" : "recebeu e ainda não abriu";
}

function SinalConvite({ convite }: { convite: ConviteCotacao }) {
  if (convite.status === "RESPONDIDA") {
    return (
      <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-semibold text-ok uppercase">
        Respondeu
      </span>
    );
  }
  if (convite.status === "RECUSADA") {
    return (
      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-faint uppercase">
        Recusou
      </span>
    );
  }
  if (convite.abertoEm) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent uppercase">
        <Eye className="size-3" aria-hidden />
        Viu
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand uppercase">
      {convite.status === "PENDENTE" ? "Não enviado" : "Aguardando"}
    </span>
  );
}

// ── Mensagens prontas ───────────────────────────────────────
// Sem gateway de WhatsApp, quem dispara é a pessoa. O sistema entrega o texto
// com o link dentro e um botão que abre a conversa certa.

function EnviosSheetMobile({
  envios,
  onFechar,
}: {
  envios: Envio[] | null;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = React.useState<string | null>(null);

  return (
    <BottomSheet
      open={envios !== null}
      onClose={onFechar}
      titulo="Mande para os fornecedores"
      descricao="O link é o mesmo em qualquer canal — o fornecedor abre no celular dele e preenche os preços, sem cadastro."
      rodape={
        <Button onClick={onFechar} variant="secondary" size="lg" className="w-full">
          Fechar
        </Button>
      }
    >
      <ul className="space-y-2">
        {(envios ?? []).map((e) => (
          <li key={e.conviteId}>
            <Card className="space-y-2 p-3">
              <p className="truncate text-sm font-medium text-ink">{e.fornecedor}</p>

              {e.email.estado !== "nao-pedido" && (
                <p
                  className={cn(
                    "text-[12px]",
                    e.email.estado === "enviado" ? "text-ok" : "text-accent",
                  )}
                >
                  {e.email.estado === "enviado"
                    ? `E-mail enviado para ${e.email.endereco}`
                    : e.email.estado === "sem-endereco"
                      ? "Sem e-mail cadastrado"
                      : "O e-mail falhou — use o link abaixo"}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {e.waLink && (
                  <a
                    href={e.waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-9 items-center gap-1.5 rounded-full bg-brand px-3 text-[12px] font-semibold text-on-brand"
                  >
                    <MessageCircle className="size-3.5" aria-hidden />
                    WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(e.mensagem);
                    setCopiado(e.conviteId);
                  }}
                  className="flex min-h-9 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2"
                >
                  <Copy className="size-3.5" aria-hidden />
                  {copiado === e.conviteId ? "Copiado" : "Copiar mensagem"}
                </button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
