"use client";

import { useEffect, useState } from "react";
import {
  Building2, Barcode, Pencil,
  Package, AlertTriangle, Store, Box, Boxes, Refrigerator, Snowflake, ShoppingCart,
  ChevronUp, ChevronDown,
} from "lucide-react";
import { cn, brl, margem } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TIPO_LABEL, TipoIcone } from "@/components/app/produto-tipo";
import { getProductInsights } from "@/app/(app)/produtos/actions";
import type { ProductInsights } from "@/app/(app)/produtos/_data";
import type { ProductRow } from "@/app/(app)/produtos/_types";
import type { StorageType } from "@/generated/prisma";

// Rótulo e ícone do tipo moram em `produto-tipo` — fonte única das duas
// superfícies. O re-export existe porque meia dúzia de telas já importavam daqui.
export { TIPO_LABEL, TIPO_ICON } from "@/components/app/produto-tipo";

export function stockLevel(p: ProductRow): "ok" | "warn" | "danger" {
  if (p.disponibilidadeDerivada !== null) {
    return p.disponibilidadeDerivada > 0 ? "ok" : "danger";
  }
  const { fechado, minimo, ideal } = p.estoque;
  if (fechado <= minimo) return "danger";
  if (ideal > 0 && fechado < ideal) return "warn";
  return "ok";
}

export const STOCK_COLOR = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" } as const;
export const STOCK_TITLE = { ok: "Disponível", warn: "Estoque baixo", danger: "Sem estoque" } as const;
export const STOCK_TEXT  = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

const STORAGE_LABEL: Record<StorageType, string> = {
  AMBIENTE: "Ambiente", REFRIGERADO: "Refrigerado", CONGELADO: "Congelado",
};
const STORAGE_ICON: Record<StorageType, React.ReactNode> = {
  AMBIENTE: <Box size={12} />, REFRIGERADO: <Refrigerator size={12} />, CONGELADO: <Snowflake size={12} />,
};

type Alert = { texto: string; nivel: "warn" | "danger" };

function buildAlerts(product: ProductRow, insights: ProductInsights | null): Alert[] {
  if (!insights) return [];
  const alerts: Alert[] = [];

  if (stockLevel(product) === "warn") {
    alerts.push({ texto: "Estoque abaixo do ideal", nivel: "warn" });
  }
  if (insights.diasSemCompra != null && insights.diasSemCompra >= 30) {
    alerts.push({ texto: `Sem compra há ${insights.diasSemCompra} dias`, nivel: "warn" });
  }
  if (insights.margemAnteriorPct != null) {
    const margemAtual = margem(product.precoVenda, product.custo);
    if (margemAtual != null) {
      const queda = Math.round(insights.margemAnteriorPct - margemAtual);
      if (queda >= 3) alerts.push({ texto: `Margem caiu ${queda}%`, nivel: "warn" });
    }
  }
  if (insights.diasSemVenda != null && insights.diasSemVenda >= 5) {
    alerts.push({ texto: `Produto sem venda há ${insights.diasSemVenda} dias`, nivel: "danger" });
  }

  return alerts;
}

/** Painel lateral de detalhes do produto — usado em /produtos e na busca global do navbar. */
export function ProductSidePanel({
  product, onClose, onEdit, onComplementar, navegacao,
}: {
  product: ProductRow;
  onClose: () => void;
  onEdit: () => void;
  /**
   * Abre "Compra e fiscal" — o que o cadastro não pergunta e a nota preenche
   * sozinha. Opcional porque a busca global do navbar não tem esse painel.
   */
  onComplementar?: () => void;
  /**
   * Pular para o produto anterior/próximo da lista sem fechar o painel.
   * Conferir dez itens seguidos não pode custar dez fecha-acha-abre.
   */
  navegacao?: {
    posicao: number;
    total: number;
    onAnterior?: () => void;
    onProximo?: () => void;
  };
}) {
  const level = stockLevel(product);
  const totalEstoque = product.estoque.fechado + product.estoque.aberto;
  const vendeDireto = product.tipo !== "INSUMO";

  const [insights, setInsights] = useState<ProductInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(true);

  // O painel remonta a cada produto (key={product.id} no chamador), então isto roda uma vez por produto aberto.
  useEffect(() => {
    let vivo = true;
    getProductInsights(product.id, product.tipo, product.precoVenda)
      .then((d) => { if (vivo) setInsights(d); })
      .finally(() => { if (vivo) setLoadingInsights(false); });
    return () => { vivo = false; };
  }, [product.id, product.tipo, product.precoVenda]);

  const alerts = buildAlerts(product, insights);

  const barcodeCodes = [
    product.ean ? { label: "Unid.", code: product.ean } : null,
    ...product.packagings.filter((pk) => !!pk.ean).map((pk) => ({
      label: `${pk.nome} ${pk.fatorConversao}x`,
      code: pk.ean!,
    })),
  ].filter(Boolean) as { label: string; code: string }[];

  const barraPct = product.estoque.ideal > 0
    ? Math.max(0, Math.min(100, Math.round((totalEstoque / product.estoque.ideal) * 100)))
    : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.nome}
      description={`${TIPO_LABEL[product.tipo]} · ${product.subcategoriaNome}`}
      width="lg"
      footer={
        <div className="flex items-center gap-2">
          {navegacao && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={navegacao.onAnterior}
                disabled={!navegacao.onAnterior}
                aria-label="Produto anterior"
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={navegacao.onProximo}
                disabled={!navegacao.onProximo}
                aria-label="Próximo produto"
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronDown size={16} />
              </button>
              <span className="ml-1 hidden font-mono text-[11px] text-faint sm:inline">
                {navegacao.posicao}/{navegacao.total}
              </span>
            </div>
          )}
          {onComplementar && (
            <Button
              variant="outline"
              onClick={onComplementar}
              className="flex-1 gap-1.5"
              title="Embalagem de compra, fornecedor e fiscal"
            >
              <Boxes size={14} /> Compra e fiscal
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="flex-1">Fechar</Button>
          <Button onClick={onEdit} className="flex-1 gap-1.5"><Pencil size={14} /> Editar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Imagem + identificação */}
        <div className="flex items-center gap-3">
          {product.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imagemUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-[var(--radius)] border border-line object-cover"
            />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-surface-2 text-faint">
              <TipoIcone tipo={product.tipo} size={22} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] font-medium text-ink">{product.sku}</div>
            {barcodeCodes.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {barcodeCodes.map((c) => (
                  <div key={c.code} className="flex items-center gap-1.5 text-[11px] text-faint">
                    <Barcode size={10} className="shrink-0" />
                    <span className="w-14 shrink-0">{c.label}</span>
                    <span className="font-mono text-ink-2">{c.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", STOCK_TEXT[level])}>
            <span className={cn("h-2 w-2 rounded-full", STOCK_COLOR[level])} />
            {STOCK_TITLE[level]}
          </span>
        </div>

        {/* Alertas inteligentes */}
        {!loadingInsights && alerts.length > 0 && (
          <div className="space-y-1.5">
            {alerts.map((a) => (
              <div
                key={a.texto}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium",
                  a.nivel === "danger" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
                )}
              >
                <AlertTriangle size={14} className="shrink-0" />
                {a.texto}
              </div>
            ))}
          </div>
        )}

        {/* Vendas */}
        {vendeDireto && (
          <div className="rounded-[var(--radius-lg)] border border-line p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
              <ShoppingCart size={13} /> Vendas
            </h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <VendaStat label="Hoje" value={insights?.vendasHoje} loading={loadingInsights} />
              <VendaStat label="7 dias" value={insights?.vendas7d} loading={loadingInsights} />
              <VendaStat label="30 dias" value={insights?.vendas30d} loading={loadingInsights} />
            </div>
          </div>
        )}

        {/* Estoque */}
        <div className="rounded-[var(--radius-lg)] border border-line p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint">
            <Package size={13} /> Estoque
          </h3>
          <div className="flex items-end justify-between gap-3">
            <div className="font-mono text-2xl font-bold text-ink tnum">
              {totalEstoque} <span className="text-sm font-normal text-muted">{product.unidadeBase}</span>
            </div>
            <div className="text-right text-[12px] text-muted">
              Mínimo: <span className="font-medium text-ink-2">{product.estoque.minimo}</span>
            </div>
          </div>
          {barraPct !== null && (
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full transition-all", STOCK_COLOR[level])}
                  style={{ width: `${barraPct}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted">{totalEstoque} / {product.estoque.ideal} ideal</div>
            </div>
          )}

          {product.locais.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              {product.locais.map((l, i) => (
                <div key={`${l.siteId}-${i}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <div className="flex min-w-0 items-center gap-1.5 text-ink-2">
                    <Store size={12} className="shrink-0 text-faint" />
                    <span className="truncate">{l.siteNome}</span>
                    {l.locationNome && (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
                        · {l.locationTipo && STORAGE_ICON[l.locationTipo]} {l.locationNome}
                        {l.locationTipo && ` (${STORAGE_LABEL[l.locationTipo]})`}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 font-mono text-[13px] font-medium text-ink tnum">
                    {l.fechado + l.aberto} {product.unidadeBase}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preços */}
        {product.tipo !== "INSUMO" && (
          <div className="rounded-[var(--radius-lg)] border border-line p-4">
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-faint">Preços</h3>
            <div className="grid grid-cols-3 gap-3">
              <InfoCard label="Venda">
                <span className="font-mono text-[14px] font-semibold text-ink tnum">{brl(product.precoVenda)}</span>
              </InfoCard>
              <InfoCard label="Custo">
                <span className="font-mono text-[13px] text-ink-2 tnum">{brl(product.custo)}</span>
              </InfoCard>
              <InfoCard label="Margem">
                <span className="font-mono text-[13px] font-medium text-ok tnum">
                  {margem(product.precoVenda, product.custo) ?? "—"}%
                </span>
              </InfoCard>
            </div>
          </div>
        )}

        {/* Fornecedores */}
        {product.fornecedores.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-line p-4">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-faint">Fornecedores</h3>
            <div className="space-y-1.5">
              {product.fornecedores.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-[13px]">
                  <Building2 size={13} className="shrink-0 text-faint" />
                  <span className="text-ink-2">{f.nome}</span>
                  {f.isPrincipal && (
                    <span className="ml-auto text-[10px] font-medium text-brand-strong">principal</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function VendaStat({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <div>
      <div className="font-mono text-lg font-semibold text-ink tnum">{loading ? "…" : (value ?? 0)}</div>
      <div className="mt-0.5 text-[11px] text-faint">{label}</div>
    </div>
  );
}
