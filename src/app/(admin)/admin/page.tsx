import { Building2 } from "lucide-react";
import { requireSuperAdmin } from "@/lib/admin";
import { basePrisma } from "@/lib/prisma";
import { precoMensal } from "@/lib/assinatura";
import { PLANOS, PLANOS_ORDEM } from "@/lib/planos";
import { brl } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast";
import { TabelaTenants, type LinhaTenant } from "./_client";

export const metadata = { title: "Back-office — NoHub" };
export const dynamic = "force-dynamic";

// ============================================================
// Back-office da equipe NoHub: uma tela, a lista de clientes e as três coisas
// que o suporte precisa fazer sem abrir o banco — mudar plano, mexer no
// acesso, esticar o teste.
// ============================================================

export default async function AdminPage() {
  await requireSuperAdmin();

  const tenants = await basePrisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nome: true,
      subdomain: true,
      plano: true,
      status: true,
      addons: true,
      lojasExtras: true,
      trialEndsAt: true,
      createdAt: true,
      emailContato: true,
      subscription: {
        select: {
          status: true,
          gateway: true,
          valorMensal: true,
          proximaCobranca: true,
        },
      },
      _count: { select: { memberships: true, products: true } },
    },
  });

  const linhas: LinhaTenant[] = tenants.map((t) => ({
    id: t.id,
    nome: t.nome,
    subdomain: t.subdomain,
    plano: t.plano,
    status: t.status,
    trialAte: t.trialEndsAt?.toISOString() ?? null,
    criadoEm: t.createdAt.toISOString(),
    email: t.emailContato,
    usuarios: t._count.memberships,
    produtos: t._count.products,
    assinatura: t.subscription
      ? {
          status: t.subscription.status,
          gateway: t.subscription.gateway,
          valor: t.subscription.valorMensal ? Number(t.subscription.valorMensal) : null,
          proximaCobranca: t.subscription.proximaCobranca?.toISOString() ?? null,
        }
      : null,
    precoTabela: precoMensal({ plano: t.plano, addons: t.addons, lojasExtras: t.lojasExtras }),
  }));

  // MRR conta só quem está pagando de fato — trial e suspenso não são receita.
  const mrr = linhas
    .filter((l) => l.assinatura?.status === "ATIVA")
    .reduce((s, l) => s + (l.assinatura?.valor ?? l.precoTabela), 0);

  const porStatus = linhas.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.18em] text-brand uppercase">
            Equipe NoHub
          </p>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
            <Building2 size={22} className="text-brand" aria-hidden />
            Clientes
          </h1>
        </div>
        <p className="text-sm text-muted">
          {linhas.length} {linhas.length === 1 ? "loja" : "lojas"} cadastradas
        </p>
      </header>

      {/* Números do negócio num grid único com divisores — não em cards soltos. */}
      <div className="grid grid-cols-2 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Metrica label="MRR" valor={brl(mrr)} destaque />
        <Metrica label="Pagando" valor={String(porStatus["ACTIVE"] ?? 0)} />
        <Metrica label="Em teste" valor={String(porStatus["TRIAL"] ?? 0)} />
        <Metrica label="Suspensos" valor={String(porStatus["SUSPENDED"] ?? 0)} />
      </div>

      <TabelaTenants
        linhas={linhas}
        planos={PLANOS_ORDEM.map((p) => ({ id: p, nome: PLANOS[p].nome }))}
      />
      <Toaster />
    </div>
  );
}

function Metrica({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
      <span className={`font-mono text-lg ${destaque ? "text-brand" : "text-ink"}`}>{valor}</span>
    </div>
  );
}
