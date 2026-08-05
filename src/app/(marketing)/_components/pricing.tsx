import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/misc";
import {
  PLANOS,
  PLANOS_ORDEM,
  ADDONS,
  ADDONS_SLUGS,
  FEATURE_LABEL,
  FEATURES_ORDEM,
  TRIAL_DIAS,
  type Limites,
} from "@/lib/planos";

/**
 * Planos da landing. Lê PLANOS/ADDONS de `lib/planos` — a MESMA fonte que a
 * cobrança e a tela de plano do app usam. Antes esta tela tinha uma tabela
 * própria (Starter/Pro/Multi) com preços que não existiam em lugar nenhum: o
 * visitante assinava esperando um valor e recebia outro.
 *
 * Sem alternador mensal/anual: a assinatura no Mercado Pago é mensal
 * (`frequency_type: "months"`). Enquanto não houver ciclo anual de verdade,
 * mostrar "−2 meses" seria vender um desconto inexistente.
 */
export function Pricing() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-5 lg:grid-cols-3">
        {PLANOS_ORDEM.map((p) => {
          const def = PLANOS[p];
          const destaque = p === "OURO";
          const lim: Limites = def.limites;
          return (
            <div
              key={p}
              className={cn(
                "relative flex flex-col rounded-[var(--radius-lg)] border bg-surface p-6",
                destaque
                  ? "border-brand shadow-[var(--shadow-2)] ring-1 ring-brand lg:-my-2 lg:py-8"
                  : "border-line shadow-[var(--shadow-float)]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-ink">{def.nome}</h3>
                {destaque && <Badge tone="brand">Mais escolhido</Badge>}
              </div>
              <p className="mt-1.5 min-h-[2.5rem] text-[13px] leading-relaxed text-muted">
                {def.descricao}
              </p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold text-ink tnum">
                  {brl(def.preco)}
                </span>
                <span className="text-sm text-muted">/mês</span>
              </div>

              <Link
                href="/cadastro"
                className={cn(
                  "mt-5 inline-flex h-11 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  destaque
                    ? "bg-brand text-on-brand hover:bg-brand-strong"
                    : "border border-line-button bg-surface text-ink hover:bg-surface-2",
                )}
              >
                Testar {TRIAL_DIAS} dias grátis
              </Link>

              <ul className="mt-6 flex flex-col gap-2.5 text-[13px]">
                <Limite texto={limiteTexto(lim.produtos, "produtos")} />
                <Limite texto={limiteTexto(lim.sites, "lojas")} />
                <Limite texto={limiteTexto(lim.usuarios, "usuários")} />
                {FEATURES_ORDEM.filter((f) => def.features.includes(f)).map((f) => (
                  <li key={f} className="flex items-start gap-2 text-ink-2">
                    <Check size={15} className="mt-0.5 shrink-0 text-brand" />
                    {FEATURE_LABEL[f]}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Add-ons — o que se cobra por fora porque tem custo por uso ou por
          unidade. Esconder isso da landing e só mostrar dentro do app seria
          surpresa na fatura. */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-ink">
            Add-ons, quando precisar
          </h3>
          <p className="text-[13px] text-muted">
            Contrate e cancele por dentro do sistema, sem falar com ninguém.
          </p>
        </div>
        <div className="mt-5 grid gap-4 divide-line sm:grid-cols-3 sm:divide-x">
          {ADDONS_SLUGS.map((slug) => {
            const a = ADDONS[slug];
            return (
              <div key={slug} className="flex flex-col gap-1.5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
                <div className="flex items-center gap-2">
                  <Plus size={14} className="text-brand" />
                  <p className="text-sm font-medium text-ink">{a.nome}</p>
                </div>
                <p className="font-mono text-lg text-ink tnum">
                  {brl(a.preco)}
                  <span className="font-sans text-xs text-muted">
                    {a.porUnidade ? " /unidade por mês" : " /mês"}
                  </span>
                </p>
                <p className="text-[13px] leading-relaxed text-muted">{a.descricao}</p>
                <p className="mt-auto pt-1 text-xs text-faint">
                  Requer o plano {PLANOS[a.requerPlano].nome}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[13px] text-muted">
        Cobrança mensal no cartão ou Pix pelo Mercado Pago. Mudou de plano, vale no próximo
        ciclo. Cancele quando quiser, sem multa.
      </p>
    </div>
  );
}

function Limite({ texto }: { texto: string }) {
  return (
    <li className="flex items-start gap-2 font-medium text-ink">
      <Check size={15} className="mt-0.5 shrink-0 text-brand" />
      {texto}
    </li>
  );
}

function limiteTexto(v: number | null, sufixo: string): string {
  return v === null ? `${sufixo[0].toUpperCase()}${sufixo.slice(1)} ilimitados` : `${v} ${sufixo}`;
}
