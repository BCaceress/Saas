import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardList,
  PackageSearch,
  ScanLine,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import type { Range } from "@/app/(app)/relatorios/_data";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma, type Acesso } from "@/lib/permissoes";
import { togglesEfetivos } from "@/lib/planos";
import { saudacao } from "@/app/(app)/inicio/_insights";
import { rotaInicialMobile } from "@/components/mobile/nav";
import { InstalarApp } from "@/components/mobile/instalar-app";
import { Bolha, MCardLink, SecaoTitulo } from "@/components/mobile/ui";
import { PrecisaDeVoce } from "./_precisa-de-voce";
import { UltimasFallback, UltimasSection, VerExtrato } from "./_ultimas";
import {
  KpisSection,
  KpisFallback,
  OperacaoSection,
  OperacaoFallback,
  type MobileCtx,
} from "./_sections";

/**
 * Home do celular. Responde três perguntas em dez segundos, de pé: quanto
 * vendi hoje, o que está pegando fogo, e o que eu faço agora.
 *
 * A página é só a casca — resolve site, período e permissões (leituras
 * baratas) e entrega cada bloco pesado ao seu próprio `<Suspense>`. Os blocos
 * usam os mesmos carregadores do dashboard de desktop (ver `_sections.tsx`).
 *
 * O período é fixo em HOJE, sem filtro. Escolher intervalo é trabalho de mesa;
 * quem abre o app no salão quer o número do dia.
 */
export default async function MobileHome() {
  const ctx = await requireActiveTenant();
  const toggles = togglesEfetivos(ctx.tenant);

  // A home é toda feita de faturamento e margem. Sem `relatorio.ver` ela seria
  // uma tela em branco — melhor cair na primeira aba que a pessoa consegue
  // usar do que numa home vazia.
  if (!podeEmAlguma(ctx.acessos, "relatorio.ver")) {
    redirect(rotaInicialMobile(ctx.acessos, toggles));
  }

  const periodo = resolvePeriodo({ periodo: "hoje" });
  const siteId = await withTenant(ctx, () => getActiveSiteId());

  // Os Range nascem AQUI e descem por referência: os carregadores de
  // `relatorios/_data.ts` são memoizados por identidade de argumento.
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prevRange: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };

  const d: MobileCtx = {
    ctx,
    range,
    prevRange,
    siteId,
    policy: policyDoTenant(ctx.tenant),
    validadeAlertaDias: ctx.tenant.validadeAlertaDias || 30,
  };

  // Quem está logado, escrito como a pessoa se cadastrou. Sem nome, o começo
  // do e-mail — é o que ela digitou para entrar, então reconhece.
  const nomeUsuario = ctx.user.name?.trim() || ctx.user.email?.split("@")[0];

  return (
    // Ritmo da tela: 24px entre blocos, 8px dentro de cada um. Nenhum valor
    // fora da escala de 8 — é o que tira a sensação de caixas empilhadas.
    <div className="space-y-6">
      {/* A home não usa a barra do topo (ver `MobileShell`): quem cumprimenta é
          a própria tela. Saudação com o nome é a manchete; a empresa ocupa a
          direita, onde antes ficava o sino — pendências já têm aba própria e o
          bloco "Precisa de você" logo abaixo, então o sino era terceira via
          para a mesma coisa. */}
      <header className="fade-up space-y-3">
        {/* Barra de identidade: de um lado de quem é o app, do outro de quem é
            a loja. Nenhum dos dois é navegação — o que leva a algum lugar é o
            bloco da direita, que abre "Mais" (empresa, plano, sair). */}
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="block h-8 w-36 shrink-0 overflow-hidden rounded-[10px]">
            {/* O arquivo é um mockup 1536×1024 com o desenho numa faixa
                central: `object-cover` numa caixa 4,5:1 corta a sobra em cima
                e embaixo, senão o wordmark encolhe até sumir. */}
            <Image
              src="/images/logoTextoVertical.png"
              alt="NoHub Market"
              width={1536}
              height={1024}
              priority
              className="h-full w-full object-cover"
            />
          </span>

          <Link
            href="/m/mais"
            className="tap flex min-w-0 items-center gap-2 rounded-full py-0.5 pl-1 text-right focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <span className="min-w-0 truncate text-[13px] font-medium text-ink-2">
              {ctx.tenant.nome}
            </span>
            {ctx.tenant.logoUrl ? (
              // <img> e não next/image: a logo da empresa é data URL gravada no
              // cadastro (ver Configurações → Empresa), não um host remoto.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ctx.tenant.logoUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full border border-line bg-surface object-contain"
              />
            ) : (
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-sm font-semibold text-brand"
                aria-hidden
              >
                {ctx.tenant.nome.trim().charAt(0).toUpperCase()}
              </span>
            )}
          </Link>
        </div>

        {/* A manchete da tela: quem está de plantão e o que ela vai ler. */}
        <div className="px-1">
          <h1 className="font-display text-[22px] leading-tight font-semibold text-ink">
            {saudacao()}
            {nomeUsuario ? `, ${nomeUsuario}` : ""}
          </h1>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">
            Aqui está o que aconteceu na sua loja hoje.
          </p>
        </div>
      </header>

      <div className="fade-up" style={{ animationDelay: "60ms" }}>
        <Suspense fallback={<KpisFallback />}>
          <KpisSection d={d} />
        </Suspense>
      </div>

      <PrecisaDeVoce />

      <section className="fade-up space-y-2" style={{ animationDelay: "120ms" }}>
        <SecaoTitulo
          acao={
            <Link
              href="/m/alertas"
              className="shrink-0 text-[13px] font-medium text-accent hover:underline"
            >
              Ver todas
            </Link>
          }
        >
          Operação
        </SecaoTitulo>
        <Suspense fallback={<OperacaoFallback />}>
          <OperacaoSection d={d} />
        </Suspense>
      </section>

      {podeEmAlguma(ctx.acessos, "estoque.ver") && (
        <section className="fade-up space-y-2" style={{ animationDelay: "150ms" }}>
          <SecaoTitulo acao={<VerExtrato />}>Últimas movimentações</SecaoTitulo>
          <Suspense fallback={<UltimasFallback />}>
            <UltimasSection d={d} />
          </Suspense>
        </section>
      )}

      <div className="fade-up" style={{ animationDelay: "180ms" }}>
        <Atalhos acessos={ctx.acessos} />
      </div>

      <InstalarApp />
    </div>
  );
}

/** Alvos grandes para as tarefas que se fazem em pé. */
function Atalhos({ acessos }: { acessos: Acesso[] }) {
  const itens: Array<{
    href: string;
    label: string;
    descricao: string;
    icone: LucideIcon;
    mostrar: boolean;
  }> = [
    {
      href: "/m/scan",
      label: "Escanear",
      descricao: "Buscar produto",
      icone: ScanLine,
      mostrar: podeEmAlguma(acessos, "produto.ver"),
    },
    {
      href: "/m/estoque/contagem",
      label: "Contar",
      descricao: "Inventário rápido",
      icone: ClipboardList,
      mostrar: podeEmAlguma(acessos, "estoque.inventario"),
    },
    {
      href: "/m/receber",
      label: "Receber",
      descricao: "Receber mercadoria",
      icone: Truck,
      mostrar: podeEmAlguma(acessos, "compras.receber"),
    },
    // Caixa saiu do celular: abrir/fechar caixa é trabalho de PDV, feito na
    // máquina que tem gaveta e impressora (ver `/m/mais` e `nav.ts`).
    {
      href: "/m/produtos",
      label: "Produtos",
      descricao: "Consultar cadastro",
      icone: PackageSearch,
      mostrar: podeEmAlguma(acessos, "produto.ver"),
    },
  ];

  const visiveis = itens.filter((i) => i.mostrar);
  if (visiveis.length === 0) return null;

  return (
    <section className="space-y-2">
      <SecaoTitulo>Ações rápidas</SecaoTitulo>
      {/* Ícone + rótulo + descrição lado a lado, não empilhado: lê mais como
          atalho de app (o texto some, e ainda cabe o dedo de pé).
          Um tom só (âmbar, a etiqueta de preço da marca) e silhueta quadrada:
          aqui a cor não classifica nada — classificar é trabalho da faixa de
          operação, onde ela quer dizer urgência. */}
      <div className="grid grid-cols-2 gap-2">
        {visiveis.map((i) => (
          <MCardLink
            key={i.href}
            href={i.href}
            className="flex min-h-20 items-center gap-3 p-4 text-ink"
          >
            <Bolha icone={i.icone} tom="accent" tamanho="md" forma="quadrada" />
            <span className="min-w-0">
              <span className="block text-base leading-tight font-medium">{i.label}</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted">{i.descricao}</span>
            </span>
          </MCardLink>
        ))}
      </div>
    </section>
  );
}
