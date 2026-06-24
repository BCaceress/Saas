import Link from "next/link";
import {
  PackageX,
  TrendingDown,
  Store,
  ScanBarcode,
  Boxes,
  ReceiptText,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Eyebrow } from "@/components/ui/misc";
import { SkuTag } from "@/components/sku-tag";
import { StockGauge } from "@/components/stock-gauge";
import { Pricing } from "./_components/pricing";
import { Faq } from "./_components/faq";

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        <div>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            O controle da sua adega,
            <br />
            <span className="text-brand">do fardo ao gole.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
            ERP para mercados de bebidas que entende garrafa fechada e dose aberta.
            Cadastre por código de barras, acompanhe o estoque de verdade e pare de
            perder venda por ruptura.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/cadastro">
              <Button size="lg" className="gap-2">
                Testar grátis por 14 dias <ArrowRight size={18} />
              </Button>
            </Link>
            <Link href="#modulos">
              <Button size="lg" variant="outline">Ver por dentro</Button>
            </Link>
          </div>
          <p className="mt-5 font-mono text-xs uppercase tracking-wider text-faint">
            Usado por mercadinhos, conveniências e adegas de bairro
          </p>
        </div>

        {/* Assinatura: prévia real da tela de produtos */}
        <HeroPreview />
      </section>

      {/* ── Problema → Solução ─────────────────────────────── */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Eyebrow>O que dói no balcão</Eyebrow>
          <h2 className="mt-2 max-w-xl font-display text-2xl font-semibold text-ink sm:text-3xl">
            Três buracos que comem a margem — e como o NoHub fecha cada um.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Problem
              icon={<PackageX size={20} />}
              title="Ruptura de estoque"
              text="Acaba a marca que mais vende num sábado à noite. Estoque mínimo e ideal por produto avisam antes de faltar."
            />
            <Problem
              icon={<TrendingDown size={20} />}
              title="Perda silenciosa"
              text="Dose servida, garrafa quebrada, validade vencida. Dois saldos — fechado e aberto — mostram para onde o produto foi."
            />
            <Problem
              icon={<Store size={20} />}
              title="Vários pontos, um caos"
              text="Cada ponto com a sua planilha. Um cadastro só, abastecido por um CD, com visão consolidada."
            />
          </div>
        </div>
      </section>

      {/* ── Módulos ────────────────────────────────────────── */}
      <section id="modulos" className="mx-auto max-w-6xl px-5 py-16">
        <Eyebrow>Por dentro</Eyebrow>
        <h2 className="mt-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
          Construído na ordem em que o mercado funciona.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <Module
            tag="Disponível"
            tone="ok"
            icon={<Boxes size={18} />}
            title="Produtos"
            text="Simples, insumos, combos e receitas num cadastro só. SKU automático, marcas e categorias que se completam enquanto você digita."
          />
          <Module
            tag="Disponível"
            tone="ok"
            icon={<ScanBarcode size={18} />}
            title="Cadastro por código de barras"
            text="Escaneou o EAN, a IA preenche nome, marca, categoria e dados fiscais. Você só revisa e salva."
          />
          <Module
            tag="Em breve"
            tone="neutral"
            icon={<ReceiptText size={18} />}
            title="PDV e fiscal"
            text="Venda no balcão, baixa de estoque na unidade certa e emissão de nota — já previstos no cadastro de hoje."
          />
          <Module
            tag="Em breve"
            tone="neutral"
            icon={<Store size={18} />}
            title="Reposição e rota"
            text="CD que abastece os pontos, pedidos de reposição e rota de entrega para a operação autônoma."
          />
        </div>
      </section>

      {/* ── Planos ─────────────────────────────────────────── */}
      <section id="planos" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mb-2 text-center">
            <Eyebrow>Planos</Eyebrow>
          </div>
          <h2 className="text-center font-display text-2xl font-semibold text-ink sm:text-3xl">
            Comece pequeno. Cresça quando o mercado crescer.
          </h2>
          <p className="mx-auto mt-2 mb-10 max-w-md text-center text-muted">
            Teste grátis nos planos Starter e Pro. Sem cartão, sem fidelidade.
          </p>
          <Pricing />
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-16">
        <Eyebrow>Dúvidas</Eyebrow>
        <h2 className="mt-2 mb-8 font-display text-2xl font-semibold text-ink sm:text-3xl">
          Antes de testar, o que costumam perguntar.
        </h2>
        <Faq />
      </section>

      {/* ── Footer CTA ─────────────────────────────────────── */}
      <section className="bg-ink">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold text-white">
            Seu estoque organizado ainda esta semana.
          </h2>
          <p className="max-w-md text-white/70">
            14 dias para cadastrar, importar a planilha antiga e ver a margem de cada
            produto. Se não servir, é só não continuar.
          </p>
          <Link href="/cadastro">
            <Button size="lg" className="gap-2">
              Criar minha conta grátis <ArrowRight size={18} />
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}

function HeroPreview() {
  const rows = [
    { nome: "Heineken Long Neck 330ml", sku: "BEB-CER-6489", preco: "R$ 7,90", fechado: 48, ideal: 60, min: 24 },
    { nome: "Coca-Cola 2L", sku: "BEB-REF-1207", preco: "R$ 9,50", fechado: 12, ideal: 40, min: 18 },
    { nome: "Vodka Absolut 1L", sku: "BEB-DES-3344", preco: "R$ 89,00", fechado: 4, ideal: 6, min: 2, frac: true, aberto: 200, conteudo: 1000 },
  ];
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-brand-soft/60 blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-2)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-display text-sm font-semibold text-ink">Produtos</span>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-strong">
            <ScanBarcode size={13} /> Escanear EAN
          </span>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Preço</th>
              <th className="px-4 py-2 font-medium">Estoque</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.sku}>
                <td className="px-4 py-3">
                  <div className="text-[13px] font-medium text-ink">{r.nome}</div>
                  <SkuTag sku={r.sku} className="mt-1" />
                </td>
                <td className="px-4 py-3 font-mono text-[13px] text-ink-2 tnum">{r.preco}</td>
                <td className="px-4 py-3">
                  <StockGauge
                    fechado={r.fechado}
                    ideal={r.ideal}
                    minimo={r.min}
                    fracionavel={r.frac}
                    aberto={r.aberto}
                    conteudoPorUnidade={r.conteudo}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Problem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div>
      <div className="grid h-10 w-10 place-items-center rounded-[var(--radius)] bg-accent-soft text-accent">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Module({
  tag,
  tone,
  icon,
  title,
  text,
}: {
  tag: string;
  tone: "ok" | "neutral";
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-canvas p-6">
      <div className="flex items-center justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-[var(--radius)] bg-brand-soft text-brand-strong">
          {icon}
        </div>
        <Badge tone={tone}>{tag}</Badge>
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}
