import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  PackageMinus,
  PackageSearch,
  ShoppingBasket,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { withTenant, type ActiveTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { db } from "@/lib/prisma";
import { resolvePeriodo, variacao, type Variacao } from "@/lib/periodo";
import { brl, cn } from "@/lib/utils";
import {
  Bolha,
  MCard,
  MCardLink,
  Sparkline,
  TOM_FUNDO,
  TOM_TEXTO,
  type Tom,
} from "@/components/mobile/ui";
import { KpiCarousel, KpiSlide } from "@/components/mobile/kpi-carousel";
import { itensVendidos, resumoVendas, serieFinanceiraDiaria, type Range } from "@/app/(app)/relatorios/_data";
import { contarNiveisEstoque, contarVencimentos } from "@/app/(app)/estoque/_data";
import { pedidosEmAndamento } from "@/app/(app)/inicio/_data";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";

/**
 * Blocos da home mobile. Cada um é uma ilha de `<Suspense>` da página.
 *
 * Cada seção reabre `withTenant`: o AsyncLocalStorage do tenant NÃO atravessa a
 * fronteira de streaming do React — a mesma regra documentada em
 * `(app)/inicio/_sections.tsx`. Sem isso a query sai sem tenantId e estoura.
 *
 * A home NÃO usa `buildInsights`: aquele motor pede quinze carregadores (o
 * dashboard inteiro) para escrever um parágrafo. No celular a mesma pergunta —
 * "o que precisa de mim agora?" — já é respondida por `getAlerts()`, numa
 * chamada só, já ordenada por prioridade. Ver `_precisa-de-voce.tsx`.
 */

export type MobileCtx = {
  ctx: ActiveTenant;
  range: Range;
  prevRange: Range;
  siteId: string | null;
  policy: EstoquePolicy;
  validadeAlertaDias: number;
};

/* ── Indicadores do dia ─────────────────────────────────────── */

export async function KpisSection({ d }: { d: MobileCtx }) {
  // A tendência (sparkline) é sempre "últimos 7 dias", independente do
  // período do card (hoje): mostra a forma da semana, não refaz o filtro.
  const serie7d: Range = (() => {
    const p = resolvePeriodo({ periodo: "7d" });
    return { inicio: p.inicio, fim: p.fim };
  })();

  // Cadastro só entra no carrossel para quem enxerga o cadastro: um card de
  // "0 clientes" para quem não tem o módulo é ruído, não indicador.
  const veProdutos = podeEmAlguma(d.ctx.acessos, "produto.ver");
  const veClientes = podeEmAlguma(d.ctx.acessos, "cliente.ver");

  const { resumo, prev, unidades, unidadesPrev, serie, produtos, clientes } = await withTenant(
    d.ctx,
    async () => {
      const [resumo, prev, unidades, unidadesPrev, serie, produtos, clientes] = await Promise.all([
        resumoVendas(d.range, d.siteId),
        resumoVendas(d.prevRange, d.siteId),
        itensVendidos(d.range, d.siteId),
        itensVendidos(d.prevRange, d.siteId),
        serieFinanceiraDiaria(serie7d, d.siteId),
        // Contagem, não listagem: os dois são `count` indexado por tenant, na
        // mesma ida das leituras que a seção já fazia.
        veProdutos ? db.product.count({ where: { ativo: true } }) : Promise.resolve(0),
        veClientes ? db.customer.count({ where: { ativo: true } }) : Promise.resolve(0),
      ]);
      return { resumo, prev, unidades, unidadesPrev, serie, produtos, clientes };
    },
  );

  return (
    // Carrossel de largura cheia, não duas colunas: o número do dia é a
    // manchete da tela e ninguém divide linha com ele. Quem avisa que há mais
    // indicadores para o lado são os pontos, já que não sobra borda de vizinho.
    <KpiCarousel pontos>
      <KpiSlide largura="cheia">
        <Tile
          label="Receita de hoje"
          valor={brl(resumo.faturamento)}
          delta={variacao(resumo.faturamento, prev.faturamento)}
          nota={`${resumo.numVendas} ${resumo.numVendas === 1 ? "venda" : "vendas"} · vs. ontem`}
          icone={DollarSign}
          tom="accent"
          serie={serie.map((p) => p.receita)}
        />
      </KpiSlide>
      <KpiSlide largura="cheia">
        <Tile
          label="Lucro bruto"
          valor={brl(resumo.margemBruta)}
          delta={variacao(resumo.margemBruta, prev.margemBruta)}
          nota={`${Math.round(resumo.margemPct)}% da receita · vs. ontem`}
          icone={TrendingUp}
          tom="ok"
          serie={serie.map((p) => p.lucro)}
        />
      </KpiSlide>
      {/* Quantas unidades saíram da prateleira. Fecha o trio do dia (dinheiro
          que entrou → dinheiro que sobrou → mercadoria que saiu) e é o número
          que o operador confere contra o que viu no salão. Sem tendência: a
          série diária é de receita e lucro, não de unidade. */}
      <KpiSlide largura="cheia">
        <Tile
          label="Itens vendidos"
          valor={unidades.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
          delta={variacao(unidades, unidadesPrev)}
          nota="unidades · vs. ontem"
          icone={ShoppingBasket}
          tom="info"
        />
      </KpiSlide>
      {/* Os dois de cadastro fecham o carrossel: são retrato, não movimento —
          não têm "vs. ontem" nem tendência, e por isso vêm depois dos dois
          números do dia. */}
      {veProdutos && (
        <KpiSlide largura="cheia">
          <Tile
            label="Produtos ativos"
            valor={produtos.toLocaleString("pt-BR")}
            nota="no catálogo"
            icone={PackageSearch}
            tom="brand"
            href="/m/produtos"
          />
        </KpiSlide>
      )}
      {veClientes && (
        <KpiSlide largura="cheia">
          <Tile
            label="Clientes ativos"
            valor={clientes.toLocaleString("pt-BR")}
            nota="cadastrados"
            icone={Users}
            tom="violeta"
            href="/m/clientes"
          />
        </KpiSlide>
      )}
    </KpiCarousel>
  );
}

export function KpisFallback() {
  return (
    <KpiCarousel>
      <KpiSlide largura="cheia">
        <MCard className="h-32 animate-pulse bg-surface-2" />
      </KpiSlide>
    </KpiCarousel>
  );
}

/** Variação em pastilha: tinta + fundo do próprio sinal, porque agora o card
 * é branco — verde sobre branco é legível sem competir com o valor. */
const TOM_DELTA = {
  up: "bg-ok-soft text-ok",
  down: "bg-danger-soft text-danger",
  flat: "bg-surface-2 text-muted",
} as const;

function Tile({
  label,
  valor,
  delta,
  nota,
  icone,
  tom,
  serie,
  href,
}: {
  label: string;
  valor: string;
  delta?: Variacao | null;
  nota?: string;
  icone: LucideIcon;
  tom: Tom;
  serie?: number[];
  /** Quando o número tem uma tela por trás, o card inteiro vira o alvo. */
  href?: string;
}) {
  const dir = delta?.dir ?? "flat";

  // h-32 fixo: os cards terminam todos na mesma linha. Cartão branco — a cor
  // do tom entra só no ícone, na tendência e (quando há) na pastilha.
  const classe = "fade-in-m flex h-32 flex-col justify-between overflow-hidden p-4";

  const miolo = (
    <>
      {/* Ícone e rótulo na mesma linha: o que o número mede se lê antes dele. */}
      <div className="flex items-center gap-2">
        <Bolha icone={icone} tom={tom} tamanho="sm" />
        <p className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium text-ink-2">
          {label}
        </p>
        {delta?.pct != null && (
          // Seta + sinal, não só cor: daltonismo não pode custar a leitura.
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[11px] leading-none font-semibold tabular-nums",
              TOM_DELTA[dir],
            )}
          >
            {dir === "up" ? "▲" : dir === "down" ? "▼" : "—"}
            {Math.abs(delta.pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
        )}
      </div>

      {/* O valor é o que se lê de longe, de pé: 30px, tinta cheia — a largura
          do carrossel é justamente o que compra esse tamanho. */}
      <p className="font-display text-[30px] leading-none font-semibold text-ink tabular-nums">
        {valor}
      </p>

      <div className="flex items-end justify-between gap-3">
        {nota && <p className="min-w-0 truncate text-[12px] text-muted">{nota}</p>}
        {serie && serie.length > 1 && (
          // A tendência é rodapé, não moldura: 80×28 no canto, do tamanho de
          // um gesto — quem quer a série abre o relatório.
          <div className="h-7 w-20 shrink-0">
            <Sparkline valores={serie} tom={tom} />
          </div>
        )}
      </div>
    </>
  );

  return href ? (
    <MCardLink href={href} className={classe}>
      {miolo}
    </MCardLink>
  ) : (
    <MCard className={classe}>{miolo}</MCard>
  );
}

/* ── Faixa de operação ──────────────────────────────────────── */

export async function OperacaoSection({ d }: { d: MobileCtx }) {
  const { niveis, vencimentos, pedidos } = await withTenant(d.ctx, async () => {
    const [niveis, vencimentos, pedidos] = await Promise.all([
      // `contarNiveisEstoque` no lugar de `ruptura`: a faixa só precisa de dois
      // números, e não da lista de produtos com déficit calculado.
      contarNiveisEstoque(d.siteId, d.policy),
      contarVencimentos(d.siteId, d.validadeAlertaDias),
      pedidosEmAndamento(d.siteId),
    ]);
    return { niveis, vencimentos, pedidos };
  });

  const chegamHoje = pedidos.filter((p) => p.previsaoHoje).length;

  type Linha = {
    href: string;
    icone: LucideIcon;
    label: string;
    valor: number;
    tom: Tom;
    nota: string;
  };

  const linhas: Linha[] = [
    {
      href: "/m/estoque?filtro=sem",
      icone: AlertTriangle,
      label: "Sem estoque",
      valor: niveis.sem,
      tom: "danger",
      // Sem nome de produto: um só entre dezenas mente sobre o resto, e a
      // lista inteira está a um toque daqui.
      nota: niveis.sem > 0 ? "repor hoje" : "nada em falta",
    },
    // Só onde existe piso: com ROTATIVIDADE não há mínimo a violar, e um card
    // eternamente zerado ocuparia lugar de pendência de verdade.
    ...(d.policy.usaMinimo
      ? [
          {
            href: "/m/estoque?filtro=minimo",
            icone: PackageMinus,
            label: "Estoque baixo",
            valor: niveis.baixo,
            tom: "warn" as const,
            nota: niveis.baixo > 0 ? "abaixo do mínimo" : "todos no nível",
          },
        ]
      : []),
    {
      // Validade continua no desktop: `/m/estoque` mostra saldo, não lote.
      href: "/estoque/validade",
      icone: CalendarClock,
      label: "Validade",
      valor: vencimentos.vencidos + vencimentos.vencendo,
      tom: vencimentos.vencidos > 0 ? "danger" : "warn",
      nota:
        vencimentos.vencidos > 0
          ? `${vencimentos.vencidos} já ${vencimentos.vencidos === 1 ? "vencido" : "vencidos"}`
          : vencimentos.vencendo > 0
            ? "vencendo em breve"
            : "nada vencendo",
    },
    {
      href: "/m/receber",
      icone: Truck,
      label: "Pedidos a receber",
      valor: pedidos.length,
      tom: "info",
      nota: chegamHoje > 0 ? `${chegamHoje} ${chegamHoje === 1 ? "chega" : "chegam"} hoje` : "nenhum previsto hoje",
    },
  ];

  return (
    // Duas colunas, não três: com quatro pendências a coluna de 118px virava
    // texto truncado. O card agora lê na horizontal — ícone e número na linha
    // de cima, rótulo e nota embaixo — e a COR carrega o estado: quem tem
    // número acende no próprio tom, quem está zerado fica branco e quieto.
    // É o oposto do desenho anterior, onde os quatro brilhavam igual e o
    // "nada em falta" verde competia com o "3 vencidos" vermelho.
    <div className="grid grid-cols-2 gap-2">
      {linhas.map((l, i) => {
        const ativo = l.valor > 0;
        const ultimoSozinho = i === linhas.length - 1 && linhas.length % 2 === 1;
        return (
          <Link
            key={l.label}
            href={l.href}
            className={cn(
              "tap fade-in-m flex min-h-24 flex-col justify-between gap-3 rounded-[var(--radius-m)] border p-3.5",
              "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
              ativo
                ? cn(TOM_FUNDO[l.tom], "border-transparent active:brightness-95")
                : "border-line bg-surface shadow-[var(--shadow-m)] hover:border-line-strong active:bg-surface-2",
              ultimoSozinho && "col-span-2",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <Bolha
                icone={l.icone}
                tom={ativo ? l.tom : "neutro"}
                tamanho="sm"
                claro={ativo}
              />
              <span
                className={cn(
                  "font-display text-[26px] leading-none font-semibold tabular-nums",
                  ativo ? TOM_TEXTO[l.tom] : "text-faint",
                )}
              >
                {l.valor}
              </span>
            </div>

            <div className="min-w-0">
              <p className="truncate text-[13px] leading-tight font-medium text-ink">{l.label}</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-muted">{l.nota}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function OperacaoFallback() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MCard className="h-24 animate-pulse bg-surface-2" />
      <MCard className="h-24 animate-pulse bg-surface-2" />
      <MCard className="h-24 animate-pulse bg-surface-2" />
      <MCard className="h-24 animate-pulse bg-surface-2" />
    </div>
  );
}
