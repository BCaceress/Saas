import {
  ArrowLeftRight,
  BarChart3,
  ClipboardList,
  LogOut,
  MonitorSmartphone,
  Handshake,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { carregarShell } from "@/lib/shell-context";
import { featureAtiva } from "@/lib/planos";
import { VERSAO_APP } from "@/lib/versao";
import { podeEmAlguma, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { InstalarApp } from "@/components/mobile/instalar-app";
import { LinhaLink } from "@/components/mobile/linha-link";
import { AtivarNotificacoes } from "@/components/mobile/ativar-notificacoes";
import { Card } from "@/components/ui/misc";
import { signOutAction } from "@/app/(app)/actions";

/**
 * O resto do app. Serve de duas coisas: dar acesso ao que não coube nas cinco
 * abas, e ser a porta de saída para a versão completa — quem abriu o `/m` num
 * tablet precisa achar isso no primeiro nível, não enterrado.
 *
 * Os destinos ainda são telas de desktop; conforme as fases entregam as
 * versões `/m`, cada linha troca de href.
 */
export default async function MaisPage() {
  const { ctx, toggles, planoLabel, vocabularioPonto, admin } = await carregarShell();

  const modulos: Array<{
    href: string;
    label: string;
    icone: LucideIcon;
    permissao?: Permissao;
    mostrar?: (t: NavToggles) => boolean;
  }> = [
    // A IA vem primeiro porque perdeu o botão flutuante: no celular ele cobria
    // o canto onde as telas de operação põem suas ações. O portão é o mesmo do
    // desktop (add-on no plano + administrador), e não cabe em `permissao`
    // nem em `mostrar`, que só olham perfil e toggles.
    ...(featureAtiva(ctx.tenant, "ia.copiloto") && admin
      ? [{ href: "/m/ia", label: "NoHub IA", icone: Sparkles }]
      : []),
    { href: "/m/vendas", label: "Vendas", icone: Receipt, permissao: "relatorio.ver" },
    // Sem Caixa: abrir/fechar caixa mora no PDV, na máquina com gaveta e
    // impressora. Um botão aqui só serviria para abrir caixa longe dele.
    { href: "/m/receber", label: "Receber pedidos", icone: Truck, permissao: "compras.receber" },
    { href: "/m/estoque/contagem", label: "Contagem", icone: ClipboardList, permissao: "estoque.inventario" },
    { href: "/m/movimentacoes", label: "Movimentações", icone: ArrowLeftRight, permissao: "estoque.ver" },
    { href: "/m/cotacoes", label: "Cotações", icone: Handshake, permissao: "compras.ver" },
    { href: "/m/pedido", label: "Pedido de compra", icone: ShoppingCart, permissao: "compras.pedir" },
    { href: "/m/etiquetas", label: "Etiquetas", icone: Tag, permissao: "produto.preco" },
    { href: "/m/relatorios", label: "Relatórios", icone: BarChart3, permissao: "relatorio.ver" },
    { href: "/m/produtos", label: "Produtos", icone: Store, permissao: "produto.ver" },
    { href: "/m/clientes", label: "Clientes", icone: Users, permissao: "cliente.ver" },
    {
      href: "/totem",
      label: "Modo autoatendimento",
      icone: MonitorSmartphone,
      permissao: "venda.registrar",
      mostrar: (t) => t.moduloAutoatendimento,
      // Sem selo de "versão de computador": o quiosque é responsivo e roda no
      // próprio tablet, que é justamente onde ele costuma ficar.
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
        {/* Sem o cargo: quem abre o app sabe o que faz na loja — o rótulo do
            perfil só ocupava a linha logo abaixo do nome. */}
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
              <LinhaLink key={m.href} href={m.href}>
                <m.icone className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
                <span className="flex-1 text-sm font-medium text-ink">{m.label}</span>
              </LinhaLink>
            ))}
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-ink">Conta</h2>
        <Card className="divide-y divide-line overflow-hidden">
          {admin && (
            <LinhaLink href="/m/configuracoes">
              <Settings className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1 text-sm font-medium text-ink">Configurações</span>
            </LinhaLink>
          )}

          {/* Sem "usar a versão completa": no aparelho de mão o app é este.
              Quem precisa da tela de mesa abre o app pelo computador. */}
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
        {/* Versão discreta: só serve quando alguém relata um problema — daí o
            tamanho de nota de rodapé, e não de linha da lista. */}
        <p className="px-1 text-center font-mono text-[11px] text-faint">
          {VERSAO_APP}
        </p>
      </section>
    </div>
  );
}
