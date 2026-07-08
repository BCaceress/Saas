import Link from "next/link";
import { MapPin, CreditCard, Scale, Gift } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";

export default function ConfiguracoesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Configurações"
        icon={navIcon("/configuracoes")}
        description="Gerencie as configurações da sua operação."
        innerClassName="max-w-none"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/configuracoes/sites"
          className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <MapPin size={18} />
          </span>
          <div>
            <p className="font-semibold text-ink">Lojas e pontos</p>
            <p className="mt-0.5 text-sm text-muted">
              Gerencie lojas, pontos e centros de distribuição.
            </p>
          </div>
        </Link>
        <Link
          href="/configuracoes/metodos-pagamento"
          className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <CreditCard size={18} />
          </span>
          <div>
            <p className="font-semibold text-ink">Métodos de pagamento</p>
            <p className="mt-0.5 text-sm text-muted">
              Defina as formas de pagamento aceitas por loja.
            </p>
          </div>
        </Link>
        <Link
          href="/configuracoes/fidelizacao"
          className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Gift size={18} />
          </span>
          <div>
            <p className="font-semibold text-ink">Fidelização</p>
            <p className="mt-0.5 text-sm text-muted">
              Cupons de retorno e aniversário, envio automático por WhatsApp.
            </p>
          </div>
        </Link>
        <Link
          href="/configuracoes/classificacao-fiscal"
          className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Scale size={18} />
          </span>
          <div>
            <p className="font-semibold text-ink">Classificação fiscal</p>
            <p className="mt-0.5 text-sm text-muted">
              Perfis fiscais e vínculo por subcategoria.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
