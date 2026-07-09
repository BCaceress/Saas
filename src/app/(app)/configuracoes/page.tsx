import Link from "next/link";
import {
  MapPin,
  CreditCard,
  Scale,
  Gift,
  Building2,
  UserCog,
  Blocks,
  Warehouse,
  Wallet,
  Bell,
  MonitorSmartphone,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";

const CARDS: {
  href: string;
  icon: LucideIcon;
  tone?: "accent";
  title: string;
  description: string;
}[] = [
  {
    href: "/configuracoes/autoatendimento",
    icon: MonitorSmartphone,
    title: "Autoatendimento",
    description: "PIN de saída do modo quiosque e acesso ao totem.",
  },
  {
    href: "/configuracoes/caixa",
    icon: Wallet,
    title: "Caixa",
    description: "Fundo de troco padrão e limite de dinheiro na gaveta.",
  },
  {
    href: "/configuracoes/classificacao-fiscal",
    icon: Scale,
    title: "Classificação fiscal",
    description: "Perfis fiscais e vínculo por subcategoria.",
  },
  {
    href: "/configuracoes/empresa",
    icon: Building2,
    title: "Empresa",
    description: "Nome, CNPJ, contato e endereço do seu mercado.",
  },
  {
    href: "/configuracoes/estoque",
    icon: Warehouse,
    title: "Estoque e alertas",
    description: "Mínimo padrão, produto parado e contagem no recebimento.",
  },
  {
    href: "/configuracoes/fidelizacao",
    icon: Gift,
    tone: "accent",
    title: "Fidelização",
    description: "Cupons de retorno e aniversário, envio automático por WhatsApp.",
  },
  {
    href: "/configuracoes/sites",
    icon: MapPin,
    title: "Lojas e pontos",
    description: "Gerencie lojas, pontos e centros de distribuição.",
  },
  {
    href: "/configuracoes/metodos-pagamento",
    icon: CreditCard,
    title: "Métodos de pagamento",
    description: "Defina as formas de pagamento aceitas por loja.",
  },
  {
    href: "/configuracoes/modulos",
    icon: Blocks,
    title: "Módulos",
    description: "Ligue PDV, fiscal, comodato e rota conforme a operação.",
  },
  {
    href: "/configuracoes/notificacoes",
    icon: Bell,
    title: "Notificações",
    description: "Escolha quais grupos de alerta aparecem no sino.",
  },
  {
    href: "/configuracoes/usuarios",
    icon: UserCog,
    title: "Usuários",
    description: "Convide a equipe e defina o papel de cada pessoa.",
  },
];

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
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
          >
            <span
              className={
                c.tone === "accent"
                  ? "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
                  : "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
              }
            >
              <c.icon size={18} />
            </span>
            <div>
              <p className="font-semibold text-ink">{c.title}</p>
              <p className="mt-0.5 text-sm text-muted">{c.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
