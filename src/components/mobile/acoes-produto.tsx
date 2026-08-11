"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  Percent,
  Scale,
  ShoppingCart,
  Tag,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useFilaEtiquetas } from "@/components/mobile/fila-etiquetas";
import { useContextoAcoes } from "@/components/mobile/contexto-acoes";
import type { Acao } from "@/components/mobile/acao-estoque";
import type { ContextoAcoes } from "@/app/(mobile)/m/acoes/actions";
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

/**
 * As sheets entram sob demanda.
 *
 * Juntas elas arrastam o painel deslizante, o teclado numérico grande e as
 * server actions de estoque, preço e compra — tudo isso no bundle da tela mais
 * aberta do app, para um código de barras que na maioria das vezes só é
 * CONSULTADO. Carregar no toque troca esse peso por milissegundos numa animação
 * que já leva 180ms para abrir.
 *
 * `ssr: false` porque nenhuma delas renderiza fechada: não há HTML a
 * pré-renderizar, só peso.
 */
const AcaoEstoqueSheet = dynamic(
  () => import("@/components/mobile/acao-estoque").then((m) => m.AcaoEstoqueSheet),
  { ssr: false },
);
const PrecoSheet = dynamic(() => import("@/components/mobile/sheet-preco"), { ssr: false });
const PedirSheet = dynamic(() => import("@/components/mobile/sheet-pedir"), { ssr: false });
const PromocaoSheet = dynamic(() => import("@/components/mobile/sheet-promocao"), { ssr: false });

type Ferramenta = {
  chave: "preco" | "promocao" | "perda" | "ajuste" | "transferencia" | "etiqueta" | "pedir";
  label: string;
  icone: LucideIcon;
  visivel: (c: ContextoAcoes, f: FichaProduto) => boolean;
  /** Aparece apagada e não abre nada — recurso ainda não liberado. */
  desabilitada?: boolean;
};

const FERRAMENTAS: Ferramenta[] = [
  { chave: "preco", label: "Preço", icone: Tag, visivel: (c) => c.podePreco },
  { chave: "promocao", label: "Promoção", icone: Percent, visivel: (c) => c.podePreco },
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
  {
    chave: "etiqueta",
    label: "Etiqueta",
    icone: Tag,
    visivel: (c) => c.podePreco,
    // Fora do ar por ora, a pedido: fica visível e apagada porque sumir daria a
    // entender que a impressão de etiqueta deixou de existir.
    desabilitada: true,
  },
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
  // Memorizado por aba: numa volta de gôndola são dezenas de fichas, e lojas e
  // permissões não mudam entre elas (ver `contexto-acoes`).
  const ctx = useContextoAcoes();
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
  const doVoz = inicial?.chave === aberta ? inicial : null;

  return (
    <div className="space-y-2">
      {/* A altura da grade é reservada antes de o contexto chegar: sem isso, o
          que vem depois nasce colado na ficha e desce quando as ações aparecem —
          o dedo já estava a caminho. */}
      {ctx === null ? (
        <div className="grid grid-cols-3 gap-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-h-16 rounded-xl border border-line bg-surface-2/60" />
          ))}
        </div>
      ) : (
        visiveis.length > 0 && (
          // 3 colunas: quatro alvos por linha ficariam menores que o polegar num
          // aparelho de 360px.
          <div className="grid grid-cols-3 gap-2">
            {visiveis.map((f) => (
              <button
                key={f.chave}
                type="button"
                disabled={f.desabilitada}
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
                  f.desabilitada && "cursor-not-allowed opacity-40 active:bg-surface",
                )}
              >
                <f.icone className="h-5 w-5 text-ink-2" aria-hidden />
                {f.label}
              </button>
            ))}
          </div>
        )
      )}

      {/* Sem "abrir cadastro completo": o destino é uma tela de computador, e
          quem está na gôndola com o telefone na mão não vai editar fiscal e
          embalagens ali. As ações acima são o que o aparelho resolve. */}

      {ctx && (aberta === "perda" || aberta === "ajuste" || aberta === "transferencia") && (
        <AcaoEstoqueSheet
          alvo={alvo}
          acao={aberta as Acao}
          sites={ctx.sites}
          siteAtivo={ctx.siteAtivo}
          quantidadeInicial={doVoz?.quantidade}
          motivoInicial={doVoz?.motivo}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}

      {aberta === "preco" && (
        <PrecoSheet
          ficha={ficha}
          valorInicial={doVoz?.preco}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}

      {ctx && aberta === "promocao" && (
        <PromocaoSheet
          ficha={ficha}
          sites={ctx.sites}
          siteAtivo={ctx.siteAtivo}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}

      {ctx && aberta === "pedir" && (
        <PedirSheet
          ficha={ficha}
          siteAtivo={ctx.siteAtivo}
          quantidadeInicial={doVoz?.quantidade}
          onFechar={() => setAberta(null)}
          onConcluir={concluir}
        />
      )}
    </div>
  );
}
