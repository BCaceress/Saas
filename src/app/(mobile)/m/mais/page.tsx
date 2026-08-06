import Link from "next/link";
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { carregarShell } from "@/lib/shell-context";
import { podeEmAlguma, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { InstalarApp } from "@/components/mobile/instalar-app";
import { AtivarNotificacoes } from "@/components/mobile/ativar-notificacoes";
import { Card } from "@/components/ui/misc";
import { signOutAction } from "@/app/(app)/actions";
import { usarVersaoCompletaAction } from "./actions";

/**
 * O resto do app. Serve de duas coisas: dar acesso ao que não coube nas cinco
 * abas, e ser a porta de saída para a versão completa — quem abriu o `/m` num
 * tablet precisa achar isso no primeiro nível, não enterrado.
 *
 * Os destinos ainda são telas de desktop; conforme as fases entregam as
 * versões `/m`, cada linha troca de href.
 */
export default async function MaisPage() {
  const { ctx, toggles, cargoLabel, planoLabel, vocabularioPonto, admin } =
    await carregarShell();

  const modulos: Array<{
    href: string;
    label: string;
    icone: LucideIcon;
    permissao?: Permissao;
    mostrar?: (t: NavToggles) => boolean;
    /** Abre na versão de computador — avisado na lista. */
    desktop?: boolean;
  }> = [
    { href: "/m/vendas", label: "Vendas", icone: Receipt, permissao: "relatorio.ver" },
    { href: "/m/caixa", label: "Caixa", icone: Wallet, permissao: "caixa.abrir", mostrar: (t) => t.moduloPdv },
    { href: "/m/receber", label: "Receber pedidos", icone: Truck, permissao: "compras.receber" },
    { href: "/m/estoque/contagem", label: "Contagem", icone: ClipboardList, permissao: "estoque.inventario" },
    { href: "/m/aprovacoes", label: "Aprovações", icone: ShoppingCart, permissao: "compras.pedir" },
    { href: "/m/relatorios", label: "Relatórios", icone: BarChart3, permissao: "relatorio.ver" },
    { href: "/produtos", label: "Produtos", icone: Store, permissao: "produto.ver", desktop: true },
    { href: "/clientes", label: "Clientes", icone: Users, permissao: "cliente.ver", desktop: true },
    {
      href: "/totem",
      label: "Modo autoatendimento",
      icone: MonitorSmartphone,
      permissao: "venda.registrar",
      mostrar: (t) => t.moduloAutoatendimento,
      desktop: true,
    },
  ];

  const visiveis = modulos.filter(
    (m) =>
      (!m.mostrar || m.mostrar(toggles)) &&
      (!m.permissao || podeEmAlguma(ctx.acessos, m.permissao)),
  );

  return (
    <div className="space-y-5">
      <MobilePageHeader titulo="Mais" />

      <Card className="p-4">
        <p className="font-display text-base font-semibold text-ink">
          {ctx.user.name ?? ctx.user.email}
        </p>
        <p className="text-sm text-ink-2">{cargoLabel}</p>
        <p className="mt-1 text-xs text-muted">
          {ctx.tenant.nome} · {planoLabel} · {vocabularioPonto.toLowerCase()}
        </p>
      </Card>

      <InstalarApp />

      {/* A chave VAPID desce como prop, não como NEXT_PUBLIC_: ela é pública
          por definição, mas manter tudo que é segredo-adjacente fora do bundle
          evita que a próxima chave siga o mesmo caminho por hábito. */}
      {process.env.VAPID_PUBLIC_KEY && (
        <AtivarNotificacoes chavePublica={process.env.VAPID_PUBLIC_KEY} />
      )}

      {visiveis.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-ink">Ir para</h2>
          <Card className="divide-y divide-line overflow-hidden">
            {visiveis.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <m.icone className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
                <span className="flex-1 text-sm font-medium text-ink">{m.label}</span>
                {/* Dizer antes evita a surpresa de cair numa tela de mesa. */}
                {m.desktop && (
                  <Monitor className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="Abre na versão de computador" />
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </Link>
            ))}
          </Card>
          <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
            <Monitor className="h-3 w-3" aria-hidden />
            abre na versão de computador
          </p>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-ink">Conta</h2>
        <Card className="divide-y divide-line overflow-hidden">
          {admin && (
            <Link
              href="/configuracoes"
              className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Settings className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1 text-sm font-medium text-ink">Configurações</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            </Link>
          )}

          <form action={usarVersaoCompletaAction}>
            <button
              type="submit"
              className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <Monitor className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">
                  Usar a versão completa
                </span>
                <span className="block text-xs text-muted">
                  Todos os módulos, feita para tela grande
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            </button>
          </form>

          <form action={signOutAction}>
            <button
              type="submit"
              className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-danger transition-colors hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden />
              <span className="flex-1 text-sm font-medium">Sair</span>
            </button>
          </form>
        </Card>
      </section>
    </div>
  );
}
