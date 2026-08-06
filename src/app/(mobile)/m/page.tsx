import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardList, ScanLine, Truck, Wallet, type LucideIcon } from "lucide-react";
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
import { PrecisaDeVoce } from "./_precisa-de-voce";
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
 * baratas) e entrega cada bloco pesado ao seu próprio `<Suspense>`. Nenhuma
 * consulta nova: tudo vem dos carregadores que o dashboard de desktop já usa.
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

  const primeiroNome = ctx.user.name?.split(" ")[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl leading-tight font-semibold text-ink">
          {saudacao()}
          {primeiroNome ? `, ${primeiroNome}` : ""}
        </h1>
        <p className="text-sm text-ink-2">Sua operação de hoje.</p>
      </div>

      <Suspense fallback={<KpisFallback />}>
        <KpisSection d={d} />
      </Suspense>

      <PrecisaDeVoce />

      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-ink">Operação</h2>
        <Suspense fallback={<OperacaoFallback />}>
          <OperacaoSection d={d} />
        </Suspense>
      </section>

      <Atalhos acessos={ctx.acessos} pdv={toggles.moduloPdv} />

      <InstalarApp />
    </div>
  );
}

/** Quatro alvos grandes para as tarefas que se fazem em pé. */
function Atalhos({ acessos, pdv }: { acessos: Acesso[]; pdv: boolean }) {
  const itens: Array<{ href: string; label: string; icone: LucideIcon; mostrar: boolean }> = [
    {
      href: "/m/scan",
      label: "Escanear",
      icone: ScanLine,
      mostrar: podeEmAlguma(acessos, "produto.ver"),
    },
    {
      href: "/m/estoque/contagem",
      label: "Contar",
      icone: ClipboardList,
      mostrar: podeEmAlguma(acessos, "estoque.inventario"),
    },
    {
      href: "/m/receber",
      label: "Receber",
      icone: Truck,
      mostrar: podeEmAlguma(acessos, "compras.receber"),
    },
    {
      href: "/m/caixa",
      label: "Caixa",
      icone: Wallet,
      mostrar: pdv && podeEmAlguma(acessos, "caixa.abrir"),
    },
  ];

  const visiveis = itens.filter((i) => i.mostrar);
  if (visiveis.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold text-ink">Ações rápidas</h2>
      <div className="grid grid-cols-2 gap-2">
        {visiveis.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-line bg-surface text-ink transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            <i.icone className="h-5 w-5 text-brand" aria-hidden />
            <span className="text-sm font-medium">{i.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
