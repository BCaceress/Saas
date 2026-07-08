import {
  LayoutDashboard,
  Boxes,
  Warehouse,
  Users,
  UserCog,
  ShoppingCart,
  ShoppingBag,
  ClipboardList,
  BarChart3,
  Wallet,
  Settings,
  Recycle,
  Truck,
  Factory,
  type LucideIcon,
} from "lucide-react";

/**
 * Mapa único de navegação do app — fonte de verdade para Sidebar e PageHeader.
 * Ícone, rótulo e rota vivem aqui; sidebar e cabeçalhos consomem o mesmo item,
 * então menu e página nunca divergem.
 */

export type NavToggles = {
  moduloPdv: boolean;
  moduloComodato: boolean;
  moduloRota: boolean;
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Módulo implementado? false = "Em breve" (não navegável). */
  enabled: boolean;
  /** Visibilidade condicionada aos toggles do tenant (default: sempre). */
  show?: (t: NavToggles) => boolean;
};

export type NavGroup = { title: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { href: "/inicio", label: "Dashboard", icon: LayoutDashboard, enabled: true },
    ],
  },
  {
    title: "Gestão",
    items: [
      { href: "/produtos", label: "Produtos", icon: Boxes, enabled: true },
      { href: "/clientes", label: "Clientes", icon: Users, enabled: true },
      { href: "/fornecedores", label: "Fornecedores", icon: Factory, enabled: true },
      { href: "/estoque", label: "Estoque", icon: Warehouse, enabled: true },
      { href: "/compras", label: "Compras", icon: ShoppingBag, enabled: true },
    ],
  },
  {
    title: "Operação",
    items: [
      {
        href: "/vendas",
        label: "PDV",
        icon: ShoppingCart,
        enabled: true,
        show: (t) => t.moduloPdv,
      },
      {
        href: "/vendas/totem",
        label: "Autoatendimento",
        icon: ShoppingCart,
        enabled: true,
        show: (t) => !t.moduloPdv,
      },
      { href: "/pedidos", label: "Pedidos", icon: ClipboardList, enabled: false },
      {
        href: "/rota",
        label: "Reposição",
        icon: Truck,
        enabled: false,
        show: (t) => t.moduloRota,
      },
      {
        href: "/comodato",
        label: "Comodato",
        icon: Recycle,
        enabled: false,
        show: (t) => t.moduloComodato,
      },
      { href: "/financeiro", label: "Financeiro", icon: Wallet, enabled: false },
      { href: "/relatorios", label: "Análises", icon: BarChart3, enabled: true },
    ],
  },
  {
    title: "Sistema",
    items: [
      {
        href: "/configuracoes/usuarios",
        label: "Usuários",
        icon: UserCog,
        enabled: false,
      },
      { href: "/configuracoes", label: "Configurações", icon: Settings, enabled: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Ícone do menu para uma rota — casa o prefixo mais específico
 * (ex.: /configuracoes/usuarios vence /configuracoes).
 */
export function navIcon(href: string): LucideIcon | undefined {
  const match = ALL_ITEMS.filter(
    (i) => href === i.href || href.startsWith(i.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.icon;
}
