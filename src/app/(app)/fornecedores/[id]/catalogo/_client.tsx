"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Search,
  ShoppingCart,
  Link2,
  LineChart as LineChartIcon,
  PackageSearch,
  Loader2,
  CircleSlash,
  Check,
  Tag,
  Scale,
  ImageOff,
} from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, Field } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/utils";
import type { FornecedorCard, ItemCatalogo, PontoPreco } from "../../../compras/_catalogo/types";
import { EstadoVazio, PromoBadge, fmtPreco, fmtQtd, fmtQuando } from "../../../compras/_catalogo/ui";
import {
  adicionarAoCarrinhoAction,
  buscarProdutosAction,
  historicoPrecoAction,
  ignorarItemAction,
  vincularItemAction,
} from "../../../compras/_catalogo/actions";

// ============================================================
// Aba Catálogo — a tabela de preços deste fornecedor, do jeito que ele mandou.
//
// Cada linha responde três coisas de uma vez: o que é (imagem, marca, EAN),
// quanto custa hoje (preço, promoção, validade da oferta) e se vale comprar
// aqui (diferença contra o melhor preço de mercado).
// ============================================================

type Filtro = {
  busca: string;
  categoria: string;
  apenasPromocao: boolean;
  apenasPendentes: boolean;
  ordem: string;
};

export function CatalogoFornecedor({
  fornecedor,
  itens,
  categorias,
  filtro,
  podeEditar,
  podePedir,
}: {
  fornecedor: FornecedorCard;
  itens: ItemCatalogo[];
  categorias: string[];
  filtro: Filtro;
  podeEditar: boolean;
  podePedir: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busca, setBusca] = useState(filtro.busca);
  const [revisar, setRevisar] = useState<ItemCatalogo | null>(null);
  const [historico, setHistorico] = useState<ItemCatalogo | null>(null);

  // Filtro vive na URL: a tela volta igual quando alguém compartilha o link
  // ou aperta voltar.
  function aplicar(mudanca: Record<string, string | null>) {
    const proximo = new URLSearchParams(params.toString());
    for (const [chave, valor] of Object.entries(mudanca)) {
      if (!valor) proximo.delete(chave);
      else proximo.set(chave, valor);
    }
    router.replace(`${pathname}?${proximo.toString()}`, { scroll: false });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== filtro.busca) aplicar({ q: busca || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-80">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, EAN, marca ou código"
            className="pl-9"
            aria-label="Buscar no catálogo"
          />
        </div>

        {categorias.length > 0 && (
          <Select
            value={filtro.categoria}
            onChange={(e) => aplicar({ categoria: e.target.value || null })}
            className="w-auto min-w-40"
            aria-label="Categoria"
          >
            <option value="">Todas as categorias</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}

        <Select
          value={filtro.ordem}
          onChange={(e) => aplicar({ ordem: e.target.value })}
          className="w-auto min-w-36"
          aria-label="Ordenar"
        >
          <option value="descricao">Nome (A–Z)</option>
          <option value="preco">Menor preço</option>
          <option value="atualizacao">Atualizados primeiro</option>
        </Select>

        <Pilula
          ativa={filtro.apenasPromocao}
          onClick={() => aplicar({ promocao: filtro.apenasPromocao ? null : "1" })}
        >
          <Tag size={13} /> Em promoção
          {fornecedor.emPromocao > 0 && <span className="font-mono">{fornecedor.emPromocao}</span>}
        </Pilula>

        {fornecedor.pendentes > 0 && (
          <Pilula
            ativa={filtro.apenasPendentes}
            onClick={() => aplicar({ pendentes: filtro.apenasPendentes ? null : "1" })}
          >
            <Link2 size={13} /> A revisar <span className="font-mono">{fornecedor.pendentes}</span>
          </Pilula>
        )}

        <Link href="/compras/comparador" className="ml-auto">
          <Button size="sm" variant="secondary">
            <Scale size={14} />
            Comparar preços
          </Button>
        </Link>
      </div>

      {itens.length === 0 ? (
        <EstadoVazio
          icon={<PackageSearch size={20} />}
          titulo="Nenhum item nesta tabela"
          descricao="Configure como a tabela deste fornecedor chega e importe a primeira versão."
          acao={
            <Link href={`/fornecedores/${fornecedor.id}/integracao`}>
              <Button size="sm" variant="secondary">
                Abrir integração
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Produto</th>
                <th className="px-3 py-2.5 font-medium">EAN / código</th>
                <th className="px-3 py-2.5 font-medium">Categoria</th>
                <th className="px-3 py-2.5 text-right font-medium">Preço</th>
                <th className="px-3 py-2.5 text-right font-medium">Promocional</th>
                <th className="px-3 py-2.5 text-right font-medium">Mercado</th>
                <th className="px-3 py-2.5 text-right font-medium">Qtd. mín.</th>
                <th className="px-3 py-2.5 font-medium">Oferta até</th>
                <th className="px-3 py-2.5 font-medium">Disponib.</th>
                <th className="px-3 py-2.5 font-medium">Atualizado</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <LinhaItem
                  key={item.id}
                  item={item}
                  podeEditar={podeEditar}
                  podePedir={podePedir}
                  onRevisar={() => setRevisar(item)}
                  onHistorico={() => setHistorico(item)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revisar && <SheetRevisao item={revisar} onClose={() => setRevisar(null)} />}
      {historico && <SheetHistorico item={historico} onClose={() => setHistorico(null)} />}
    </div>
  );
}

function Pilula({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        ativa
          ? "border-brand bg-brand-soft text-brand"
          : "border-line-button bg-surface text-ink hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function ImagemItem({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
        <ImageOff size={14} />
      </span>
    );
  }
  return (
    // Imagem vem da tabela do fornecedor — host arbitrário não passa pelo next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] border border-line bg-surface object-contain p-0.5"
    />
  );
}

function LinhaItem({
  item,
  podeEditar,
  podePedir,
  onRevisar,
  onHistorico,
}: {
  item: ItemCatalogo;
  podeEditar: boolean;
  podePedir: boolean;
  onRevisar: () => void;
  onHistorico: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const desconto =
    item.emPromocao && item.preco > 0 ? ((item.preco - item.precoEfetivo) / item.preco) * 100 : 0;

  // Diferença contra o melhor preço de mercado — o número que decide a compra.
  const delta =
    item.melhorPrecoMercado != null && item.melhorPrecoMercado > 0
      ? item.precoEfetivo - item.melhorPrecoMercado
      : null;

  // O servidor já derrubou a promoção vencida (o preço efetivo volta a ser o
  // de tabela) — a data em vermelho só marca o que perdeu a validade.
  const ofertaVencida = item.validadeOferta != null && item.precoPromocional != null && !item.emPromocao;

  function adicionar() {
    startTransition(async () => {
      try {
        await adicionarAoCarrinhoAction({
          catalogItemId: item.id,
          quantidade: item.quantidadeMinima ?? 1,
        });
        toast.success("Adicionado à cesta", item.descricao);
        router.refresh();
      } catch (e) {
        toast.error("Não deu para adicionar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-2/60">
      <td className="max-w-72 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <ImagemItem url={item.imagemUrl} alt="" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{item.descricao}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted">
              {item.marca && <span>{item.marca}</span>}
              {item.unidade && <span className="text-faint">· {item.unidade}</span>}
              {item.matchStatus === "VINCULADO" && item.produtoSku ? (
                <span className="font-mono text-brand">· {item.produtoSku}</span>
              ) : item.matchStatus === "PENDENTE" ? (
                <Badge tone="warn" className="ml-0.5">
                  sem vínculo
                </Badge>
              ) : null}
            </p>
          </div>
        </div>
      </td>

      <td className="px-3 py-2.5">
        <p className="font-mono text-[12px] text-ink-2">{item.ean ?? "—"}</p>
        {item.codigoFornecedor && (
          <p className="font-mono text-[11px] text-faint">{item.codigoFornecedor}</p>
        )}
      </td>

      <td className="max-w-36 px-3 py-2.5 text-[12px] text-muted">
        <span className="block truncate">{item.categoria ?? "—"}</span>
      </td>

      <td className="px-3 py-2.5 text-right">
        <p
          className={cn(
            "font-mono text-sm font-semibold",
            item.emPromocao ? "text-faint line-through" : "text-ink",
          )}
        >
          {fmtPreco(item.preco)}
        </p>
      </td>

      <td className="px-3 py-2.5 text-right">
        {item.precoPromocional == null ? (
          <span className="text-[12px] text-faint">—</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <span
              className={cn(
                "font-mono text-sm font-semibold",
                item.emPromocao ? "text-accent" : "text-faint line-through",
              )}
            >
              {fmtPreco(item.precoPromocional)}
            </span>
            {item.emPromocao && <PromoBadge desconto={desconto} />}
          </div>
        )}
      </td>

      <td className="px-3 py-2.5 text-right">
        {delta == null ? (
          <span className="text-[12px] text-faint">—</span>
        ) : delta <= 0.0001 ? (
          <Badge tone="ok">melhor preço</Badge>
        ) : (
          <span className="font-mono text-[12px] text-danger" title={`Melhor: ${item.melhorFornecedor}`}>
            +{fmtPreco(delta)}
          </span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink-2">
        {item.quantidadeMinima != null ? fmtQtd(item.quantidadeMinima) : "—"}
      </td>

      <td className="px-3 py-2.5 text-[12px]">
        {item.validadeOferta ? (
          <span className={ofertaVencida ? "text-danger" : "text-muted"}>
            {new Date(item.validadeOferta).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "2-digit",
            })}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-[12px]">
        {item.estoqueDisponivel == null ? (
          <Badge tone="neutral">disponível</Badge>
        ) : item.estoqueDisponivel <= 0 ? (
          <Badge tone="danger">em falta</Badge>
        ) : (
          <span className="font-mono text-ink-2">{fmtQtd(item.estoqueDisponivel)}</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-[12px] text-muted">{fmtQuando(item.ultimaAtualizacao)}</td>

      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" onClick={onHistorico} title="Ver histórico de preço">
            <LineChartIcon size={15} />
          </Button>
          {podeEditar && item.matchStatus !== "VINCULADO" && (
            <Button size="icon" variant="ghost" onClick={onRevisar} title="Vincular a um produto">
              <Link2 size={15} />
            </Button>
          )}
          {podePedir && (
            <Button size="sm" variant="secondary" onClick={adicionar} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
              Adicionar
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Revisão manual do vínculo ───────────────────────────────

function SheetRevisao({ item, onClose }: { item: ItemCatalogo; onClose: () => void }) {
  const router = useRouter();
  const [termo, setTermo] = useState(item.descricao.slice(0, 40));
  const [resultados, setResultados] = useState<
    Array<{ id: string; nome: string; sku: string; ean: string | null }>
  >([]);
  const [buscando, setBuscando] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await buscarProdutosAction(termo);
      if (vivo) {
        setResultados(r);
        setBuscando(false);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [termo]);

  function vincular(productId: string) {
    startTransition(async () => {
      try {
        await vincularItemAction(item.id, productId);
        toast.success("Item vinculado", "As próximas importações já reconhecem este código.");
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não deu para vincular", e instanceof Error ? e.message : undefined);
      }
    });
  }

  function ignorar() {
    startTransition(async () => {
      try {
        await ignorarItemAction(item.id);
        toast.success("Item ignorado", "Ele sai da fila de revisão.");
        router.refresh();
        onClose();
      } catch (e) {
        toast.error("Não deu para ignorar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Vincular ao seu produto"
      description="Sem vínculo o item aparece no catálogo, mas fica fora da comparação de preços."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={ignorar} disabled={pending}>
            <CircleSlash size={15} />
            Não vendo isso
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Fechar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-[var(--radius)] border border-line bg-surface-2/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">No fornecedor</p>
          <p className="mt-0.5 font-medium text-ink">{item.descricao}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {item.codigoFornecedor ?? "sem código"} {item.ean ? `· ${item.ean}` : ""} ·{" "}
            {fmtPreco(item.precoEfetivo)}
          </p>
        </div>

        <Field label="Procure o produto no seu catálogo">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, SKU ou EAN"
              className="pl-9"
              autoFocus
            />
          </div>
        </Field>

        <div className="flex flex-col gap-1">
          {buscando && <p className="px-1 py-2 text-[12px] text-muted">Procurando…</p>}
          {!buscando && resultados.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted">
              Nenhum produto encontrado. Cadastre o produto primeiro ou marque o item como &ldquo;não
              vendo isso&rdquo;.
            </p>
          )}
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => vincular(p.id)}
              disabled={pending}
              className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-line px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-soft/40 disabled:opacity-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{p.nome}</p>
                <p className="font-mono text-[11px] text-muted">
                  {p.sku} {p.ean ? `· ${p.ean}` : ""}
                </p>
              </div>
              <Check size={16} className="shrink-0 text-brand" />
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// ── Histórico de preço de um item ───────────────────────────

const JANELAS = [
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 90, label: "90 dias" },
  { dias: 180, label: "180 dias" },
];

function SheetHistorico({ item, onClose }: { item: ItemCatalogo; onClose: () => void }) {
  const [dias, setDias] = useState(30);
  const [carga, setCarga] = useState<{ dias: number; pontos: PontoPreco[] } | null>(null);
  const pontos = carga && carga.dias === dias ? carga.pontos : null;

  useEffect(() => {
    let vivo = true;
    historicoPrecoAction(item.id, dias).then((r) => {
      if (vivo) setCarga({ dias, pontos: r });
    });
    return () => {
      vivo = false;
    };
  }, [item.id, dias]);

  const serie = (pontos ?? []).map((p) => ({
    data: new Date(p.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    valor: p.precoEfetivo,
  }));

  const menor = pontos && pontos.length > 0 ? Math.min(...pontos.map((p) => p.precoEfetivo)) : null;
  const maior = pontos && pontos.length > 0 ? Math.max(...pontos.map((p) => p.precoEfetivo)) : null;

  return (
    <Sheet open onClose={onClose} title="Histórico de preço" description={item.descricao} width="xl">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {JANELAS.map((j) => (
            <button
              key={j.dias}
              type="button"
              onClick={() => setDias(j.dias)}
              aria-pressed={dias === j.dias}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                dias === j.dias
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {j.label}
            </button>
          ))}
        </div>

        {pontos == null ? (
          <div className="flex h-44 items-center justify-center text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : serie.length < 2 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
            Ainda não há mudança de preço registrada nesta janela. O gráfico aparece na segunda
            tabela importada.
          </div>
        ) : (
          <>
            <LineChart pontos={serie} formato={fmtPreco} altura={200} />
            <div className="grid grid-cols-3 divide-x divide-line rounded-[var(--radius)] border border-line bg-surface-2/50 py-2.5 text-center">
              <div>
                <p className="font-mono text-sm font-semibold text-ok">{fmtPreco(menor ?? 0)}</p>
                <p className="text-[11px] text-faint">menor</p>
              </div>
              <div>
                <p className="font-mono text-sm font-semibold text-ink">{fmtPreco(item.precoEfetivo)}</p>
                <p className="text-[11px] text-faint">hoje</p>
              </div>
              <div>
                <p className="font-mono text-sm font-semibold text-danger">{fmtPreco(maior ?? 0)}</p>
                <p className="text-[11px] text-faint">maior</p>
              </div>
            </div>
            {menor != null && item.precoEfetivo > menor * 1.001 && (
              <p className="text-[12px] text-muted">
                O preço de hoje está {fmtPreco(item.precoEfetivo - menor)} acima do menor valor do
                período — promoção de verdade é a que fica abaixo dessa linha.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
