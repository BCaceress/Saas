"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Loader2,
  Monitor,
  Scale,
  ShoppingCart,
  Tag,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn, brl } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { TecladoNumerico, paraNumero } from "@/components/mobile/teclado-numerico";
import { AcaoEstoqueSheet, Chip, type Acao } from "@/components/mobile/acao-estoque";
import { useFilaEtiquetas } from "@/components/mobile/fila-etiquetas";
import {
  alterarPrecoAction,
  contextoAcoesAction,
  criarPedidoDoScannerAction,
  type ContextoAcoes,
} from "@/app/(mobile)/m/acoes/actions";
import type { FichaProduto } from "@/app/(mobile)/m/_produto-data";

/**
 * O que dá para fazer com o produto que acabou de ser lido.
 *
 * Esta barra é a razão de o scanner existir: antes dela, bipar respondia "é
 * isto aqui" e a pessoa tinha de ir ao computador para agir. A ordem das ações
 * é a frequência real na gôndola — mudar preço e dar baixa em quebra vêm antes
 * de pedir ao fornecedor.
 *
 * Permissão: a barra esconde o que a pessoa não pode, mas quem autoriza de fato
 * é a server action de cada ação. Esconder é conforto, não segurança.
 */

type Ferramenta = {
  chave: "preco" | "perda" | "ajuste" | "transferencia" | "etiqueta" | "pedir";
  label: string;
  icone: LucideIcon;
  visivel: (c: ContextoAcoes, f: FichaProduto) => boolean;
};

const FERRAMENTAS: Ferramenta[] = [
  { chave: "preco", label: "Preço", icone: Tag, visivel: (c) => c.podePreco },
  {
    chave: "perda",
    label: "Perda",
    icone: TriangleAlert,
    visivel: (c, f) => c.podeAjustar && f.controlaEstoque,
  },
  {
    chave: "ajuste",
    label: "Ajustar",
    icone: Scale,
    visivel: (c, f) => c.podeAjustar && f.controlaEstoque,
  },
  {
    chave: "transferencia",
    label: "Transferir",
    icone: ArrowLeftRight,
    // Uma loja só: não há para onde transferir, e o botão seria um beco.
    visivel: (c, f) => c.podeTransferir && f.controlaEstoque && c.sites.length > 1,
  },
  { chave: "etiqueta", label: "Etiqueta", icone: Tag, visivel: (c) => c.podePreco },
  { chave: "pedir", label: "Pedir", icone: ShoppingCart, visivel: (c) => c.podePedir },
];

/** Sheet já aberta ao montar, com campos preenchidos — vem do ditado por voz. */
export type AcaoInicial = {
  chave: Ferramenta["chave"];
  quantidade?: string;
  preco?: string;
  motivo?: string;
};

export function AcoesProduto({
  ficha,
  inicial,
  onAtualizar,
}: {
  ficha: FichaProduto;
  inicial?: AcaoInicial | null;
  /** Chamado depois de uma escrita — a tela recarrega a ficha se quiser. */
  onAtualizar?: () => void;
}) {
  const [ctx, setCtx] = React.useState<ContextoAcoes | null>(null);
  const [aberta, setAberta] = React.useState<Ferramenta["chave"] | null>(
    inicial?.chave ?? null,
  );
  const fila = useFilaEtiquetas();

  // Um comando de voz novo troca a sheet aberta: o gesto anterior foi
  // substituído, não empilhado. É ajuste de estado DURANTE o render (o padrão
  // do React para "derivar de uma prop que mudou") — num efeito seria um render
  // a mais, com a sheet antiga piscando antes da nova.
  const [inicialVisto, setInicialVisto] = React.useState(inicial);
  if (inicial !== inicialVisto) {
    setInicialVisto(inicial);
    if (inicial) setAberta(inicial.chave);
  }

  // Uma viagem por montagem da barra, não por bipe: o resultado é o mesmo para
  // qualquer produto (lojas e permissões da pessoa).
  React.useEffect(() => {
    let vivo = true;
    contextoAcoesAction()
      .then((c) => vivo && setCtx(c))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const alvo = {
    productId: ficha.id,
    nome: ficha.nome,
    sku: ficha.sku,
    unidadeBase: ficha.unidadeBase,
    estoqueFechado: ficha.totalFechado,
  };

  function concluir(mensagem: string) {
    setAberta(null);
    toast.success("Pronto", mensagem);
    onAtualizar?.();
  }

  const visiveis = ctx ? FERRAMENTAS.filter((f) => f.visivel(ctx, ficha)) : [];

  return (
    <div className="space-y-2">
      {visiveis.length > 0 && (
        // 3 colunas: quatro alvos por linha ficariam menores que o polegar num
        // aparelho de 360px.
        <div className="grid grid-cols-3 gap-2">
          {visiveis.map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => {
                if (f.chave === "etiqueta") {
                  const total = fila.adicionar({
                    productId: ficha.id,
                    nome: ficha.nome,
                    sku: ficha.sku,
                  });
                  toast.success(
                    "Na fila de etiquetas",
                    `${ficha.nome} · ${total} ${total === 1 ? "produto" : "produtos"} para imprimir.`,
                  );
                  return;
                }
                setAberta(f.chave);
              }}
              className={cn(
                "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl",
                "border border-line-button bg-surface text-[13px] font-medium text-ink",
                "active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
              )}
            >
              <f.icone className="h-5 w-5 text-ink-2" aria-hidden />
              {f.label}
            </button>
          ))}
        </div>
      )}

      <Link
        href={`/produtos/${ficha.id}/editar`}
        className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-button bg-surface text-sm font-medium text-ink"
      >
        Abrir cadastro completo
        <Monitor className="h-3.5 w-3.5 text-faint" aria-label="Abre na versão de computador" />
      </Link>

      {ctx && (aberta === "perda" || aberta === "ajuste" || aberta === "transferencia") && (
        <AcaoEstoqueSheet
          alvo={alvo}
          acao={aberta as Acao}
          sites={ctx.sites}
          siteAtivo={ctx.siteAtivo}
          quantidadeInicial={inicial?.chave === aberta ? inicial.quantidade : undefined}
          motivoInicial={inicial?.chave === aberta ? inicial.motivo : undefined}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}

      {aberta === "preco" && (
        <PrecoSheet
          ficha={ficha}
          valorInicial={inicial?.chave === "preco" ? inicial.preco : undefined}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}

      {ctx && aberta === "pedir" && (
        <PedirSheet
          ficha={ficha}
          siteAtivo={ctx.siteAtivo}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}
    </div>
  );
}

// ── Preço ───────────────────────────────────────────────────

/**
 * Trocar preço é a ação mais rápida do app: um número e confirmar.
 *
 * A margem aparece ENQUANTO se digita, não depois de salvar — é o único jeito
 * de a pessoa perceber que ia vender abaixo do custo antes de a etiqueta ir
 * para a prateleira.
 */
function PrecoSheet({
  ficha,
  valorInicial,
  onFechar,
  onConcluir,
}: {
  ficha: FichaProduto;
  valorInicial?: string;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const [valor, setValor] = React.useState(valorInicial ?? "");
  const [salvando, setSalvando] = React.useState(false);

  const preco = paraNumero(valor);
  const custo = ficha.custoMedio;
  const margem = custo != null && custo > 0 && preco > 0 ? ((preco - custo) / preco) * 100 : null;
  const abaixoDoCusto = custo != null && preco > 0 && preco < custo;

  async function salvar() {
    if (preco <= 0 || salvando) return;
    setSalvando(true);
    try {
      const r = await alterarPrecoAction({ productId: ficha.id, preco });
      onConcluir(
        `${r.nome} agora custa ${brl(r.preco)}${
          r.margemPct != null ? ` · margem ${r.margemPct.toFixed(1)}%` : ""
        }.`,
      );
    } catch (e) {
      toast.error(
        "Não foi possível salvar o preço",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Alterar preço"
      descricao={
        <span className="line-clamp-1">
          {ficha.nome} · <span className="font-mono text-xs">{ficha.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={preco <= 0 || salvando} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar preço
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            <span className="mr-1 text-base font-normal text-muted">R$</span>
            {valor === "" ? "0,00" : valor}
          </p>
          <p className="mt-1 text-xs text-muted">
            hoje: {ficha.precoVenda == null ? "sem preço" : brl(ficha.precoVenda)}
            {custo != null && ` · custo ${brl(custo)}`}
          </p>
        </div>

        {margem != null && (
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-center text-[13px] font-medium",
              abaixoDoCusto
                ? "bg-danger-soft text-danger"
                : margem < 10
                  ? "bg-warn-soft text-warn"
                  : "bg-ok-soft text-ok",
            )}
          >
            {abaixoDoCusto
              ? `Abaixo do custo — prejuízo de ${brl(custo! - preco)} por unidade.`
              : `Margem de ${margem.toFixed(1)}% · ${brl(preco - custo!)} por unidade.`}
          </p>
        )}

        <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />
      </div>
    </BottomSheet>
  );
}

// ── Pedir ao fornecedor ─────────────────────────────────────

const ATALHOS_QTD = [6, 12, 24, 48];

/**
 * Pedido de um item só, direto da gôndola.
 *
 * Já vem com a sugestão da estratégia de estoque da empresa (`cobertura.sugestao`,
 * calculada em lib/estoque-estrategia): quem está de pé na frente do buraco na
 * prateleira não deveria ter de calcular quanto falta para o alvo.
 */
function PedirSheet({
  ficha,
  siteAtivo,
  onFechar,
  onConcluir,
}: {
  ficha: FichaProduto;
  siteAtivo: string | null;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const sugestao = ficha.cobertura?.sugestao ?? 0;
  const [valor, setValor] = React.useState(sugestao > 0 ? String(Math.ceil(sugestao)) : "");
  const [salvando, setSalvando] = React.useState(false);

  const qtd = paraNumero(valor);

  async function salvar() {
    if (qtd <= 0 || salvando) return;
    setSalvando(true);
    try {
      const r = await criarPedidoDoScannerAction({
        siteId: siteAtivo,
        enviar: false,
        itens: [{ productId: ficha.id, quantidade: qtd, supplierId: null }],
      });
      if (r.semFornecedor.length > 0) {
        toast.error(
          "Sem fornecedor cadastrado",
          `${ficha.nome} não tem fornecedor vinculado — cadastre um antes de pedir.`,
        );
        setSalvando(false);
        return;
      }
      const pedido = r.criados[0];
      onConcluir(
        `Rascunho ${pedido?.numero ?? ""} para ${pedido?.fornecedor ?? "o fornecedor"} — revise em Compras antes de enviar.`,
      );
    } catch (e) {
      toast.error(
        "Não foi possível abrir o pedido",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Pedir ao fornecedor"
      descricao={
        <span className="line-clamp-1">
          {ficha.nome} · <span className="font-mono text-xs">{ficha.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={qtd <= 0 || salvando} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Criar rascunho de pedido
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            {valor === "" ? "0" : valor}
            <span className="ml-1 text-base font-normal text-muted">
              {ficha.unidadeBase.toLowerCase()}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">
            em estoque: {ficha.totalFechado.toLocaleString("pt-BR")}
            {ficha.cobertura?.dias != null && ` · dura ${ficha.cobertura.label}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {sugestao > 0 && (
            <Chip ativo={qtd === Math.ceil(sugestao)} onClick={() => setValor(String(Math.ceil(sugestao)))}>
              sugerido {Math.ceil(sugestao)}
            </Chip>
          )}
          {ATALHOS_QTD.map((n) => (
            <Chip key={n} ativo={qtd === n} onClick={() => setValor(String(n))}>
              {n}
            </Chip>
          ))}
        </div>

        <TecladoNumerico valor={valor} onChange={setValor} decimais={0} />

        <p className="text-xs text-muted">
          O pedido nasce como rascunho, no fornecedor principal do produto. Enviar é um
          toque em Compras — bipe errado não vira caminhão na porta.
        </p>
      </div>
    </BottomSheet>
  );
}
