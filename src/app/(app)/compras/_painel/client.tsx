"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShoppingBasket,
  PiggyBank,
  Tag,
  TriangleAlert,
  ClipboardList,
  PackageSearch,
  Sparkles,
  ArrowRight,
  Loader2,
  CircleAlert,
  Info,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Scale,
  FileQuestion,
  History,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { EstadoVazio, Metrica, MetricaGrid, SupplierAvatar, fmtMoney, fmtPreco, fmtQtd, fmtQuando } from "../_catalogo/ui";
import { adicionarLoteAoCarrinhoAction } from "../_catalogo/actions";
import type { PainelCompras, SugestaoCompra } from "./data";

// ============================================================
// Central Inteligente de Compras. Zero configuração: só decisão.
//
// A ordem da tela é a ordem da pergunta do comprador —
// "o que comprar" → "de quem" → "quanto economizo" → "o que precisa de atenção".
// ============================================================

const STATUS_META: Record<
  SugestaoCompra["status"],
  { label: string; tone: "danger" | "warn" | "accent" | "neutral" }
> = {
  ruptura: { label: "Sem estoque", tone: "danger" },
  critico: { label: "Crítico", tone: "danger" },
  abaixo: { label: "Abaixo do mínimo", tone: "warn" },
  monitorar: { label: "Monitorar", tone: "neutral" },
};

/**
 * Onde se decide compra. Ficam aqui porque o menu lateral de Compras tem só
 * três linhas — o painel é a porta de entrada das demais telas operacionais.
 */
const ATALHOS = [
  { href: "/compras/reposicao-inteligente", label: "Reposição inteligente", icon: Sparkles },
  { href: "/compras/comparador", label: "Comparador", icon: Scale },
  { href: "/compras/carrinho", label: "Cesta", icon: ShoppingBasket },
  { href: "/compras/cotacoes", label: "Cotações", icon: FileQuestion },
  { href: "/compras/historico", label: "Histórico de preços", icon: History },
  { href: "/fornecedores", label: "Fornecedores", icon: Truck },
] as const;

const IMPORT_META: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; icon: React.ElementType }> = {
  CONCLUIDA: { label: "Concluída", tone: "ok", icon: CheckCircle2 },
  CONCLUIDA_COM_ERROS: { label: "Com avisos", tone: "warn", icon: AlertCircle },
  FALHOU: { label: "Falhou", tone: "danger", icon: AlertCircle },
  PROCESSANDO: { label: "Processando", tone: "neutral", icon: Clock3 },
  PENDENTE: { label: "Na fila", tone: "neutral", icon: Clock3 },
};

export function PainelComprasCliente({
  dados,
  podePedir,
}: {
  dados: PainelCompras;
  podePedir: boolean;
}) {
  const { resumo, sugestoes, importacoes, alertas } = dados;

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid>
        <Metrica
          label="Produtos para comprar"
          valor={String(resumo.produtosParaComprar)}
          sub={resumo.produtosCriticos > 0 ? `${resumo.produtosCriticos} críticos` : "nada urgente"}
          tom={resumo.produtosCriticos > 0 ? "accent" : "ink"}
          icon={<ShoppingBasket size={12} />}
        />
        <Metrica
          label="Economia possível"
          valor={fmtMoney(resumo.economiaPossivel)}
          sub={`${resumo.produtosComparaveis} produtos com 2+ ofertas`}
          tom="accent"
          icon={<PiggyBank size={12} />}
        />
        <Metrica
          label="Promoções encontradas"
          valor={resumo.promocoes.toLocaleString("pt-BR")}
          sub="ofertas vigentes"
          tom={resumo.promocoes > 0 ? "accent" : "ink"}
          icon={<Tag size={12} />}
        />
        <Metrica
          label="Sem fornecedor"
          valor={String(resumo.produtosSemFornecedor)}
          sub="produtos fora da sugestão"
          tom={resumo.produtosSemFornecedor > 0 ? "accent" : "ok"}
          icon={<PackageSearch size={12} />}
        />
        <Metrica
          label="Preço desatualizado"
          valor={String(resumo.produtosSemPrecoAtualizado)}
          sub="itens parados há 30+ dias"
          tom={resumo.produtosSemPrecoAtualizado > 0 ? "accent" : "ok"}
          icon={<TriangleAlert size={12} />}
        />
        <Metrica
          label="Pedidos pendentes"
          valor={String(resumo.pedidosPendentes)}
          sub={
            resumo.pedidosAtrasados > 0
              ? `${resumo.pedidosAtrasados} atrasados`
              : fmtMoney(resumo.valorPedidosPendentes)
          }
          tom={resumo.pedidosAtrasados > 0 ? "accent" : "ink"}
          icon={<ClipboardList size={12} />}
        />
      </MetricaGrid>

      <nav aria-label="Ações de compra" className="flex flex-wrap items-center gap-2">
        {ATALHOS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand"
          >
            <a.icon size={14} />
            {a.label}
          </Link>
        ))}
      </nav>

      {alertas.length > 0 && (
        <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {alertas.map((a) => {
            const Icone = a.tom === "danger" ? CircleAlert : a.tom === "warn" ? TriangleAlert : Info;
            return (
              <Link
                key={a.titulo}
                href={a.href}
                className={cn(
                  "flex items-start gap-2.5 rounded-[var(--radius-lg)] border p-3 transition-colors",
                  a.tom === "danger"
                    ? "border-danger/40 bg-danger-soft/30 hover:bg-danger-soft/50"
                    : a.tom === "warn"
                      ? "border-warn/40 bg-warn-soft/30 hover:bg-warn-soft/50"
                      : "border-line bg-surface hover:bg-surface-2",
                )}
              >
                <Icone
                  size={15}
                  className={cn(
                    "mt-0.5 shrink-0",
                    a.tom === "danger" ? "text-danger" : a.tom === "warn" ? "text-warn" : "text-brand",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{a.titulo}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{a.detalhe}</p>
                  <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-brand">
                    {a.acao} <ArrowRight size={12} />
                  </p>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <PainelSugestoes sugestoes={sugestoes} podePedir={podePedir} aprendendo={dados.aprendendo} />

      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-ink">
              <FileUp size={15} className="text-brand" /> Últimas importações
            </h2>
            <p className="text-[12px] text-muted">
              De onde vieram os preços que sustentam as sugestões acima.
            </p>
          </div>
          <Link href="/compras/importacoes">
            <Button size="sm" variant="ghost">
              Ver todas <ArrowRight size={14} />
            </Button>
          </Link>
        </div>

        {importacoes.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">
            Nenhuma tabela importada ainda. Configure a integração de um fornecedor para começar.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {importacoes.map((imp) => {
              const meta = IMPORT_META[imp.status] ?? IMPORT_META.PENDENTE;
              const Icone = meta.icon;
              return (
                <Link
                  key={imp.id}
                  href={`/fornecedores/${imp.supplierId}/integracao`}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{imp.supplierNome}</p>
                    <p className="truncate text-[11px] text-faint">
                      {imp.arquivoNome ?? imp.origem} · {fmtQuando(imp.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[12px]">
                    <span className="font-mono text-ink" title="Produtos lidos">
                      {imp.itensLidos}
                    </span>
                    <span className="font-mono text-ok" title="Produtos novos">
                      +{imp.itensNovos}
                    </span>
                    <span className="font-mono text-muted" title="Produtos atualizados">
                      ~{imp.itensAtualizados}
                    </span>
                    {imp.itensSemVinculo > 0 && (
                      <span className="font-mono text-warn" title="Produtos não encontrados">
                        ?{imp.itensSemVinculo}
                      </span>
                    )}
                    <Badge tone={meta.tone}>
                      <Icone size={11} />
                      {meta.label}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Sugestão inteligente de compra ──────────────────────────

function PainelSugestoes({
  sugestoes,
  podePedir,
  aprendendo,
}: {
  sugestoes: SugestaoCompra[];
  podePedir: boolean;
  aprendendo: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adicionados, setAdicionados] = useState<Set<string>>(new Set());

  const comOferta = sugestoes.filter((s) => s.catalogItemId);
  const economiaTotal = sugestoes.reduce((soma, s) => soma + s.economia, 0);

  function adicionar(itens: SugestaoCompra[]) {
    const alvo = itens.filter((s) => s.catalogItemId && !adicionados.has(s.productId));
    if (alvo.length === 0) return;

    start(async () => {
      try {
        await adicionarLoteAoCarrinhoAction(
          alvo.map((s) => ({ catalogItemId: s.catalogItemId as string, quantidade: s.quantidade })),
        );
        setAdicionados((atual) => new Set([...atual, ...alvo.map((s) => s.productId)]));
        toast.success(
          alvo.length === 1 ? "Adicionado à cesta" : `${alvo.length} itens na cesta`,
          "Feche o pedido de cada fornecedor em Compras › Cesta.",
        );
        router.refresh();
      } catch (e) {
        toast.error("Não deu para adicionar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  if (sugestoes.length === 0) {
    return (
      <EstadoVazio
        icon={<Sparkles size={20} />}
        titulo={aprendendo ? "Ainda aprendendo o giro da loja" : "Nada para comprar agora"}
        descricao={
          aprendendo
            ? "A sugestão por rotatividade precisa de algumas semanas de venda. Enquanto isso, use o comparador para achar o melhor preço."
            : "Todo produto está acima do mínimo e não há pedido pendente vencido. A tela volta a encher sozinha conforme o estoque cai."
        }
        acao={
          <Link href="/compras/comparador">
            <Button size="sm" variant="secondary">
              <Scale size={14} /> Abrir comparador
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-ink">
            <Sparkles size={15} className="text-brand" /> Sugestão inteligente de compra
          </h2>
          <p className="text-[12px] text-muted">
            O que repor, de quem comprar mais barato e quanto isso economiza.
            {economiaTotal > 0 && (
              <>
                {" "}
                Nesta lista:{" "}
                <span className="font-mono font-semibold text-accent">{fmtMoney(economiaTotal)}</span>.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {podePedir && comOferta.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => adicionar(comOferta)} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBasket size={14} />}
              Tudo na cesta
            </Button>
          )}
          <Link href="/compras/reposicao-inteligente">
            <Button size="sm">
              Revisar tudo <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Comprar</th>
              <th className="px-3 py-2.5 text-right font-medium">Quanto</th>
              <th className="px-3 py-2.5 font-medium">Fornecedor</th>
              <th className="px-3 py-2.5 text-right font-medium">Preço un.</th>
              <th className="px-3 py-2.5 text-right font-medium">Economia</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sugestoes.map((s) => {
              const meta = STATUS_META[s.status];
              const naCesta = adicionados.has(s.productId);
              return (
                <tr key={s.productId} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="max-w-72 px-4 py-2.5">
                    <p className="truncate font-medium text-ink">{s.nome}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-faint">{s.sku}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </p>
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono text-[13px] font-semibold text-ink">
                      {fmtQtd(s.quantidade)}
                    </span>
                    {s.unidade && <span className="ml-1 text-[11px] text-faint">{s.unidade}</span>}
                  </td>

                  <td className="max-w-52 px-3 py-2.5">
                    {s.supplierId ? (
                      <Link
                        href={`/fornecedores/${s.supplierId}/catalogo`}
                        className="flex items-center gap-2 hover:text-brand"
                      >
                        <SupplierAvatar nome={s.supplierNome} logoUrl={s.supplierLogoUrl} size={26} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{s.supplierNome}</span>
                          {s.ofertas > 1 && (
                            <span className="block text-[11px] text-faint">
                              {s.ofertas} ofertas comparadas
                            </span>
                          )}
                        </span>
                      </Link>
                    ) : (
                      <Badge tone="warn">sem fornecedor</Badge>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right font-mono text-[13px] text-ink">
                    {s.precoUnitario != null ? fmtPreco(s.precoUnitario) : "—"}
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    {s.economia > 0 ? (
                      <span
                        className="font-mono text-[13px] font-semibold text-accent"
                        title={s.comparadoCom ? `Contra ${s.comparadoCom}` : undefined}
                      >
                        {fmtMoney(s.economia)}
                      </span>
                    ) : (
                      <span className="text-[12px] text-faint">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    {podePedir && s.catalogItemId ? (
                      <Button
                        size="sm"
                        variant={naCesta ? "ghost" : "secondary"}
                        onClick={() => adicionar([s])}
                        disabled={pending || naCesta}
                      >
                        {naCesta ? <CheckCircle2 size={14} /> : <ShoppingBasket size={14} />}
                        {naCesta ? "Na cesta" : "Adicionar"}
                      </Button>
                    ) : (
                      <Link href="/compras/reposicao-inteligente">
                        <Button size="sm" variant="ghost">
                          Pedir
                        </Button>
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
