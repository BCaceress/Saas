import Link from "next/link";
import {
  PackageX,
  TrendingDown,
  Store,
  ScanBarcode,
  Boxes,
  ReceiptText,
  ArrowRight,
  ShoppingCart,
  Truck,
  ScanLine,
  MonitorSmartphone,
  Users,
  BarChart3,
  Handshake,
  ShieldCheck,
  Lock,
  Download,
  CreditCard,
  Sparkles,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Eyebrow } from "@/components/ui/misc";
import { brl } from "@/lib/utils";
import {
  PLANOS,
  ADDONS,
  ADDONS_SLUGS,
  planoMinimo,
  TRIAL_DIAS,
  type Feature,
} from "@/lib/planos";
import { HeroVisual } from "./_components/hero-visual";
import { Screens } from "./_components/screens";
import { Pricing } from "./_components/pricing";
import { Faq } from "./_components/faq";

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-14 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-28">
          <div>
            <span className="mkt-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-medium text-ink-2 backdrop-blur">
              <Sparkles size={13} className="text-brand" />
              {TRIAL_DIAS} dias grátis · sem cartão
            </span>

            <h1
              className="mkt-rise mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]"
              style={{ animationDelay: "60ms" }}
            >
              O mercado inteiro
              <br />
              <span className="text-brand">numa tela só.</span>
            </h1>

            <p
              className="mkt-rise mt-5 max-w-lg text-lg leading-relaxed text-muted"
              style={{ animationDelay: "120ms" }}
            >
              ERP para mercadinho, conveniência, adega e mercado autônomo. Produto, estoque,
              compra, frente de caixa, nota fiscal e cliente no mesmo sistema — sem juntar
              cinco assinaturas e três planilhas.
            </p>

            <div
              className="mkt-rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "180ms" }}
            >
              <Link href="/cadastro">
                <Button size="lg" className="gap-2">
                  Criar minha conta grátis <ArrowRight size={18} />
                </Button>
              </Link>
              <a href="#telas">
                <Button size="lg" variant="secondary">
                  Ver o sistema por dentro
                </Button>
              </a>
            </div>

            <p
              className="mkt-rise mt-5 text-[13px] text-muted"
              style={{ animationDelay: "240ms" }}
            >
              Prefere conversar antes?{" "}
              <a
                href="mailto:contato@nohub.market"
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                Fale com a gente
              </a>{" "}
              — respondemos em pt-BR, por gente.
            </p>
          </div>

          <div className="mkt-rise" style={{ animationDelay: "200ms" }}>
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ── Fatos ──────────────────────────────────────────── */}
      {/* Grid único com divisores (não cards soltos): a faixa é uma leitura só. */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-line px-5 sm:divide-x lg:grid-cols-4">
          {[
            { n: "12", t: "módulos no ar", d: "de produtos a fiscal" },
            { n: `${TRIAL_DIAS} dias`, t: "de teste", d: "sem cartão, sem fidelidade" },
            { n: `${brl(PLANOS.PRATA.preco)}`, t: "para começar", d: "cobrança mensal" },
            { n: "1 min", t: "para o primeiro produto", d: "leu o EAN, a IA preenche" },
          ].map((f, i) => (
            <div
              key={f.t}
              className={`flex flex-col gap-0.5 px-0 py-7 sm:px-6 ${i === 0 ? "sm:pl-0" : ""}`}
            >
              <span className="font-display text-2xl font-bold text-ink tnum">{f.n}</span>
              <span className="text-sm font-medium text-ink-2">{f.t}</span>
              <span className="text-[13px] text-muted">{f.d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problema → Solução ─────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <Eyebrow>O que dói no balcão</Eyebrow>
        <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Três buracos que comem a margem — e como o NoHub fecha cada um.
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          <Problem
            icon={<PackageX size={20} />}
            title="Ruptura de estoque"
            text="Acaba a marca que mais vende num sábado à noite. Estoque mínimo e ideal por produto avisam antes de faltar — e o pedido de compra já sai pronto."
          />
          <Problem
            icon={<TrendingDown size={20} />}
            title="Perda silenciosa"
            text="Dose servida, garrafa quebrada, validade vencida. Dois saldos — fechado e aberto — mais controle de lote por validade mostram para onde o produto foi."
          />
          <Problem
            icon={<Store size={20} />}
            title="Vários pontos, um caos"
            text="Cada ponto com a sua planilha. Um cadastro só, transferência entre lojas e visão consolidada de todas elas."
          />
        </div>
      </section>

      {/* ── Módulos ────────────────────────────────────────── */}
      <section id="recursos" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Eyebrow>Recursos</Eyebrow>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Construído na ordem em que o mercado funciona.
          </h2>
          <p className="mt-3 max-w-xl text-muted">
            Nada aqui é promessa de roadmap: tudo abaixo já está no ar. O que muda entre os
            planos é o quanto você libera.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULOS.map((m) => (
              <Module key={m.title} {...m} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Telas ──────────────────────────────────────────── */}
      <section id="telas" className="mx-auto max-w-6xl px-5 py-20">
        <Eyebrow>Por dentro</Eyebrow>
        <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          As telas que o operador abre todo dia.
        </h2>
        <div className="mt-10">
          <Screens />
        </div>
      </section>

      {/* ── Faixa escura: um sistema, não seis assinaturas ─── */}
      <section className="mkt-slab">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Eyebrow className="text-white/50">Por que trocar</Eyebrow>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Um sistema, não seis assinaturas amarradas com planilha.
          </h2>

          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
                Como costuma ser
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                {[
                  "Um PDV que não conversa com o estoque",
                  "Planilha de compras separada do fornecedor",
                  "Contador pedindo XML por WhatsApp",
                  "Relatório que só existe se alguém montar à mão",
                  "Cada loja com um número diferente do total",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-white/55">
                    <span
                      aria-hidden
                      className="mt-2 h-1 w-3 shrink-0 rounded-full bg-white/25"
                    />
                    <span className="text-[15px] leading-relaxed line-through decoration-white/25">
                      {t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand">
                Com o NoHub
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                {[
                  "A venda no caixa baixa o estoque na unidade certa",
                  "Pedido → recebimento → entrada, com custo médio calculado",
                  "NFC-e e NF-e emitidas e guardadas no mesmo lugar",
                  "Relatório que você monta uma vez e agenda por e-mail",
                  "Todas as lojas somadas, e cada uma separada quando precisar",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <Check size={17} className="mt-0.5 shrink-0 text-brand" />
                    <span className="text-[15px] leading-relaxed text-white/90">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Planos ─────────────────────────────────────────── */}
      <section id="planos" className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-center">
          <Eyebrow>Planos</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Comece pequeno. Cresça quando o mercado crescer.
          </h2>
          <p className="mx-auto mt-3 mb-12 max-w-lg text-muted">
            {TRIAL_DIAS} dias de teste em qualquer plano, sem cartão e sem fidelidade. Troque de
            plano por dentro do sistema, quando quiser.
          </p>
        </div>
        <Pricing />
      </section>

      {/* ── Confiança ──────────────────────────────────────── */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Eyebrow>Seus dados</Eyebrow>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Trocar de sistema não pode ser uma aposta.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Trust
              icon={<Lock size={18} />}
              title="Isolados por mercado"
              text="Cada mercado tem seus dados separados no banco, com isolamento aplicado em duas camadas. Ninguém vê o que é seu."
            />
            <Trust
              icon={<Download size={18} />}
              title="Exportáveis sempre"
              text="Relatórios em CSV e XML fiscal na mão a qualquer momento. Seus dados continuam seus, inclusive na saída."
            />
            <Trust
              icon={<ShieldCheck size={18} />}
              title="LGPD e cliente"
              text="Cadastro de cliente com consentimento, e exclusão completa quando você pedir."
            />
            <Trust
              icon={<CreditCard size={18} />}
              title="Cobrança transparente"
              text="Mercado Pago, mensal, sem multa de cancelamento. O preço na tela é o preço da fatura."
            />
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
        <Eyebrow>Dúvidas</Eyebrow>
        <h2 className="mt-2 mb-8 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Antes de testar, o que costumam perguntar.
        </h2>
        <Faq />
      </section>

      {/* ── Footer CTA ─────────────────────────────────────── */}
      <section className="mkt-slab">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-20 text-center">
          <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Seu estoque organizado ainda esta semana.
          </h2>
          <p className="max-w-md leading-relaxed text-white/65">
            {TRIAL_DIAS} dias para cadastrar, importar a planilha antiga e ver a margem de cada
            produto. Se não servir, é só não continuar.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link href="/cadastro">
              <Button size="lg" className="gap-2">
                Criar minha conta grátis <ArrowRight size={18} />
              </Button>
            </Link>
            <a href="mailto:contato@nohub.market">
              <Button
                size="lg"
                variant="outline"
                className="border-white/25 text-white hover:bg-white/10"
              >
                Falar com a gente
              </Button>
            </a>
          </div>
          <p className="text-xs text-white/40">
            Sem cartão para começar · cancele quando quiser
          </p>
        </div>
      </section>
    </>
  );
}

/* ── Módulos ──────────────────────────────────────────────── */

type ModuloDef = {
  icon: React.ReactNode;
  title: string;
  text: string;
  /** Quando existe, a etiqueta do card é derivada de `lib/planos`. */
  feature?: Feature;
};

const MODULOS: ModuloDef[] = [
  {
    icon: <Boxes size={18} />,
    title: "Produtos e catálogo",
    text: "Simples, insumos, combos e receitas num cadastro só. SKU automático, marcas e categorias que se completam enquanto você digita.",
  },
  {
    icon: <ScanBarcode size={18} />,
    title: "Cadastro por código de barras",
    text: "Escaneou o EAN, a IA preenche nome, marca, categoria e dados fiscais. Você só revisa e salva.",
  },
  {
    icon: <PackageX size={18} />,
    title: "Estoque com dois saldos",
    text: "Garrafa fechada e dose aberta separadas, controle de lote por validade (FEFO) e alerta antes de vencer.",
  },
  {
    icon: <ShoppingCart size={18} />,
    title: "Compras e cotações",
    text: "Pedido, recebimento e entrada com custo médio. Peça preço a vários fornecedores e compare item a item.",
    feature: "compras.recebimento",
  },
  {
    icon: <Truck size={18} />,
    title: "Fornecedores",
    text: "Tabela de preço importada ou por API, comparador de cesta e histórico de cada compra num centro de gestão só.",
  },
  {
    icon: <ScanLine size={18} />,
    title: "PDV e caixa",
    text: "Frente de caixa com leitor, abertura e fechamento de caixa, Pix e cartão pelo Mercado Pago, sangria e conferência.",
    feature: "pdv",
  },
  {
    icon: <MonitorSmartphone size={18} />,
    title: "Autoatendimento",
    text: "Modo quiosque para o cliente comprar sozinho, com fila integrada ao caixa do balcão.",
    feature: "autoatendimento",
  },
  {
    icon: <ReceiptText size={18} />,
    title: "Fiscal",
    text: "NFC-e e NF-e com certificado próprio, manifestação de documentos e entrada de nota do fornecedor pelo XML.",
    feature: "fiscal",
  },
  {
    icon: <Users size={18} />,
    title: "Clientes e fidelização",
    text: "Histórico de compra, níveis, cupom automático e aviso de cliente em risco de sumir.",
    feature: "crm.fidelizacao",
  },
  {
    icon: <BarChart3 size={18} />,
    title: "Relatórios",
    text: "Curva ABC, giro, margem e ruptura. Monte o relatório que faltar, salve como modelo e exporte em CSV.",
    feature: "relatorios.avancados",
  },
  {
    icon: <Handshake size={18} />,
    title: "Comodato",
    text: "Freezer, chopeira e ativos emprestados ao cliente, com contrato e devolução controlados.",
    feature: "comodato",
  },
  {
    icon: <Store size={18} />,
    title: "Multi-loja e rota",
    text: "Um CD abastecendo os pontos, transferência entre lojas e rota de reposição para a operação autônoma.",
    feature: "multiloja",
  },
];

/** Etiqueta do módulo, derivada da fonte comercial — nunca escrita à mão. */
function etiqueta(feature?: Feature): { texto: string; tone: "neutral" | "brand" | "accent" } {
  if (!feature) return { texto: "Todos os planos", tone: "neutral" };
  const min = planoMinimo(feature);
  const addon = ADDONS_SLUGS.find((s) => ADDONS[s].feature === feature);
  if (min && addon) return { texto: `${PLANOS[min].nome} ou add-on`, tone: "brand" };
  if (min) return { texto: `A partir do ${PLANOS[min].nome}`, tone: "brand" };
  if (addon) return { texto: `Add-on · ${brl(ADDONS[addon].preco)}/mês`, tone: "accent" };
  return { texto: "Todos os planos", tone: "neutral" };
}

function Problem({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div>
      <div className="grid h-11 w-11 place-items-center rounded-[var(--radius)] bg-accent-soft text-accent">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Module({ icon, title, text, feature }: ModuloDef) {
  const tag = etiqueta(feature);
  return (
    <div className="card-hover flex flex-col rounded-[var(--radius-lg)] border border-line bg-canvas p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-brand-soft text-brand-strong">
          {icon}
        </div>
        <Badge tone={tag.tone}>{tag.texto}</Badge>
      </div>
      <h3 className="mt-4 font-display text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Trust({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] bg-ok-soft text-ok">
        {icon}
      </div>
      <h3 className="mt-1 font-display text-base font-semibold text-ink">{title}</h3>
      <p className="text-[13px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}
