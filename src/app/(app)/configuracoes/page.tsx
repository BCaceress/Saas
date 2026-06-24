import Link from "next/link";
import { MapPin, CreditCard } from "lucide-react";

export default function ConfiguracoesPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Configurações</h1>
        <p className="text-sm text-muted">
          Gerencie as configurações da sua operação.
        </p>
      </div>
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
      </div>
    </div>
  );
}
