"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Minus, Plus, ScanLine, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { Chip } from "@/components/mobile/acao-estoque";
import { buscarPorCodigoAction } from "../scan/actions";
import { criarPedidoDoScannerAction } from "../acoes/actions";

type Site = { id: string; nome: string };

type Item = {
  productId: string;
  nome: string;
  sku: string;
  unidade: string;
  emEstoque: number;
  /** Quanto falta para o alvo da estratégia da empresa. 0 = sem sugestão. */
  sugerido: number;
  quantidade: number;
};

/**
 * Carrinho de compra montado escaneando.
 *
 * Duas decisões que valem explicar:
 *
 * 1. **A quantidade já vem preenchida** com a sugestão de reposição da ficha
 *    (`cobertura.sugestao`, calculada por lib/estoque-estrategia com a política
 *    da empresa). Quem está de pé na frente da prateleira vazia não deveria ter
 *    de calcular quanto falta — mas o número fica editável, porque quem está lá
 *    sabe da promoção que o sistema não sabe.
 *
 * 2. **O agrupamento por fornecedor acontece no servidor.** O celular manda uma
 *    lista de produtos; quem sabe qual é o fornecedor principal de cada um é o
 *    banco, e mandar esse mapa para o browser seria despejar o catálogo de
 *    vínculos numa tela de gôndola.
 */
export function PedidoClient({
  sites,
  siteAtivo,
}: {
  sites: Site[];
  siteAtivo: string | null;
}) {
  const [itens, setItens] = React.useState<Item[]>([]);
  const [site, setSite] = React.useState<string | null>(siteAtivo ?? sites[0]?.id ?? null);
  const [lendo, setLendo] = React.useState(true);
  const [ocupado, setOcupado] = React.useState(false);
  const [ultimo, setUltimo] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function aoLer(codigo: string) {
    setOcupado(true);
    try {
      const r = await buscarPorCodigoAction(codigo);
      if (r.tipo !== "achou") {
        setUltimo(`Sem cadastro: ${codigo}`);
        return;
      }
      const f = r.ficha;
      const sugerido = Math.ceil(f.cobertura?.sugestao ?? 0);

      setItens((atual) => {
        const i = atual.findIndex((x) => x.productId === f.id);
        // Bipar de novo soma uma unidade: é assim que se conta caixa a caixa.
        if (i >= 0) {
          const copia = [...atual];
          copia[i] = { ...copia[i], quantidade: copia[i].quantidade + 1 };
          return copia;
        }
        return [
          ...atual,
          {
            productId: f.id,
            nome: f.nome,
            sku: f.sku,
            unidade: f.unidadeBase.toLowerCase(),
            emEstoque: f.totalFechado,
            sugerido,
            quantidade: sugerido > 0 ? sugerido : 1,
          },
        ];
      });
      setUltimo(f.nome);
    } finally {
      setOcupado(false);
    }
  }

  function mudarQtd(productId: string, delta: number) {
    setItens((atual) =>
      atual
        .map((i) =>
          i.productId === productId ? { ...i, quantidade: i.quantidade + delta } : i,
        )
        .filter((i) => i.quantidade > 0),
    );
  }

  async function fechar() {
    if (itens.length === 0 || salvando) return;
    setSalvando(true);
    try {
      const r = await criarPedidoDoScannerAction({
        siteId: site,
        enviar: false,
        itens: itens.map((i) => ({
          productId: i.productId,
          quantidade: i.quantidade,
          supplierId: null,
        })),
      });

      if (r.criados.length === 0) {
        toast.error(
          "Nenhum pedido criado",
          "Os produtos bipados não têm fornecedor vinculado.",
        );
        return;
      }

      // Um bipe pode virar três pedidos — um por fornecedor. Dizer quantos e de
      // quem evita a pergunta seguinte ("cadê o resto?").
      toast.success(
        `${r.criados.length} ${r.criados.length === 1 ? "rascunho criado" : "rascunhos criados"}`,
        r.criados.map((c) => `${c.numero} · ${c.fornecedor}`).join(" · "),
      );
      if (r.semFornecedor.length > 0) {
        toast.info(
          "Ficaram de fora",
          `${r.semFornecedor.join(", ")} — sem fornecedor cadastrado.`,
        );
      }
      setItens([]);
      setLendo(true);
    } catch (e) {
      toast.error(
        "Não foi possível fechar o pedido",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  const totalUnidades = itens.reduce((a, i) => a + i.quantidade, 0);

  return (
    <div className="space-y-3">
      {sites.length > 1 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Entregar em</p>
          <div className="flex flex-wrap gap-1.5">
            {sites.map((s) => (
              <Chip key={s.id} ativo={site === s.id} onClick={() => setSite(s.id)}>
                {s.nome}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {lendo ? (
        <div className="space-y-2">
          <Scanner
            onCodigo={aoLer}
            onFechar={() => setLendo(false)}
            continuo
            ocupado={ocupado}
            dica="Bipe o que está faltando"
          />
          {ultimo && (
            <p className="text-center text-[13px] text-ink-2" aria-live="polite">
              {ultimo}
            </p>
          )}
        </div>
      ) : (
        <Button onClick={() => setLendo(true)} variant="secondary" className="w-full" size="lg">
          <ScanLine className="h-4 w-4" aria-hidden />
          Voltar a escanear
        </Button>
      )}

      {itens.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ShoppingCart className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Carrinho vazio</p>
          <p className="text-sm text-ink-2">
            Cada produto entra com a quantidade que falta para o seu nível ideal. Dá para
            mudar item por item.
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.productId}>
                <Card className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{i.nome}</p>
                    <p className="text-xs text-muted">
                      <span className="font-mono">{i.sku}</span> · tem{" "}
                      {i.emEstoque.toLocaleString("pt-BR")}
                      {i.sugerido > 0 && ` · sugerido ${i.sugerido}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <BotaoQtd rotulo={`Menos um ${i.nome}`} onClick={() => mudarQtd(i.productId, -1)}>
                      <Minus className="h-4 w-4" aria-hidden />
                    </BotaoQtd>
                    <span className="w-8 text-center font-display text-base font-semibold text-ink tabular-nums">
                      {i.quantidade}
                    </span>
                    <BotaoQtd rotulo={`Mais um ${i.nome}`} onClick={() => mudarQtd(i.productId, 1)}>
                      <Plus className="h-4 w-4" aria-hidden />
                    </BotaoQtd>
                  </div>

                  <button
                    type="button"
                    onClick={() => mudarQtd(i.productId, -i.quantidade)}
                    aria-label={`Tirar ${i.nome} do carrinho`}
                    className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </Card>
              </li>
            ))}
          </ul>

          <div className="sticky bottom-24 z-10">
            <Button
              onClick={fechar}
              disabled={salvando}
              className="w-full shadow-[var(--shadow-2)]"
              size="lg"
            >
              {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Fechar pedido · {itens.length} {itens.length === 1 ? "item" : "itens"} ·{" "}
              {totalUnidades} un
            </Button>
          </div>

          <p className="px-1 text-xs text-muted">
            Sai como rascunho, um por fornecedor. Revise e envie em{" "}
            <Link href="/pedidos" className="underline">
              Compras
            </Link>
            .
          </p>
        </>
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
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line-button bg-surface text-ink-2 active:bg-surface-2"
    >
      {children}
    </button>
  );
}
