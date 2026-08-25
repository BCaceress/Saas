"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Mail,
  Package,
  Link as LinkIcon,
  Loader2,
  Lock,
  MessageCircle,
  Minus,
  Plus,
  ScanLine,
  Search,
  Send,
  Star,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { maskPhone } from "@/lib/masks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { Chip } from "@/components/mobile/acao-estoque";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { SupplierAvatar, Thumb } from "@/app/(app)/cotacoes/_ui";
import type {
  ContatoConvite,
  ConviteCotacao,
  CotacaoDetalhe,
  FornecedorOpcao,
} from "@/app/(app)/cotacoes/_compra-types";
import { andamento, statusVisivel } from "@/app/(app)/cotacoes/_status";
import { regrasDaCotacao } from "@/lib/compras/cotacao-regras";
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
  mensagensDaCotacaoAction,
  removerItemAction,
  type MensagemPronta,
  type ProdutoCotacao,
} from "@/app/(app)/cotacoes/_compra-actions";
import { ComparativoCotacao } from "@/app/(app)/cotacoes/[id]/_comparativo";
import type { ResumoCotacao } from "@/lib/compras/cotacao-resumo";
import type { PedidoDaCotacao } from "@/lib/compras/cotacao-economia";

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
  resumo,
  pedidos,
  podePedir,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  /** Leitura da cotação — mesmo motor determinístico do desktop. */
  resumo: ResumoCotacao;
  /** Pedidos que a cotação virou. Vazio até ela ser decidida. */
  pedidos: PedidoDaCotacao[];
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
  const [aba, setAba] = React.useState<"itens" | "fornecedores" | "comparar">(
    cotacao.convites.some((c) => c.status === "RESPONDIDA") ? "comparar" : "fornecedores",
  );
  const [envios, setEnvios] = React.useState<Envio[] | null>(null);

  const respondidos = cotacao.convites.filter((c) => c.status === "RESPONDIDA").length;
  const recusados = cotacao.convites.filter((c) => c.status === "RECUSADA").length;
  // Mesma régua do servidor: depois da primeira resposta a lista congela.
  const regras = regrasDaCotacao(cotacao.status, cotacao.convites);
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
          {/* Quem abre uma cotação decidida no celular está atrás de uma
              pergunta só: "em que pedido isso foi parar?". Estava dentro do
              comparativo; com o totalizador removido de lá, sobe para cá. */}
          {pedidos.length > 0 && (
            <section className="rounded-[var(--radius-lg)] border border-ok/40 bg-ok-soft px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ok">
                {pedidos.length === 1 ? "Pedido gerado" : `${pedidos.length} pedidos gerados`}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {pedidos.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/m/pedidos?pedido=${p.id}`}
                      className="flex items-center gap-2 rounded-full border border-ok/30 bg-surface px-2.5 py-1"
                    >
                      <span className="font-mono text-[13px] font-semibold text-ink">
                        {p.numero}
                      </span>
                      <span className="max-w-[8rem] truncate text-[11px] text-muted">
                        {p.supplierNome}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* A lista de itens some depois do envio, e ela é justamente o que
              o operador quer conferir no corredor ("o que foi que eu pedi?").
              Fica como aba, com a mesma régua de edição do servidor. */}
          <div className="flex gap-2 overflow-x-auto">
            <Chip ativo={aba === "itens"} onClick={() => setAba("itens")}>
              Itens ({cotacao.itens.length})
            </Chip>
            <Chip ativo={aba === "fornecedores"} onClick={() => setAba("fornecedores")}>
              Fornecedores ({cotacao.convites.length})
            </Chip>
            <Chip ativo={aba === "comparar"} onClick={() => setAba("comparar")}>
              Comparar ({respondidos})
            </Chip>
          </div>

          {aba === "itens" && (
            <PassoProdutos
              cotacao={cotacao}
              editavel={podePedir && regras.itens.pode}
              travado={podePedir && !regras.itens.pode ? regras.itens.motivo : null}
            />
          )}
          {aba === "fornecedores" && (
            <Acompanhamento
              cotacao={cotacao}
              podePedir={podePedir}
              onEnviado={setEnvios}
            />
          )}
          {aba === "comparar" && (
            <ComparativoCotacao
              cotacao={cotacao}
              resumo={resumo}
              podePedir={podePedir}
            />
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

  // Mesma régua do servidor: um rascunho pode ter resposta registrada à mão
  // (alguém ligou e passou preço pelo desktop). A partir daí a lista congela,
  // aqui também — senão o celular oferece um botão que a Server Action recusa.
  const regras = regrasDaCotacao(cotacao.status, cotacao.convites);

  // A seleção de fornecedor mora AQUI, e não dentro do passo, porque o botão
  // "Continuar" depende dela: preso à lista do servidor, ele só destravava
  // depois do refresh — meio segundo depois do toque, parecendo travado.
  const [toques, setToques] = React.useState<Record<string, boolean>>({});
  const convidados = new Set(cotacao.convites.map((c) => c.supplierId));
  const escolhidos = fornecedores.filter((f) => toques[f.id] ?? convidados.has(f.id)).length;

  // Mesma história do lado dos itens: a lista do passo 1 é otimista, então o
  // "Continuar" precisa contar o que está NA TELA. Preso à lista do servidor,
  // ele seguia dizendo "Adicione um produto" com três produtos já na lista.
  const [itensNaTela, setItensNaTela] = React.useState<number | null>(null);

  // Quantos ainda vão receber depois que as gravações do passo 2 chegarem. Sem
  // isso o botão do passo 3 nascia "Todos já receberam" no mesmo segundo em
  // que o operador escolheu o primeiro fornecedor.
  const pendentesServidor = cotacao.convites.filter((c) => c.status === "PENDENTE");
  const pendentesPrevistos = Math.max(
    0,
    fornecedores.reduce((n, f) => {
      const tocado = toques[f.id];
      if (tocado === undefined) return n;
      if (tocado && !convidados.has(f.id)) return n + 1;
      if (!tocado && pendentesServidor.some((c) => c.supplierId === f.id)) return n - 1;
      return n;
    }, pendentesServidor.length),
  );

  const feito = {
    produtos: (itensNaTela ?? cotacao.itens.length) > 0,
    fornecedores: escolhidos > 0,
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

      {passo === "produtos" && (
        <PassoProdutos
          cotacao={cotacao}
          editavel={podePedir && regras.itens.pode}
          travado={podePedir && !regras.itens.pode ? regras.itens.motivo : null}
          onContagem={setItensNaTela}
        />
      )}
      {passo === "fornecedores" && (
        <PassoFornecedores
          cotacao={cotacao}
          fornecedores={fornecedores}
          editavel={podePedir && regras.convidar.pode}
          toques={toques}
          onToques={setToques}
        />
      )}
      {passo === "enviar" && (
        <PassoEnviar
          cotacao={cotacao}
          editavel={podePedir}
          pendentesPrevistos={pendentesPrevistos}
          onEnviado={onEnviado}
        />
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
  travado,
  onContagem,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
  /** Por que a lista congelou, para quem TERIA permissão de mexer nela. */
  travado?: string | null;
  /** Quantos itens estão na tela agora — é o que destrava o "Continuar" no
   *  trilho do rascunho. A aba de itens da cotação enviada não usa. */
  onContagem?: (n: number) => void;
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

  // O trilho decide o "Continuar" pela contagem da TELA, não pela do servidor.
  React.useEffect(() => {
    onContagem?.(itens.length);
  }, [itens.length, onContagem]);

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
      {travado && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
          {travado}
        </p>
      )}

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

                {!editavel && (
                  <span className="shrink-0 font-display text-base font-semibold text-ink tabular-nums">
                    {fmtQtd(item.quantidade)}
                  </span>
                )}

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
  toques,
  onToques,
}: {
  cotacao: CotacaoDetalhe;
  fornecedores: FornecedorOpcao[];
  editavel: boolean;
  /** O que o dedo já disse, por fornecedor — estado do trilho, não do passo. */
  toques: Record<string, boolean>;
  onToques: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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
    onToques((atual) => ({ ...atual, [f.id]: desejado }));

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
          onToques((atual) => ({ ...atual, [f.id]: estava }));
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
            const contato = resumoContato(f);
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
                    <span
                      className={cn(
                        "block truncate text-[12px]",
                        contato ? "text-muted" : "text-accent",
                      )}
                    >
                      {contato ?? "sem contato — cadastre alguém para enviar"}
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

/**
 * Quem receberia a cotação neste fornecedor. É o que decide se dá para
 * convidar: o telefone da empresa não serve — cotação vai para uma pessoa.
 * Null = ninguém alcançável cadastrado.
 */
function resumoContato(f: FornecedorOpcao): string | null {
  const alcancavel = (c: ContatoConvite) => Boolean(c.telefone?.trim() || c.email?.trim());
  const contato =
    f.contatos.find((c) => c.principal && alcancavel(c)) ?? f.contatos.find(alcancavel);
  if (!contato) return null;
  return [contato.nome, contato.telefone ? maskPhone(contato.telefone) : contato.email]
    .filter(Boolean)
    .join(" · ");
}

// ── Passo 3: revisar e enviar ───────────────────────────────

function PassoEnviar({
  cotacao,
  editavel,
  pendentesPrevistos,
  onEnviado,
}: {
  cotacao: CotacaoDetalhe;
  editavel: boolean;
  /** Quantos vão receber contando os toques do passo 2 que ainda não voltaram
   *  do servidor. É o número que o botão mostra — e o que decide se ele vive. */
  pendentesPrevistos: number;
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
  const destinos = pendentes.map((c) => ({ c, d: destinatarioDoConvite(c, undefined) }));
  const semEmail = destinos.length > 0 && destinos.every((x) => !x.d.email);
  // Fornecedor sem ninguém cadastrado não tem para onde receber, e a Server
  // Action recusa o lote inteiro. Melhor dizer aqui, com o nome de quem falta,
  // do que deixar o operador tocar em "Enviar" e levar um erro seco.
  const semContato = destinos
    .filter((x) => !x.d.telefone && !x.d.email)
    .map((x) => x.c.supplierNome);

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
            Nenhum dos fornecedores tem e-mail cadastrado — vai só pelo WhatsApp.
          </p>
        )}
      </div>

      {semContato.length > 0 && (
        <p className="text-[12px] text-accent">
          Sem contato cadastrado: {semContato.join(", ")}. A cotação vai para uma pessoa —
          cadastre alguém com WhatsApp ou e-mail no fornecedor.
        </p>
      )}

      <div className="sticky bottom-24 z-10">
        <Button
          onClick={enviar}
          disabled={!editavel || enviando || pendentesPrevistos === 0 || semContato.length > 0}
          size="lg"
          className="w-full"
        >
          {enviando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {pendentesPrevistos === 0
            ? "Todos já receberam"
            : enviando
              ? "Enviando…"
              : `Enviar para ${pendentesPrevistos}`}
        </Button>
      </div>
    </div>
  );
}

// ── Enviada: acompanhamento ─────────────────────────────────

/** Ação de um cartão de fornecedor. Cada uma gira no próprio botão. */
type Acao = "link" | "mensagem" | "reenviar" | "whatsapp" | "email";

/** Teto do corpo de um mailto. Acima disso vários apps de e-mail cortam a URL
 *  no meio e a lista chega picada — melhor mandar o link e copiar o resto. */
const LIMITE_MAILTO = 1500;

/**
 * Quem, dentro do fornecedor, recebe este convite — mesma precedência do
 * servidor: escolha da tela → contato gravado no convite → principal →
 * primeiro alcançável. Sem contato NÃO há destino: o telefone da empresa é do
 * fiscal ou um 0800, e cotação mandada para lá some.
 */
function destinatarioDoConvite(
  c: ConviteCotacao,
  escolhido: string | null | undefined,
): { contato: ContatoConvite | null; telefone: string | null; email: string | null } {
  const alcancavel = (x: ContatoConvite) => Boolean(x.telefone?.trim() || x.email?.trim());
  const contato =
    (escolhido ? c.contatos.find((x) => x.id === escolhido) : undefined) ??
    (c.contatoId ? c.contatos.find((x) => x.id === c.contatoId) : undefined) ??
    c.contatos.find((x) => x.principal && alcancavel(x)) ??
    c.contatos.find(alcancavel) ??
    null;
  return contato
    ? { contato, telefone: contato.telefone, email: contato.email }
    : { contato: null, telefone: null, email: null };
}

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
  /** Qual botão de qual cartão está rodando — o giro precisa nascer no botão
   *  que o dedo tocou, senão parece que outra coisa começou a acontecer. */
  const [ocupado, setOcupado] = React.useState<{ id: string; acao: Acao } | null>(null);
  const [copiado, setCopiado] = React.useState<{ id: string; acao: Acao } | null>(null);
  /** Para quem mandar, por convite. Chave ausente = a precedência de sempre. */
  const [escolhas, setEscolhas] = React.useState<Record<string, string>>({});
  const [trocando, setTrocando] = React.useState<string | null>(null);
  /** Mensagens já montadas, por `conviteId:contactId`. Com o texto em mãos o
   *  toque no WhatsApp navega na hora, sem round-trip no meio do gesto. */
  const [prontas, setProntas] = React.useState<Record<string, MensagemPronta>>({});

  // Recarrega quando algum convite é enviado de novo: reenvio troca o token e
  // o link guardado aqui morre na hora.
  const assinatura = cotacao.convites.map((c) => `${c.id}:${c.enviadaEm ?? ""}`).join("|");
  React.useEffect(() => {
    let vivo = true;
    void mensagensDaCotacaoAction(cotacao.id)
      .then((lista) => {
        if (!vivo) return;
        setProntas((atual) => {
          const novo = { ...atual };
          for (const p of lista) novo[`${p.conviteId}:${p.contactId ?? ""}`] = p;
          return novo;
        });
      })
      .catch(() => {
        // Sem cache o toque cai no caminho lento — não é erro para mostrar.
      });
    return () => {
      vivo = false;
    };
  }, [cotacao.id, assinatura]);

  const rodando = (id: string, acao: Acao) =>
    ocupado?.id === id && ocupado.acao === acao;
  const copiou = (id: string, acao: Acao) => copiado?.id === id && copiado.acao === acao;

  async function copiarLink(conviteId: string) {
    setOcupado({ id: conviteId, acao: "link" });
    try {
      const { url } = await linkDoConviteAction(conviteId);
      if (!(await copiarTexto(url))) {
        toast.info("Copie manualmente", url);
        return;
      }
      setCopiado({ id: conviteId, acao: "link" });
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
    setOcupado({ id: conviteId, acao: "mensagem" });
    try {
      const { mensagem } = await mensagemDoConviteAction(conviteId);
      if (!(await copiarTexto(mensagem))) {
        toast.info("Copie manualmente", mensagem);
        return;
      }
      setCopiado({ id: conviteId, acao: "mensagem" });
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

  /**
   * Abre o WhatsApp ou o app de e-mail com a mensagem pronta e o destinatário
   * preenchido — o que faltava no celular, onde copiar e colar entre dois apps
   * é justamente o trabalho que ninguém faz na frente da gôndola.
   *
   * A navegação é na MESMA aba de propósito: `window.open` depois de um await
   * perde o gesto do usuário e morre no bloqueador de pop-up do celular.
   */
  function navegar(p: MensagemPronta, canal: "whatsapp" | "email") {
    if (canal === "whatsapp") {
      if (!p.waLink) {
        toast.info("Sem WhatsApp", "Este contato não tem telefone cadastrado.");
        return;
      }
      window.location.assign(p.waLink);
      return;
    }
    if (!p.email) {
      toast.info("Sem e-mail", "Este contato não tem e-mail cadastrado.");
      return;
    }
    // Corpo longo estoura o limite de URL de vários apps de e-mail e a lista
    // chega picada. Passando do teto, o e-mail leva o link — que é o que
    // interessa — e o texto inteiro vai para a área de transferência.
    const cortar = p.mensagem.length > LIMITE_MAILTO;
    const corpo = cortar
      ? `Pedido de cotação ${cotacao.numero} — ${cotacao.titulo}.

É só preencher os preços aqui (não precisa cadastro):
${p.link}`
      : p.mensagem;
    if (cortar) {
      void copiarTexto(p.mensagem);
      toast.info("Lista copiada", "O e-mail leva o link; cole a lista se quiser mandar junto.");
    }
    const assunto = `Cotação ${cotacao.numero} — ${cotacao.titulo}`;
    window.location.assign(
      `mailto:${p.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`,
    );
  }

  /** Monta a mensagem daquele contato ANTES de o dedo precisar dela — trocar
   *  de contato é o único caso que o lote inicial não cobre. */
  function preparar(conviteId: string, contactId: string | null) {
    const chave = `${conviteId}:${contactId ?? ""}`;
    if (prontas[chave]) return;
    void mensagemDoConviteAction(conviteId, contactId)
      .then((r) =>
        setProntas((a) => ({
          ...a,
          [chave]: {
            conviteId,
            contactId,
            contato: r.contato,
            telefone: r.telefone,
            email: r.email,
            mensagem: r.mensagem,
            link: r.link,
            waLink: r.waLink,
          },
        })),
      )
      .catch(() => {
        // Cache é conforto: sem ele o toque cai no caminho lento e funciona.
      });
  }

  /**
   * Abre o app com a mensagem pronta. Com o texto em cache — o caso comum — a
   * navegação sai no MESMO gesto do toque: nada de esperar o servidor com o
   * dedo já fora do botão.
   */
  function abrir(c: ConviteCotacao, canal: "whatsapp" | "email", contactId: string | null) {
    const chave = `${c.id}:${contactId ?? ""}`;
    const pronta = prontas[chave];
    if (pronta) {
      navegar(pronta, canal);
      return;
    }
    setOcupado({ id: c.id, acao: canal });
    void (async () => {
      try {
        const r = await mensagemDoConviteAction(c.id, contactId);
        const nova: MensagemPronta = {
          conviteId: c.id,
          contactId,
          contato: r.contato,
          telefone: r.telefone,
          email: r.email,
          mensagem: r.mensagem,
          link: r.link,
          waLink: r.waLink,
        };
        setProntas((a) => ({ ...a, [chave]: nova }));
        navegar(nova, canal);
      } catch (e) {
        toast.error(
          "Não deu para abrir o app",
          e instanceof Error ? e.message : "Tente de novo em instantes.",
        );
      } finally {
        setOcupado(null);
      }
    })();
  }

  async function reenviar(conviteId: string) {
    setOcupado({ id: conviteId, acao: "reenviar" });
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
      {cotacao.convites.map((c) => {
        const escolhido = c.id in escolhas ? escolhas[c.id] : undefined;
        const d = destinatarioDoConvite(c, escolhido);
        const aberto = trocando === c.id;
        const podeAgir = podePedir && c.status !== "RESPONDIDA" && c.status !== "RECUSADA";
        // Antes do primeiro envio não existe link para colocar na mensagem.
        const jaSaiu = c.status !== "PENDENTE";

        return (
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

              {podeAgir && (
                <div className="mt-2.5 flex items-center gap-2 rounded-[var(--radius)] bg-surface-2 px-2.5 py-2">
                  <UserRound className="size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {d.contato ? (
                      <>
                        <span className="flex items-center gap-1">
                          <span className="truncate text-[13px] font-medium text-ink">
                            {d.contato.nome}
                          </span>
                          {d.contato.principal && (
                            <Star
                              className="size-3 shrink-0 fill-accent text-accent"
                              aria-label="Contato principal"
                            />
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted">
                          {[d.contato.cargo, d.telefone ? maskPhone(d.telefone) : null, d.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    ) : (
                      <span className="block truncate text-[12px] text-accent">
                        Sem contato — cadastre alguém no fornecedor para enviar
                      </span>
                    )}
                  </span>
                  {c.contatos.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTrocando(aberto ? null : c.id)}
                      aria-expanded={aberto}
                      className="min-h-9 shrink-0 rounded-full px-2 text-[12px] font-medium text-brand"
                    >
                      {aberto ? "Fechar" : "Trocar"}
                    </button>
                  )}
                </div>
              )}

              {podeAgir && aberto && (
                <ul className="mt-1.5 space-y-1">
                  {c.contatos.map((ct) => (
                    <li key={ct.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setEscolhas((e) => ({ ...e, [c.id]: ct.id }));
                          setTrocando(null);
                          preparar(c.id, ct.id);
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2 rounded-[var(--radius)] border px-2.5 text-left",
                          d.contato?.id === ct.id ? "border-brand bg-brand-soft" : "border-line",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{ct.nome}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {[ct.cargo, ct.telefone ? maskPhone(ct.telefone) : null, ct.email]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {d.contato?.id === ct.id && (
                          <Check className="size-3.5 shrink-0 text-brand" aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {podeAgir && (
                <div className="-mx-3 mt-2.5 flex gap-1.5 overflow-x-auto px-3">
                  {/* Ação principal do cartão — laranja do sistema, como
                      qualquer outra ação que move a cotação adiante. */}
                  <button
                    type="button"
                    onClick={() => abrir(c, "whatsapp", d.contato?.id ?? null)}
                    disabled={ocupado !== null || !jaSaiu || !d.telefone}
                    className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 text-[12px] font-semibold text-on-brand active:bg-brand-strong disabled:opacity-50"
                  >
                    {rodando(c.id, "whatsapp") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <MessageCircle className="size-3.5" aria-hidden />
                    )}
                    WhatsApp
                  </button>
                  {d.email && (
                    <button
                      type="button"
                      onClick={() => abrir(c, "email", d.contato?.id ?? null)}
                      disabled={ocupado !== null || !jaSaiu}
                      className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                    >
                      {rodando(c.id, "email") ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Mail className="size-3.5" aria-hidden />
                      )}
                      E-mail
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => copiarLink(c.id)}
                    disabled={ocupado !== null || !jaSaiu}
                    className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                  >
                    {rodando(c.id, "link") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : copiou(c.id, "link") ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <LinkIcon className="size-3.5" aria-hidden />
                    )}
                    {copiou(c.id, "link") ? "Copiado" : "Copiar link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copiarMensagem(c.id)}
                    disabled={ocupado !== null || !jaSaiu}
                    className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                  >
                    {rodando(c.id, "mensagem") ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : copiou(c.id, "mensagem") ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {copiou(c.id, "mensagem") ? "Copiada" : "Copiar mensagem"}
                  </button>
                  {c.status === "PENDENTE" && (
                    <button
                      type="button"
                      onClick={() => reenviar(c.id)}
                      disabled={ocupado !== null}
                      className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-button px-3 text-[12px] font-medium text-ink-2 active:bg-surface-2 disabled:opacity-50"
                    >
                      {rodando(c.id, "reenviar") ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Send className="size-3.5" aria-hidden />
                      )}
                      Enviar
                    </button>
                  )}
                </div>
              )}
            </Card>
          </li>
        );
      })}
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
      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent uppercase">
        Visualizou
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
              {/* Quem recebeu, e não só onde: no celular é o dado que o
                  comprador confere antes de apertar "WhatsApp". */}
              {e.contato && (
                <p className="-mt-1 truncate text-[12px] text-muted">para {e.contato.nome}</p>
              )}

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
                    void copiarTexto(e.mensagem).then((ok) => setCopiado(ok ? e.conviteId : null));
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
