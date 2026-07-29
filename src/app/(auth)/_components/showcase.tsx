import Link from "next/link";
import { Boxes, Brain, ShieldCheck, TrendingUp } from "lucide-react";
import { BrandSymbol } from "./brand-symbol";
import { SegmentosCarousel } from "./segmentos-carousel";

const pilares = [
  {
    icon: Boxes,
    titulo: "Gestão completa",
    texto: "Estoque, compras, vendas e financeiro em um único lugar.",
  },
  {
    icon: TrendingUp,
    titulo: "Mais performance",
    texto: "Automações e indicadores para decisões mais rápidas.",
  },
  {
    icon: Brain,
    titulo: "Operação inteligente",
    texto: "Reposição, alertas e recomendações em tempo real.",
  },
  {
    icon: ShieldCheck,
    titulo: "Controle total",
    texto: "Informações centralizadas e seguras.",
  },
];

/**
 * Coluna institucional do shell de autenticação. Existe para dizer o valor do
 * NoHub em poucos segundos — promessa, quatro pilares e os perfis de operação
 * atendidos — sem competir com o formulário de login à direita.
 */
export function Showcase() {
  return (
    <aside className="relative hidden min-h-0 flex-col overflow-hidden px-8 py-10 md:flex lg:px-14 xl:px-20 xl:py-14">
      {/* Lockup: o símbolo manda, o nome acompanha em peso menor. */}
      <Link
        href="/"
        aria-label="NoHub Market — início"
        className="auth-rise group flex w-fit shrink-0 items-center gap-3"
      >
        <BrandSymbol className="h-9 transition-transform duration-200 group-hover:-translate-y-0.5" />
        <span className="font-display text-[15px] tracking-tight text-[var(--auth-ink-2)]">
          NoHub <span className="text-[var(--auth-muted)]">Market</span>
        </span>
      </Link>

      <div className="flex min-h-0 flex-1 flex-col justify-center pb-4 pt-12 xl:pt-16">
        {/* Título ocupa a largura da coluna: sem medida estreita, sem quebra
            desnecessária. Só duas palavras estratégicas recebem o laranja. */}
        <h2
          className="auth-rise max-w-[22ch] font-display text-[2rem] font-semibold leading-[1.1] tracking-tight text-[var(--auth-ink)] lg:max-w-none lg:text-[2.6rem] xl:text-[3rem]"
          style={{ animationDelay: "100ms" }}
        >
          <span className="text-[var(--auth-brand-text)]">Controle</span> toda a sua operação.
          <br className="hidden lg:block" /> Cresça com{" "}
          <span className="auth-marca text-[var(--auth-brand-text)]">inteligência</span>.
        </h2>

        <p
          className="auth-rise mt-5 max-w-[54ch] text-[15px] leading-relaxed text-[var(--auth-muted)]"
          style={{ animationDelay: "200ms" }}
        >
          Estoque, vendas, financeiro, compras e PDV integrados para mercados, conveniências,
          distribuidoras e lojas de bebidas.
        </p>

        {/* Quatro pilares em cartão de peso mínimo — a leitura é ícone → título
            → uma linha. Em tablet a coluna é estreita demais para 2 colunas. */}
        <ul className="mt-12 grid max-w-3xl gap-x-8 gap-y-7 lg:grid-cols-2 xl:gap-x-12">
          {pilares.map(({ icon: Icon, titulo, texto }, i) => (
            <li
              key={titulo}
              className="auth-rise group flex items-start gap-3.5"
              style={{ animationDelay: `${300 + i * 70}ms` }}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--auth-brand-tint)] text-[var(--auth-brand-text)] transition-all duration-200 group-hover:scale-105 group-hover:shadow-[0_0_0_6px_var(--auth-glow)]">
                <Icon size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[var(--auth-ink)]">{titulo}</p>
                <p className="mt-1 max-w-[34ch] text-[13px] leading-relaxed text-[var(--auth-muted)]">
                  {texto}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-12 max-w-md">
          <SegmentosCarousel />
        </div>
      </div>
    </aside>
  );
}
