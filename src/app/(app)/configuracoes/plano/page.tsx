import { Check, Lock, Sparkles } from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { basePrisma, db } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/misc";
import { brl, cn } from "@/lib/utils";
import {
  PLANOS,
  PLANOS_ORDEM,
  ADDONS,
  ADDONS_SLUGS,
  limitesDe,
  planoAtendeOuSuperior,
  ehAddonSlug,
  type Feature,
  type Limites,
} from "@/lib/planos";

export const metadata = { title: "Plano — NoHub Market" };

/** Rótulo de cada feature na tabela comparativa. Ordem = ordem de exibição. */
const FEATURE_LABEL: Record<Feature, string> = {
  pdv: "PDV com operador e caixa",
  autoatendimento: "Autoatendimento (totem)",
  fiscal: "Emissão fiscal (NFC-e / NF-e)",
  comodato: "Comodato de ativos",
  rota: "Rota de reposição",
  "compras.recebimento": "Recebimento e entrada por pedido",
  "crm.fidelizacao": "Fidelização e cupons",
  "equipe.perfis": "Perfis de acesso por loja",
  "relatorios.avancados": "Curva ABC, giro e histórico",
  "relatorios.exportar": "Exportar relatórios em CSV",
  multiloja: "Mais de uma loja",
  api: "API e integrações",
};

const FEATURES_ORDEM = Object.keys(FEATURE_LABEL) as Feature[];

function limiteTexto(v: number | null, sufixo: string): string {
  return v === null ? `${sufixo} ilimitados` : `${v} ${sufixo}`;
}

/** Uso × teto. Passar do teto é possível em downgrade — mostrar em âmbar. */
function Uso({ label, usados, limite }: { label: string; usados: number; limite: number | null }) {
  const estourou = limite !== null && usados > limite;
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-xs tracking-wide text-muted uppercase">{label}</span>
      <span className={cn("font-mono text-lg", estourou ? "text-warn" : "text-ink")}>
        {usados}
        <span className="text-muted"> / {limite === null ? "∞" : limite}</span>
      </span>
    </div>
  );
}

export default async function PlanoPage() {
  const ctx = await requireActiveTenant();
  const { tenant } = ctx;
  const atual = tenant.plano;
  const limites = limitesDe(tenant);

  const [sites, produtos, usuarios] = await Promise.all([
    withTenant(ctx, () => db.site.count()),
    withTenant(ctx, () => db.product.count({ where: { ativo: true } })),
    basePrisma.membership.count({ where: { tenantId: tenant.id, ativo: true } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plano e add-ons"
        icon={Sparkles}
        description="O que sua assinatura cobre hoje e o que muda ao subir de plano."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />

      {/* Uso contra os limites — num grid único com divisores, não em cards soltos. */}
      <div className="grid grid-cols-1 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Uso label="Lojas" usados={sites} limite={limites.sites} />
        <Uso label="Usuários" usados={usuarios} limite={limites.usuarios} />
        <Uso label="Produtos ativos" usados={produtos} limite={limites.produtos} />
      </div>

      {/* Planos */}
      <div className="grid gap-3 lg:grid-cols-3">
        {PLANOS_ORDEM.map((p) => {
          const def = PLANOS[p];
          const ehAtual = p === atual;
          const lim: Limites = def.limites;
          return (
            <div
              key={p}
              className={cn(
                "flex flex-col gap-4 rounded-[var(--radius-lg)] border bg-surface p-5",
                ehAtual ? "border-brand ring-1 ring-brand" : "border-line",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold text-ink">{def.nome}</p>
                  <p className="mt-0.5 text-sm text-muted">{def.descricao}</p>
                </div>
                {ehAtual && <Badge tone="brand">Plano atual</Badge>}
              </div>

              <p className="font-mono text-2xl text-ink">
                {brl(def.preco)}
                <span className="text-sm text-muted"> /mês</span>
              </p>

              <ul className="flex flex-col gap-1.5 text-sm text-muted">
                <li className="text-ink">{limiteTexto(lim.sites, "lojas")}</li>
                <li className="text-ink">{limiteTexto(lim.usuarios, "usuários")}</li>
                <li className="text-ink">{limiteTexto(lim.produtos, "produtos")}</li>
                {FEATURES_ORDEM.filter((f) => def.features.includes(f)).map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={15} className="mt-0.5 shrink-0 text-ok" />
                    {FEATURE_LABEL[f]}
                  </li>
                ))}
              </ul>

              {!ehAtual && (
                <p className="mt-auto text-sm text-accent">
                  {planoAtendeOuSuperior(atual, p)
                    ? "Abaixo do seu plano atual."
                    : `Fale com a gente para subir para ${def.nome}.`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-ons — o que se cobra por fora porque custa por uso ou por unidade. */}
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-base font-semibold text-ink">Add-ons</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADDONS_SLUGS.map((slug) => {
            const a = ADDONS[slug];
            const contratado = tenant.addons.some((s) => ehAddonSlug(s) && s === slug);
            const podeContratar = planoAtendeOuSuperior(atual, a.requerPlano);
            return (
              <div
                key={slug}
                className={cn(
                  "flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-surface p-5",
                  contratado ? "border-brand" : "border-line",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-ink">{a.nome}</p>
                  {contratado && <Badge tone="ok">Ativo</Badge>}
                </div>
                <p className="text-sm text-muted">{a.descricao}</p>
                <p className="font-mono text-ink">
                  {brl(a.preco)}
                  <span className="text-sm text-muted">
                    {a.porUnidade ? " /unidade por mês" : " /mês"}
                  </span>
                </p>
                {!contratado && !podeContratar && (
                  <p className="flex items-center gap-1.5 text-sm text-accent">
                    <Lock size={13} />
                    Requer o plano {PLANOS[a.requerPlano].nome}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted">
        Mudança de plano e contratação de add-on ainda passam pelo nosso time — fale com o
        suporte e a liberação sai no mesmo dia.
      </p>
    </div>
  );
}
