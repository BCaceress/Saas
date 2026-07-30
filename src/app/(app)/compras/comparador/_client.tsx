"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Scale,
  Loader2,
  ShoppingCart,
  Split,
  Package,
  TriangleAlert,
  Sparkles,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ComparacaoCesta, OfertaComparada } from "@/lib/compras/comparador";
import {
  adicionarLoteAoCarrinhoAction,
  buscarOfertasAction,
  compararCestaAction,
} from "../_catalogo/actions";
import { EstadoVazio, ReguaPreco, SupplierAvatar, fmtMoney, fmtPreco, fmtQuando } from "../_catalogo/ui";

type Grupo = {
  chave: string;
  productId: string | null;
  titulo: string;
  ofertas: OfertaComparada[];
};

type ItemCesta = { productId: string; nome: string; quantidade: number };

/**
 * Comparador — busca um produto, mostra todo fornecedor que o tem e destaca o
 * menor preço. A cesta responde a pergunta que ninguém consegue no WhatsApp:
 * dividir o pedido compensa o trabalho de dividir?
 */
export function Comparador({ podePedir }: { podePedir: boolean }) {
  const router = useRouter();
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<OfertaComparada[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [cesta, setCesta] = useState<ItemCesta[]>([]);
  const [comparacao, setComparacao] = useState<ComparacaoCesta | null>(null);
  const [comparando, startComparar] = useTransition();
  const [enviando, startEnviar] = useTransition();

  // Busca com atraso curto: o operador digita o nome inteiro antes de a
  // consulta sair. Todo setState mora dentro do timer — nada dispara render em
  // cascata no corpo do efeito.
  useEffect(() => {
    const t = termo.trim();
    let vivo = true;
    const timer = setTimeout(async () => {
      if (t.length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const r = await buscarOfertasAction(t);
        if (vivo) setResultados(r);
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 320);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [termo]);

  const grupos = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>();
    for (const oferta of resultados) {
      const chave = oferta.productId ?? `item:${oferta.itemId}`;
      const grupo = mapa.get(chave) ?? {
        chave,
        productId: oferta.productId,
        titulo: oferta.descricao,
        ofertas: [],
      };
      grupo.ofertas.push(oferta);
      mapa.set(chave, grupo);
    }
    for (const grupo of mapa.values()) {
      grupo.ofertas.sort((a, b) => a.precoEfetivo - b.precoEfetivo);
    }
    // Produto disputado por vários fornecedores primeiro: é ali que a
    // comparação tem valor.
    return [...mapa.values()].sort((a, b) => b.ofertas.length - a.ofertas.length);
  }, [resultados]);

  function adicionarNaCesta(productId: string, nome: string) {
    setComparacao(null);
    setCesta((atual) =>
      atual.some((i) => i.productId === productId)
        ? atual.map((i) => (i.productId === productId ? { ...i, quantidade: i.quantidade + 1 } : i))
        : [...atual, { productId, nome, quantidade: 1 }],
    );
  }

  function mudarQuantidade(productId: string, delta: number) {
    setComparacao(null);
    setCesta((atual) =>
      atual
        .map((i) => (i.productId === productId ? { ...i, quantidade: i.quantidade + delta } : i))
        .filter((i) => i.quantidade > 0),
    );
  }

  function comparar() {
    startComparar(async () => {
      try {
        const r = await compararCestaAction(
          cesta.map((i) => ({ productId: i.productId, quantidade: i.quantidade })),
        );
        setComparacao(r);
      } catch (e) {
        toast.error("Não deu para comparar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  function mandarParaCarrinho(estrategia: "dividido" | "unico") {
    if (!comparacao) return;
    const itens = comparacao.linhas
      .map((linha) => {
        const oferta = estrategia === "dividido" ? linha.melhor : linha.noFornecedorUnico;
        return oferta ? { catalogItemId: oferta.itemId, quantidade: linha.quantidade } : null;
      })
      .filter((i): i is { catalogItemId: string; quantidade: number } => !!i);

    if (itens.length === 0) {
      toast.error("Nada para adicionar", "Nenhum item da cesta tem oferta disponível.");
      return;
    }

    startEnviar(async () => {
      try {
        await adicionarLoteAoCarrinhoAction(itens);
        toast.success(
          "Cesta no carrinho",
          `${itens.length} item(ns) adicionados. Feche os pedidos na aba Pedidos.`,
        );
        router.refresh();
      } catch (e) {
        toast.error("Não deu para adicionar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* Coluna da busca */}
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Busque um produto — ex.: Heineken Long Neck"
            className="h-12 pl-11 text-[15px]"
            autoFocus
            aria-label="Buscar produto entre os fornecedores"
          />
          {buscando && (
            <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted" />
          )}
        </div>

        {termo.trim().length < 2 ? (
          <EstadoVazio
            icon={<Scale size={20} />}
            titulo="Compare antes de comprar"
            descricao="Digite o nome, o EAN ou o código do produto. O sistema procura em todas as tabelas importadas e destaca o menor preço."
          />
        ) : grupos.length === 0 && !buscando ? (
          <EstadoVazio
            icon={<Package size={20} />}
            titulo="Nenhuma oferta encontrada"
            descricao="Nenhum fornecedor tem esse produto nas tabelas importadas. Importe uma tabela nova ou revise os itens sem vínculo."
            acao={
              <Link href="/compras/importacoes">
                <Button size="sm" variant="secondary">
                  Importar tabela
                </Button>
              </Link>
            }
          />
        ) : (
          grupos.map((grupo) => (
            <GrupoProduto
              key={grupo.chave}
              grupo={grupo}
              naCesta={cesta.some((i) => i.productId === grupo.productId)}
              onAdicionar={() =>
                grupo.productId && adicionarNaCesta(grupo.productId, grupo.titulo)
              }
            />
          ))
        )}
      </div>

      {/* Cesta */}
      <aside className="flex flex-col gap-3 lg:sticky lg:top-3 lg:self-start">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-[15px] font-semibold text-ink">Cesta de comparação</h2>
            {cesta.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCesta([]);
                  setComparacao(null);
                }}
                className="text-[12px] text-muted transition-colors hover:text-danger"
              >
                Limpar
              </button>
            )}
          </div>

          {cesta.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted">
              Junte os produtos da compra e descubra se vale dividir o pedido entre fornecedores.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {cesta.map((item) => (
                <li key={item.productId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.nome}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => mudarQuantidade(item.productId, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2"
                      aria-label={`Diminuir ${item.nome}`}
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-7 text-center font-mono text-[12px] font-semibold text-ink">
                      {item.quantidade}
                    </span>
                    <button
                      type="button"
                      onClick={() => mudarQuantidade(item.productId, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2"
                      aria-label={`Aumentar ${item.nome}`}
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => mudarQuantidade(item.productId, -item.quantidade)}
                      className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:text-danger"
                      aria-label={`Remover ${item.nome}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Button
            className="mt-3 w-full"
            onClick={comparar}
            disabled={cesta.length === 0 || comparando}
          >
            {comparando ? <Loader2 size={15} className="animate-spin" /> : <Scale size={15} />}
            Comparar cesta
          </Button>
        </div>

        {comparacao && (
          <ResultadoCesta
            comparacao={comparacao}
            podePedir={podePedir}
            enviando={enviando}
            onEnviar={mandarParaCarrinho}
          />
        )}
      </aside>
    </div>
  );
}

// ── Um produto, todos os fornecedores ───────────────────────

function GrupoProduto({
  grupo,
  naCesta,
  onAdicionar,
}: {
  grupo: Grupo;
  naCesta: boolean;
  onAdicionar: () => void;
}) {
  const melhor = grupo.ofertas[0];
  const marcas = grupo.ofertas.map((o) => ({
    id: o.itemId,
    nome: o.supplierNome,
    preco: o.precoEfetivo,
  }));

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-semibold text-ink">{grupo.titulo}</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {grupo.ofertas.length === 1
              ? "Só um fornecedor tem este item"
              : `${grupo.ofertas.length} fornecedores · melhor em ${melhor.supplierNome}`}
            {!grupo.productId && " · item sem vínculo com produto"}
          </p>
        </div>
        {grupo.productId && (
          <Button size="sm" variant={naCesta ? "secondary" : "primary"} onClick={onAdicionar}>
            <Plus size={14} />
            {naCesta ? "Mais um" : "Somar à cesta"}
          </Button>
        )}
      </header>

      {grupo.ofertas.length > 1 && (
        <div className="border-b border-line px-4 pb-3 pt-4">
          <ReguaPreco marcas={marcas} />
        </div>
      )}

      <table className="w-full text-sm">
        <tbody>
          {grupo.ofertas.map((oferta, i) => {
            const melhorPreco = i === 0;
            const diferenca = oferta.precoEfetivo - melhor.precoEfetivo;
            return (
              <tr
                key={oferta.itemId}
                className={cn(
                  "border-b border-line last:border-0",
                  melhorPreco && grupo.ofertas.length > 1 && "bg-accent-soft/30",
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <SupplierAvatar
                      nome={oferta.supplierNome}
                      logoUrl={oferta.supplierLogoUrl}
                      size={28}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{oferta.supplierNome}</p>
                      <p className="truncate font-mono text-[11px] text-faint">
                        {oferta.codigoFornecedor ?? oferta.ean ?? "—"}
                        {oferta.unidade ? ` · ${oferta.unidade}` : ""}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-3 py-2.5 text-right">
                  <p
                    className={cn(
                      "font-mono text-sm font-semibold",
                      melhorPreco ? "text-accent" : "text-ink",
                    )}
                  >
                    {fmtPreco(oferta.precoEfetivo)}
                  </p>
                  {oferta.emPromocao && (
                    <p className="font-mono text-[11px] text-faint line-through">
                      {fmtPreco(oferta.preco)}
                    </p>
                  )}
                </td>

                <td className="w-24 px-3 py-2.5 text-right">
                  {melhorPreco ? (
                    <Badge tone="accent">menor preço</Badge>
                  ) : (
                    <span className="font-mono text-[12px] text-muted">+{fmtPreco(diferenca)}</span>
                  )}
                </td>

                <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                  {oferta.emPromocao && <Badge tone="accent">promoção</Badge>}
                </td>

                <td className="hidden px-3 py-2.5 text-right font-mono text-[12px] text-ink-2 md:table-cell">
                  {oferta.estoqueDisponivel != null
                    ? oferta.estoqueDisponivel.toLocaleString("pt-BR")
                    : "—"}
                </td>

                <td className="hidden px-4 py-2.5 text-right text-[11px] text-faint lg:table-cell">
                  {fmtQuando(oferta.ultimaAtualizacao)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ── Resultado da cesta ──────────────────────────────────────

function ResultadoCesta({
  comparacao,
  podePedir,
  enviando,
  onEnviar,
}: {
  comparacao: ComparacaoCesta;
  podePedir: boolean;
  enviando: boolean;
  onEnviar: (estrategia: "dividido" | "unico") => void;
}) {
  const { dividido, unico, economia, pedidosDivididos } = comparacao;
  const compensaDividir = economia > 0 && pedidosDivididos > 1;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <h2 className="font-display text-[15px] font-semibold text-ink">Estratégia de compra</h2>

      {/* Tudo em um fornecedor */}
      {unico && (
        <div
          className={cn(
            "rounded-[var(--radius)] border p-3",
            compensaDividir ? "border-line" : "border-brand bg-brand-soft/40",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Package size={13} /> Tudo em {unico.supplierNome}
            </p>
            {!compensaDividir && <Badge tone="brand">recomendado</Badge>}
          </div>
          <p className="mt-1 font-display text-[20px] font-semibold text-ink">{fmtMoney(unico.total)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            1 pedido · {unico.itens} itens
            {unico.faltantes > 0 && ` · ${unico.faltantes} sem oferta aqui`}
          </p>
          {!unico.atingePedidoMinimo && unico.pedidoMinimo != null && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-warn">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              Abaixo do pedido mínimo de {fmtMoney(unico.pedidoMinimo)}.
            </p>
          )}
          {podePedir && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5 w-full"
              onClick={() => onEnviar("unico")}
              disabled={enviando}
            >
              <ShoppingCart size={14} />
              Levar para o carrinho
            </Button>
          )}
        </div>
      )}

      {/* Dividido */}
      <div
        className={cn(
          "rounded-[var(--radius)] border p-3",
          compensaDividir ? "border-accent bg-accent-soft/30" : "border-line",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <Split size={13} /> Dividido no melhor preço
          </p>
          {compensaDividir && <Badge tone="accent">economiza {fmtMoney(economia)}</Badge>}
        </div>
        <p className="mt-1 font-display text-[20px] font-semibold text-ink">{fmtMoney(dividido.total)}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          {pedidosDivididos} pedido{pedidosDivididos > 1 ? "s" : ""} ·{" "}
          {dividido.porFornecedor.map((f) => f.supplierNome).join(", ") || "—"}
        </p>

        {dividido.porFornecedor.some((f) => !f.atingePedidoMinimo) && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-warn">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            Um dos pedidos fica abaixo do mínimo do fornecedor.
          </p>
        )}

        {dividido.itensSemOferta > 0 && (
          <p className="mt-1.5 text-[11px] text-muted">
            {dividido.itensSemOferta} item(ns) da cesta não têm oferta em nenhuma tabela.
          </p>
        )}

        {podePedir && (
          <Button
            size="sm"
            className="mt-2.5 w-full"
            onClick={() => onEnviar("dividido")}
            disabled={enviando}
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
            Levar para o carrinho
          </Button>
        )}
      </div>

      {compensaDividir ? (
        <p className="flex items-start gap-1.5 text-[12px] text-ink-2">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" />
          Dividir em {pedidosDivididos} pedidos economiza {fmtMoney(economia)} — vale se o frete e o
          pedido mínimo de cada fornecedor couberem.
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-[12px] text-ink-2">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-brand" />
          Dividir o pedido não compensa nesta cesta: um fornecedor só entrega tudo pelo mesmo preço.
        </p>
      )}

      {/* Cada fornecedor, cesta inteira */}
      {comparacao.fornecedores.length > 1 && (
        <div className="mt-1 flex flex-col gap-1 border-t border-line pt-2.5">
          <p className="text-[11px] uppercase tracking-wide text-faint">Cesta inteira por fornecedor</p>
          {comparacao.fornecedores.slice(0, 6).map((f) => (
            <div key={f.supplierId} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 truncate text-ink-2">
                {f.supplierNome}
                {f.faltantes > 0 && <span className="text-faint"> · {f.faltantes} faltando</span>}
              </span>
              <span className="shrink-0 font-mono text-ink">{fmtMoney(f.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
